// Outgoing destinations of the testnet payer wallet: the addresses this Gramsight install has actually paid.
// Used as trusted references for lookalike detection and as "paid before" evidence. Cached for a minute.
//
// Only transfers the wallet SIGNED count, i.e. transactions started by an external message. Bounces do not:
// when someone sends dust to a fresh (uninitialised) wallet, the dust bounces back as an outgoing message
// to the sender. Counting that would make a poisoning address look "paid before".
import { Address } from '@ton/core'
import { payerKeyPair, payerWallet, testnetClient } from '../ton.ts'
import type { HistorySource } from './sources.ts'

type TxLike = {
  inMessage?: { info: { type: string } } | null
  outMessages: { values(): { info: { type: string; dest?: unknown; bounced?: boolean } }[] }
}

/** Destinations of internal messages in wallet-signed (external-in) transactions, as non-bounceable testnet strings. */
export function signedTransferDestinations(txs: TxLike[]): string[] {
  const seen = new Set<string>()
  for (const tx of txs) {
    if (tx.inMessage?.info.type !== 'external-in') continue
    for (const m of tx.outMessages.values()) {
      if (m.info.type === 'internal' && !m.info.bounced && m.info.dest instanceof Address) {
        seen.add(m.info.dest.toString({ testOnly: true, bounceable: false, urlSafe: true }))
      }
    }
  }
  return [...seen]
}

export class PayerHistory implements HistorySource {
  private cache: { at: number; list: string[] } | undefined

  constructor(
    private readonly limit = 30,
    private readonly ttlMs = 60_000,
  ) {}

  async paidAddresses(): Promise<string[]> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.list
    const client = testnetClient()
    const wallet = payerWallet((await payerKeyPair()).publicKey)
    const txs = await client.getTransactions(wallet.address, { limit: this.limit })
    this.cache = { at: Date.now(), list: signedTransferDestinations(txs) }
    return this.cache.list
  }

  /** Forget the cache, e.g. right after a payment. */
  refresh(): void {
    this.cache = undefined
  }
}
