// Long-polling loop for the vault bot. One copy at a time: Telegram rejects a second poller with 409.
import { requireEnv } from '../env.ts'
import { VaultStore } from '../vault/store.ts'
import { BotApi, BotApiError, type TgUpdate } from './api.ts'
import { OWNER_COMMANDS, VaultBot } from './vaultBot.ts'

export async function runVaultBot(opts: { signal?: AbortSignal; log?: (line: string) => void } = {}): Promise<void> {
  const log = opts.log ?? ((line: string) => console.log(`[vault-bot] ${line}`))
  const ownerId = Number(requireEnv('BOT_OWNER_TELEGRAM_ID'))
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('BOT_OWNER_TELEGRAM_ID must be your numeric Telegram user id')

  const api = new BotApi(requireEnv('BOT_TOKEN'))
  const me = await api.call<{ username: string }>('getMe')
  const store = new VaultStore()
  const bot = new VaultBot({ api, store, ownerId, log })

  // The command menu is shown only in the owner's chat with the bot.
  await api
    .call('setMyCommands', { commands: OWNER_COMMANDS, scope: { type: 'chat', chat_id: ownerId } })
    .catch((err: unknown) => log(`command menu not set (start the bot from your account first): ${err instanceof Error ? err.message : String(err)}`))

  log(`@${me.username} is running for owner ${ownerId}. Vault file: ${store.path}`)

  let offset = 0
  while (!opts.signal?.aborted) {
    let updates: TgUpdate[]
    try {
      updates = await api.call<TgUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] })
    } catch (err) {
      if (err instanceof BotApiError && err.code === 409) {
        throw new Error('Another copy of this bot (or a webhook) is already receiving updates. Stop it first.')
      }
      if (err instanceof BotApiError && err.code === 401) throw new Error('BOT_TOKEN was rejected (401). Check it in .env.')
      log(`getUpdates failed, retrying in 3 s: ${err instanceof Error ? err.message : String(err)}`)
      await new Promise((r) => setTimeout(r, 3000))
      continue
    }
    for (const u of updates) {
      offset = u.update_id + 1 // advance first, so a failing update is never retried in a loop
      try {
        await bot.handle(u)
      } catch (err) {
        log(`update ${u.update_id} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}
