// HTTP API for the glasses app. Listens on 127.0.0.1 only: in this build the glasses app (simulator WebView)
// runs on the same machine and reaches it through the Vite dev proxy. Phone use needs a pairing step first.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { FlowAController } from './flowA/controller.ts'
import { chainHintIn } from './flowA/requests.ts'

const MAX_BODY = 8 * 1024

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        const v = raw ? JSON.parse(raw) : {}
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {})
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export type ApiOptions = { controller: FlowAController; dev: boolean; devChatId?: () => Promise<number> }

export function createApiServer(opts: ApiOptions): Server {
  const { controller } = opts
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, service: 'gramsight-backend', network: 'testnet' })
      }
      if (req.method === 'GET' && url.pathname === '/api/card') return send(res, 200, controller.view())
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' })

      const body = await readJson(req)
      switch (url.pathname) {
        case '/api/command': {
          const text = typeof body.text === 'string' ? body.text.slice(0, 300) : ''
          if (!text.trim()) return send(res, 400, { error: 'text is required' })
          return send(res, 200, await controller.command(text))
        }
        case '/api/tap':
          return send(res, 200, await controller.tap(String(body.cardId ?? '')))
        case '/api/cancel':
          return send(res, 200, controller.cancel())
        case '/api/next':
          return send(res, 200, controller.next())
        case '/api/dev/request': {
          // Dev only: simulate an incoming "send me your address" message, for the simulator demo and tests.
          if (!opts.dev) return send(res, 404, { error: 'not found' })
          const text = typeof body.text === 'string' && body.text.trim() ? body.text.slice(0, 300) : 'can you send me your sol address?'
          const chatId = typeof body.chatId === 'number' ? body.chatId : opts.devChatId ? await opts.devChatId() : 0
          controller.addRequest({
            chatId,
            chatTitle: typeof body.chatTitle === 'string' ? body.chatTitle.slice(0, 40) : 'Test chat',
            fromName: typeof body.fromName === 'string' ? body.fromName.slice(0, 30) : 'Ada',
            text,
            ...chainHintIn(text),
          })
          return send(res, 200, controller.view())
        }
        default:
          return send(res, 404, { error: 'not found' })
      }
    } catch (err) {
      return send(res, 400, { error: err instanceof Error ? err.message : 'bad request' })
    }
  })
}
