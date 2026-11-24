// Lookalike (address-poisoning) detection. Scammers generate an address whose visible start and end match
// one you trust, then hope you copy it. Two addresses "look alike" when they differ but share at least
// MIN characters at both the start and the end of the part a person actually reads.
import { Address } from '@ton/core'
import type { Family } from '../vault/addresses.ts'

export const MIN_MATCH = 3

/** The part a person reads: the fixed prefix every address of the family shares is skipped. */
export function readablePart(family: Family, display: string): string {
  switch (family) {
    case 'evm':
      return display.slice(2).toLowerCase()
    case 'ton':
      return display.slice(2) // flags and workchain (UQ / EQ / 0Q / kQ)
    case 'bitcoin': {
      const lower = display.toLowerCase()
      return lower.startsWith('bc1') || lower.startsWith('tb1') ? lower.slice(4) : display.slice(1)
    }
    case 'tron':
      return display.slice(1)
    case 'solana':
      return display
  }
}

function sharedPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function sharedSuffix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

/**
 * Renders a trusted TON address in the same friendly form as the incoming one (same bounceable,
 * test-only and url-safe flags), so the comparison is on what the user would actually see.
 */
function renderLike(family: Family, incomingDisplay: string, trustedDisplay: string): string {
  if (family !== 'ton') return trustedDisplay
  try {
    const trusted = Address.parse(trustedDisplay)
    if (!Address.isFriendly(incomingDisplay)) return trusted.toRawString()
    const f = Address.parseFriendly(incomingDisplay)
    const urlSafe = !/[+/]/.test(incomingDisplay)
    return trusted.toString({ bounceable: f.isBounceable, testOnly: f.isTestOnly, urlSafe })
  } catch {
    return trustedDisplay
  }
}

export type TrustedRef = { label: string; kind: 'own' | 'contact' | 'paid' | 'profile'; family: Family; display: string; normalized: string }

/** The first trusted address the incoming one imitates, if any. Identical addresses are not lookalikes. */
export function findLookalike(
  incoming: { family: Family; display: string; normalized: string },
  refs: TrustedRef[],
  min = MIN_MATCH,
): TrustedRef | undefined {
  const mine = readablePart(incoming.family, incoming.display)
  for (const ref of refs) {
    if (ref.family !== incoming.family || ref.normalized === incoming.normalized) continue
    const theirs = readablePart(incoming.family, renderLike(incoming.family, incoming.display, ref.display))
    if (sharedPrefix(mine, theirs) >= min && sharedSuffix(mine, theirs) >= min) return ref
  }
  return undefined
}
