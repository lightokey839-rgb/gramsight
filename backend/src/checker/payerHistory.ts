// Outgoing destinations of the testnet payer wallet: the addresses this Gramsight install has actually paid.
// Used as trusted references for lookalike detection. Cached for a minute to keep the check fast.
import { Address } from '@ton/core'
import { payerKeyPair, payerWallet, testnetClient } from '../ton.ts'
import type { HistorySource } from './sources.ts'

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
    const seen = new Set<string>()
    for (const tx of txs) {
      for (const m of tx.outMessages.values()) {
        if (m.info.type === 'internal' && m.info.dest instanceof Address) {
          seen.add(m.info.dest.toString({ testOnly: true, bounceable: false, urlSafe: true }))
        }
      }
    }
    this.cache = { at: Date.now(), list: [...seen] }
    return this.cache.list
  }
}
