import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Address } from '@ton/core'
import { AddressChecker } from '../src/checker/checker.ts'
import { findLookalike, readablePart } from '../src/checker/lookalike.ts'
import { LayeredProfileSource, type ProfileWalletSource, TonapiReputation } from '../src/checker/sources.ts'
import { FlowBController, verdictCardText } from '../src/flowB/controller.ts'
import { FlowAController, type MessageSender } from '../src/flowA/controller.ts'
import { Screen } from '../src/screen.ts'
import { validateForChain } from '../src/vault/addresses.ts'
import { VaultStore } from '../src/vault/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'gramsight-checker-'))
after(() => rmSync(dir, { recursive: true, force: true }))

/** A TON address whose friendly form we control: same flags, different hash. */
const ton = (fill: number) => new Address(0, Buffer.alloc(32, fill)).toString({ bounceable: false })
const ADA = ton(0x11)
const OTHER = ton(0x22)

/** Builds a TON address that LOOKS like `target` (same readable start and end) but is a different account. */
function lookalikeOf(target: string): string {
  const t = Address.parse(target)
  for (let i = 0; i < 2_000_000; i++) {
    const h = Buffer.from(t.hash)
    h.writeUInt32BE(i, 12) // change only the middle of the hash
    const cand = new Address(0, h).toString({ bounceable: false })
    const a = readablePart('ton', cand)
    const b = readablePart('ton', target)
    if (cand !== target && a.slice(0, 3) === b.slice(0, 3) && a.slice(-3) === b.slice(-3)) return cand
  }
  throw new Error('no lookalike found')
}

const card = (address: string | null): ProfileWalletSource => ({ walletCardAddress: async () => address })
const failing: ProfileWalletSource = {
  walletCardAddress: async () => {
    throw new Error('chat not found')
  },
}
const rep = (flagged: boolean) => ({ check: async (family: string) => (family === 'ton' ? { flagged } : undefined) })

function store(name: string) {
  return new VaultStore(join(dir, `${name}.json`))
}

test('lookalike: same readable start and end, different address; identical is not a lookalike', () => {
  const fake = lookalikeOf(ADA)
  const ref = { label: 'contact ada', kind: 'contact' as const, family: 'ton' as const, display: ADA, normalized: Address.parse(ADA).toRawString() }
  const incoming = (a: string) => ({ family: 'ton' as const, display: a, normalized: Address.parse(a).toRawString() })
  assert.equal(findLookalike(incoming(fake), [ref])?.label, 'contact ada')
  assert.equal(findLookalike(incoming(ADA), [ref]), undefined)
  assert.equal(findLookalike(incoming(OTHER), [ref]), undefined)
  // The same wallet written in another form (bounceable) is compared in the incoming form, so still caught.
  const fakeBounceable = Address.parse(fake).toString({ bounceable: true })
  assert.equal(findLookalike(incoming(fakeBounceable), [ref])?.label, 'contact ada')
})

test('the three profile verdicts never overlap', async () => {
  const s = store('profile')
  const match = await new AddressChecker({ store: s, profile: card(ADA) }).check({ address: ADA, senderUserId: 1 })
  assert.equal(match.code, 'their-wallet')
  assert.equal(match.level, 'ok')

  // Same wallet in a different written form still matches (raw compare).
  const bounceable = Address.parse(ADA).toString({ bounceable: true, testOnly: true })
  assert.equal((await new AddressChecker({ store: s, profile: card(ADA) }).check({ address: bounceable, senderUserId: 1 })).code, 'their-wallet')

  const mismatch = await new AddressChecker({ store: s, profile: card(OTHER) }).check({ address: ADA, senderUserId: 1 })
  assert.equal(mismatch.code, 'not-their-wallet')
  assert.equal(mismatch.level, 'confirm-twice')

  const none = await new AddressChecker({ store: s, profile: card(null) }).check({ address: ADA, senderUserId: 1 })
  assert.equal(none.code, 'new-address', 'no card is neutral, never a match')
  assert.ok(none.details.includes('No wallet on their profile'))

  const down = await new AddressChecker({ store: s, profile: failing }).check({ address: ADA, senderUserId: 1 })
  assert.equal(down.code, 'new-address', 'a failed lookup is never a match')
  assert.ok(down.details.includes("Profile wallet: couldn't check"))
})

test('layered profile source: a card from any source wins; all failing is "couldn\'t check"', async () => {
  assert.equal(await new LayeredProfileSource([failing, card(ADA)]).walletCardAddress(1), ADA)
  assert.equal(await new LayeredProfileSource([card(null), failing]).walletCardAddress(1), null)
  await assert.rejects(new LayeredProfileSource([failing, failing]).walletCardAddress(1))
})

