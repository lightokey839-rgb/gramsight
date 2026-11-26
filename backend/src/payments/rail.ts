// A payment rail is how an approved payment actually leaves. The glasses flow, the checker and the guards
// are the same whichever rail runs it:
//   - testnet payer (now): a testnet-only backend wallet signs, hands-free, after the guards and a tap;
//   - dry run (default):   logs only, nothing is broadcast;
//   - TON Connect (later, only if the user decides so): a sendTransaction request approved in the user's
//     own wallet app, for larger payments or new addresses.
import { randomBytes } from 'node:crypto'
import type { Verdict } from '../checker/checker.ts'

export type PaymentRequest = {
  /** Recipient, exactly as checked by the checker. */
  to: string
  amountNano: bigint
  comment: string
}

export type PaymentResult = {
  /** confirmed: seen on chain. submitted: broadcast once, not yet seen (never re-sent automatically). */
  status: 'confirmed' | 'submitted'
  hash?: string
  explorerUrl?: string
}

export interface PaymentRail {
  readonly id: 'testnet-payer' | 'dry-run' | 'tonconnect'
  /** Human label for the card, e.g. "TON testnet". */
  readonly network: string
  /** Must broadcast at most once and never retry by itself. */
  pay(req: PaymentRequest): Promise<PaymentResult>
}

/** Picks the rail for one payment. Today always the same rail; a TON Connect path can plug in here later. */
export type RailChooser = (ctx: { amountNano: bigint; verdict: Verdict }) => PaymentRail

export const singleRail =
  (rail: PaymentRail): RailChooser =>
  () =>
    rail

/**
 * The two-path rule (the production rule from the safety design, on testnet):
 *   - verified address (their Telegram wallet, a saved contact, paid before) AND within the hands-free limit
 *     -> hands-free rail (one tap on the glasses);
 *   - anything else (new address, not their wallet, above the limit) -> the user's own wallet via TON Connect,
 *     approved on the phone, when a wallet is connected. Without one, it stays on the hands-free rail, where the
 *     glasses demand a spoken "confirm" and the hands-free limits apply.
 */
export function twoPathChooser(
  handsFree: PaymentRail,
  wallet: (PaymentRail & { isReady(): boolean }) | undefined,
  handsFreeMaxNano: bigint,
): RailChooser {
  return ({ amountNano, verdict }) => {
    const needsWallet = verdict.level !== 'ok' || amountNano > handsFreeMaxNano
    return needsWallet && wallet?.isReady() ? wallet : handsFree
  }
}

export class DryRunRail implements PaymentRail {
  readonly id = 'dry-run' as const
  readonly network = 'TON testnet (dry run)'
  constructor(private readonly log: (line: string) => void = console.log) {}
  async pay(req: PaymentRequest): Promise<PaymentResult> {
    this.log(`[dry-run] would pay ${req.amountNano} nanoGram`)
    return { status: 'confirmed', hash: `dryrun${randomBytes(6).toString('hex')}` }
  }
}
