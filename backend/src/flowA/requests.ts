// Flow A, step 1: spot an incoming chat message that ASKS for one of your addresses.
// Chat text is untrusted. This only classifies it; nothing in the text can trigger a send.
import { CHAINS, type Chain, type Family, detectFamilies, parseChain } from '../vault/addresses.ts'

export type RequestHint = { chain?: Chain; family?: Family }

const ADDRESS_WORD = /\b(address(es)?|addy|addr|wallet|pub(lic)?\s?key)\b/i
const ASK_WORD =
  /\b(send|share|drop|give|post|dm|need|want|what'?s|whats|what is|where'?s|can i (get|have)|could i (get|have)|gimme|pls|please|plz)\b/i
const YOU_WORD = /\b(your|ur|yours|you|u)\b|\bsend me\b/i

/** Chain words people use in chat, mapped to vault chains. "evm"/"0x" names a family, not a chain. */
const CHAIN_WORDS: Record<string, Chain> = {}
for (const c of Object.keys(CHAINS) as Chain[]) CHAIN_WORDS[c] = c
for (const [w, c] of Object.entries({ sol: 'solana', eth: 'ethereum', btc: 'bitcoin', gram: 'ton', trx: 'tron', bsc: 'bnb', matic: 'polygon', arb: 'arbitrum' })) {
  CHAIN_WORDS[w] = c as Chain
}

export function chainHintIn(text: string): RequestHint {
  const lower = text.toLowerCase()
  for (const token of lower.split(/[^a-z0-9]+/).filter(Boolean)) {
    const chain = CHAIN_WORDS[token] ?? parseChain(token)
    if (chain) return { chain, family: CHAINS[chain].family }
  }
  if (/\bevm\b|\b0x\b/.test(lower)) return { family: 'evm' }
  return {}
}

/** Returns a hint if the message reads like "send me your Solana address", otherwise undefined. */
export function detectAddressRequest(text: string): RequestHint | undefined {
  const t = text.trim()
  if (!t || t.length > 500) return undefined
  // A message that already contains an address is someone SHARING one (Flow B), not asking for yours.
  if (t.split(/\s+/).some((tok) => detectFamilies(tok.replace(/[.,;:!?)"'(]+$/g, '')).length > 0)) return undefined
  if (!ADDRESS_WORD.test(t)) return undefined
  if (!ASK_WORD.test(t) && !t.includes('?')) return undefined
  if (!YOU_WORD.test(t)) return undefined
  return chainHintIn(t)
}

/** Display-safe one-line quote of untrusted chat text. */
export function quoteUntrusted(text: string, max = 70): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
