// HTTP API for the glasses app. Listens on 127.0.0.1 only: in this build the glasses app (simulator WebView)
// runs on the same machine and reaches it through the Vite dev proxy. Phone use needs a pairing step first.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { FlowAController } from './flowA/controller.ts'
import { chainHintIn } from './flowA/requests.ts'
import type { FlowBController } from './flowB/controller.ts'
import type { ScreenLike } from './screen.ts'
import { type TonConnectRail, isPairableWallet } from './payments/tonconnect.ts'
import QRCode from 'qrcode'
import { type Transcriber, VoiceBusyError } from './voice/groq.ts'

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

const MAX_AUDIO = 16_000 * 2 * 12 // 12 s of 16 kHz, 16-bit mono PCM

function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new Error('audio too long'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
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
  /** Speech-to-text for POST /api/voice. Undefined when no key is configured (typed commands still work). */
  stt?: Transcriber
}

export function createApiServer(opts: ApiOptions): Server {
  const { screen, dev, wallet, stt } = opts
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

      if (url.pathname === '/api/voice') {
        // Raw 16 kHz 16-bit mono PCM from the glasses mic -> transcript -> the same path as a typed command.
        // Read the whole body first: answering before it is consumed resets the connection (proxies turn that into a 500).
        const pcm = await readRaw(req, MAX_AUDIO)
        if (!stt) return send(res, 400, { error: 'Voice is not set up (GROQ_API_KEY). Type the command instead.' })
        if (pcm.length < 16_000 * 2 * 0.3) return send(res, 200, { transcript: '', error: "Didn't hear anything", card: screen.view() })
        try {
          const transcript = (await stt.transcribe(pcm)).slice(0, 300)
          if (!transcript) return send(res, 200, { transcript: '', error: "Didn't catch that", card: screen.view() })
          return send(res, 200, { transcript, card: await screen.command(transcript) })
        } catch (err) {
          const msg = err instanceof VoiceBusyError ? err.message : 'Voice failed, try again'
          return send(res, 200, { transcript: '', error: msg, card: screen.view() })
        }
      }

      const body = await readJson(req)
      switch (url.pathname) {
        case '/api/tonconnect/connect': {
          // Pairing happens on the phone page: a universal link plus the same link as a QR code.
          if (!wallet) return send(res, 400, { error: 'TON Connect is not configured (GRAMSIGHT_TONCONNECT_MANIFEST_URL)' })
          const choice = body.wallet ?? 'tonkeeper'
          if (!isPairableWallet(choice)) return send(res, 400, { error: 'Unknown wallet' })
          const pairing = await wallet.pairing(choice)
          const qrSvg = await QRCode.toString(pairing.link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
          return send(res, 200, { ...pairing, qrSvg })
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
