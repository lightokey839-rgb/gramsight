// Test 4c, part 2: send ONE tiny TON testnet transfer from the payer wallet. You run this yourself.
//   npm run ton:send-test -- <destination address> <amount in Gram>            dry run: shows what would be sent
//   npm run ton:send-test -- <destination address> <amount in Gram> --send     asks you to type SEND, then broadcasts once
// Guards: testnet endpoint only, amount <= 0.1 Gram, never to the payer itself, balance check, exactly one broadcast
// (no automatic retry, so a timeout can never turn into a double send). The mnemonic is never printed.
import { Address, SendMode, fromNano, internal, toNano } from '@ton/core'
import * as readline from 'node:readline'
import { stdin, stdout } from 'node:process'
import {
  addressFingerprint,
  explorerAddressUrl,
  explorerTxUrl,
  payerKeyPair,
  payerWallet,
  testnetClient,
  testnetFriendly,
} from '../src/ton.ts'

const MAX_TEST_AMOUNT = toNano('0.1')
const FEE_BUFFER = toNano('0.05')
const CONFIRM_TIMEOUT_MS = 90_000

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true })
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim()))))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const [toArg, amountArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const doSend = process.argv.includes('--send')
  if (!toArg || !amountArg) throw new Error('Usage: npm run ton:send-test -- <destination address> <amount in Gram> [--send]')

  let to: Address
  let toIsBounceableForm = false
  try {
    const parsed = Address.parseFriendly(toArg)
    to = parsed.address
    toIsBounceableForm = parsed.isBounceable
  } catch {
    try {
      to = Address.parseRaw(toArg)
    } catch {
      throw new Error('Destination is not a valid TON address')
    }
  }

  let amount: bigint
  try {
    amount = toNano(amountArg)
  } catch {
    throw new Error('Amount must be a number of Gram, e.g. 0.01')
  }
  if (amount <= 0n) throw new Error('Amount must be greater than 0')
  if (amount > MAX_TEST_AMOUNT) throw new Error(`Amount is above the test limit of ${fromNano(MAX_TEST_AMOUNT)} Gram`)

  const client = testnetClient()
  const { publicKey, secretKey } = await payerKeyPair()
  const wallet = client.open(payerWallet(publicKey))
  const from = wallet.address
  if (from.equals(to)) throw new Error('Destination is the payer wallet itself')

  const balance = await wallet.getBalance()
  await sleep(1100)
  const destState = await client.getContractState(to)
  // Uninitialised destinations (a fresh wallet on testnet) must get a non-bounceable message or the funds bounce back.
  const bounce = destState.state === 'active' && toIsBounceableForm

  console.log('TON TESTNET transfer (test Gram, no real value)')
  console.log(`  from:   ${testnetFriendly(from)}  balance ${fromNano(balance)}`)
  console.log(`  to:     ${testnetFriendly(to)}  (${destState.state})`)
  console.log(`  check:  ${addressFingerprint(testnetFriendly(to))}`)
  console.log(`  amount: ${fromNano(amount)} Gram, bounce=${bounce}, comment "Gramsight testnet test"`)
  if (balance < amount + FEE_BUFFER) throw new Error('Payer balance is too low for this amount plus fees. Top up from a testnet faucet.')

  if (!doSend) {
    console.log('\nDry run only. Add --send to broadcast.')
    return
  }
  if ((await ask('\nType SEND to broadcast this one transfer: ')) !== 'SEND') {
    console.log('Cancelled. Nothing was sent.')
    return
  }

  await sleep(1100)
  const seqno = await wallet.getSeqno()
  await sleep(1100)
  await wallet.sendTransfer({
    seqno,
    secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    messages: [internal({ to, value: amount, bounce, body: 'Gramsight testnet test' })],
  })
  console.log(`Broadcast once (seqno ${seqno}). Waiting for it to land...`)

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(3000)
    let current: number
    try {
      current = await wallet.getSeqno()
    } catch {
      continue // transient API error; keep waiting, never re-send
    }
    if (current > seqno) {
      await sleep(1100)
      const txs = await client.getTransactions(from, { limit: 5 })
      const tx = txs.find((t) => t.outMessages.values().some((m) => m.info.dest instanceof Address && m.info.dest.equals(to)))
      console.log('Sent.')
      if (tx) {
        const hash = tx.hash().toString('hex')
        console.log(`  tx hash: ${hash.slice(0, 8)}…${hash.slice(-8)}`)
        console.log(`  explorer: ${explorerTxUrl(hash)}`)
      }
      console.log(`  recipient: ${explorerAddressUrl(to)}`)
      return
    }
  }
  console.log('Not confirmed within 90 s. Check the explorer before trying again (do NOT re-run blindly):')
  console.log(`  ${explorerAddressUrl(from)}`)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`ton:send-test failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
