// Address validation per chain. Addresses are checked by their real encoding (checksums included),
// and compared through a normalized form, never as raw strings.
//
// A format gives a FAMILY, not a chain: Ethereum, Base and other EVM chains share one address format.
// The chain therefore always comes from the vault label the user chose, never from the address.
import { keccak_256 } from '@noble/hashes/sha3.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58, bech32, bech32m, createBase58check } from '@scure/base'
import { Address } from '@ton/core'

export type Family = 'ton' | 'evm' | 'solana' | 'bitcoin' | 'tron'

export const CHAINS = {
  ton: { family: 'ton', display: 'TON' },
  ethereum: { family: 'evm', display: 'Ethereum' },
  base: { family: 'evm', display: 'Base' },
  arbitrum: { family: 'evm', display: 'Arbitrum' },
  optimism: { family: 'evm', display: 'Optimism' },
  polygon: { family: 'evm', display: 'Polygon' },
  bnb: { family: 'evm', display: 'BNB Chain' },
  solana: { family: 'solana', display: 'Solana' },
  bitcoin: { family: 'bitcoin', display: 'Bitcoin' },
  tron: { family: 'tron', display: 'Tron' },
} as const satisfies Record<string, { family: Family; display: string }>

export type Chain = keyof typeof CHAINS

const ALIASES: Record<string, Chain> = {
  gram: 'ton',
  eth: 'ethereum',
  arb: 'arbitrum',
  op: 'optimism',
  matic: 'polygon',
  pol: 'polygon',
  bsc: 'bnb',
  sol: 'solana',
  btc: 'bitcoin',
  trx: 'tron',
}

export function parseChain(input: string): Chain | undefined {
  const key = input.trim().toLowerCase()
  if (key in CHAINS) return key as Chain
  return ALIASES[key]
}

export function chainDisplay(chain: Chain): string {
  return CHAINS[chain].display
}

export type Checked = { ok: true; family: Family; display: string; normalized: string; note?: string } | { ok: false; reason: string }

const base58check = createBase58check(sha256)
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/

/** EIP-55 checksum form of a 40-hex-digit address. */
export function toChecksumAddress(hex40: string): string {
  const lower = hex40.toLowerCase().replace(/^0x/, '')
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex')
  let out = '0x'
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
  return out
}

function checkEvm(a: string): Checked {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: false, reason: 'not an EVM address (0x followed by 40 hex characters)' }
  const body = a.slice(2)
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase()
  const checksummed = toChecksumAddress(body)
  if (mixed && checksummed !== a) return { ok: false, reason: 'EVM checksum does not match (a character may be mistyped)' }
  return {
    ok: true,
    family: 'evm',
    display: checksummed,
    normalized: body.toLowerCase(),
    note: mixed ? undefined : 'no checksum in this address (all one case)',
  }
}

function checkTon(a: string): Checked {
  try {
    if (Address.isFriendly(a)) {
      const f = Address.parseFriendly(a)
      return { ok: true, family: 'ton', display: a, normalized: f.address.toRawString(), note: f.isTestOnly ? 'test-only (testnet) form' : undefined }
    }
    if (Address.isRaw(a)) {
      const addr = Address.parseRaw(a)
      return { ok: true, family: 'ton', display: addr.toString({ bounceable: false, urlSafe: true }), normalized: addr.toRawString() }
    }
  } catch {
    // fall through
  }
  return { ok: false, reason: 'not a valid TON address (checksum or format)' }
}

function checkSolana(a: string): Checked {
  if (!BASE58_RE.test(a) || a.length < 32 || a.length > 44) return { ok: false, reason: 'not a Solana address (base58, 32 to 44 characters)' }
  try {
    if (base58.decode(a).length === 32) return { ok: true, family: 'solana', display: a, normalized: a }
  } catch {
    // fall through
  }
  return { ok: false, reason: 'not a Solana address (does not decode to 32 bytes)' }
}

function checkBitcoin(a: string): Checked {
  const lower = a.toLowerCase()
  if (/^(bc|tb)1/.test(lower)) {
    if (a !== lower && a !== a.toUpperCase()) return { ok: false, reason: 'Bitcoin bech32 address mixes upper and lower case' }
    for (const coder of [bech32, bech32m]) {
      try {
        const { prefix, words } = coder.decode(lower as `${string}1${string}`, 90)
        const version = words[0]
        const program = coder.fromWords(words.slice(1))
        const rightCoder = version === 0 ? bech32 : bech32m
        if (coder !== rightCoder) continue
        if (version === 0 && program.length !== 20 && program.length !== 32) continue
        if (version > 0 && (program.length < 2 || program.length > 40)) continue
        return { ok: true, family: 'bitcoin', display: lower, normalized: lower, note: prefix === 'tb' ? 'Bitcoin testnet address' : undefined }
      } catch {
        // try the other encoding
      }
    }
    return { ok: false, reason: 'not a valid Bitcoin bech32 address (checksum)' }
  }
  if (!BASE58_RE.test(a)) return { ok: false, reason: 'not a Bitcoin address' }
  try {
    const raw = base58check.decode(a)
    if (raw.length === 21 && (raw[0] === 0x00 || raw[0] === 0x05)) return { ok: true, family: 'bitcoin', display: a, normalized: a }
  } catch {
    // fall through
  }
  return { ok: false, reason: 'not a valid Bitcoin address (checksum or version)' }
}

function checkTron(a: string): Checked {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return { ok: false, reason: 'not a Tron address (T followed by 33 base58 characters)' }
  try {
    const raw = base58check.decode(a)
    if (raw.length === 21 && raw[0] === 0x41) return { ok: true, family: 'tron', display: a, normalized: a }
  } catch {
    // fall through
  }
  return { ok: false, reason: 'not a valid Tron address (checksum)' }
}

const CHECKERS: Record<Family, (a: string) => Checked> = {
  ton: checkTon,
  evm: checkEvm,
  solana: checkSolana,
  bitcoin: checkBitcoin,
  tron: checkTron,
}

/** Validates an address for the chain the user named. */
export function validateForChain(chain: Chain, address: string): Checked {
  const a = address.trim()
  if (!a) return { ok: false, reason: 'empty address' }
  return CHECKERS[CHAINS[chain].family](a)
}

/** Every format family the string is a valid address in (usually zero or one). */
export function detectFamilies(address: string): Family[] {
  const a = address.trim()
  return (Object.keys(CHECKERS) as Family[]).filter((f) => CHECKERS[f](a).ok)
}

/** True if both are valid addresses of this chain and point to the same account. */
export function sameAddress(chain: Chain, a: string, b: string): boolean {
  const x = validateForChain(chain, a)
  const y = validateForChain(chain, b)
  return x.ok && y.ok && x.normalized === y.normalized
}

/** Start, middle and end of an address. Lookalike scams copy the ends, so the middle is shown too. */
export function fingerprint(address: string): string {
  if (address.length <= 18) return address
  const mid = Math.floor(address.length / 2)
  return `${address.slice(0, 6)}…${address.slice(mid - 3, mid + 3)}…${address.slice(-6)}`
}
