// One plain-language line on a warned or blocked verdict, e.g. "Looks like your contact Ada, but the middle differs."
// It explains the checker's STRUCTURED result; it never decides anything and is never financial advice.
// The AI only sees facts (verdict code, labels, which checks passed), never an address.
// A fixed template is always available, and is used when the AI is off, busy, or says something unsafe.
import type { Verdict } from '../checker/checker.ts'
import { detectFamilies } from '../vault/addresses.ts'
import type { AiProvider } from './provider.ts'

export type Reason = { text: string; source: 'ai' | 'template' }

/** The fixed explanation for each verdict that needs one. Undefined for verdicts that need no explanation. */
export function templateReason(v: Verdict): string | undefined {
  switch (v.code) {
    case 'invalid':
      return 'The checksum is wrong, so it may be mistyped.'
    case 'flagged':
      return 'This address is reported as a scam.'
    case 'lookalike':
      return `Looks like ${v.lookalikeOf ?? 'an address you trust'}, but the middle differs.`
    case 'not-their-wallet':
      return 'Their Telegram profile shows a different wallet.'
    case 'contact-other-person':
      return `This address is saved as ${v.contact ?? 'someone else'}, not the sender.`
    case 'own-address':
      return 'This is one of your own addresses.'
    case 'new-address':
      return v.profile.status === 'none'
        ? 'No wallet on their profile, and you have never paid it.'
        : 'You have never paid or saved this address.'
    default:
      return undefined
  }
}

const REASON_SCHEMA = {
  type: 'object',
  properties: { reason: { type: 'string' } },
  required: ['reason'],
  additionalProperties: false,
}

const SYSTEM = [
  'You write ONE short plain-English sentence (at most 70 characters) that explains a safety check result to someone',
  'about to send crypto. Explain only the facts given. Do not give advice, do not say what to do, do not invent facts,',
  'do not include any address, number or link. Reply with JSON: {"reason": "..."}.',
].join(' ')

/** Facts for the AI: no addresses, no fingerprints. */
function facts(v: Verdict): string {
  const lines = [
    `verdict: ${v.code} (${v.headline.toLowerCase()})`,
    `their Telegram profile wallet: ${v.profile.status}`,
    `scam reports: ${v.reputation}`,
  ]
  if (v.lookalikeOf) lines.push(`imitates: ${v.lookalikeOf} (same start and end characters, different middle)`)
  if (v.contact) lines.push(`saved contact name involved: ${v.contact}`)
  return lines.join('\n')
}

/** Rejects AI text that is too long, contains an address-like token, digits, or a link. */
export function safeReason(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 90) return undefined
  if (/https?:|www\.|\d/.test(t)) return undefined
  if (t.split(' ').some((tok) => tok.length >= 20 || detectFamilies(tok.replace(/[.,;:!?]+$/, '')).length > 0)) return undefined
  return t
}

export class VerdictExplainer {
  constructor(private readonly ai?: AiProvider) {}

  /** Immediate, deterministic reason for the card (or undefined when none is needed). */
  quick(v: Verdict): Reason | undefined {
    const t = templateReason(v)
    return t ? { text: t, source: 'template' } : undefined
  }

  /** AI wording when available and safe; otherwise the template. Only for warned or blocked verdicts. */
  async explain(v: Verdict): Promise<Reason | undefined> {
    const fallback = this.quick(v)
    if (!fallback || !this.ai || v.level === 'ok') return fallback
    try {
      const raw = (await this.ai.completeJson({ system: SYSTEM, user: facts(v), schema: REASON_SCHEMA, schemaName: 'reason', maxTokens: 80 })) as {
        reason?: unknown
      }
      const text = safeReason(raw?.reason)
      return text ? { text, source: 'ai' } : fallback
    } catch {
      return fallback
    }
  }
}
