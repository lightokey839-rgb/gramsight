// The address checker. Layers, in order:
//   1. the sender's Telegram profile wallet card (TON)   2. saved contacts in the vault
//   3. lookalike of anything trusted                      4. a scam-reputation source
// Three profile outcomes are kept strictly apart and never merged:
//   "Matches their Telegram wallet"  only with a card present AND the same address (raw compare)
//   "Not their Telegram wallet"      card present, different address
//   "No wallet on their profile"     no card: neutral, never counted as a match
// Every layer can fail; a failure is reported as "couldn't check", never as safe.
import { type Chain, type Family, detectFamilies, fingerprint, validateForChain } from '../vault/addresses.ts'
import { type VaultStore, entryLabel } from '../vault/store.ts'
import { type TrustedRef, findLookalike } from './lookalike.ts'
import type { HistorySource, ProfileWalletSource, ReputationSource } from './sources.ts'

export type ProfileCheck =
  | { status: 'match'; cardAddress: string }
  | { status: 'mismatch'; cardAddress: string }
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'skipped' }

export type VerdictCode =
  | 'invalid'
  | 'flagged'
  | 'lookalike'
  | 'not-their-wallet'
  | 'their-wallet'
  | 'contact-other-person'
  | 'saved-contact'
  | 'own-address'
  | 'new-address'

export type Verdict = {
  /** block: no way to pay. confirm-twice: needs an extra spoken "confirm" plus a tap. ok: one tap. */
  level: 'block' | 'confirm-twice' | 'ok'
  code: VerdictCode
  headline: string
  details: string[]
  address: string
  family?: Family
  normalized?: string
  profile: ProfileCheck
  reputation: 'flagged' | 'clean' | 'unknown' | 'not-covered'
  contact?: string
  lookalikeOf?: string
}

