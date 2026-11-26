// Path 2: TON Connect. The payment is sent as a request to the user's OWN testnet wallet app (e.g. Tonkeeper
// with a testnet account) and approved on the phone. Gramsight holds no key on this path.
// Pairing happens once, on the phone page (QR code / universal link), never on the glasses.
// Needs a public HTTPS manifest (GRAMSIGHT_TONCONNECT_MANIFEST_URL), because the wallet fetches it to show who is asking.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Address, beginCell } from '@ton/core'
import { CHAIN, type IStorage, TonConnect, UserRejectsError, isWalletInfoRemote } from '@tonconnect/sdk'
import { Cell } from '@ton/core'
import { dataDir } from '../vault/store.ts'
import type { PaymentRail, PaymentRequest, PaymentResult } from './rail.ts'

/** TON Connect session storage on disk (outside the repo). Holds the bridge session, not any wallet key. */
export class FileStorage implements IStorage {
  constructor(private readonly path = join(dataDir(), 'tonconnect.json')) {}
  private read(): Record<string, string> {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>) : {}
  }
  private write(data: Record<string, string>): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(`${this.path}.tmp`, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
  }
  async setItem(key: string, value: string): Promise<void> {
    this.write({ ...this.read(), [key]: value })
  }
  async getItem(key: string): Promise<string | null> {
    return this.read()[key] ?? null
  }
  async removeItem(key: string): Promise<void> {
    const d = this.read()
    delete d[key]
    this.write(d)
  }
}

export type TonConnectStatus = { configured: boolean; connected: boolean; address?: string; testnet?: boolean; wallet?: string }

/** The shape of the TON Connect connector this rail uses (lets tests use a fake). */
export interface ConnectorLike {
  readonly connected: boolean
  readonly account: { address: string; chain: string } | null
  readonly wallet: { device: { appName: string } } | null
  restoreConnection(): Promise<void>
  setConnectionNetwork(network?: string): void
  getWallets(): Promise<unknown[]>
  connect(source: { universalLink: string; bridgeUrl: string }): string | void
  disconnect(): Promise<void>
  sendTransaction(tx: {
    validUntil: number
    network?: string
    messages: { address: string; amount: string; payload?: string }[]
  }): Promise<{ boc: string }>
}

export function commentPayload(comment: string): string {
  return beginCell().storeUint(0, 32).storeStringTail(comment).endCell().toBoc().toString('base64')
}

export class TonConnectRail implements PaymentRail {
  readonly id = 'tonconnect' as const
  readonly network = 'TON testnet (your wallet)'
  private ready: Promise<void> | undefined

  constructor(
    private readonly connector: ConnectorLike,
    private readonly approveTimeoutMs = 180_000,
  ) {}

  static fromManifest(manifestUrl: string, storagePath?: string): TonConnectRail {
    const connector = new TonConnect({ manifestUrl, storage: new FileStorage(storagePath) }) as unknown as ConnectorLike
    return new TonConnectRail(connector)
  }

  /** Restores a saved connection once. Testnet only: a mainnet wallet is refused at connect time. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      try {
        await this.connector.restoreConnection()
      } catch {
        // no saved session
      }
      if (!this.connector.connected) this.connector.setConnectionNetwork(CHAIN.TESTNET)
    })()
    return this.ready
  }

  status(): TonConnectStatus {
    const a = this.connector.account
    if (!this.connector.connected || !a) return { configured: true, connected: false }
    return {
      configured: true,
      connected: true,
      address: Address.parseRaw(a.address).toString({ testOnly: a.chain === CHAIN.TESTNET, bounceable: false }),
      testnet: a.chain === CHAIN.TESTNET,
      wallet: this.connector.wallet?.device.appName ?? 'wallet',
    }
  }

  isReady(): boolean {
    const a = this.connector.account
    return this.connector.connected && !!a && a.chain === CHAIN.TESTNET
  }

  /** A universal link (show it as a QR code on the phone page, or open it on the phone) to pair a wallet. */
  async connectLink(appName = 'tonkeeper'): Promise<string> {
    await this.init()
    if (this.connector.connected) await this.connector.disconnect()
    this.connector.setConnectionNetwork(CHAIN.TESTNET)
    const wallets = (await this.connector.getWallets()) as Parameters<typeof isWalletInfoRemote>[0][]
    const remote = wallets.filter(isWalletInfoRemote)
    const w = remote.find((x) => x.appName === appName) ?? remote[0]
    if (!w) throw new Error('No TON Connect wallets available')
    const link = this.connector.connect({ universalLink: w.universalLink, bridgeUrl: w.bridgeUrl })
    if (typeof link !== 'string') throw new Error('Wallet link not available')
    return link
  }

  async disconnect(): Promise<void> {
    await this.init()
    if (this.connector.connected) await this.connector.disconnect()
  }

  /** Sends one request to the wallet. Approved: returns the message hash. Rejected or timed out: throws. Never retries. */
  async pay(req: PaymentRequest): Promise<PaymentResult> {
    await this.init()
    if (!this.connector.connected) throw new Error('No wallet connected. Connect it on the phone page.')
    if (this.connector.account?.chain !== CHAIN.TESTNET) throw new Error('Connected wallet is not on testnet')
    let timer: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([
        this.connector.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + Math.ceil(this.approveTimeoutMs / 1000),
          network: CHAIN.TESTNET,
          messages: [{ address: req.to, amount: req.amountNano.toString(), payload: commentPayload(req.comment) }],
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out waiting for your wallet')), this.approveTimeoutMs)
        }),
      ])
      const hash = Cell.fromBase64(result.boc).hash().toString('hex')
      // The wallet broadcast it; the on-chain transaction follows within seconds.
      return { status: 'submitted', hash }
    } catch (err) {
      if (err instanceof UserRejectsError || (err instanceof Error && err.name === 'UserRejectsError')) {
        throw new Error('Rejected in your wallet')
      }
      throw err
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
