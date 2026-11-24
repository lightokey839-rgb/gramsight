// Flow B, part 1 (Day 4): someone sends you an address -> the checker runs -> a verdict card.
// Paying from the card ("send 10 Gram", the guards, the testnet transfer) is added on Day 5.
import { randomBytes } from 'node:crypto'
import type { AddressChecker, Verdict } from '../checker/checker.ts'
import type { CardView } from '../flowA/controller.ts'
import { quoteUntrusted } from '../flowA/requests.ts'
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

const FAMILY_LABEL = { ton: 'TON', evm: 'EVM', solana: 'Solana', bitcoin: 'Bitcoin', tron: 'Tron' } as const

/** Lens text for a verdict: who sent it, the verdict, the address's start/middle/end, then the evidence. */
export function verdictCardText(share: Pick<AddressShare, 'fromName' | 'chatTitle'>, v: Verdict | undefined, address: string): string {
  const head = `ADDRESS FROM ${share.fromName} · ${share.chatTitle}`
  if (!v) return [head, 'Checking...', fingerprint(address)].join('\n')
  const fam = v.family ? ` (${FAMILY_LABEL[v.family]})` : ''
  const lines = [head, v.headline, `${fingerprint(v.address)}${fam}`]
  const extra = v.details.slice(0, 2).join(' · ')
  if (extra) lines.push(extra)
  lines.push('')
  lines.push(v.level === 'block' ? 'Payment blocked.   Double-tap: dismiss' : 'Double-tap: dismiss')
  return lines.join('\n')
}

export class FlowBController {
  private items: AddressShare[] = []
  private version = 1

  constructor(
    private readonly checker: AddressChecker,
    private readonly now: () => number = Date.now,
    private readonly log: (line: string) => void = () => {},
  ) {}

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
    this.version++
    this.log(`address from chat ${s.chatId} queued for checking`)
    void this.checker
      .check({ address: s.address, ...(s.senderUserId !== undefined ? { senderUserId: s.senderUserId } : {}) })
      .then((v) => {
        item.verdict = v
        this.version++
        this.log(`verdict for chat ${s.chatId}: ${v.code}`)
      })
      .catch((err: unknown) => this.log(`check failed: ${err instanceof Error ? err.message : String(err)}`))
    return item
  }

  /** Waits until every queued item has a verdict (tests and the CLI). */
  async settled(timeoutMs = 10_000): Promise<void> {
    const end = Date.now() + timeoutMs
    while (this.items.some((i) => !i.verdict) && Date.now() < end) await new Promise((r) => setTimeout(r, 20))
  }

  current(): AddressShare | undefined {
    return this.items[0]
  }

  view(): CardView | undefined {
    const item = this.items[0]
    if (!item) return undefined
    const count = this.items.length > 1 ? `1/${this.items.length} ` : ''
    const text = verdictCardText(item, item.verdict, item.address)
    return {
      id: item.id,
      kind: item.verdict ? 'verdict' : 'checking',
      text: count ? text.replace('ADDRESS FROM', `ADDRESS ${count}FROM`) : text,
      tap: 'none',
      doubleTap: 'cancel',
      version: this.version,
    }
  }

  cancel(): void {
    if (this.items.length) this.items.shift()
    this.version++
  }

  next(): void {
    if (this.items.length > 1) this.items.push(this.items.shift()!)
    this.version++
  }
}
