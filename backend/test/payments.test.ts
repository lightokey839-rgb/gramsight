import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Address, toNano } from '@ton/core'
import { AddressChecker } from '../src/checker/checker.ts'
import type { ProfileWalletSource } from '../src/checker/sources.ts'
import { FlowAController } from '../src/flowA/controller.ts'
import { FlowBController } from '../src/flowB/controller.ts'
import { parsePayCommand } from '../src/payments/command.ts'
import { signedTransferDestinations } from '../src/checker/payerHistory.ts'
import { PaymentLedger, ledgerHistory } from '../src/payments/ledger.ts'
import { type PaymentRail, type PaymentRequest, singleRail } from '../src/payments/rail.ts'
import { Screen } from '../src/screen.ts'
import { VaultStore } from '../src/vault/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'gramsight-pay-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const ton = (fill: number) => new Address(0, Buffer.alloc(32, fill)).toString({ bounceable: false })
const ADA = ton(0x11)
const NEW = ton(0x33)
const card = (address: string | null): ProfileWalletSource => ({ walletCardAddress: async () => address })

class FakeRail implements PaymentRail {
  readonly id = 'testnet-payer' as const
  readonly network = 'TON testnet'
  paid: PaymentRequest[] = []
  fail = false
  gate: Promise<void> = Promise.resolve()
  async pay(req: PaymentRequest) {
    await this.gate
    if (this.fail) throw new Error('payer balance too low')
    this.paid.push(req)
    return { status: 'confirmed' as const, hash: 'ab'.repeat(32) }
  }
}

function setup(name: string, opts: { profile?: ProfileWalletSource; per?: string; daily?: string } = {}) {
  const store = new VaultStore(join(dir, `${name}-vault.json`))
  const ledger = new PaymentLedger(join(dir, `${name}-payments.json`))
  const rail = new FakeRail()
  let clock = Date.parse('2026-11-26T10:00:00Z')
  const checker = new AddressChecker({ store, ...(opts.profile ? { profile: opts.profile } : {}), history: ledgerHistory(ledger) })
  const b = new FlowBController(checker, () => clock, () => {}, {
    rails: singleRail(rail),
    ledger,
    limits: { perPaymentNano: toNano(opts.per ?? '1'), dailyNano: toNano(opts.daily ?? '3') },
  })
  const screen = new Screen(new FlowAController(store, { send: async () => 1 }, undefined, () => clock), b)
  return { store, ledger, rail, b, screen, advance: (ms: number) => (clock += ms) }
}

async function share(t: ReturnType<typeof setup>, address: string, senderUserId = 7) {
  t.b.addShare({ chatId: 1, chatTitle: 'Private chat', fromName: 'Ada', senderUserId, address })
  await t.b.settled()
}

test('pay command: code reads the amount and token; nothing else starts a payment', () => {
  assert.deepEqual(parsePayCommand('send 1 Gram'), { kind: 'pay', amountNano: toNano('1') })
  assert.deepEqual(parsePayCommand('Send 0,5 gram please'), { kind: 'pay', amountNano: toNano('0.5') })
  assert.deepEqual(parsePayCommand('pay two ton'), { kind: 'pay', amountNano: toNano('2') })
  assert.deepEqual(parsePayCommand('confirm'), { kind: 'confirm' })
  assert.deepEqual(parsePayCommand('cancel'), { kind: 'cancel' })
  assert.deepEqual(parsePayCommand('send 0 gram'), { kind: 'unknown' })
  assert.deepEqual(parsePayCommand('send 10 usdt'), { kind: 'unknown' })
  assert.deepEqual(parsePayCommand('send everything'), { kind: 'unknown' })
})

test('a matching profile wallet: send -> payment card -> one tap pays exactly once', async () => {
  const t = setup('match', { profile: card(ADA) })
  await share(t, ADA)
  assert.match(t.screen.view().text, /MATCHES THEIR TELEGRAM WALLET[\s\S]*Say: send 1 Gram/)

  const pay = await t.screen.command('send 1 Gram')
  assert.equal(pay.kind, 'pay')
  assert.equal(pay.tap, 'confirm')
  assert.match(pay.text, /PAY Ada · Private chat\n1 Gram · TON testnet/)
  assert.equal(t.rail.paid.length, 0, 'nothing paid before the tap')

  await Promise.all([t.screen.tap(pay.id), t.screen.tap(pay.id), t.screen.tap(pay.id)])
  await t.b.settled()
  assert.equal(t.rail.paid.length, 1, 'three taps, one payment')
  assert.equal(t.rail.paid[0].to, ADA)
  assert.equal(t.rail.paid[0].amountNano, toNano('1'))
  const sent = t.screen.view()
  assert.equal(sent.kind, 'sent')
  assert.match(sent.text, /SENT 1 Gram → Ada\nTON testnet · tx abab/)
  assert.equal(t.ledger.list()[0].status, 'confirmed')
})

test('a new address needs a spoken "confirm" before the tap works', async () => {
  const t = setup('confirm-twice')
  await share(t, NEW)
  const pay = await t.screen.command('send 0.5 gram')
  assert.equal(pay.tap, 'none')
  assert.match(pay.text, /NEW ADDRESS, BE CAREFUL[\s\S]*Say "confirm", then tap/)
  await t.screen.tap(pay.id)
  await t.b.settled()
  assert.equal(t.rail.paid.length, 0, 'a tap without the spoken confirm does nothing')

  const armed = await t.screen.command('confirm')
  assert.equal(armed.tap, 'confirm')
  await t.screen.tap(armed.id)
  await t.b.settled()
  assert.equal(t.rail.paid.length, 1)
})

