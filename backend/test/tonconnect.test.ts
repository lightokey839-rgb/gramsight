import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Address, beginCell, toNano } from '@ton/core'
import { AddressChecker } from '../src/checker/checker.ts'
import type { ProfileWalletSource } from '../src/checker/sources.ts'
import { FlowAController } from '../src/flowA/controller.ts'
import { FlowBController } from '../src/flowB/controller.ts'
import { PaymentLedger } from '../src/payments/ledger.ts'
import { type PaymentRail, type PaymentRequest, twoPathChooser } from '../src/payments/rail.ts'
import { type ConnectorLike, FileStorage, TonConnectRail, isPairableWallet } from '../src/payments/tonconnect.ts'
import { Screen } from '../src/screen.ts'
import { VaultStore } from '../src/vault/store.ts'

const dir = mkdtempSync(join(tmpdir(), 'gramsight-tc-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const ton = (fill: number) => new Address(0, Buffer.alloc(32, fill)).toString({ bounceable: false })
const ADA = ton(0x11)
const NEW = ton(0x33)
const RAW_WALLET = `0:${'ab'.repeat(32)}`
const BOC = beginCell().storeUint(7, 8).endCell().toBoc().toString('base64')

class FakeConnector implements ConnectorLike {
  connected = true
  account: { address: string; chain: string } | null = { address: RAW_WALLET, chain: '-3' }
  wallet = { device: { appName: 'tonkeeper' } }
  sent: { validUntil: number; network?: string; messages: { address: string; amount: string; payload?: string }[] }[] = []
  behaviour: 'approve' | 'reject' | 'hang' = 'approve'
  async restoreConnection() {}
  setConnectionNetwork() {}
  async getWallets() {
    return [{ appName: 'tonkeeper', name: 'Tonkeeper', universalLink: 'https://app.tonkeeper.com/ton-connect', bridgeUrl: 'https://bridge.tonapi.io/bridge', imageUrl: '', aboutUrl: '', platforms: [] }]
  }
  connect() {
    return 'https://app.tonkeeper.com/ton-connect?v=2&id=test'
  }
  async disconnect() {
    this.connected = false
  }
  async sendTransaction(tx: FakeConnector['sent'][number]) {
    this.sent.push(tx)
    if (this.behaviour === 'reject') {
      const e = new Error('user rejected')
      e.name = 'UserRejectsError'
      throw e
    }
    if (this.behaviour === 'hang') return new Promise<{ boc: string }>(() => {})
    return { boc: BOC }
  }
}

class CountingRail implements PaymentRail {
  readonly id = 'testnet-payer' as const
  readonly network = 'TON testnet'
  paid: PaymentRequest[] = []
  async pay(req: PaymentRequest) {
    this.paid.push(req)
    return { status: 'confirmed' as const, hash: 'cd'.repeat(32) }
  }
}

test('wallet path: testnet network, amount in nanotons, comment payload; approved returns the message hash', async () => {
  const c = new FakeConnector()
  const rail = new TonConnectRail(c)
  const r = await rail.pay({ to: NEW, amountNano: toNano('1.5'), comment: 'Gramsight testnet payment' })
  assert.equal(r.status, 'submitted')
  assert.match(r.hash ?? '', /^[0-9a-f]{64}$/)
  assert.equal(c.sent[0].network, '-3')
  assert.deepEqual(c.sent[0].messages[0].address, NEW)
  assert.equal(c.sent[0].messages[0].amount, '1500000000')
  assert.ok(c.sent[0].messages[0].payload)
  assert.ok(c.sent[0].validUntil > Date.now() / 1000)
  assert.equal(rail.status().testnet, true)
})

test('wallet path: rejected, timed out, mainnet wallet and no wallet all fail without sending again', async () => {
  const c = new FakeConnector()
  c.behaviour = 'reject'
  await assert.rejects(new TonConnectRail(c).pay({ to: NEW, amountNano: 1n, comment: 'x' }), /Rejected in your wallet/)
  const h = new FakeConnector()
  h.behaviour = 'hang'
  await assert.rejects(new TonConnectRail(h, 50).pay({ to: NEW, amountNano: 1n, comment: 'x' }), /Timed out waiting for your wallet/)
  assert.equal(h.sent.length, 1, 'one request, no retry')
  const main = new FakeConnector()
  main.account = { address: RAW_WALLET, chain: '-239' }
  await assert.rejects(new TonConnectRail(main).pay({ to: NEW, amountNano: 1n, comment: 'x' }), /not on testnet/)
  assert.equal(main.sent.length, 0)
  const none = new FakeConnector()
  none.connected = false
  await assert.rejects(new TonConnectRail(none).pay({ to: NEW, amountNano: 1n, comment: 'x' }), /No wallet connected/)
})

test('pairing link and file storage', async () => {
  const c = new FakeConnector()
  c.connected = false
  const link = await new TonConnectRail(c).connectLink()
  assert.match(link, /^https:\/\/app\.tonkeeper\.com\/ton-connect/)
  // Keeper also gets its web version, with the same request query, for a wallet that lives in a browser tab.
  const p = await new TonConnectRail(c).pairing('tonkeeper')
  assert.equal(p.webLink, 'https://web.keeperwallet.com/ton-connect?v=2&id=test')
  // A wallet that is not in the list is an error, not a silent fallback to another wallet.
  await assert.rejects(new TonConnectRail(c).pairing('gramwallet'), /not in the TON Connect wallet list/)
  assert.equal(isPairableWallet('gramwallet'), true)
  assert.equal(isPairableWallet('constructor'), false)
  const s = new FileStorage(join(dir, 'tc.json'))
  await s.setItem('a', '1')
  assert.equal(await s.getItem('a'), '1')
  await s.removeItem('a')
  assert.equal(await s.getItem('a'), null)
})

function setup(name: string, opts: { profile?: ProfileWalletSource; walletReady?: boolean } = {}) {
  const store = new VaultStore(join(dir, `${name}-v.json`))
  const ledger = new PaymentLedger(join(dir, `${name}-p.json`))
  const handsFree = new CountingRail()
  const connector = new FakeConnector()
  connector.connected = opts.walletReady ?? true
  const wallet = new TonConnectRail(connector)
  const b = new FlowBController(new AddressChecker({ store, ...(opts.profile ? { profile: opts.profile } : {}) }), Date.now, () => {}, {
    rails: twoPathChooser(handsFree, wallet, toNano('1')),
    ledger,
    limits: { perPaymentNano: toNano('1'), dailyNano: toNano('3'), walletMaxNano: toNano('10') },
  })
  const screen = new Screen(new FlowAController(store, { send: async () => 1 }), b)
  return { store, ledger, handsFree, connector, b, screen }
}

async function share(t: ReturnType<typeof setup>, address: string) {
  t.b.addShare({ chatId: 1, chatTitle: 'Private chat', fromName: 'Ada', senderUserId: 7, address })
  await t.b.settled()
}

const card = (address: string): ProfileWalletSource => ({ walletCardAddress: async () => address })

test('two paths: their wallet + small amount -> one tap hands-free', async () => {
  const t = setup('small', { profile: card(ADA) })
  await share(t, ADA)
  const pay = await t.screen.command('send 1 gram')
  assert.match(pay.text, /Tap: pay/)
  await t.screen.tap(pay.id)
  await t.b.settled()
  assert.equal(t.handsFree.paid.length, 1)
  assert.equal(t.connector.sent.length, 0)
})

test('two paths: a new address goes to your wallet; no spoken confirm, "Approve on your phone", "Sent" with msg hash', async () => {
  const t = setup('new')
  await share(t, NEW)
  const pay = await t.screen.command('send 0.5 gram')
  assert.equal(pay.tap, 'confirm', 'the phone approval replaces the spoken confirm')
  assert.match(pay.text, /0\.5 Gram · TON testnet · your wallet[\s\S]*Tap: send to your wallet/)
  await t.screen.tap(pay.id)
  await t.b.settled()
  assert.equal(t.connector.sent.length, 1)
  assert.equal(t.handsFree.paid.length, 0)
  assert.match(t.screen.view().text, /SENT 0\.5 Gram → Ada\nApproved in your wallet · msg /)
  assert.equal(t.ledger.list()[0].rail, 'tonconnect')
  assert.equal(t.ledger.spentSince(0), 0n, 'wallet payments do not use the hands-free daily limit')
})

test('two paths: above the hands-free limit goes to your wallet; a rejection shows "REJECTED"', async () => {
  const t = setup('large', { profile: card(ADA) })
  await share(t, ADA)
  t.connector.behaviour = 'reject'
  const pay = await t.screen.command('send 5 gram')
  assert.match(pay.text, /your wallet/)
  await t.screen.tap(pay.id)
  await t.b.settled()
  assert.match(t.screen.view().text, /REJECTED\nRejected in your wallet\nNothing was sent\./)
  assert.equal(t.handsFree.paid.length, 0)
  assert.equal(t.ledger.list()[0].status, 'failed')
})

test('two paths: without a connected wallet, a new address falls back to spoken confirm + tap, within hands-free limits', async () => {
  const t = setup('fallback', { walletReady: false })
  await share(t, NEW)
  assert.match((await t.screen.command('send 5 gram')).text, /Over your limit\.\nMax 1 Gram per payment/)
  t.screen.cancel()
  const pay = await t.screen.command('send 1 gram')
  assert.match(pay.text, /Say "confirm", then tap/)
  assert.equal(pay.tap, 'none')
})
