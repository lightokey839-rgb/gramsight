// Flow B: someone sends you an address -> the checker runs -> a verdict card -> (optional) you pay.
//   verdict card --"send 1 Gram"--> payment card --[spoken "confirm" if the verdict needs it]--> tap -> paying -> sent
// Guards, all in code:
//   - blocked verdicts (invalid, scam, lookalike) can never reach a payment card;
//   - "confirm twice" verdicts (new address, not their Telegram wallet, ...) need a spoken "confirm" before the tap works;
//   - per-payment and 24-hour limits, counted from the on-disk ledger;
//   - the amount comes only from the user's command, the recipient only from the checked card on screen;
//   - one tap starts exactly one payment: it is consumed before the rail runs, and never retried.
import { randomBytes } from 'node:crypto'
import { fromNano } from '@ton/core'
import type { AddressChecker, Verdict } from '../checker/checker.ts'
import type { CardView } from '../flowA/controller.ts'
import { quoteUntrusted } from '../flowA/requests.ts'
import { parsePayCommand } from '../payments/command.ts'
import type { PaymentLedger } from '../payments/ledger.ts'
import type { RailChooser } from '../payments/rail.ts'
import { fingerprint } from '../vault/addresses.ts'

export type AddressShare = {
  id: string
  chatId: number
  chatTitle: string
  fromName: string
  senderUserId?: number
  address: string
  messageId?: number
  receivedAt: number
  verdict?: Verdict
}

export type PaymentLimits = { perPaymentNano: bigint; dailyNano: bigint }

export type PaymentDeps = { rails: RailChooser; ledger: PaymentLedger; limits: PaymentLimits }

type Pending = {
  id: string
  item: AddressShare
  amountNano: bigint
  needsSpokenConfirm: boolean
  spokenConfirmed: boolean
  state: 'awaiting' | 'paying'
}

const FAMILY_LABEL = { ton: 'TON', evm: 'EVM', solana: 'Solana', bitcoin: 'Bitcoin', tron: 'Tron' } as const
const DAY_MS = 24 * 60 * 60 * 1000

const gram = (nano: bigint) => `${fromNano(nano)} Gram`

/** Can this verdict lead to a payment at all? Only valid TON addresses that are not blocked. */
export function payable(v: Verdict | undefined): boolean {
  return !!v && v.level !== 'block' && v.family === 'ton'
}

/** Lens text for a verdict: who sent it, the verdict, the address's start/middle/end, the evidence, what you can do. */
export function verdictCardText(
  share: Pick<AddressShare, 'fromName' | 'chatTitle'>,
  v: Verdict | undefined,
  address: string,
  canPay = false,
): string {
  const head = `ADDRESS FROM ${share.fromName} · ${share.chatTitle}`
  if (!v) return [head, 'Checking...', fingerprint(address)].join('\n')
  const fam = v.family ? ` (${FAMILY_LABEL[v.family]})` : ''
  const lines = [head, v.headline, `${fingerprint(v.address)}${fam}`]
  const extra = v.details.slice(0, 2).join(' · ')
  if (extra) lines.push(extra)
  lines.push('')
  if (v.level === 'block') lines.push('Payment blocked.   Double-tap: dismiss')
  else if (canPay && v.family === 'ton') lines.push('Say: send 1 Gram   Double-tap: dismiss')
  else lines.push('Double-tap: dismiss')
  return lines.join('\n')
}

export class FlowBController {
  private items: AddressShare[] = []
  private pending: Pending | undefined
  private flash: { kind: 'sent' | 'error'; text: string; until: number; id: string } | undefined
  private version = 1

  constructor(
    private readonly checker: AddressChecker,
    private readonly now: () => number = Date.now,
    private readonly log: (line: string) => void = () => {},
    private readonly payments?: PaymentDeps,
  ) {}

  private bump(): void {
    this.version++
  }

  private setFlash(kind: 'sent' | 'error', text: string, ms = 6000): void {
    this.flash = { kind, text, until: this.now() + ms, id: `f-${randomBytes(4).toString('hex')}` }
    this.bump()
  }

