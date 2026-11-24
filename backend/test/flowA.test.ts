import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { FlowAController, type MessageSender, buildAddressReply } from '../src/flowA/controller.ts'
import { type IntentParser, LayeredIntentParser, parseRules, sanitizeIntent } from '../src/flowA/intent.ts'
import { detectAddressRequest, quoteUntrusted } from '../src/flowA/requests.ts'
import { createApiServer } from '../src/http.ts'
import { VaultStore } from '../src/vault/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'gramsight-flowa-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const SOL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SOL2 = '11111111111111111111111111111111'
const EVM = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

class RecordingSender implements MessageSender {
  sent: { chatId: number; text: string }[] = []
  fail = false
  async send(chatId: number, text: string): Promise<number> {
    if (this.fail) throw new Error('network down')
    this.sent.push({ chatId, text })
    return this.sent.length
  }
}

function setup(name: string, parser?: IntentParser) {
  const store = new VaultStore(join(dir, `${name}.json`))
  const sender = new RecordingSender()
  let clock = 1_000_000
  const ctl = new FlowAController(store, sender, parser, () => clock)
  return { store, sender, ctl, advance: (ms: number) => (clock += ms) }
}

test('address requests are recognised; shared addresses and chit-chat are not', () => {
  assert.deepEqual(detectAddressRequest('hey can you send me your sol address?'), { chain: 'solana', family: 'solana' })
  assert.deepEqual(detectAddressRequest("what's your ETH wallet"), { chain: 'ethereum', family: 'evm' })
  assert.deepEqual(detectAddressRequest('drop ur evm addy pls'), { family: 'evm' })
  assert.deepEqual(detectAddressRequest('send me your wallet address'), {})
  assert.equal(detectAddressRequest(`here is mine: ${SOL}`), undefined)
  assert.equal(detectAddressRequest('see you at the address tomorrow'), undefined)
  assert.equal(detectAddressRequest('nice weather today'), undefined)
})

test('untrusted text is flattened and stripped of control and bidi characters', () => {
  assert.equal(quoteUntrusted('line1\nline2‮evil\u0007'), 'line1 line2 evil')
  assert.equal(quoteUntrusted('x'.repeat(100), 10).length, 10)
})

test('rule parser: chains, names, cancel and next; never an address', () => {
  const labels = [
    { chain: 'solana' as const, name: 'main' },
    { chain: 'solana' as const, name: 'savings' },
  ]
  assert.deepEqual(parseRules('send my Solana address', labels), { action: 'send_address', chain: 'solana' })
  assert.deepEqual(parseRules('send my sol savings address to Ada', labels), { action: 'send_address', chain: 'solana', name: 'savings' })
  assert.deepEqual(parseRules('send it', labels), { action: 'send_address' })
  assert.deepEqual(parseRules('cancel', labels), { action: 'cancel' })
  assert.deepEqual(parseRules('next', labels), { action: 'next' })
  assert.deepEqual(parseRules('what time is it', labels), { action: 'unknown' })
})

test('model output is re-validated: unknown chains and names are dropped, addresses cannot get through', () => {
  const labels = [{ chain: 'solana' as const, name: 'main' }]
  assert.deepEqual(sanitizeIntent({ action: 'send_address', chain: 'solana', name: 'main' }, labels), { action: 'send_address', chain: 'solana', name: 'main' })
  assert.deepEqual(sanitizeIntent({ action: 'send_address', chain: 'dogecoin', name: SOL }, labels), { action: 'send_address' })
  assert.deepEqual(sanitizeIntent({ action: 'rm -rf' }, labels), { action: 'unknown' })
  assert.deepEqual(sanitizeIntent('nonsense', labels), { action: 'unknown' })
})

test('layered parser asks the model only when the rules do not understand', async () => {
  let calls = 0
  const model: IntentParser = {
    async parse() {
      calls++
      return { action: 'send_address', chain: 'solana' }
    },
  }
  const p = new LayeredIntentParser(model)
  await p.parse('send my solana address', { labels: [] })
  assert.equal(calls, 0)
  await p.parse('yeah give him my sol one', { labels: [] })
  assert.equal(calls, 0, '"give" + chain is handled by the rules too')
  await p.parse('hmm the usual one please', { labels: [] })
  assert.equal(calls, 1)
})

