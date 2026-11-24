// Flow A, step 2: turn what the user said (voice transcript or typed text) into a structured intent.
// The intent names a chain and an optional vault label name, never an address. Code looks the address up.
import { type Chain, parseChain } from '../vault/addresses.ts'
import { chainHintIn } from './requests.ts'

export type Intent =
  | { action: 'send_address'; chain?: Chain; name?: string }
  | { action: 'cancel' }
  | { action: 'next' }
  | { action: 'unknown' }

export type VaultLabel = { chain: Chain; name: string }

export interface IntentParser {
  parse(text: string, ctx: { labels: VaultLabel[]; requestChain?: Chain }): Promise<Intent>
}

const CANCEL = /^(no|nope|cancel|stop|skip|dismiss|ignore|never ?mind|back)\b/
const NEXT = /^(next|next one|later|show next)\b/
const SEND = /\b(send|share|give|post|reply with|drop)\b/

/** Deterministic parser for the phrases the demo uses. Fast, free, and never invents a label. */
export function parseRules(text: string, labels: VaultLabel[]): Intent {
  const t = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return { action: 'unknown' }
  if (CANCEL.test(t)) return { action: 'cancel' }
  if (NEXT.test(t)) return { action: 'next' }
  if (!SEND.test(t) && !/\baddress\b/.test(t)) return { action: 'unknown' }

  const chain = chainHintIn(t).chain
  const words = t.split(' ')
  // A vault name ("savings", "cold-2") spoken anywhere in the phrase, for the chain if one was said.
  const name = labels.find((l) => (!chain || l.chain === chain) && l.name !== 'main' && words.includes(l.name))?.name
  return { action: 'send_address', ...(chain ? { chain } : {}), ...(name ? { name } : {}) }
}

export class RuleIntentParser implements IntentParser {
  async parse(text: string, ctx: { labels: VaultLabel[] }): Promise<Intent> {
    return parseRules(text, ctx.labels)
  }
}

/** Rules first; a model only for phrasing the rules do not understand. */
export class LayeredIntentParser implements IntentParser {
  constructor(private readonly fallback?: IntentParser) {}

  async parse(text: string, ctx: { labels: VaultLabel[]; requestChain?: Chain }): Promise<Intent> {
    const ruled = parseRules(text, ctx.labels)
    if (ruled.action !== 'unknown' || !this.fallback) return ruled
    return this.fallback.parse(text, ctx)
  }
}

/** Validates an intent that came from outside the rules (a model): only known chains and existing label names pass. */
export function sanitizeIntent(raw: unknown, labels: VaultLabel[]): Intent {
  if (!raw || typeof raw !== 'object') return { action: 'unknown' }
  const r = raw as Record<string, unknown>
  if (r.action === 'cancel') return { action: 'cancel' }
  if (r.action === 'next') return { action: 'next' }
  if (r.action !== 'send_address') return { action: 'unknown' }
  const chain = typeof r.chain === 'string' ? parseChain(r.chain) : undefined
  const name =
    typeof r.name === 'string' && labels.some((l) => l.name === r.name && (!chain || l.chain === chain)) ? r.name : undefined
  return { action: 'send_address', ...(chain ? { chain } : {}), ...(name ? { name } : {}) }
}
