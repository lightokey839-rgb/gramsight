// Every payment Gramsight starts, kept on disk (default ~/.gramsight/payments.json, outside the repo).
// Used for the daily limit (so a restart cannot reset it) and as "paid before" evidence for the checker.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir } from '../vault/store.ts'

export type PaymentRecord = {
  at: string
  to: string
  /** Comparison form of the recipient (TON raw workchain:hash). */
  normalized: string
  amountNano: string
  rail: string
  verdict: string
  status: 'started' | 'confirmed' | 'submitted' | 'failed'
  hash?: string
}

export class PaymentLedger {
  constructor(readonly path: string = join(dataDir(), 'payments.json')) {}

  list(): PaymentRecord[] {
    if (!existsSync(this.path)) return []
    const data = JSON.parse(readFileSync(this.path, 'utf8')) as { payments?: PaymentRecord[] }
    return Array.isArray(data.payments) ? data.payments : []
  }

  private save(payments: PaymentRecord[]): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({ payments }, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.path)
  }

  /** Adds a record and returns its index, for a later status update. */
  add(r: PaymentRecord): number {
    const all = this.list()
    all.push(r)
    this.save(all)
    return all.length - 1
  }

  update(index: number, patch: Partial<PaymentRecord>): void {
    const all = this.list()
    if (!all[index]) return
    all[index] = { ...all[index], ...patch }
    this.save(all)
  }

  /**
   * Total counted against the daily limit: real payments (not dry runs) not known to have failed,
   * in the window. A started payment counts until it is known to have failed.
   */
  spentSince(sinceMs: number, rail = 'testnet-payer'): bigint {
    // The daily limit guards the backend-held testnet key, so it counts that rail only. Wallet (TON Connect)
    // payments are approved by the user in their own wallet; dry runs move nothing.
    return this.list()
      .filter((p) => p.rail === rail && p.status !== 'failed' && Date.parse(p.at) >= sinceMs)
      .reduce((sum, p) => sum + BigInt(p.amountNano), 0n)
  }

  /** Real payments that went out (confirmed or submitted). Dry runs never count as trust. */
  sent(): PaymentRecord[] {
    return this.list().filter((p) => p.rail !== 'dry-run' && (p.status === 'confirmed' || p.status === 'submitted'))
  }

  paidNormalized(): Set<string> {
    return new Set(this.sent().map((p) => p.normalized))
  }
}

/** The ledger as a checker history source: recipients of real payments that went out. */
export function ledgerHistory(ledger: PaymentLedger) {
  return {
    async paidAddresses(): Promise<string[]> {
      return ledger.sent().map((p) => p.to)
    },
  }
}
