// Gramsight backend entry point.
// Day 1: skeleton only. Day 2 adds the vault bot and the Telegram user-account client.
import { createServer } from 'node:http'
import { loadEnv } from './env.ts'

loadEnv()

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
