import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Address } from '@ton/core'
import { type Reason, VerdictExplainer, safeReason, templateReason } from '../src/ai/explain.ts'
import { AiIntentParser } from '../src/ai/intent.ts'
import { OpenRouterProvider } from '../src/ai/openrouter.ts'
import { AiBusyError, type AiProvider, BudgetedAi } from '../src/ai/provider.ts'
import { AddressChecker } from '../src/checker/checker.ts'
import { FlowAController } from '../src/flowA/controller.ts'
import { LayeredIntentParser } from '../src/flowA/intent.ts'
import { FlowBController } from '../src/flowB/controller.ts'
import { VaultStore } from '../src/vault/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'gramsight-ai-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const SOL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ton = (fill: number) => new Address(0, Buffer.alloc(32, fill)).toString({ bounceable: false })

class ScriptedAi implements AiProvider {
  readonly name = 'Test'
  readonly model = 'test:free'
  calls: { system: string; user: string }[] = []
  constructor(private readonly reply: (user: string) => unknown) {}
  async completeJson(req: { system: string; user: string }) {
    this.calls.push(req)
    const r = this.reply(req.user)
    if (r instanceof Error) throw r
    return r
  }
}

test('budget and cache: identical inputs are free, the daily limit turns into "AI busy", a new day resets', async () => {
  let clock = Date.parse('2026-11-26T10:00:00Z')
  const inner = new ScriptedAi(() => ({ ok: true }))
  const ai = new BudgetedAi(inner, 2, 24 * 3600_000, () => clock)
  const req = (user: string) => ({ system: 's', user, schema: {}, schemaName: 'x' })
  await ai.completeJson(req('a'))
  await ai.completeJson(req('a'))
  assert.equal(inner.calls.length, 1, 'cached')
  await ai.completeJson(req('b'))
  await assert.rejects(ai.completeJson(req('c')), AiBusyError)
  clock += 24 * 3600_000
  await ai.completeJson(req('c'))
  assert.equal(ai.usedToday(), 1)
})

