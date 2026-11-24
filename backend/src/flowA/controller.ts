// Flow A on the glasses: one card at a time.
//   idle -> request card ("Ada asks for your Solana address") -> confirmation card -> tap -> sent
// Rules enforced here, in code:
//   - the address on the card and in the message comes from the vault, never from the AI or the chat;
//   - the recipient is the chat of the request card on screen, never something parsed from speech;
//   - the chain must match what was asked for;
//   - one tap sends exactly one message: the confirmation is consumed before sending, and never retried.
import { randomBytes } from 'node:crypto'
import { type Chain, CHAINS, type Family, chainDisplay, fingerprint } from '../vault/addresses.ts'
import { type VaultEntry, VaultStore, entryLabel } from '../vault/store.ts'
import { type IntentParser, RuleIntentParser } from './intent.ts'
import { quoteUntrusted } from './requests.ts'

export interface MessageSender {
  /** Sends text to a Telegram chat as the user. Resolves with the sent message id. Must not retry by itself. */
  send(chatId: number, text: string): Promise<number>
}

export type AddressRequest = {
  id: string
  chatId: number
  chatTitle: string
  fromName: string
  text: string
  chain?: Chain
  family?: Family
  receivedAt: number
  /** Telegram message id, to drop duplicates. */
  messageId?: number
}

type Confirmation = {
  id: string
  request: AddressRequest
  entry: VaultEntry
  message: string
  state: 'awaiting' | 'sending'
}

export type CardView = {
  id: string
  kind: 'idle' | 'request' | 'confirm' | 'sending' | 'sent' | 'error' | 'checking' | 'verdict'
  text: string
  /** What a single tap does on this card. */
  tap: 'confirm' | 'none'
  /** What a double tap does: cancel/dismiss, or exit the app on the idle root card. */
  doubleTap: 'cancel' | 'exit'
  version: number
}

const FLASH_MS = 4000

/** The outgoing message. Built by code from the vault entry only. */
export function buildAddressReply(entry: VaultEntry): string {
  return `My ${chainDisplay(entry.chain)} address:\n${entry.address}`
}

export class FlowAController {
  private requests: AddressRequest[] = []
  private confirmation: Confirmation | undefined
  private flash: { kind: 'sent' | 'error'; text: string; until: number; id: string } | undefined
  private version = 1

  constructor(
    private readonly store: VaultStore,
    private readonly sender: MessageSender,
    private readonly parser: IntentParser = new RuleIntentParser(),
    private readonly now: () => number = Date.now,
    private readonly log: (line: string) => void = () => {},
  ) {}

  private bump(): void {
    this.version++
  }

  private setFlash(kind: 'sent' | 'error', text: string, ms = FLASH_MS): void {
    this.flash = { kind, text, until: this.now() + ms, id: `f-${randomBytes(4).toString('hex')}` }
    this.bump()
  }

  /** Adds an incoming request (from the Telegram listener, or the dev endpoint). Ignores duplicates. */
  addRequest(r: Omit<AddressRequest, 'id' | 'receivedAt'>): AddressRequest | undefined {
    if (r.messageId !== undefined && this.requests.some((x) => x.chatId === r.chatId && x.messageId === r.messageId)) return undefined
    const req: AddressRequest = { ...r, text: quoteUntrusted(r.text, 120), id: `r-${randomBytes(4).toString('hex')}`, receivedAt: this.now() }
    this.requests.push(req)
    this.log(`request queued from chat ${r.chatId}${r.chain ? ` (${r.chain})` : ''}`)
    this.bump()
    return req
  }

  /** Handles a voice transcript or typed command for the card on screen. */
  async command(text: string): Promise<CardView> {
    const request = this.requests[0]
    if (!request) {
      this.setFlash('error', 'Nothing to answer yet.\nNo address requests are waiting.')
      return this.view()
    }
    const labels = this.store.list().map((e) => ({ chain: e.chain, name: e.name }))
    let intent
    try {
      intent = await this.parser.parse(text, { labels, requestChain: request.chain })
    } catch (err) {
      this.log(`intent parser failed: ${err instanceof Error ? err.message : String(err)}`)
      intent = { action: 'unknown' as const }
    }

    if (intent.action === 'cancel') return this.cancel()
    if (intent.action === 'next') return this.next()
    if (intent.action === 'unknown') {
      this.setFlash('error', `Didn't catch that.\nSay: send my ${request.chain ? chainDisplay(request.chain) : 'Solana'} address`)
      return this.view()
    }

    const chain = intent.chain ?? request.chain
    if (!chain) {
      this.setFlash('error', 'Which chain?\nSay: send my Solana address')
      return this.view()
    }
    // Chain safety: never send an address of a different chain than the one asked for.
    if (request.chain && request.chain !== chain) {
      this.setFlash('error', `They asked for ${chainDisplay(request.chain)},\nnot ${chainDisplay(chain)}. Nothing sent.`)
      return this.view()
    }
    if (!request.chain && request.family && CHAINS[chain].family !== request.family) {
      this.setFlash('error', `They asked for an ${request.family.toUpperCase()} address,\nnot ${chainDisplay(chain)}. Nothing sent.`)
      return this.view()
    }

    const entries = this.store.byChain(chain)
    let entry: VaultEntry | undefined
    if (intent.name) entry = entries.find((e) => e.name === intent.name)
    else if (entries.length === 1) entry = entries[0]
    else entry = entries.find((e) => e.name === 'main')
    if (!entry) {
      this.setFlash(
        'error',
        entries.length
          ? `Which ${chainDisplay(chain)} address?\nSay: ${entries.map((e) => e.name).slice(0, 3).join(' / ')}`
          : `No ${chainDisplay(chain)} address in your vault.\nAdd one in the vault bot.`,
      )
      return this.view()
    }

    this.confirmation = {
      id: `c-${randomBytes(6).toString('hex')}`,
      request,
      entry,
      message: buildAddressReply(entry),
      state: 'awaiting',
    }
    this.flash = undefined
    this.bump()
    return this.view()
  }

