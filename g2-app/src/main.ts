// Gramsight glasses app. The backend decides what the card says; this app draws it on the G2
// (one full-screen text container, one card at a time) and turns touchpad / R1 input into actions:
//   tap        -> confirm the card on screen (only a confirmation card reacts)
//   double-tap -> cancel / dismiss; on the idle home card it exits the app (system rule)
//   swipe down -> next request
// Taps from the temple touchpad and the R1 ring are treated the same.
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

type CardView = {
  id: string
  kind: 'idle' | 'request' | 'confirm' | 'sending' | 'sent' | 'error' | 'offline' | 'checking' | 'verdict' | 'pay' | 'paying'
  text: string
  tap: 'confirm' | 'none'
  doubleTap: 'cancel' | 'exit'
  version: number
  /** The backend marks cards that take a spoken command. */
  voice?: boolean
}

const API = '/api' // proxied to the backend (127.0.0.1:8787) by the Vite dev server

const OFFLINE: CardView = {
  id: 'offline',
  kind: 'offline',
  text: 'GRAMSIGHT\n\nBackend offline.\nStart it: cd backend; npm run dev',
  tap: 'none',
  doubleTap: 'exit',
  version: -1,
}

let card: CardView = { id: 'boot', kind: 'idle', text: 'GRAMSIGHT\n\nConnecting...', tap: 'none', doubleTap: 'exit', version: 0 }
let busy = false

const mirror = document.querySelector<HTMLPreElement>('#mirror')!

const bridge = await waitForEvenAppBridge()
const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 8,
        containerID: 1,
        containerName: 'main',
        content: card.text,
        isEventCapture: 1,
      }),
    ],
  }),
)
console.log(`[gramsight] ready (page ${result === 0 ? 'created' : `failed: ${result}`})`)

// Cards with nothing to approve take voice: a tap opens the mic ("tap to talk").

const canTalk = (c: CardView) => c.voice === true && c.tap === 'none'

function draw(text: string): void {
  mirror.textContent = text
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content: text }))
}

function render(next: CardView): void {
  const changed = next.id !== card.id || next.version !== card.version || next.text !== card.text
  card = next
  if (!changed) return
  draw(canTalk(next) ? `${next.text}\nTap: talk` : next.text)
}

async function api(path: string, body?: unknown): Promise<CardView> {
  const res = await fetch(`${API}${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
  return data as CardView
}

async function act(label: string, path: string, body: unknown = {}): Promise<void> {
  if (busy) return // one action at a time: a burst of taps cannot queue up extra sends
  busy = true
  console.log(`[gramsight] input: ${label} on ${card.kind} ${card.id}`)
  try {
    render(await api(path, body))
  } catch (err) {
    console.warn(`[gramsight] ${label} failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    busy = false
  }
}

// Voice: collect the mic's 16 kHz PCM while listening, then send it to the backend for speech-to-text.
let listening: { chunks: Uint8Array[]; timer: number } | undefined
const MAX_LISTEN_MS = 6000

function toBytes(p: unknown): Uint8Array {
  if (p instanceof Uint8Array) return p
  if (Array.isArray(p)) return Uint8Array.from(p as number[])
  if (typeof p === 'string') return Uint8Array.from(atob(p), (c) => c.charCodeAt(0))
  return new Uint8Array()
}

async function startListening(): Promise<void> {
  if (listening || busy) return
  // Mark as listening before the (sometimes slow) mic switch, so a tap during start-up stops instead of restarting.
  listening = { chunks: [], timer: window.setTimeout(() => void stopListening(), MAX_LISTEN_MS) }
  console.log('[gramsight] input: listening')
  // Draw outside the input-event callback: an update sent from inside it can be overwritten.
  await new Promise((r) => window.setTimeout(r, 0))
  draw(`${card.text}\n\nListening... tap to stop`)
  const ok = await bridge.audioControl(true)
  console.log(`[gramsight] mic ${ok ? 'on' : 'failed'}`)
  if (!ok && listening) {
    window.clearTimeout(listening.timer)
    listening = undefined
    draw(`${card.text}\n\nMicrophone unavailable. Type on the phone.`)
  } else if (listening) {
    draw(`${card.text}\n\nListening... tap to stop`) // switching the mic on can repaint the page
  }
}