test('happy path: request -> command -> confirmation card -> one tap sends exactly once', async () => {
  const t = setup('happy')
  t.store.upsert('solana', 'main', SOL)
  t.ctl.addRequest({ chatId: 42, chatTitle: 'Weekend trip', fromName: 'Ada', text: 'can you send your sol address?', chain: 'solana' })
  assert.equal(t.ctl.view().kind, 'request')

  const confirm = await t.ctl.command('send my Solana address')
  assert.equal(confirm.kind, 'confirm')
  assert.equal(confirm.tap, 'confirm')
  assert.match(confirm.text, /SEND TO Ada · Weekend trip/)
  assert.match(confirm.text, /Solana main/)
  assert.match(confirm.text, /Tokenk…/) // fingerprint with start, middle and end
  assert.equal(t.sender.sent.length, 0, 'nothing is sent before the tap')

  const [a, b] = await Promise.all([t.ctl.tap(confirm.id), t.ctl.tap(confirm.id)])
  assert.equal(t.sender.sent.length, 1, 'a double tap sends once')
  assert.deepEqual(t.sender.sent[0], { chatId: 42, text: buildAddressReply(t.store.get('solana', 'main')!) })
  assert.ok([a.kind, b.kind].includes('sent'))
  await t.ctl.tap(confirm.id)
  assert.equal(t.sender.sent.length, 1, 'a later tap on the old card does nothing')

  t.advance(5000)
  assert.equal(t.ctl.view().kind, 'idle')
})

test('chain safety: an address of another chain is never offered', async () => {
  const t = setup('chain')
  t.store.upsert('solana', 'main', SOL)
  t.store.upsert('base', 'main', EVM)
  t.ctl.addRequest({ chatId: 1, chatTitle: 'DM', fromName: 'Bo', text: 'your eth address?', chain: 'ethereum', family: 'evm' })
  const v = await t.ctl.command('send my base address')
  assert.equal(v.kind, 'error')
  assert.match(v.text, /asked for Ethereum/)
  assert.equal(t.sender.sent.length, 0)
})

test('an EVM-family request accepts any EVM chain but not Solana', async () => {
  const t = setup('family')
  t.store.upsert('solana', 'main', SOL)
  t.store.upsert('base', 'main', EVM)
  t.ctl.addRequest({ chatId: 1, chatTitle: 'DM', fromName: 'Bo', text: 'drop your evm addy', family: 'evm' })
  assert.equal((await t.ctl.command('send my solana address')).kind, 'error')
  t.advance(10_000)
  assert.equal((await t.ctl.command('send my base address')).kind, 'confirm')
})

test('missing or ambiguous vault entries ask instead of guessing', async () => {
  const t = setup('ambiguous')
  t.ctl.addRequest({ chatId: 1, chatTitle: 'DM', fromName: 'Bo', text: 'sol address?', chain: 'solana' })
  assert.match((await t.ctl.command('send my solana address')).text, /No Solana address in your vault/)
  t.store.upsert('solana', 'savings', SOL)
  t.store.upsert('solana', 'cold', SOL2)
  t.advance(10_000)
  assert.match((await t.ctl.command('send my solana address')).text, /Which Solana address/)
  t.advance(10_000)
  const v = await t.ctl.command('send my solana cold address')
  assert.equal(v.kind, 'confirm')
  assert.match(v.text, /Solana cold/)
})

test('a failed send is reported and never retried; double-tap cancels a confirmation', async () => {
  const t = setup('fail')
  t.store.upsert('solana', 'main', SOL)
  t.ctl.addRequest({ chatId: 7, chatTitle: 'DM', fromName: 'Cy', text: 'sol addy?', chain: 'solana' })
  const c1 = await t.ctl.command('send my solana address')
  assert.equal(t.ctl.cancel().kind, 'request', 'double-tap goes back to the request')
  await t.ctl.tap(c1.id)
  assert.equal(t.sender.sent.length, 0, 'a cancelled confirmation cannot be sent')

  const c2 = await t.ctl.command('send my solana address')
  t.sender.fail = true
  const v = await t.ctl.tap(c2.id)
  assert.equal(v.kind, 'error')
  assert.match(v.text, /NOT SENT/)
  t.sender.fail = false
  await t.ctl.tap(c2.id)
  assert.equal(t.sender.sent.length, 0, 'no automatic or repeated send after a failure')
})

test('HTTP API: card, simulated request, command and tap; dev endpoint is off unless enabled', async () => {
  const t = setup('http')
  t.store.upsert('solana', 'main', SOL)
  const server = createApiServer({ screen: t.ctl, dev: { flowA: t.ctl } })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  type Card = { kind: string; id: string }
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(
      (r) => r.json() as Promise<Card>,
    )
  try {
    assert.equal((await fetch(`${base}/api/card`).then((r) => r.json() as Promise<Card>)).kind, 'idle')
    assert.equal((await post('/api/dev/request', { text: 'send me your sol address', chatId: 5 })).kind, 'request')
    const confirm = await post('/api/command', { text: 'send my solana address' })
    assert.equal(confirm.kind, 'confirm')
    assert.equal((await post('/api/tap', { cardId: confirm.id })).kind, 'sent')
    assert.equal(t.sender.sent[0].chatId, 5)
    assert.equal((await fetch(`${base}/api/command`, { method: 'POST', body: '{bad' })).status, 400)
  } finally {
    server.close()
  }

  const prod = createApiServer({ screen: t.ctl })
  await new Promise<void>((r) => prod.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${(prod.address() as AddressInfo).port}/api/dev/request`, { method: 'POST', body: '{}' })
    assert.equal(res.status, 404)
  } finally {
    prod.close()
  }
})
