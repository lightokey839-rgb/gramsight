// Where the checker's evidence comes from. Each source can fail or time out; the checker then reports
// "couldn't check", never a match or a clean bill of health.
import { Address } from '@ton/core'
import type { BotApiLike } from '../bot/api.ts'
import type { Client } from '../telegram.ts'
import { optionalEnv } from '../env.ts'
import type { Family } from '../vault/addresses.ts'

/** The TON wallet card on a Telegram user's profile: its address, or null when they have none. */
export interface ProfileWalletSource {
  walletCardAddress(userId: number): Promise<string | null>
}

/** User account (TDLib): works for any user, no need for them to have started the bot. */
export class TdlibProfileSource implements ProfileWalletSource {
  constructor(private readonly client: Client) {}
  async walletCardAddress(userId: number): Promise<string | null> {
    const full = await this.client.invoke({ _: 'getUserFullInfo', user_id: userId })
    return full.ton_wallet_card?.address ?? null
  }
}

/** Bot API fallback: only works for users who have started the vault bot (private chats). */
export class BotProfileSource implements ProfileWalletSource {
  constructor(private readonly api: BotApiLike) {}
  async walletCardAddress(userId: number): Promise<string | null> {
    const chat = await this.api.call<{ ton_wallet_card?: { address: string } }>('getChat', { chat_id: userId })
    return chat.ton_wallet_card?.address ?? null
  }
}

/** Tries each source in order. A card from any source wins; "no card" needs at least one source to answer. */
export class LayeredProfileSource implements ProfileWalletSource {
  constructor(private readonly sources: ProfileWalletSource[]) {}
  async walletCardAddress(userId: number): Promise<string | null> {
    let answered = false
    let lastError: unknown
    for (const s of this.sources) {
      try {
        const card = await s.walletCardAddress(userId)
        answered = true
        if (card) return card
      } catch (err) {
        lastError = err
      }
    }
    if (answered) return null
    throw lastError ?? new Error('no profile source configured')
  }
}

export type ReputationResult = { flagged: boolean; name?: string }

/** A scam-reputation lookup. Returns undefined when the source does not cover this address family. */
export interface ReputationSource {
  check(family: Family, address: string): Promise<ReputationResult | undefined>
}

/**
 * tonapi.io account flags (is_scam), read from MAINNET: scam reports live there, and a TON address is
 * the same account on testnet and mainnet. Note: this sends the address being checked to tonapi.
 */
export class TonapiReputation implements ReputationSource {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = 'https://tonapi.io',
    private readonly apiKey = optionalEnv('TONAPI_KEY'),
  ) {}

  async check(family: Family, address: string): Promise<ReputationResult | undefined> {
    if (family !== 'ton') return undefined
    const raw = Address.parse(address).toRawString()
    const res = await this.fetchImpl(`${this.base}/v2/accounts/${encodeURIComponent(raw)}`, {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      signal: AbortSignal.timeout(4000),
    })
    if (res.status === 404) return { flagged: false }
    if (!res.ok) throw new Error(`tonapi ${res.status}`)
    const body = (await res.json()) as { is_scam?: boolean; name?: string }
    return { flagged: body.is_scam === true, ...(body.name ? { name: body.name } : {}) }
  }
}

/** Addresses the user has paid before. Only OUTGOING destinations count: poisoning arrives as incoming dust. */
export interface HistorySource {
  paidAddresses(): Promise<string[]>
}

/** Merges several history sources; a failing one is skipped. */
export function combineHistory(...sources: HistorySource[]): HistorySource {
  return {
    async paidAddresses() {
      const lists = await Promise.allSettled(sources.map((s) => s.paidAddresses()))
      return [...new Set(lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))]
    },
  }
}