async function stopListening(): Promise<void> {
  const l = listening
  if (!l) return
  listening = undefined
  window.clearTimeout(l.timer)
  await bridge.audioControl(false)
  const size = l.chunks.reduce((n, c) => n + c.length, 0)
  const pcm = new Uint8Array(size)
  let o = 0
  for (const c of l.chunks) {
    pcm.set(c, o)
    o += c.length
  }
  busy = true
  draw(`${card.text}\n\nUnderstanding...`)
  try {
    const res = await fetch(`${API}/voice`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm })
    const data = (await res.json().catch(() => ({ error: `Voice failed (HTTP ${res.status})` }))) as {
      transcript?: string
      error?: string
      card?: CardView
    }
    console.log(`[gramsight] voice: ${data.error ?? `heard "${data.transcript}"`}`)
    if (data.card) {
      card = { ...card, version: -2 } // force a redraw
      render(data.card)
    }
    if (data.error) draw(`${card.text}\n\n${data.error}`)
  } catch {
    draw(`${card.text}\n\nVoice failed. Type on the phone.`)
  } finally {
    busy = false
  }
}

async function poll(): Promise<void> {
  if (busy || listening) return
  try {
    render(await api('/card'))
  } catch {
    render(OFFLINE)
  }
}
setInterval(poll, 1000)
void poll()

// Reads the event type out of one envelope. CLICK_EVENT is 0 and protobuf omits zero values,
// so a tap arrives with eventType undefined; resolve that default only inside an envelope that exists.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

bridge.onEvenHubEvent((event) => {
  if (event.audioEvent) {
    if (listening) listening.chunks.push(toBytes(event.audioEvent.audioPcm))
    return
  }
  const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent)]
  const is = (t: OsEventTypeList) => types.includes(t)

  if (listening && is(OsEventTypeList.CLICK_EVENT)) {
    void stopListening()
    return
  }
  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    if (card.doubleTap === 'exit') {
      console.log('[gramsight] input: double-tap on home card, exiting')
      bridge.shutDownPageContainer(1)
    } else void act('double-tap', '/cancel')
    return
  }
  if (is(OsEventTypeList.CLICK_EVENT)) {
    if (card.tap === 'confirm') void act('tap', '/tap', { cardId: card.id })
    else if (canTalk(card)) void startListening()
    else console.log(`[gramsight] input: tap on ${card.kind} (no action)`)
    return
  }
  if (is(OsEventTypeList.SCROLL_BOTTOM_EVENT)) void act('swipe down', '/next')
})

// Phone side: a typed command stands in for voice until speech-to-text is connected.
document.querySelector<HTMLFormElement>('#cmd')!.addEventListener('submit', (e) => {
  e.preventDefault()
  const input = document.querySelector<HTMLInputElement>('#cmdText')!
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  if (!busy) draw(`${card.text}\n\nThinking...`) // the AI fallback can take 10+ s on free models
  void act(`command "${text}"`, '/command', { text })
})

// Phone side: pair a testnet wallet once with TON Connect (QR code or universal link). Never on the glasses.
type WalletStatus = { configured: boolean; connected: boolean; address?: string; testnet?: boolean; wallet?: string }
const wStatus = document.querySelector<HTMLParagraphElement>('#walletStatus')!
const wConnect = document.querySelector<HTMLButtonElement>('#walletConnect')!
const wDisconnect = document.querySelector<HTMLButtonElement>('#walletDisconnect')!
const wPair = document.querySelector<HTMLDivElement>('#walletPair')!
const wQr = document.querySelector<HTMLDivElement>('#walletQr')!
const wLink = document.querySelector<HTMLAnchorElement>('#walletLink')!
const wWeb = document.querySelector<HTMLAnchorElement>('#walletWeb')!
const wWebHint = document.querySelector<HTMLParagraphElement>('#walletWebHint')!
const wCopy = document.querySelector<HTMLButtonElement>('#walletCopy')!
const wApp = document.querySelector<HTMLSelectElement>('#walletApp')!
const wPick = document.querySelector<HTMLDivElement>('#walletPick')!
const short = (a: string) => (a.length > 18 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a)

