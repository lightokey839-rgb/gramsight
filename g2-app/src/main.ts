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
  kind: 'idle' | 'request' | 'confirm' | 'sending' | 'sent' | 'error' | 'offline'
  text: string
  tap: 'confirm' | 'none'
  doubleTap: 'cancel' | 'exit'
  version: number
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

function render(next: CardView): void {
  const changed = next.id !== card.id || next.version !== card.version || next.text !== card.text
  card = next
  if (!changed) return
  mirror.textContent = next.text
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content: next.text }))
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

async function poll(): Promise<void> {
  if (busy) return
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
  const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent)]
  const is = (t: OsEventTypeList) => types.includes(t)

  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    if (card.doubleTap === 'exit') {
      console.log('[gramsight] input: double-tap on home card, exiting')
      bridge.shutDownPageContainer(1)
    } else void act('double-tap', '/cancel')
    return
  }
  if (is(OsEventTypeList.CLICK_EVENT)) {
    if (card.tap === 'confirm') void act('tap', '/tap', { cardId: card.id })
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
  void act(`command "${text}"`, '/command', { text })
})

if (import.meta.env.DEV) {
  const sim = document.querySelector<HTMLFormElement>('#sim')!
  sim.hidden = false
  sim.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = document.querySelector<HTMLInputElement>('#simText')!.value
    void act('simulated request', '/dev/request', { text, fromName: 'Ada', chatTitle: 'Weekend trip' })
  })
}