  /** A single tap on the card with this id. Only a confirmation card reacts, and only once. */
  async tap(cardId: string): Promise<CardView> {
    const c = this.confirmation
    if (!c || c.id !== cardId || c.state !== 'awaiting') return this.view()
    c.state = 'sending' // consumed before the network call: a second tap or a retry cannot send twice
    this.bump()
    try {
      await this.sender.send(c.request.chatId, c.message)
      this.requests = this.requests.filter((r) => r.id !== c.request.id)
      this.confirmation = undefined
      this.log(`sent ${c.entry.chain}:${c.entry.name} to chat ${c.request.chatId}`)
      // The G2 font has no check-mark glyph, so the card says it in words.
      this.setFlash('sent', `SENT\n${entryLabel(c.entry)} → ${c.request.fromName}\n${c.request.chatTitle}`)
    } catch (err) {
      this.confirmation = undefined
      const reason = err instanceof Error ? err.message : String(err)
      this.log(`send failed: ${reason}`)
      this.setFlash('error', `NOT SENT\n${quoteUntrusted(reason, 80)}\nCheck the chat before trying again.`, 8000)
    }
    return this.view()
  }

  /** Double tap: back out of a confirmation, or dismiss the request on screen. */
  cancel(): CardView {
    if (this.flash) this.flash = undefined
    else if (this.confirmation && this.confirmation.state === 'awaiting') this.confirmation = undefined
    else if (!this.confirmation && this.requests.length) this.requests.shift()
    this.bump()
    return this.view()
  }

  /** Scroll: move the request on screen to the back of the queue. */
  next(): CardView {
    if (!this.confirmation && this.requests.length > 1) this.requests.push(this.requests.shift()!)
    this.flash = undefined
    this.bump()
    return this.view()
  }

  view(): CardView {
    if (this.flash && this.flash.until <= this.now()) {
      this.flash = undefined
      this.bump()
    }
    const v = this.version
    if (this.flash) {
      const text = this.flash.kind === 'error' ? `${this.flash.text}\n\nDouble-tap: back` : this.flash.text
      return { id: this.flash.id, kind: this.flash.kind, text, tap: 'none', doubleTap: 'cancel', version: v }
    }

    const c = this.confirmation
    if (c) {
      const lines = [
        `SEND TO ${c.request.fromName} · ${c.request.chatTitle}`,
        entryLabel(c.entry),
        fingerprint(c.entry.address),
        '',
        c.state === 'sending' ? 'Sending…' : 'Tap: send      Double-tap: cancel',
      ]
      return { id: c.id, kind: c.state === 'sending' ? 'sending' : 'confirm', text: lines.join('\n'), tap: c.state === 'awaiting' ? 'confirm' : 'none', doubleTap: 'cancel', version: v }
    }

    const r = this.requests[0]
    if (r) {
      const count = this.requests.length > 1 ? ` 1/${this.requests.length}` : ''
      const ask = r.chain ? chainDisplay(r.chain) : r.family === 'evm' ? 'EVM' : 'which chain?'
      const lines = [
        `REQUEST${count} · ${r.chatTitle}`,
        `${r.fromName} asks (${ask}):`,
        `"${quoteUntrusted(r.text, 60)}"`,
        '',
        `Say: send my ${r.chain ? chainDisplay(r.chain) : 'Solana'} address`,
        this.requests.length > 1 ? 'Double-tap: dismiss   Scroll: next' : 'Double-tap: dismiss',
      ]
      return { id: r.id, kind: 'request', text: lines.join('\n'), tap: 'none', doubleTap: 'cancel', version: v }
    }

    const n = this.store.list().length
    return {
      id: 'idle',
      kind: 'idle',
      text: ['GRAMSIGHT', '', 'No address requests.', '', `Vault: ${n} address${n === 1 ? '' : 'es'}`].join('\n'),
      tap: 'none',
      doubleTap: 'exit',
      version: v,
    }
  }
}
