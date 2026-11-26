// The hands-free rail: one Gram transfer on TON TESTNET from the testnet-only payer wallet.
// Broadcasts exactly once. If the network does not confirm in time, it reports "submitted" and never re-sends;
// the user checks the explorer. The mnemonic and keys never leave this process and are never logged.
import { Address, SendMode, fromNano, internal } from '@ton/core'
import { explorerAddressUrl, explorerTxUrl, payerKeyPair, payerWallet, testnetClient } from '../ton.ts'
import type { PaymentRail, PaymentRequest, PaymentResult } from './rail.ts'

const FEE_BUFFER = 50_000_000n // 0.05 Gram for fees
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class TestnetPayerRail implements PaymentRail {
  readonly id = 'testnet-payer' as const
  readonly network = 'TON testnet'

  constructor(
    private readonly confirmTimeoutMs = 30_000,
    private readonly pace = 1100, // toncenter allows about 1 request per second without an API key
  ) {}

  async pay(req: PaymentRequest): Promise<PaymentResult> {
    const to = Address.parse(req.to)
    const client = testnetClient() // refuses anything that is not a testnet endpoint
    const { publicKey, secretKey } = await payerKeyPair()
    const wallet = client.open(payerWallet(publicKey))
    if (wallet.address.equals(to)) throw new Error('That is the payer wallet itself')

    const balance = await wallet.getBalance()
    if (balance < req.amountNano + FEE_BUFFER) throw new Error(`Payer has only ${fromNano(balance)} test Gram`)
    await sleep(this.pace)
    const dest = await client.getContractState(to)
    // A fresh wallet (uninitialised on testnet) must get a non-bounceable message, or the Gram bounces back.
    const bounce = dest.state === 'active' && Address.isFriendly(req.to) && Address.parseFriendly(req.to).isBounceable
    await sleep(this.pace)
    const seqno = await wallet.getSeqno()
    await sleep(this.pace)

    await wallet.sendTransfer({
      seqno,
      secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
      messages: [internal({ to, value: req.amountNano, bounce, body: req.comment })],
    })
    // Broadcast happened. From here on nothing may send again.

    const deadline = Date.now() + this.confirmTimeoutMs
    while (Date.now() < deadline) {
      await sleep(3000)
      let current: number
      try {
        current = await wallet.getSeqno()
      } catch {
        continue
      }
      if (current > seqno) {
        try {
          await sleep(this.pace)
          const txs = await client.getTransactions(wallet.address, { limit: 5 })
          const tx = txs.find((t) => t.outMessages.values().some((m) => m.info.dest instanceof Address && m.info.dest.equals(to)))
          if (tx) {
            const hash = tx.hash().toString('hex')
            return { status: 'confirmed', hash, explorerUrl: explorerTxUrl(hash) }
          }
        } catch {
          // confirmed by seqno; the hash lookup is best effort
        }
        return { status: 'confirmed', explorerUrl: explorerAddressUrl(wallet.address) }
      }
    }
    return { status: 'submitted', explorerUrl: explorerAddressUrl(wallet.address) }
  }
}
