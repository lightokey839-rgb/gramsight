import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { BotApiLike, TgUpdate } from '../src/bot/api.ts'
import { VaultBot } from '../src/bot/vaultBot.ts'
import { VaultStore } from '../src/vault/store.ts'

const OWNER = 111
const STRANGER = 222
const SOL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SOL2 = '11111111111111111111111111111111'
const dir = mkdtempSync(join(tmpdir(), 'gramsight-bot-'))
after(() => rmSync(dir, { recursive: true, force: true }))

type Call = { method: string; params: Record<string, unknown> }

function setup(name: string) {
  const calls: Call[] = []
  const api: BotApiLike = {
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params })
      return {} as T
    },
  }
  let clock = 1_000_000
  const store = new VaultStore(join(dir, `${name}.json`))
  const bot = new VaultBot({ api, store, ownerId: OWNER, now: () => clock })
  let id = 1
  const msg = (from: number, text: string, chatType: 'private' | 'group' = 'private'): TgUpdate => ({
    update_id: id++,
    message: { message_id: id, from: { id: from, is_bot: false, username: `u${from}` }, chat: { id: chatType === 'private' ? from : -5, type: chatType }, date: 0, text },
  })
  const tap = (from: number, data: string): TgUpdate => ({
    update_id: id++,
    callback_query: { id: `q${id}`, from: { id: from, is_bot: false }, message: { message_id: 99, chat: { id: from, type: 'private' } }, data },
  })
  const lastKeyboardData = (button: 0 | 1) => {
    const c = [...calls].reverse().find((x) => x.method === 'sendMessage' && x.params.reply_markup)
    const kb = (c?.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard
    return kb[0][button].callback_data
  }
  const lastAnswer = () => [...calls].reverse().find((c) => c.method === 'answerCallbackQuery')?.params.text
  return { calls, store, bot, msg, tap, lastKeyboardData, lastAnswer, advance: (ms: number) => (clock += ms) }
}

test('a stranger gets the privacy note, is recorded on /start, and cannot change the vault', async () => {
  const t = setup('stranger')
  await t.bot.handle(t.msg(STRANGER, '/start'))
  await t.bot.handle(t.msg(STRANGER, `/add solana main ${SOL}`))
  assert.equal(t.store.list().length, 0)
  assert.ok(t.store.starters()[String(STRANGER)])
  const replies = t.calls.filter((c) => c.method === 'sendMessage')
  assert.equal(replies.length, 2)
  assert.ok(replies.every((r) => String(r.params.text).includes('private Gramsight address vault')))
  assert.ok(replies.every((r) => !r.params.reply_markup))
})

test('owner /add needs a Confirm tap; one tap saves exactly once', async () => {
  const t = setup('add')
  await t.bot.handle(t.msg(OWNER, `/add sol main ${SOL}`))
  assert.equal(t.store.list().length, 0, 'nothing saved before Confirm')
  const ok = t.lastKeyboardData(0)
  assert.match(ok, /^ok:/)

  await t.bot.handle(t.tap(STRANGER, ok))
  assert.equal(t.lastAnswer(), 'Not allowed.')
  assert.equal(t.store.list().length, 0)

  await t.bot.handle(t.tap(OWNER, ok))
  assert.equal(t.lastAnswer(), 'Saved.')
  assert.equal(t.store.get('solana', 'main')?.address, SOL)

  await t.bot.handle(t.tap(OWNER, ok))
  assert.equal(t.lastAnswer(), 'Already done or expired.')
  assert.equal(t.store.list().length, 1)
})

test('a confirmation expires after 2 minutes, and Cancel changes nothing', async () => {
  const t = setup('expire')
  await t.bot.handle(t.msg(OWNER, `/add solana main ${SOL}`))
  const ok = t.lastKeyboardData(0)
  t.advance(121_000)
  await t.bot.handle(t.tap(OWNER, ok))
  assert.equal(t.store.list().length, 0)

  await t.bot.handle(t.msg(OWNER, `/add solana main ${SOL}`))
  await t.bot.handle(t.tap(OWNER, t.lastKeyboardData(1)))
  assert.equal(t.lastAnswer(), 'Cancelled.')
  assert.equal(t.store.list().length, 0)
})

