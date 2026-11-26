// HTTP API for the glasses app. Listens on 127.0.0.1 only: in this build the glasses app (simulator WebView)
// runs on the same machine and reaches it through the Vite dev proxy. Phone use needs a pairing step first.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { FlowAController } from './flowA/controller.ts'
import { chainHintIn } from './flowA/requests.ts'
import type { FlowBController } from './flowB/controller.ts'
import type { ScreenLike } from './screen.ts'
import type { TonConnectRail } from './payments/tonconnect.ts'
import QRCode from 'qrcode'

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

const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : fallback)

export type ApiOptions = {
  screen: ScreenLike
  /** Dev-only endpoints that simulate incoming Telegram messages. Leave undefined in normal runs. */
  dev?: { flowA?: FlowAController; flowB?: FlowBController; chatId?: () => Promise<number> }
  /** TON Connect pairing for the phone page. Undefined when no manifest URL is configured. */
  wallet?: TonConnectRail
}

export function createApiServer(opts: ApiOptions): Server {
  const { screen, dev, wallet } = opts
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, service: 'gramsight-backend', network: 'testnet' })
      }
      if (req.method === 'GET' && url.pathname === '/api/card') return send(res, 200, screen.view())
      if (req.method === 'GET' && url.pathname === '/api/tonconnect') {
        if (!wallet) return send(res, 200, { configured: false, connected: false })
        await wallet.init()
        return send(res, 200, wallet.status())
      }
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' })

      const body = await readJson(req)
      switch (url.pathname) {
        case '/api/tonconnect/connect': {
          // Pairing happens on the phone page: a universal link plus the same link as a QR code.
          if (!wallet) return send(res, 400, { error: 'TON Connect is not configured (GRAMSIGHT_TONCONNECT_MANIFEST_URL)' })
          const link = await wallet.connectLink(str(body.wallet, 30, 'tonkeeper'))
          const qrSvg = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
          return send(res, 200, { link, qrSvg })
        }
        case '/api/tonconnect/disconnect':
          if (wallet) await wallet.disconnect()
          return send(res, 200, wallet ? wallet.status() : { configured: false, connected: false })
        case '/api/command': {
          const text = typeof body.text === 'string' ? body.text.slice(0, 300) : ''
          if (!text.trim()) return send(res, 400, { error: 'text is required' })
          return send(res, 200, await screen.command(text))
        }
        case '/api/tap':
          return send(res, 200, await screen.tap(String(body.cardId ?? '')))
        case '/api/cancel':
          return send(res, 200, screen.cancel())
        case '/api/next':
          return send(res, 200, screen.next())
        case '/api/dev/request': {
          // Dev only: simulate "send me your address" (Flow A).
          if (!dev?.flowA) return send(res, 404, { error: 'not found' })
          const text = str(body.text, 300, 'can you send me your sol address?')
          const chatId = typeof body.chatId === 'number' ? body.chatId : dev.chatId ? await dev.chatId() : 0
          dev.flowA.addRequest({
            chatId,
            chatTitle: str(body.chatTitle, 40, 'Test chat'),
            fromName: str(body.fromName, 30, 'Ada'),
            text,
            ...chainHintIn(text),
          })
          return send(res, 200, screen.view())
        }
        case '/api/dev/share': {
          // Dev only: simulate someone sending you an address (Flow B), optionally from a real Telegram user id.
          if (!dev?.flowB) return send(res, 404, { error: 'not found' })
          const address = str(body.address, 120, '')
          if (!address) return send(res, 400, { error: 'address is required' })
          dev.flowB.addShare({
            chatId: typeof body.chatId === 'number' ? body.chatId : 0,
            chatTitle: str(body.chatTitle, 40, 'Test chat'),
            fromName: str(body.fromName, 30, 'Ada'),
            address,
            ...(typeof body.senderUserId === 'number' ? { senderUserId: body.senderUserId } : {}),
          })
          return send(res, 200, screen.view())
        }
        default:
          return send(res, 404, { error: 'not found' })
      }
    } catch (err) {
      return send(res, 400, { error: err instanceof Error ? err.message : 'bad request' })
    }
  })
}
