// Gramsight backend entry point: HTTP API for the glasses app (from Day 3) plus the vault bot.
// `npm run dev` runs both; `npm run bot` runs only the bot. Never run two copies of the bot at once.
import { createServer } from 'node:http'
import { loadEnv, optionalEnv } from './env.ts'
import { runVaultBot } from './bot/run.ts'

loadEnv()

if (optionalEnv('BOT_TOKEN') && optionalEnv('BOT_OWNER_TELEGRAM_ID')) {
  runVaultBot().catch((err: unknown) => {
    console.error(`[vault-bot] stopped: ${err instanceof Error ? err.message : String(err)}`)
  })
} else {
  console.log('[vault-bot] not started: set BOT_TOKEN and BOT_OWNER_TELEGRAM_ID in .env')
}

const port = Number(process.env.PORT ?? 8787)

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'gramsight-backend', network: 'testnet' }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(port, () => {
  console.log(`gramsight-backend listening on http://localhost:${port}`)
})
