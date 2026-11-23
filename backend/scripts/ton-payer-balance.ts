// Test 4c, part 1: derive the TON testnet payer address from TON_TESTNET_PAYER_MNEMONIC and read its testnet balance.
//   npm run ton:balance
// Shows every wallet contract the mnemonic maps to (W5 testnet id, W5 mainnet id, v4r2), because the address
// depends on the contract and, for W5, on the network id. The mnemonic and keys are never printed.
import { fromNano } from '@ton/core'
import {
  candidateWallets,
  configuredVersion,
  explorerAddressUrl,
  payerKeyPair,
  payerWallet,
  testnetClient,
  testnetFriendly,
} from '../src/ton.ts'

async function main(): Promise<void> {
  const client = testnetClient()
  const { publicKey } = await payerKeyPair()
  const configured = configuredVersion()
  const payer = payerWallet(publicKey, configured)
  console.log(`Mnemonic valid (24 words). Configured wallet version: ${configured}. Network: TON testnet.\n`)

  let funded = 0
  for (const c of candidateWallets(publicKey)) {
    const state = await client.getContractState(c.wallet.address)
    const balance = state.balance
    if (balance > 0n) funded++
    const isPayer = c.wallet.address.equals(payer.address)
    console.log(`${isPayer ? '* ' : '  '}${c.label}`)
    console.log(`    address: ${testnetFriendly(c.wallet.address)}`)
    console.log(`    state:   ${state.state}, balance ${fromNano(balance)} test Gram`)
    console.log(`    explorer: ${explorerAddressUrl(c.wallet.address)}`)
    await new Promise((r) => setTimeout(r, 1100)) // stay under toncenter's 1 req/s limit without a key
  }

  console.log('\n* = the contract Gramsight will pay from (TON_TESTNET_PAYER_WALLET_VERSION).')
  if (funded === 0) {
    console.log('No candidate has a balance yet. Fund the starred address from a testnet faucet (for example @testgiver_ton_bot).')
  } else {
    console.log('If the funded address is not the starred one, set TON_TESTNET_PAYER_WALLET_VERSION to match the app you created the wallet in.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`ton:balance failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
