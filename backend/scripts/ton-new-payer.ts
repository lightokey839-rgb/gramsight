// Creates the TON TESTNET payer wallet for you, so no wallet app is needed.
//   npm run ton:new-payer
// - Generates a fresh 24-word mnemonic and writes it to TON_TESTNET_PAYER_MNEMONIC in .env,
//   ONLY if that value is empty. It never overwrites an existing mnemonic and never prints the words.
// - Sets TON_TESTNET_API_ENDPOINT to toncenter testnet if it is empty.
// - Prints the W5-testnet address to fund (the starred address in `npm run ton:balance`).
// Never use your real Gram Wallet in Telegram as the payer: that is mainnet and holds real funds.
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto'
import { ENV_PATH, optionalEnv, setEnvIfEmpty, writeEnvValue } from '../src/env.ts'
import { DEFAULT_TESTNET_ENDPOINT, explorerAddressUrl, payerKeyPair, payerWallet, testnetFriendly } from '../src/ton.ts'

async function main(): Promise<void> {
  console.log('Gramsight: TON TESTNET payer wallet setup.')
  console.log('This wallet only ever holds free test Gram from a faucet. Never use your real Gram Wallet as the payer:')
  console.log('it is on mainnet and holds real funds.\n')

  if (setEnvIfEmpty('TON_TESTNET_API_ENDPOINT', DEFAULT_TESTNET_ENDPOINT)) {
    console.log(`Set TON_TESTNET_API_ENDPOINT=${DEFAULT_TESTNET_ENDPOINT}`)
  }

  let publicKey: Buffer
  if (optionalEnv('TON_TESTNET_PAYER_MNEMONIC')) {
    console.log('TON_TESTNET_PAYER_MNEMONIC is already set in .env. Keeping it (this script never overwrites a mnemonic).')
    publicKey = (await payerKeyPair()).publicKey
  } else {
    const words = await mnemonicNew(24)
    writeEnvValue('TON_TESTNET_PAYER_MNEMONIC', words.join(' '))
    console.log(`Generated a new 24-word mnemonic and wrote it to ${ENV_PATH} (not shown).`)
    publicKey = (await mnemonicToPrivateKey(words)).publicKey
  }

  const version = optionalEnv('TON_TESTNET_PAYER_WALLET_VERSION')
  if (!version) writeEnvValue('TON_TESTNET_PAYER_WALLET_VERSION', 'v5r1')
  else if (version.toLowerCase() !== 'v5r1') {
    console.log(`Note: TON_TESTNET_PAYER_WALLET_VERSION is ${version}; the address below follows that setting.`)
  }

  const payer = payerWallet(publicKey)
  console.log('\nFund this TESTNET address (W5, testnet wallet id):')
  console.log(`  ${testnetFriendly(payer.address)}`)
  console.log('\nHow: open @testgiver_ton_bot in Telegram, send it the address above, and it sends free test Gram.')
  console.log(`Check: ${explorerAddressUrl(payer.address)}`)
  console.log('Then run `npm run ton:balance` to confirm the balance arrived (the starred line).')
  console.log('\nBack up .env somewhere private if you want to keep this test wallet. Do not paste the mnemonic into any chat.')
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`ton:new-payer failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
