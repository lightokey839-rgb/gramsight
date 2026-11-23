// Detects text that looks like a wallet SECRET (seed phrase or private key) rather than a public address.
// The vault bot deletes such messages and warns the sender: the vault stores public addresses only.
import { sha256 } from '@noble/hashes/sha2.js'
import { base58, createBase58check } from '@scure/base'
import { wordlist } from '@scure/bip39/wordlists/english.js'

export type SecretKind = 'seed phrase' | 'private key' | 'extended private key'

const BIP39 = new Set(wordlist)
const base58check = createBase58check(sha256)

/** Longest run of consecutive BIP39 words (TON and most wallets use this wordlist). */
function longestBip39Run(text: string): number {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  let best = 0
  let run = 0
  for (const t of tokens) {
    run = BIP39.has(t) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

export function detectSecret(text: string): SecretKind | undefined {
  // 12+ consecutive BIP39 words: a seed phrase (12, 15, 18, 21 or 24 words).
  if (longestBip39Run(text) >= 12) return 'seed phrase'

  // xprv / yprv / zprv / tprv extended private keys.
  if (/\b[xyzt]prv[1-9A-HJ-NP-Za-km-z]{100,}\b/.test(text)) return 'extended private key'

  // 64 hex characters (EVM / TON private key). A TON raw address "0:<64 hex>" is NOT a secret.
  for (const m of text.matchAll(/(^|[^0-9a-fA-F:])(0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) {
    if (m[3]) return 'private key'
  }

  // A Solana keypair file: a JSON array of 64 byte values.
  if (/\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]/.test(text)) return 'private key'

  for (const token of text.split(/\s+/)) {
    const t = token.replace(/^[^1-9A-HJ-NP-Za-km-z]+|[^1-9A-HJ-NP-Za-km-z]+$/g, '')
    if (!/^[1-9A-HJ-NP-Za-km-z]{50,90}$/.test(t)) continue
    // Bitcoin WIF private key (base58check, version 0x80 mainnet or 0xef testnet).
    try {
      const raw = base58check.decode(t)
      if ((raw[0] === 0x80 || raw[0] === 0xef) && (raw.length === 33 || raw.length === 34)) return 'private key'
    } catch {
      // not base58check
    }
    // Solana secret key: base58 of 64 bytes.
    try {
      if (base58.decode(t).length === 64) return 'private key'
    } catch {
      // not base58
    }
  }
  return undefined
}