test('OpenRouter: strict json_schema request, fenced JSON parsed, 429 becomes "AI busy"', async () => {
  let sent: Record<string, unknown> | undefined
  const ok = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"action":"cancel","chain":"none","name":""}\n```' } }] }), { status: 200 })
  }) as typeof fetch
  const p = new OpenRouterProvider('test-key', 'google/gemma-4-31b-it:free', ok)
  assert.deepEqual(await p.completeJson({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'intent' }), {
    action: 'cancel',
    chain: 'none',
    name: '',
  })
  assert.equal(sent?.model, 'google/gemma-4-31b-it:free')
  assert.deepEqual((sent?.response_format as { type: string }).type, 'json_schema')

  const limited = (async () => new Response('{}', { status: 429 })) as typeof fetch
  await assert.rejects(new OpenRouterProvider('k', 'm', limited).completeJson({ system: 's', user: 'u', schema: {}, schemaName: 'x' }), AiBusyError)
  const down = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch
  await assert.rejects(new OpenRouterProvider('k', 'm', down).completeJson({ system: 's', user: 'u', schema: {}, schemaName: 'x' }), AiBusyError)
})

test('AI intents are re-validated and marked; the AI sees label names, never addresses', async () => {
  const ai = new ScriptedAi(() => ({ action: 'send_address', chain: 'solana', name: SOL }))
  const parser = new AiIntentParser(ai)
  const intent = await parser.parse('give her the usual one', { labels: [{ chain: 'solana', name: 'main' }] })
  assert.deepEqual(intent, { action: 'send_address', chain: 'solana', viaAi: true }, 'an address in "name" is dropped')
  assert.doesNotMatch(ai.calls[0].user, new RegExp(SOL))
  assert.match(ai.calls[0].user, /solana:main/)
})

test('Flow A: natural phrasing via the rules; AI only when needed; "AI busy" is shown, never guessed', async () => {
  const store = new VaultStore(join(dir, 'a.json'))
  store.upsert('solana', 'main', SOL)
  const ai = new ScriptedAi((u) => (u.includes('usual') ? { action: 'send_address', chain: 'solana', name: 'main' } : new AiBusyError()))
  const ctl = new FlowAController(store, { send: async () => 1 }, new LayeredIntentParser(new AiIntentParser(ai)))
  ctl.addRequest({ chatId: 1, chatTitle: 'Weekend trip', fromName: 'Ada', text: 'sol addy?', chain: 'solana' })

  const rules = await ctl.command('can u send ada my sol addy')
  assert.equal(rules.kind, 'confirm')
  assert.doesNotMatch(rules.text, /understood by AI/)
  assert.equal(ai.calls.length, 0, 'the rules understood it, no AI call')
  ctl.cancel()

  const viaAi = await ctl.command('hmm the usual one for her')
  assert.equal(viaAi.kind, 'confirm')
  assert.match(viaAi.text, /Solana main   \(understood by AI\)/)
  ctl.cancel()

  const busy = await ctl.command('erm the thing from before')
  assert.equal(busy.kind, 'error')
  assert.match(busy.text, /AI busy, try again\.\nOr say: send my Solana address/)
})

test('reason line: fixed templates; AI wording only when safe; nothing for safe verdicts', async () => {
  const store = new VaultStore(join(dir, 'b.json'))
  const ada = ton(0x11)
  store.upsertContact('ada', 'ton', ada)
  const checker = new AddressChecker({ store })
  const fresh = await checker.check({ address: ton(0x99) })
  assert.equal(templateReason(fresh), 'You have never paid or saved this address.')
  const contact = await checker.check({ address: ada })
  assert.equal(templateReason(contact), undefined)

  assert.equal(safeReason('Looks like your contact Ada, but the middle differs.'), 'Looks like your contact Ada, but the middle differs.')
  assert.equal(safeReason(`Send to ${ada} instead`), undefined)
  assert.equal(safeReason('Pay 10 Gram now'), undefined)
  assert.equal(safeReason('x'.repeat(120)), undefined)
  assert.equal(safeReason('see https://example.com'), undefined)

  const good = new VerdictExplainer(new ScriptedAi(() => ({ reason: 'You have never sent money to this address.' })))
  assert.deepEqual(await good.explain(fresh), { text: 'You have never sent money to this address.', source: 'ai' })
  const unsafe = new VerdictExplainer(new ScriptedAi(() => ({ reason: `Use ${ada}` })))
  assert.deepEqual(await unsafe.explain(fresh), { text: 'You have never paid or saved this address.', source: 'template' })
  const busy = new VerdictExplainer(new ScriptedAi(() => new AiBusyError()))
  assert.equal((await busy.explain(fresh))?.source, 'template')
  const counting = new ScriptedAi(() => ({ reason: 'x' }))
  assert.equal(await new VerdictExplainer(counting).explain(contact), undefined)
  assert.equal(counting.calls.length, 0, 'no AI call for verdicts that need no explanation')
  assert.doesNotMatch(good instanceof VerdictExplainer ? JSON.stringify((good as unknown as { ai: ScriptedAi }).ai.calls) : '', new RegExp(ton(0x99)))
})

test('Flow B card: template reason at once, AI reason replaces it with an "AI:" label', async () => {
  const store = new VaultStore(join(dir, 'c.json'))
  const ai = new ScriptedAi(() => ({ reason: 'Nobody you know has used this address.' }))
  const b = new FlowBController(new AddressChecker({ store }), Date.now, () => {}, undefined, new VerdictExplainer(ai))
  b.addShare({ chatId: 1, chatTitle: 'Private chat', fromName: 'Stranger', address: ton(0x55) })
  await b.settled()
  await new Promise((r) => setTimeout(r, 50))
  const text = b.view()!.text
  assert.match(text, /NEW ADDRESS, BE CAREFUL\n.*\nAI: Nobody you know has used this address\./)
  const reasonOf = (b.current() as { reason?: Reason }).reason
  assert.equal(reasonOf?.source, 'ai')
})

test('OpenRouter model list: a 429 on the first free model falls through to the next; at most two tries', async () => {
  const tried: string[] = []
  const flaky = (async (_u: string | URL | Request, init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model as string
    tried.push(model)
    if (model === 'a:free') return new Response(JSON.stringify({ error: { code: 429, message: 'rate-limited upstream' } }), { status: 429 })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"reason":"ok"}' } }] }), { status: 200 })
  }) as typeof fetch
  const p = new OpenRouterProvider('k', 'a:free, b:free, c:free', flaky)
  assert.deepEqual(await p.completeJson({ system: 's', user: 'u', schema: {}, schemaName: 'x' }), { reason: 'ok' })
  assert.deepEqual(tried, ['a:free', 'b:free'])

  const allBusy = (async () => new Response('{}', { status: 429 })) as typeof fetch
  const calls: number[] = []
  const counting = (async (...a: Parameters<typeof fetch>) => (calls.push(1), allBusy(...a))) as typeof fetch
  await assert.rejects(new OpenRouterProvider('k', 'a:free,b:free,c:free', counting).completeJson({ system: 's', user: 'u', schema: {}, schemaName: 'x' }), AiBusyError)
  assert.equal(calls.length, 2)
})