test('priority: scam flag > lookalike > profile mismatch > match > contact > own > new', async () => {
  const s = store('priority')
  s.upsertContact('ada', 'ton', ADA)
  const fake = lookalikeOf(ADA)

  assert.equal((await new AddressChecker({ store: s, reputation: rep(true), profile: card(fake) }).check({ address: fake, senderUserId: 9 })).code, 'flagged')
  const look = await new AddressChecker({ store: s, reputation: rep(false), profile: card(fake) }).check({ address: fake, senderUserId: 9 })
  assert.equal(look.code, 'lookalike', 'a lookalike of a saved contact is blocked even if it is on the sender profile')
  assert.equal(look.level, 'block')
  assert.match(look.headline, /LOOKALIKE OF CONTACT ADA/)

  const contact = await new AddressChecker({ store: s, reputation: rep(false) }).check({ address: ADA })
  assert.equal(contact.code, 'saved-contact')
  assert.equal(contact.level, 'ok')
  assert.ok(contact.details.includes('No scam reports'))

  s.upsert('ton', 'main', OTHER)
  const own = await new AddressChecker({ store: s }).check({ address: OTHER })
  assert.equal(own.code, 'own-address')
  assert.equal(own.level, 'confirm-twice')

  const fresh = await new AddressChecker({ store: s }).check({ address: ton(0x77) })
  assert.equal(fresh.code, 'new-address')
  assert.equal(fresh.level, 'confirm-twice')
})

test('a lookalike of the sender\'s own profile wallet is blocked (the classic swap)', async () => {
  const s = store('swap')
  const fake = lookalikeOf(ADA)
  const v = await new AddressChecker({ store: s, profile: card(ADA) }).check({ address: fake, senderUserId: 1 })
  assert.equal(v.code, 'lookalike')
  assert.match(v.headline, /THEIR TELEGRAM WALLET/)
})

test('addresses paid before are lookalike references; invalid input is blocked', async () => {
  const s = store('paid')
  const paid = ton(0x44)
  const fake = lookalikeOf(paid)
  const history = { paidAddresses: async () => [paid] }
  assert.equal((await new AddressChecker({ store: s, history }).check({ address: fake })).code, 'lookalike')
  const again = await new AddressChecker({ store: s, history }).check({ address: paid })
  assert.equal(again.code, 'paid-before')
  assert.equal(again.level, 'ok')
  const broken = ADA.slice(0, 10) + (ADA[10] === 'A' ? 'B' : 'A') + ADA.slice(11)
  const invalid = await new AddressChecker({ store: s }).check({ address: broken })
  assert.equal(invalid.code, 'invalid')
  assert.equal(invalid.level, 'block')
})

test('slow sources time out into "couldn\'t check", never into safe', async () => {
  const s = store('slow')
  const never = { walletCardAddress: () => new Promise<string | null>(() => {}) }
  const slowRep = { check: () => new Promise<{ flagged: boolean }>(() => {}) }
  const started = Date.now()
  const v = await new AddressChecker({ store: s, profile: never, reputation: slowRep, timeoutMs: 50 }).check({ address: ADA, senderUserId: 1 })
  assert.ok(Date.now() - started < 2000)
  assert.equal(v.code, 'new-address')
  assert.equal(v.profile.status, 'unavailable')
  assert.equal(v.reputation, 'unknown')
})

test('tonapi reputation: reads is_scam from mainnet by raw address; other families are not covered', async () => {
  const calls: string[] = []
  const fakeFetch = (async (url: string | URL | Request) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ is_scam: true, name: 'Bad' }), { status: 200 })
  }) as typeof fetch
  const r = new TonapiReputation(fakeFetch, 'https://tonapi.io', undefined)
  assert.deepEqual(await r.check('ton', ADA), { flagged: true, name: 'Bad' })
  assert.equal(calls[0], `https://tonapi.io/v2/accounts/${encodeURIComponent(Address.parse(ADA).toRawString())}`)
  assert.equal(await r.check('evm', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), undefined)
})

test('verdict card text and Flow B queue; the screen shows verdicts before requests', async () => {
  const s = store('flowb')
  const checker = new AddressChecker({ store: s, profile: card(OTHER) })
  const b = new FlowBController(checker)
  const sender: MessageSender = { send: async () => 1 }
  const a = new FlowAController(s, sender)
  const screen = new Screen(a, b)
  a.addRequest({ chatId: 1, chatTitle: 'DM', fromName: 'Bo', text: 'sol address?', chain: 'solana' })
  b.addShare({ chatId: 2, chatTitle: 'Private chat', fromName: 'Ada', senderUserId: 5, address: ADA })
  await b.settled()
  const v = screen.view()
  assert.equal(v.kind, 'verdict')
  assert.match(v.text, /ADDRESS FROM Ada · Private chat/)
  assert.match(v.text, /NOT THEIR TELEGRAM WALLET/)
  assert.match(v.text, /Their wallet: /)
  assert.equal(screen.cancel().kind, 'request', 'dismissing the verdict shows the waiting request')

  const blocked = verdictCardText({ fromName: 'X', chatTitle: 'Y' }, { ...(await checker.check({ address: 'nonsense' })) }, 'nonsense')
  assert.match(blocked, /NOT A VALID ADDRESS/)
  assert.match(blocked, /Payment blocked/)
})

test('own TON vault entries in any written form are recognised', () => {
  const c = validateForChain('ton', Address.parse(ADA).toString({ bounceable: true }))
  assert.ok(c.ok && c.normalized === Address.parse(ADA).toRawString())
})