export type CheckerDeps = {
  store: VaultStore
  profile?: ProfileWalletSource
  reputation?: ReputationSource
  history?: HistorySource
  timeoutMs?: number
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

export class AddressChecker {
  constructor(private readonly deps: CheckerDeps) {}

  async check(input: { address: string; chain?: Chain; senderUserId?: number }): Promise<Verdict> {
    const address = input.address.trim()
    const base = { address, profile: { status: 'skipped' } as ProfileCheck, reputation: 'not-covered' as Verdict['reputation'], details: [] as string[] }

    // 0. Is it an address at all, and of which family? (The chain itself comes from context, not the format.)
    let family: Family | undefined
    let display = address
    let normalized: string | undefined
    if (input.chain) {
      const c = validateForChain(input.chain, address)
      if (c.ok) ({ family, display, normalized } = c)
    } else {
      const families = detectFamilies(address)
      if (families.length === 1) {
        family = families[0]
        const c = validateForChain(({ ton: 'ton', evm: 'ethereum', solana: 'solana', bitcoin: 'bitcoin', tron: 'tron' } as const)[family], address)
        if (c.ok) ({ display, normalized } = c)
      }
    }
    if (!family || !normalized) {
      return { ...base, level: 'block', code: 'invalid', headline: 'NOT A VALID ADDRESS', details: ['Checksum or format is wrong. Ask them to resend.'] }
    }

    const t = this.deps.timeoutMs ?? 4000
    const { store } = this.deps

    // Run the remote layers in parallel to stay well inside the glasses' ~30 s budget.
    const [profile, reputation, paid] = await Promise.all([
      family === 'ton' && input.senderUserId !== undefined && this.deps.profile
        ? withTimeout(this.deps.profile.walletCardAddress(input.senderUserId), t).then(
            (card): ProfileCheck => {
              if (!card) return { status: 'none' }
              const c = validateForChain('ton', card)
              return c.ok && c.normalized === normalized ? { status: 'match', cardAddress: card } : { status: 'mismatch', cardAddress: card }
            },
            (): ProfileCheck => ({ status: 'unavailable' }),
          )
        : Promise.resolve<ProfileCheck>({ status: 'skipped' }),
      this.deps.reputation
        ? withTimeout(this.deps.reputation.check(family, display), t).then(
            (r): Verdict['reputation'] => (r === undefined ? 'not-covered' : r.flagged ? 'flagged' : 'clean'),
            (): Verdict['reputation'] => 'unknown',
          )
        : Promise.resolve<Verdict['reputation']>('not-covered'),
      family === 'ton' && this.deps.history
        ? withTimeout(this.deps.history.paidAddresses(), t).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
    ])

    // Trusted references for the lookalike check: own vault addresses, contacts, addresses paid before,
    // and the sender's own profile wallet (a lookalike of THAT is the classic swap).
    const refs: TrustedRef[] = []
    for (const e of store.list()) {
      const c = validateForChain(e.chain, e.address)
      if (c.ok) refs.push({ label: `your ${entryLabel(e)}`, kind: 'own', family: c.family, display: c.display, normalized: c.normalized })
    }
    for (const k of store.contacts()) {
      const c = validateForChain(k.chain, k.address)
      if (c.ok) refs.push({ label: `contact ${k.name}`, kind: 'contact', family: c.family, display: c.display, normalized: c.normalized })
    }
    for (const p of paid) {
      const c = validateForChain('ton', p)
      if (c.ok) refs.push({ label: `an address you paid (${fingerprint(c.display)})`, kind: 'paid', family: 'ton', display: c.display, normalized: c.normalized })
    }
    if (profile.status === 'mismatch') {
      const c = validateForChain('ton', profile.cardAddress)
      if (c.ok) refs.push({ label: 'their Telegram wallet', kind: 'profile', family: 'ton', display: c.display, normalized: c.normalized })
    }

    const contacts = store.contacts().filter((k) => k.normalized === normalized)
    const own = store.list().find((e) => e.normalized === normalized)
    const look = findLookalike({ family, display, normalized }, refs)

    const details: string[] = []
    if (profile.status === 'none') details.push('No wallet on their profile')
    if (profile.status === 'unavailable') details.push("Profile wallet: couldn't check")
    if (profile.status === 'mismatch') details.push(`Their wallet: ${fingerprint(profile.cardAddress)}`)
    if (reputation === 'clean') details.push('No scam reports')
    if (reputation === 'unknown') details.push("Scam check: couldn't check")

    const common = { address: display, family, normalized, profile, reputation }
    const v = (level: Verdict['level'], code: VerdictCode, headline: string, extra: Partial<Verdict> = {}): Verdict => ({
      ...common,
      level,
      code,
      headline,
      details,
      ...extra,
    })

    // Strongest signal first.
    if (reputation === 'flagged') return v('block', 'flagged', 'FLAGGED AS SCAM', { details: ['Reported as a scam (tonapi)', ...details] })
    if (look) {
      return v('block', 'lookalike', `LOOKALIKE OF ${look.label.toUpperCase()}`, {
        lookalikeOf: look.label,
        details: ['Same start and end, different address', ...details],
      })
    }
    if (profile.status === 'mismatch') {
      return v('confirm-twice', 'not-their-wallet', 'NOT THEIR TELEGRAM WALLET', {
        ...(contacts[0] ? { contact: contacts[0].name } : {}),
        details: contacts[0] ? [...details, `Saved as contact ${contacts[0].name}`] : details,
      })
    }
    if (profile.status === 'match') {
      return v('ok', 'their-wallet', 'MATCHES THEIR TELEGRAM WALLET', {
        ...(contacts[0] ? { contact: contacts[0].name, details: [...details, `Also saved as ${contacts[0].name}`] } : {}),
      })
    }
    if (contacts.length) {
      const k = contacts[0]
      if (k.telegramUserId !== undefined && input.senderUserId !== undefined && k.telegramUserId !== input.senderUserId) {
        return v('confirm-twice', 'contact-other-person', `SAVED AS ${k.name.toUpperCase()}, NOT THE SENDER`, { contact: k.name })
      }
      return v('ok', 'saved-contact', `MATCHES SAVED CONTACT ${k.name.toUpperCase()}`, { contact: k.name })
    }
    if (own) return v('confirm-twice', 'own-address', 'THIS IS YOUR OWN ADDRESS', { details: [`Your ${entryLabel(own)}`, ...details] })
    return v('confirm-twice', 'new-address', 'NEW ADDRESS, BE CAREFUL', { details })
  }
}
