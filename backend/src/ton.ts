// TON testnet payer: wallet derivation and client. TESTNET ONLY. The mnemonic and keys are never logged.
import { Address } from '@ton/core'
import { mnemonicToPrivateKey, mnemonicValidate, type KeyPair } from '@ton/crypto'
import { TonClient, WalletContractV4, WalletContractV5R1 } from '@ton/ton'
import { optionalEnv, requireEnv } from './env.ts'

export const TESTNET_GLOBAL_ID = -3
export const MAINNET_GLOBAL_ID = -239

export type WalletVersion = 'v5r1' | 'v4r2'
export type PayerWallet = WalletContractV5R1 | WalletContractV4

export function testnetClient(): TonClient {
  const endpoint = requireEnv('TON_TESTNET_API_ENDPOINT')
  if (!/testnet/i.test(endpoint)) {
    throw new Error('TON_TESTNET_API_ENDPOINT does not look like a testnet endpoint. Refusing to continue (testnet only).')
  }
  return new TonClient({ endpoint, apiKey: optionalEnv('TON_TESTNET_API_KEY') })
}

export async function payerKeyPair(): Promise<KeyPair> {
  const words = requireEnv('TON_TESTNET_PAYER_MNEMONIC').split(/\s+/).filter(Boolean)
  if (words.length !== 24) throw new Error(`TON_TESTNET_PAYER_MNEMONIC must have 24 words (found ${words.length})`)
  if (!(await mnemonicValidate(words))) throw new Error('TON_TESTNET_PAYER_MNEMONIC is not a valid TON mnemonic')
  return mnemonicToPrivateKey(words)
}

export function configuredVersion(): WalletVersion {
  const v = (optionalEnv('TON_TESTNET_PAYER_WALLET_VERSION') ?? 'v5r1').toLowerCase()
  if (v !== 'v5r1' && v !== 'v4r2') throw new Error('TON_TESTNET_PAYER_WALLET_VERSION must be v5r1 or v4r2')
  return v
}

/** The wallet contract the payer uses on testnet. V5 wallet IDs include the network, so testnet = -3. */
export function payerWallet(publicKey: Buffer, version: WalletVersion = configuredVersion()): PayerWallet {
  if (version === 'v4r2') return WalletContractV4.create({ workchain: 0, publicKey })
  return WalletContractV5R1.create({
    publicKey,
    walletId: {
      networkGlobalId: TESTNET_GLOBAL_ID,
      context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 },
    },
  })
}

/** Every address the same mnemonic maps to, so a wallet made in any app can be recognised. */
export function candidateWallets(publicKey: Buffer): { label: string; version: WalletVersion; wallet: PayerWallet }[] {
  return [
    { label: 'W5 (v5r1), testnet wallet id', version: 'v5r1', wallet: payerWallet(publicKey, 'v5r1') },
    {
      label: 'W5 (v5r1), mainnet wallet id',
      version: 'v5r1',
      wallet: WalletContractV5R1.create({
        publicKey,
        walletId: {
          networkGlobalId: MAINNET_GLOBAL_ID,
          context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 },
        },
      }),
    },
    { label: 'v4r2', version: 'v4r2', wallet: payerWallet(publicKey, 'v4r2') },
  ]
}

/** Testnet display form: non-bounceable, test-only (0Q... / kQ...). */
export function testnetFriendly(address: Address, bounceable = false): string {
  return address.toString({ testOnly: true, bounceable, urlSafe: true })
}

export function explorerAddressUrl(address: Address): string {
  return `https://testnet.tonviewer.com/${testnetFriendly(address)}`
}

export function explorerTxUrl(hashHex: string): string {
  return `https://testnet.tonviewer.com/transaction/${hashHex}`
}

/** Short fingerprint for showing on the lens: start, middle and end, so a lookalike cannot match on the ends alone. */
export function addressFingerprint(friendly: string): string {
  const mid = Math.floor(friendly.length / 2)
  return `${friendly.slice(0, 6)}…${friendly.slice(mid - 3, mid + 3)}…${friendly.slice(-6)}`
}