test('replacing shows the old fingerprint; remove also needs Confirm', async () => {
  const t = setup('replace')
  t.store.upsert('solana', 'main', SOL)
  await t.bot.handle(t.msg(OWNER, `/add solana main ${SOL2}`))
  const prompt = [...t.calls].reverse().find((c) => c.method === 'sendMessage')!
  assert.match(String(prompt.params.text), /Replace <b>Solana main<\/b>/)
  assert.match(String(prompt.params.text), /Old: /)
  await t.bot.handle(t.tap(OWNER, t.lastKeyboardData(0)))
  assert.equal(t.store.get('solana', 'main')?.address, SOL2)

  await t.bot.handle(t.msg(OWNER, '/remove solana'))
  assert.equal(t.store.list().length, 1)
  await t.bot.handle(t.tap(OWNER, t.lastKeyboardData(0)))
  assert.equal(t.store.list().length, 0)
})

test('a wrong-chain address is refused with a family hint and no Confirm button', async () => {
  const t = setup('wrongchain')
  await t.bot.handle(t.msg(OWNER, '/add solana main 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'))
  const reply = t.calls.at(-1)!
  assert.equal(reply.method, 'sendMessage')
  assert.match(String(reply.params.text), /Not saved/)
  assert.match(String(reply.params.text), /evm/)
  assert.equal(reply.params.reply_markup, undefined)
})

test('a pasted seed phrase is deleted and warned about, for owner and strangers alike', async () => {
  const t = setup('seed')
  const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  await t.bot.handle(t.msg(OWNER, seed))
  await t.bot.handle(t.msg(STRANGER, seed))
  assert.equal(t.calls.filter((c) => c.method === 'deleteMessage').length, 2)
  assert.ok(t.calls.filter((c) => c.method === 'sendMessage').every((c) => /seed phrase/.test(String(c.params.text))))
  assert.equal(t.store.list().length, 0)
})

test('owner /start sets the owner-only command menu and shows help', async () => {
  const t = setup('start')
  await t.bot.handle(t.msg(OWNER, '/start'))
  const menu = t.calls.find((c) => c.method === 'setMyCommands')
  assert.deepEqual(menu?.params.scope, { type: 'chat', chat_id: OWNER })
  assert.match(String(t.calls.at(-1)?.params.text), /address vault/)
})

test('trusted contacts: /contact needs Confirm, /contacts lists, /uncontact removes; strangers cannot add', async () => {
  const t = setup('contacts')
  await t.bot.handle(t.msg(STRANGER, `/contact solana ada ${SOL}`))
  assert.equal(t.store.contacts().length, 0)

  await t.bot.handle(t.msg(OWNER, `/contact solana ada ${SOL}`))
  assert.equal(t.store.contacts().length, 0, 'nothing saved before Confirm')
  await t.bot.handle(t.tap(OWNER, t.lastKeyboardData(0)))
  assert.equal(t.store.contacts()[0]?.name, 'ada')

  await t.bot.handle(t.msg(OWNER, '/contacts'))
  assert.match(String(t.calls.at(-1)?.params.text), /Trusted contacts[\s\S]*ada/)

  await t.bot.handle(t.msg(OWNER, '/contact solana bob 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'))
  assert.match(String(t.calls.at(-1)?.params.text), /Not saved/)

  await t.bot.handle(t.msg(OWNER, '/uncontact solana ada'))
  await t.bot.handle(t.tap(OWNER, t.lastKeyboardData(0)))
  assert.equal(t.store.contacts().length, 0)
})

test('group chats are ignored entirely', async () => {
  const t = setup('group')
  await t.bot.handle(t.msg(OWNER, '/list', 'group'))
  assert.equal(t.calls.length, 0)
})
