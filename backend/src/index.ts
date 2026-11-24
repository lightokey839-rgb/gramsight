// Gramsight backend: the HTTP API for the glasses app, the Telegram request listener, and the vault bot.
//   npm run dev       everything (Flow A + vault bot)
//   npm run bot       only the vault bot
// Settings (.env or environment):
//   GRAMSIGHT_SEND=live       really send as your Telegram account (default: dry-run, logs only)
//   GRAMSIGHT_TELEGRAM=off    don't start TDLib (no listener; use with dry-run for UI work)
//   GRAMSIGHT_DEV=1           enable POST /api/dev/request (simulate an incoming request)
//   GRAMSIGHT_BOT=off         don't start the vault bot here
// TDLib allows one client per login database: stop `npm run dev` before running the telegram:* scripts.
import { loadEnv, optionalEnv } from './env.ts'
import { runVaultBot } from './bot/run.ts'
import { claudeIntentParserFromEnv } from './flowA/claudeIntent.ts'
import { FlowAController, type MessageSender } from './flowA/controller.ts'
import { LayeredIntentParser } from './flowA/intent.ts'
import { DryRunSender, TdlibSender, attachRequestListener } from './flowA/listener.ts'
import { createApiServer } from './http.ts'
import { closeClient, connectLoggedIn, resolveChatId, type Client } from './telegram.ts'
import { VaultStore } from './vault/store.ts'

loadEnv()
const log = (line: string) => console.log(`[gramsight] ${line}`)
const flag = (name: string) => (optionalEnv(name) ?? '').toLowerCase()

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787)
  const store = new VaultStore()
  const live = flag('GRAMSIGHT_SEND') === 'live'
  const dev = flag('GRAMSIGHT_DEV') === '1' || flag('GRAMSIGHT_DEV') === 'true'

  let client: Client | undefined
  if (flag('GRAMSIGHT_TELEGRAM') !== 'off') {
    try {
      client = await connectLoggedIn()
      log('Telegram user account connected (TDLib)')
    } catch (err) {
      log(`Telegram not connected: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (live && !client) throw new Error('GRAMSIGHT_SEND=live needs the Telegram user account. Run `npm run telegram:login` first.')

  const sender: MessageSender = live && client ? new TdlibSender(client) : new DryRunSender(log)
  const claude = claudeIntentParserFromEnv()
  const controller = new FlowAController(store, sender, new LayeredIntentParser(claude), Date.now, log)
  if (client) attachRequestListener(client, controller, log)

  const server = createApiServer({
    controller,
    dev,
    devChatId: client ? () => resolveChatId(client!, 'me') : undefined,
  })
  server.listen(port, '127.0.0.1', () => {
    log(`API on http://127.0.0.1:${port} · sending: ${live ? 'LIVE as your account' : 'dry-run'} · intent: rules${claude ? ' + Claude' : ''}${dev ? ' · dev endpoints on' : ''}`)
    log(`vault: ${store.path}`)
  })

  if (flag('GRAMSIGHT_BOT') !== 'off' && optionalEnv('BOT_TOKEN') && optionalEnv('BOT_OWNER_TELEGRAM_ID')) {
    runVaultBot().catch((err: unknown) => log(`vault bot stopped: ${err instanceof Error ? err.message : String(err)}`))
  }

  const shutdown = async () => {
    server.close()
    if (client) await closeClient(client)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error(`[gramsight] failed to start: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
