// Test 4b, part 1: does Bot API getChat return ChatFullInfo.ton_wallet_card for a user who started the bot?
//   npm run check:wallet-card                      checks BOT_OWNER_TELEGRAM_ID
//   npm run check:wallet-card -- 123456789 ...     checks these user ids
//   npm run check:wallet-card -- --from-updates    checks everyone who has messaged the bot recently
// Documented (Bot API 10.x): "ton_wallet_card: For private chats, the TON wallet card of the user,
// which is shown on their profile page". The bot token is never printed.
import { Address } from '@ton/core'
import { optionalEnv, requireEnv } from '../src/env.ts'
import { addressFingerprint } from '../src/ton.ts'

let token = ''

type BotResponse<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string }

async function bot<T>(method: string, params: Record<string, unknown> = {}): Promise<BotResponse<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    })
    return (await res.json()) as BotResponse<T>
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).split(token).join('<BOT_TOKEN>')
    throw new Error(`Bot API ${method} request failed: ${msg}`)
  }
}

type TonWalletCard = { address: string; amount: string; stickers?: unknown[]; background_nft_address?: string }
type ChatFullInfo = { id: number; type: string; first_name?: string; username?: string; ton_wallet_card?: TonWalletCard } & Record<string, unknown>
type Update = { message?: { from?: { id: number; is_bot: boolean } } }

function describeAddress(raw: string): string {
  try {
    const a = Address.parse(raw)
    const friendly = a.toString({ bounceable: false, urlSafe: true })
    return `${addressFingerprint(friendly)}  (raw ${a.toRawString()})`
  } catch {
    return `unparseable address string of length ${raw.length}`
  }
}

async function main(): Promise<void> {
  token = requireEnv('BOT_TOKEN')
  const me = await bot<{ id: number; username: string }>('getMe')
  if (!me.ok) throw new Error(`getMe failed: ${me.error_code} ${me.description} (check BOT_TOKEN)`)
  console.log(`Bot: @${me.result.username}`)

  const args = process.argv.slice(2)
  let userIds: string[] = args.filter((a) => /^\d+$/.test(a))

  if (args.includes('--from-updates')) {
    // getUpdates without an offset does not mark updates as read.
    const updates = await bot<Update[]>('getUpdates', { limit: 100, allowed_updates: ['message'] })
    if (!updates.ok) throw new Error(`getUpdates failed: ${updates.error_code} ${updates.description}`)
    const ids = new Set(updates.result.map((u) => u.message?.from).filter((f) => f && !f.is_bot).map((f) => String(f!.id)))
    console.log(`Users seen in recent updates: ${ids.size}`)
    userIds.push(...ids)
  }
  if (userIds.length === 0) {
    const owner = optionalEnv('BOT_OWNER_TELEGRAM_ID')
    if (!owner) throw new Error('Pass user ids, --from-updates, or set BOT_OWNER_TELEGRAM_ID')
    userIds = [owner]
  }

  for (const id of [...new Set(userIds)]) {
    const chat = await bot<ChatFullInfo>('getChat', { chat_id: id })
    if (!chat.ok) {
      console.log(`\nuser ${id}: getChat failed: ${chat.error_code} ${chat.description}`)
      console.log('  (A user who has never started the bot usually gives "chat not found".)')
      continue
    }
    const c = chat.result
    console.log(`\nuser ${id}: type=${c.type}${c.username ? ` @${c.username}` : ''}`)
    console.log(`  ChatFullInfo fields returned: ${Object.keys(c).sort().join(', ')}`)
    if (c.ton_wallet_card) {
      const w = c.ton_wallet_card
      console.log('  ton_wallet_card: PRESENT')
      console.log(`    address: ${describeAddress(w.address)}`)
      console.log(`    balance field present: ${w.amount !== undefined}; stickers: ${w.stickers?.length ?? 0}`)
    } else {
      console.log('  ton_wallet_card: ABSENT (no wallet card on the profile, hidden, or not returned to bots)')
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`check:wallet-card failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