test('blocked verdicts can never reach a payment card', async () => {
  const t = setup('blocked')
  t.b.addShare({ chatId: 1, chatTitle: 'DM', fromName: 'X', address: 'not-an-address-at-all' })
  await t.b.settled()
  const v = await t.screen.command('send 1 gram')
  assert.equal(v.kind, 'error')
  assert.match(v.text, /Payment blocked/)
  assert.equal(t.rail.paid.length, 0)
})

test('limits: per payment and per 24 hours, counted from the ledger', async () => {
  const t = setup('limits', { profile: card(ADA), per: '1', daily: '1.5' })
  await share(t, ADA)
  assert.match((await t.screen.command('send 2 gram')).text, /Over your limit\.\nMax 1 Gram per payment/)
  const p1 = await t.screen.command('send 1 gram')
  await t.screen.tap(p1.id)
  await t.b.settled()
  assert.equal(t.rail.paid.length, 1)

  t.advance(10_000)
  await share(t, ADA)
  assert.match((await t.screen.command('send 1 gram')).text, /Over your daily limit\.\n0\.5 Gram left today/)
  t.advance(24 * 60 * 60 * 1000)
  assert.equal((await t.screen.command('send 1 gram')).kind, 'pay', 'the window rolls after 24 hours')
})

test('a failed payment is recorded as failed and never retried', async () => {
  const t = setup('fail', { profile: card(ADA) })
  await share(t, ADA)
  t.rail.fail = true
  const p = await t.screen.command('send 1 gram')
  await t.screen.tap(p.id)
  await t.b.settled()
  const v = t.screen.view()
  assert.equal(v.kind, 'error')
  assert.match(v.text, /NOT PAID\npayer balance too low/)
  await t.screen.tap(p.id)
  await t.b.settled()
  assert.equal(t.rail.paid.length, 0)
  assert.equal(t.ledger.list().length, 1)
  assert.equal(t.ledger.list()[0].status, 'failed')
  assert.equal(t.ledger.spentSince(0), 0n, 'failed payments do not count against the limit')
})

test('double-tap cancels a waiting payment but never one in flight; the next check says "paid before"', async () => {
  const t = setup('cancel')
  t.store.upsertContact('ada', 'ton', ADA)
  await share(t, ADA)
  const p1 = await t.screen.command('send 1 gram')
  assert.equal(t.screen.cancel().kind, 'verdict', 'back to the verdict card')
  await t.screen.tap(p1.id)
  assert.equal(t.rail.paid.length, 0)

  let release!: () => void
  t.rail.gate = new Promise((r) => (release = r))
  const p2 = await t.screen.command('send 1 gram')
  await t.screen.tap(p2.id)
  assert.equal(t.screen.view().kind, 'paying')
  t.screen.cancel()
  assert.equal(t.screen.view().kind, 'paying', 'a payment in flight cannot be cancelled into a retry')
  release()
  await t.b.settled()
  assert.equal(t.rail.paid.length, 1)

  t.store.removeContact('ada', 'ton')
  await share(t, ADA)
  t.advance(10_000)
  const again = t.screen.view()
  assert.equal(again.kind, 'verdict')
  assert.match(again.text, /YOU PAID THIS ADDRESS BEFORE/)
})

test('history counts only wallet-signed transfers: a bounced dust message is not "paid before"', () => {
  const paid = Address.parse(ADA)
  const spammer = Address.parse(NEW)
  const out = (dest: Address, bounced = false) => ({ info: { type: 'internal', dest, bounced } })
  const txs = [
    { inMessage: { info: { type: 'external-in' } }, outMessages: { values: () => [out(paid)] } }, // our signed transfer
    { inMessage: { info: { type: 'internal' } }, outMessages: { values: () => [out(spammer)] } }, // dust bounced back
    { inMessage: null, outMessages: { values: () => [out(spammer)] } },
  ]
  const list = signedTransferDestinations(txs)
  assert.equal(list.length, 1)
  assert.ok(Address.parse(list[0]).equals(paid))
})

test('dry-run payments never count as trust or against the limits', () => {
  const ledger = new PaymentLedger(join(dir, 'dryrun-ledger.json'))
  const base = { at: new Date().toISOString(), to: ADA, normalized: 'x', amountNano: toNano('1').toString(), verdict: 'new-address' }
  ledger.add({ ...base, rail: 'dry-run', status: 'confirmed' })
  assert.equal(ledger.spentSince(0), 0n)
  assert.equal(ledger.sent().length, 0)
  ledger.add({ ...base, rail: 'testnet-payer', status: 'submitted' })
  assert.equal(ledger.spentSince(0), toNano('1'))
  assert.equal(ledger.sent().length, 1)
})

test('only TON addresses can be paid', async () => {
  const t = setup('evm')
  t.b.addShare({ chatId: 1, chatTitle: 'DM', fromName: 'Bo', address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' })
  await t.b.settled()
  assert.doesNotMatch(t.screen.view().text, /Say: send 1 Gram/)
  assert.match((await t.screen.command('send 1 gram')).text, /pays in Gram on TON only/)
})
