// Parses what the user said on a verdict card. Code, not the AI, reads the amount and the token,
// so nothing in a chat message (or a model) can choose how much is paid.
import { toNano } from '@ton/core'

export type PayCommand = { kind: 'pay'; amountNano: bigint } | { kind: 'confirm' } | { kind: 'cancel' } | { kind: 'unknown' }

const WORDS: Record<string, string> = {
  half: '0.5',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
}

export function parsePayCommand(text: string): PayCommand {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (/^(no|nope|cancel|stop|back|never ?mind)\b/.test(t)) return { kind: 'cancel' }
  if (/^(confirm|confirmed|yes,? confirm|i confirm)\b/.test(t)) return { kind: 'confirm' }
  const m = /\b(?:send|pay|transfer)\s+(\d+(?:[.,]\d{1,9})?|half|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:a\s+)?(gram|grams|ton|tons|test gram|test grams)\b/.exec(t)
  if (!m) return { kind: 'unknown' }
  const amount = WORDS[m[1]] ?? m[1].replace(',', '.')
  try {
    const amountNano = toNano(amount)
    return amountNano > 0n ? { kind: 'pay', amountNano } : { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}