let pairing = false // true while a pairing link is out and we are waiting for the wallet

async function refreshWallet(): Promise<WalletStatus | undefined> {
  try {
    const s = (await fetch(`${API}/tonconnect`, { cache: 'no-store' }).then((r) => r.json())) as WalletStatus
    if (!s.configured) {
      wStatus.textContent = 'Not set up: the backend needs GRAMSIGHT_TONCONNECT_MANIFEST_URL.'
      wConnect.hidden = true
      wDisconnect.hidden = true
    } else if (s.connected) {
      wStatus.textContent = `Connected: ${s.wallet} · ${short(s.address ?? '')}${s.testnet ? ' (testnet)' : ' (NOT testnet: payments refused)'}`
      wPick.hidden = true
      wDisconnect.hidden = false
      wPair.hidden = true
    } else {
      wStatus.textContent = pairing ? 'Waiting for your wallet to approve the connection…' : 'Not connected.'
      wPick.hidden = false
      wDisconnect.hidden = true
    }
    return s
  } catch {
    wStatus.textContent = 'Backend offline.'
    return undefined
  }
}

wConnect.addEventListener('click', async () => {
  wConnect.disabled = true
  try {
    const res = await fetch(`${API}/tonconnect/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: wApp.value }),
    })
    const data = (await res.json()) as { wallet?: string; link?: string; webLink?: string; qrSvg?: string; error?: string }
    if (!res.ok || !data.link || !data.qrSvg) throw new Error(data.error ?? `HTTP ${res.status}`)
    wQr.innerHTML = data.qrSvg // generated by our own backend from the pairing link
    wLink.href = data.link
    wLink.textContent = `Open in ${data.wallet ?? 'wallet'}`
    wCopy.dataset.link = data.link
    wCopy.textContent = 'Copy link'
    wWeb.hidden = wWebHint.hidden = !data.webLink
    if (data.webLink) wWeb.href = data.webLink
    wPair.hidden = false
    pairing = true
    wStatus.textContent = 'Waiting for your wallet to approve the connection…'
    const until = Date.now() + 180_000
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000))
      if ((await refreshWallet())?.connected) break
    }
    if (wPick.hidden === false) wStatus.textContent = 'No approval within 3 minutes. Press Connect wallet to try again.'
  } catch (err) {
    wStatus.textContent = `Could not start pairing: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    pairing = false
    wConnect.disabled = false
  }
})

wCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(wCopy.dataset.link ?? '')
    wCopy.textContent = 'Copied'
  } catch {
    wCopy.textContent = 'Copy failed'
  }
})

wDisconnect.addEventListener('click', async () => {
  await fetch(`${API}/tonconnect/disconnect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  await refreshWallet()
})
void refreshWallet()

if (import.meta.env.DEV) {
  const sim = document.querySelector<HTMLFormElement>('#sim')!
  sim.hidden = false
  sim.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = document.querySelector<HTMLInputElement>('#simText')!.value
    void act('simulated request', '/dev/request', { text, fromName: 'Ada', chatTitle: 'Weekend trip' })
  })
  const share = document.querySelector<HTMLFormElement>('#simShare')!
  share.hidden = false
  share.addEventListener('submit', (e) => {
    e.preventDefault()
    const address = document.querySelector<HTMLInputElement>('#simAddr')!.value.trim()
    const fromName = document.querySelector<HTMLInputElement>('#simFrom')!.value.trim() || 'Ada'
    if (address) void act('simulated share', '/dev/share', { address, fromName, chatTitle: 'Weekend trip' })
  })
}