  /** Queues an address someone sent and starts checking it. Ignores duplicates of the same message. */
  addShare(s: Omit<AddressShare, 'id' | 'receivedAt' | 'verdict'>): AddressShare | undefined {
    if (s.messageId !== undefined && this.items.some((x) => x.chatId === s.chatId && x.messageId === s.messageId)) return undefined
    const item: AddressShare = {
      ...s,
      fromName: quoteUntrusted(s.fromName, 30),
      chatTitle: quoteUntrusted(s.chatTitle, 30),
      id: `b-${randomBytes(4).toString('hex')}`,
      receivedAt: this.now(),
    }
    this.items.push(item)
    this.bump()
    this.log(`address from chat ${s.chatId} queued for checking`)
    void this.checker
      .check({ address: s.address, ...(s.senderUserId !== undefined ? { senderUserId: s.senderUserId } : {}) })
      .then((v) => {
        item.verdict = v
        this.bump()
        this.log(`verdict for chat ${s.chatId}: ${v.code}`)
      })
      .catch((err: unknown) => this.log(`check failed: ${err instanceof Error ? err.message : String(err)}`))
    return item
  }

  /** Waits until every queued item has a verdict and no payment is running (tests and the CLI). */
  async settled(timeoutMs = 10_000): Promise<void> {
    const end = Date.now() + timeoutMs
    while ((this.items.some((i) => !i.verdict) || this.pending?.state === 'paying') && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  current(): AddressShare | undefined {
    return this.items[0]
  }

  /** A spoken / typed command while a Flow B card is on screen. */
  async command(text: string): Promise<CardView | undefined> {
    const item = this.items[0]
    const cmd = parsePayCommand(text)
    if (cmd.kind === 'cancel') {
      this.cancel()
      return this.view()
    }
    if (this.pending) {
      if (cmd.kind === 'confirm' && this.pending.state === 'awaiting' && this.pending.needsSpokenConfirm) {
        this.pending.spokenConfirmed = true
        this.bump()
      } else if (cmd.kind !== 'confirm') {
        this.setFlash('error', 'A payment is waiting.\nTap to pay, or double-tap to cancel.', 4000)
      }
      return this.view()
    }
    if (!item || !item.verdict) return this.view()
    if (cmd.kind !== 'pay') {
      this.setFlash('error', payable(item.verdict) ? "Didn't catch that.\nSay: send 1 Gram" : 'Nothing to confirm here.', 4000)
      return this.view()
    }
    if (!this.payments) {
      this.setFlash('error', 'Payments are not set up on this backend.')
      return this.view()
    }
    const v = item.verdict
    if (v.level === 'block') {
      this.setFlash('error', `Payment blocked:\n${v.headline}`)
      return this.view()
    }
    if (v.family !== 'ton') {
      this.setFlash('error', 'Gramsight pays in Gram on TON only.\nThis is not a TON address.')
      return this.view()
    }
    const { perPaymentNano, dailyNano } = this.payments.limits
    if (cmd.amountNano > perPaymentNano) {
      this.setFlash('error', `Over your limit.\nMax ${gram(perPaymentNano)} per payment.`)
      return this.view()
    }
    const spent = this.payments.ledger.spentSince(this.now() - DAY_MS)
    if (spent + cmd.amountNano > dailyNano) {
      this.setFlash('error', `Over your daily limit.\n${gram(dailyNano - spent > 0n ? dailyNano - spent : 0n)} left today.`)
      return this.view()
    }
    this.pending = {
      id: `p-${randomBytes(6).toString('hex')}`,
      item,
      amountNano: cmd.amountNano,
      needsSpokenConfirm: v.level === 'confirm-twice',
      spokenConfirmed: false,
      state: 'awaiting',
    }
    this.flash = undefined
    this.bump()
    return this.view()
  }

  /** A tap on the payment card with this id. Pays at most once, never retries. */
  async tap(cardId: string): Promise<CardView | undefined> {
    const p = this.pending
    if (!p || p.id !== cardId || p.state !== 'awaiting' || !this.payments) return this.view()
    if (p.needsSpokenConfirm && !p.spokenConfirmed) return this.view()
    p.state = 'paying' // consumed before anything is sent
    this.bump()
    const v = p.item.verdict!
    const rail = this.payments.rails({ amountNano: p.amountNano, verdict: v })
    const ledger = this.payments.ledger
    const idx = ledger.add({
      at: new Date(this.now()).toISOString(),
      to: v.address,
      normalized: v.normalized ?? v.address,
      amountNano: p.amountNano.toString(),
      rail: rail.id,
      verdict: v.code,
      status: 'started',
    })
    this.log(`payment started via ${rail.id}: ${p.amountNano} nanoGram, verdict ${v.code}`)
    void rail
      .pay({ to: v.address, amountNano: p.amountNano, comment: 'Gramsight testnet payment' })
      .then((r) => {
        ledger.update(idx, { status: r.status, ...(r.hash ? { hash: r.hash } : {}) })
        this.items = this.items.filter((i) => i.id !== p.item.id)
        this.pending = undefined
        const short = r.hash ? `${r.hash.slice(0, 6)}…${r.hash.slice(-6)}` : 'see explorer'
        this.log(`payment ${r.status} via ${rail.id}${r.hash ? ` (${r.hash})` : ''}`)
        this.setFlash(
          'sent',
          r.status === 'confirmed'
            ? `SENT ${gram(p.amountNano)} → ${p.item.fromName}\n${rail.network} · tx ${short}`
            : `SUBMITTED ${gram(p.amountNano)} → ${p.item.fromName}\nNot confirmed yet. Check the explorer\nbefore trying again.`,
          8000,
        )
      })
      .catch((err: unknown) => {
        ledger.update(idx, { status: 'failed' })
        this.pending = undefined
        const reason = err instanceof Error ? err.message : String(err)
        this.log(`payment failed via ${rail.id}: ${reason}`)
        this.setFlash('error', `NOT PAID\n${quoteUntrusted(reason, 80)}`, 8000)
      })
    return this.view()
  }

  view(): CardView | undefined {
    if (this.flash && this.flash.until <= this.now()) {
      this.flash = undefined
      this.bump()
    }
    if (this.flash) {
      const text = this.flash.kind === 'error' ? `${this.flash.text}\n\nDouble-tap: back` : this.flash.text
      return { id: this.flash.id, kind: this.flash.kind, text, tap: 'none', doubleTap: 'cancel', version: this.version }
    }
    const p = this.pending
    if (p) {
      const v = p.item.verdict!
      const armed = !p.needsSpokenConfirm || p.spokenConfirmed
      const lines = [
        `PAY ${p.item.fromName} · ${p.item.chatTitle}`,
        `${gram(p.amountNano)} · TON testnet`,
        fingerprint(v.address),
        v.headline,
        '',
        p.state === 'paying' ? 'Paying… waiting for the network' : armed ? 'Tap: pay      Double-tap: cancel' : 'Say "confirm", then tap.   Double-tap: cancel',
      ]
      return {
        id: p.id,
        kind: p.state === 'paying' ? 'paying' : 'pay',
        text: lines.join('\n'),
        tap: p.state === 'awaiting' && armed ? 'confirm' : 'none',
        doubleTap: 'cancel',
        version: this.version,
      }
    }
    const item = this.items[0]
    if (!item) return undefined
    const count = this.items.length > 1 ? `1/${this.items.length} ` : ''
    const text = verdictCardText(item, item.verdict, item.address, !!this.payments && payable(item.verdict))
    return {
      id: item.id,
      kind: item.verdict ? 'verdict' : 'checking',
      text: count ? text.replace('ADDRESS FROM', `ADDRESS ${count}FROM`) : text,
      tap: 'none',
      doubleTap: 'cancel',
      version: this.version,
    }
  }

  /** Double tap: clear a message, back out of a payment, or dismiss the verdict card. Never stops a payment in flight. */
  cancel(): void {
    if (this.flash) this.flash = undefined
    else if (this.pending?.state === 'awaiting') this.pending = undefined
    else if (!this.pending && this.items.length) this.items.shift()
    this.bump()
  }

  next(): void {
    if (!this.pending && this.items.length > 1) this.items.push(this.items.shift()!)
    this.flash = undefined
    this.bump()
  }
}
