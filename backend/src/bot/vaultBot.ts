// The Gramsight address vault bot. Owner-only: only BOT_OWNER_TELEGRAM_ID can read or change the vault,
// and only in a private chat. Every change needs a second step (a Confirm tap within 2 minutes),
// and one tap applies exactly one change. Public addresses only: anything that looks like a seed phrase
// or private key is deleted on sight, with a warning.
import { randomBytes } from 'node:crypto'
import type { BotApiLike, TgCallbackQuery, TgMessage, TgUpdate } from './api.ts'
import { CHAINS, type Chain, chainDisplay, detectFamilies, fingerprint, parseChain, validateForChain } from '../vault/addresses.ts'
import { detectSecret } from '../vault/secrets.ts'
import { entryLabel, normalizeName, type VaultStore } from '../vault/store.ts'

type Pending =
  | { kind: 'add'; chain: Chain; name: string; address: string; expires: number }
  | { kind: 'remove'; chain: Chain; name: string; expires: number }

export type VaultBotOptions = {
  api: BotApiLike
  store: VaultStore
  ownerId: number
  now?: () => number
  confirmTtlMs?: number
  log?: (line: string) => void
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const OWNER_COMMANDS = [
  { command: 'list', description: 'Show your saved addresses' },
  { command: 'add', description: 'Save an address: /add <chain> [name] <address>' },
  { command: 'remove', description: 'Remove one: /remove <chain> [name]' },
  { command: 'chains', description: 'Supported chains' },
  { command: 'help', description: 'How the vault works' },
]

const HELP = [
  '<b>Gramsight address vault</b> (owner only)',
  'Public addresses only. Never send a seed phrase or private key here.',
  '',
  '/add &lt;chain&gt; [name] &lt;address&gt;  save, e.g. <code>/add solana main 7xKX…</code>',
  '/list  show saved addresses',
  '/remove &lt;chain&gt; [name]  remove one',
  '/chains  supported chains',
  '',
  'Every change asks you to tap Confirm within 2 minutes.',
].join('\n')

const STRANGER =
  'This is a private Gramsight address vault. Starting it lets its owner check that a wallet address you send them ' +
  'matches the wallet on your Telegram profile, before they pay you. It keeps only your Telegram user id.'

export class VaultBot {
  private readonly pending = new Map<string, Pending>()
  private readonly api: BotApiLike
  private readonly store: VaultStore
  private readonly ownerId: number
  private readonly now: () => number
  private readonly ttl: number
  private readonly log: (line: string) => void

  constructor(opts: VaultBotOptions) {
    this.api = opts.api
    this.store = opts.store
    this.ownerId = opts.ownerId
    this.now = opts.now ?? Date.now
    this.ttl = opts.confirmTtlMs ?? 120_000
    this.log = opts.log ?? (() => {})
  }

  async handle(update: TgUpdate): Promise<void> {
    if (update.message) await this.onMessage(update.message)
    else if (update.callback_query) await this.onCallback(update.callback_query)
  }

  private reply(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    return this.api.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra })
  }

  private async onMessage(msg: TgMessage): Promise<void> {
    const from = msg.from
    if (msg.chat.type !== 'private' || !from || from.is_bot) return // groups and channels are ignored
    const text = msg.text ?? ''
    const isOwner = from.id === this.ownerId

    // Secrets are removed for everyone, owner or not.
    const secret = text ? detectSecret(text) : undefined
    if (secret) {
      this.log(`deleted a message that looked like a ${secret} (from ${isOwner ? 'owner' : 'non-owner'})`)
      await this.api.call('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id }).catch(() => undefined)
      await this.reply(
        msg.chat.id,
        `⚠️ That looked like a <b>${secret}</b>, so I deleted it. This vault stores public addresses only.\n` +
          'If it was a real seed phrase or private key, treat it as exposed: move the funds to a new wallet.',
      )
      return
    }

    if (!isOwner) {
      if (text.startsWith('/start')) this.store.recordStarter(from.id, from.username)
      this.log(`non-owner ${from.id} wrote to the bot`)
      await this.reply(msg.chat.id, STRANGER)
      return
    }

    const [rawCmd, ...args] = text.trim().split(/\s+/)
    const cmd = rawCmd?.toLowerCase().replace(/@\w+$/, '')
    this.log(`owner command: ${cmd?.startsWith('/') ? cmd : '(text)'}`)
    switch (cmd) {
      case '/start':
      case '/help':
        await this.reply(msg.chat.id, HELP)
        return
      case '/chains':
        await this.reply(
          msg.chat.id,
          `<b>Chains</b>\n${(Object.keys(CHAINS) as Chain[]).map((c) => `${c}: ${chainDisplay(c)}`).join('\n')}\n\n` +
            'EVM chains share one address format, so the chain you name is the one the address is labelled for.',
        )
        return
      case '/list':
        await this.onList(msg.chat.id)
        return
      case '/add':
        await this.onAdd(msg.chat.id, args)
        return
      case '/remove':
        await this.onRemove(msg.chat.id, args)
        return
      default:
        await this.onText(msg.chat.id, text)
    }
  }

  private async onList(chatId: number): Promise<void> {
    const entries = this.store.list()
    if (!entries.length) {
      await this.reply(chatId, 'The vault is empty. Add one with <code>/add &lt;chain&gt; [name] &lt;address&gt;</code>.')
      return
    }
    const lines = entries.map((e) => `<b>${esc(entryLabel(e))}</b>\n<code>${esc(e.address)}</code>`)
    await this.reply(chatId, `<b>Your addresses</b>\n\n${lines.join('\n\n')}`)
  }

  private async onAdd(chatId: number, args: string[]): Promise<void> {
    if (args.length < 2 || args.length > 3) {
      await this.reply(chatId, 'Usage: <code>/add &lt;chain&gt; [name] &lt;address&gt;</code>, for example <code>/add ton main UQB…</code>')
      return
    }
    const chain = parseChain(args[0])
    if (!chain) {
      await this.reply(chatId, `Unknown chain "${esc(args[0])}". See /chains.`)
      return
    }
    const name = normalizeName(args.length === 3 ? args[1] : 'main')
    if (!name) {
      await this.reply(chatId, 'The name must be 1 to 20 characters: letters, digits, - or _.')
      return
    }
    const address = args[args.length - 1]
    const checked = validateForChain(chain, address)
    if (!checked.ok) {
      const families = detectFamilies(address)
      const hint = families.length ? ` It looks like a ${families.join('/')} address.` : ''
      await this.reply(chatId, `Not saved: not a valid ${chainDisplay(chain)} address (${esc(checked.reason)}).${hint}`)
      return
    }
    const previous = this.store.get(chain, name)
    const label = entryLabel({ chain, name })
    const lines = [
      `${previous ? 'Replace' : 'Save'} <b>${esc(label)}</b>?`,
      `<code>${esc(checked.display)}</code>`,
      `Check: <code>${esc(fingerprint(checked.display))}</code>`,
    ]
    if (checked.note) lines.push(`Note: ${esc(checked.note)}`)
    if (previous) {
      if (previous.normalized === checked.normalized) {
        await this.reply(chatId, `${esc(label)} already has this address. Nothing to change.`)
        return
      }
      lines.push(`Old: <code>${esc(fingerprint(previous.address))}</code>`)
    }
    await this.askConfirm(chatId, { kind: 'add', chain, name, address: checked.display, expires: this.now() + this.ttl }, lines.join('\n'))
  }

  private async onRemove(chatId: number, args: string[]): Promise<void> {
    const chain = args[0] ? parseChain(args[0]) : undefined
    const name = normalizeName(args[1] ?? 'main')
    if (!chain || !name || args.length > 2) {
      await this.reply(chatId, 'Usage: <code>/remove &lt;chain&gt; [name]</code>')
      return
    }
    const entry = this.store.get(chain, name)
    if (!entry) {
      await this.reply(chatId, `No address saved as ${esc(entryLabel({ chain, name }))}.`)
      return
    }
    await this.askConfirm(
      chatId,
      { kind: 'remove', chain, name, expires: this.now() + this.ttl },
      `Remove <b>${esc(entryLabel(entry))}</b>?\n<code>${esc(fingerprint(entry.address))}</code>`,
    )
  }

  private async onText(chatId: number, text: string): Promise<void> {
    const families = detectFamilies(text)
    if (families.length) {
      await this.reply(
        chatId,
        `That looks like a ${families.join('/')} address. To save it, send:\n<code>/add &lt;chain&gt; main ${esc(text.trim())}</code>`,
      )
      return
    }
    await this.reply(chatId, 'Send /help to see what I can do.')
  }

  private async askConfirm(chatId: number, p: Pending, text: string): Promise<void> {
    this.sweep()
    const token = randomBytes(9).toString('base64url')
    this.pending.set(token, p)
    await this.reply(chatId, `${text}\n\nTap Confirm within 2 minutes.`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: `ok:${token}` },
            { text: 'Cancel', callback_data: `no:${token}` },
          ],
        ],
      },
    })
  }

  private sweep(): void {
    const t = this.now()
    for (const [k, p] of this.pending) if (p.expires <= t) this.pending.delete(k)
  }

  private async onCallback(q: TgCallbackQuery): Promise<void> {
    const answer = (text: string) => this.api.call('answerCallbackQuery', { callback_query_id: q.id, text })
    const edit = (text: string) =>
      q.message
        ? this.api
            .call('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text, parse_mode: 'HTML' })
            .catch(() => undefined)
        : Promise.resolve(undefined)

    if (q.from.id !== this.ownerId || q.message?.chat.type !== 'private') {
      await answer('Not allowed.')
      return
    }
    const m = /^(ok|no):([A-Za-z0-9_-]+)$/.exec(q.data ?? '')
    const p = m ? this.pending.get(m[2]) : undefined
    if (!m || !p) {
      await answer('Already done or expired.')
      return
    }
    this.pending.delete(m[2]) // one tap, one action: the token is gone before anything is applied
    if (p.expires <= this.now()) {
      await edit('Expired. Nothing changed.')
      await answer('Expired.')
      return
    }
    if (m[1] === 'no') {
      await edit('Cancelled. Nothing changed.')
      await answer('Cancelled.')
      return
    }
    try {
      if (p.kind === 'add') {
        const { entry } = this.store.upsert(p.chain, p.name, p.address)
        await edit(`Saved <b>${esc(entryLabel(entry))}</b>\n<code>${esc(fingerprint(entry.address))}</code>`)
        await answer('Saved.')
      } else {
        const removed = this.store.remove(p.chain, p.name)
        await edit(removed ? `Removed <b>${esc(entryLabel(removed))}</b>.` : 'It was already gone. Nothing changed.')
        await answer(removed ? 'Removed.' : 'Nothing changed.')
      }
    } catch (err) {
      await edit(`Not saved: ${esc(err instanceof Error ? err.message : String(err))}`)
      await answer('Not saved.')
    }
  }
}
