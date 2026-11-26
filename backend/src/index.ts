// Gramsight backend: the HTTP API for the glasses app, the Telegram request listener, and the vault bot.
//   npm run dev       everything (Flow A + vault bot)
//   npm run bot       only the vault bot
// Settings (.env or environment):
//   GRAMSIGHT_SEND=live       really send as your Telegram account (default: dry-run, logs only)
//   GRAMSIGHT_TELEGRAM=off    don't start TDLib (no listener; use with dry-run for UI work)
//   GRAMSIGHT_DEV=1           enable POST /api/dev/request (simulate an incoming request)
//   GRAMSIGHT_BOT=off         don't start the vault bot here
//   GRAMSIGHT_PAY=live        really pay on TON testnet from the payer wallet (default: dry-run)
//   GRAMSIGHT_MAX_PAYMENT_GRAM, GRAMSIGHT_DAILY_LIMIT_GRAM   payment limits (default 1 and 3)
// TDLib allows one client per login database: stop `npm run dev` before running the telegram:* scripts.
import { loadEnv, optionalEnv } from './env.ts'
import { runVaultBot } from './bot/run.ts'
import { aiFromEnv } from './ai/fromEnv.ts'
import { AiIntentParser } from './ai/intent.ts'
import { VerdictExplainer } from './ai/explain.ts'
import { FlowAController, type MessageSender } from './flowA/controller.ts'
import { LayeredIntentParser } from './flowA/intent.ts'
import { DryRunSender, TdlibSender, attachRequestListener } from './flowA/listener.ts'
import { createApiServer } from './http.ts'
import { BotApi } from './bot/api.ts'
import { AddressChecker } from './checker/checker.ts'
import { PayerHistory } from './checker/payerHistory.ts'
import {
  BotProfileSource,
  LayeredProfileSource,
  type ProfileWalletSource,
  TdlibProfileSource,
  TonapiReputation,
} from './checker/sources.ts'
import { combineHistory } from './checker/sources.ts'
import { FlowBController } from './flowB/controller.ts'
import { PaymentLedger, ledgerHistory } from './payments/ledger.ts'
import { DryRunRail, type PaymentRail, twoPathChooser } from './payments/rail.ts'
import { TonConnectRail } from './payments/tonconnect.ts'
import { transcriberFromEnv } from './voice/groq.ts'
import { TestnetPayerRail } from './payments/testnetPayer.ts'
import { Screen } from './screen.ts'
import { fromNano, toNano } from '@ton/core'
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
  // AI (OpenRouter free model by default, Claude behind GRAMSIGHT_AI=claude): rules first, AI only where it adds something.
  const ai = aiFromEnv()
  const controller = new FlowAController(store, sender, new LayeredIntentParser(ai ? new AiIntentParser(ai) : undefined), Date.now, log)
  const explainer = new VerdictExplainer(ai, log)

  // Address checker: profile wallet card (user account first, vault bot as fallback), saved contacts,
  // lookalikes (vault, contacts, addresses the payer has paid), and tonapi scam flags.
  const profileSources: ProfileWalletSource[] = []
  if (client) profileSources.push(new TdlibProfileSource(client))
  const botToken = optionalEnv('BOT_TOKEN')
  if (botToken) profileSources.push(new BotProfileSource(new BotApi(botToken)))
  // Payments (Flow B): dry run unless GRAMSIGHT_PAY=live; limits from .env; every payment in the ledger.
  const ledger = new PaymentLedger()
  const payLive = flag('GRAMSIGHT_PAY') === 'live'
  if (payLive && !optionalEnv('TON_TESTNET_PAYER_MNEMONIC')) throw new Error('GRAMSIGHT_PAY=live needs TON_TESTNET_PAYER_MNEMONIC. Run `npm run ton:new-payer`.')
  const rail: PaymentRail = payLive ? new TestnetPayerRail() : new DryRunRail(log)
  const limits = {
    perPaymentNano: toNano(optionalEnv('GRAMSIGHT_MAX_PAYMENT_GRAM') ?? '1'),
    dailyNano: toNano(optionalEnv('GRAMSIGHT_DAILY_LIMIT_GRAM') ?? '3'),
    walletMaxNano: toNano(optionalEnv('GRAMSIGHT_WALLET_MAX_GRAM') ?? '10'),
  }
  // Path 2: TON Connect to the user's own testnet wallet, for new addresses, warnings and larger amounts.
  const manifestUrl = optionalEnv('GRAMSIGHT_TONCONNECT_MANIFEST_URL')
  const wallet = manifestUrl ? TonConnectRail.fromManifest(manifestUrl) : undefined
  if (wallet) void wallet.init()

  const history = optionalEnv('TON_TESTNET_PAYER_MNEMONIC') ? combineHistory(new PayerHistory(), ledgerHistory(ledger)) : ledgerHistory(ledger)
  const checker = new AddressChecker({
    store,
    ...(profileSources.length ? { profile: new LayeredProfileSource(profileSources) } : {}),
    ...(flag('GRAMSIGHT_REPUTATION') === 'off' ? {} : { reputation: new TonapiReputation() }),
    history,
  })
  const flowB = new FlowBController(checker, Date.now, log, { rails: twoPathChooser(rail, wallet, limits.perPaymentNano), ledger, limits }, explainer)
  const screen = new Screen(controller, flowB)
  if (client) attachRequestListener(client, controller, log, flowB)

  const stt = transcriberFromEnv()
  const server = createApiServer({
    screen,
    ...(stt ? { stt } : {}),
    ...(wallet ? { wallet } : {}),
    ...(dev ? { dev: { flowA: controller, flowB, ...(client ? { chatId: () => resolveChatId(client!, 'me') } : {}) } } : {}),
  })
  server.listen(port, '127.0.0.1', () => {
    log(`API on http://127.0.0.1:${port} · sending: ${live ? 'LIVE as your account' : 'dry-run'} · AI: ${ai ? `${ai.name} ${ai.model}` : 'off (rules and templates only)'}${dev ? ' · dev endpoints on' : ''}`)
    log(`checker: profile ${profileSources.length ? (client ? 'user account + bot' : 'bot only') : 'off'} · scam check ${flag('GRAMSIGHT_REPUTATION') === 'off' ? 'off' : 'tonapi'}`)
    log(`voice: ${stt ? 'Groq Whisper' : 'off (set GROQ_API_KEY); typed commands work'}`)
    log(`wallet path (TON Connect): ${wallet ? 'on; pair it on the phone page' : 'off (set GRAMSIGHT_TONCONNECT_MANIFEST_URL)'}`)
    log(`payments: ${payLive ? 'LIVE on TON testnet (payer wallet)' : 'dry-run'} · max ${fromNano(limits.perPaymentNano)} Gram each, ${fromNano(limits.dailyNano)} Gram per 24 h · ledger ${ledger.path}`)
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
