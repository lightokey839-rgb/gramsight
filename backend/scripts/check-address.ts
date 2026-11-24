// Runs the address checker from the terminal, with the same layers the glasses use.
//   npm run check:address -- <address>                      contacts, lookalikes, scam flags
//   npm run check:address -- <address> --from @username     plus that user's Telegram profile wallet
//   npm run check:address -- <address> --from 123456789 --no-telegram
// Note: the scam check sends the address to tonapi.io. Stop `npm run dev` first if it is running (one TDLib client).
import { BotApi } from '../src/bot/api.ts'
import { AddressChecker } from '../src/checker/checker.ts'
import { PayerHistory } from '../src/checker/payerHistory.ts'
import { BotProfileSource, LayeredProfileSource, type ProfileWalletSource, TdlibProfileSource, TonapiReputation } from '../src/checker/sources.ts'
import { optionalEnv } from '../src/env.ts'
import { type Client, closeClient, connectLoggedIn, resolveUserId } from '../src/telegram.ts'
import { VaultStore } from '../src/vault/store.ts'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const address = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--from')
  if (!address) throw new Error('Usage: npm run check:address -- <address> [--from @username|user id] [--no-telegram]')
  const fromIdx = args.indexOf('--from')
  const from = fromIdx >= 0 ? args[fromIdx + 1] : undefined

  let client: Client | undefined
  if (!args.includes('--no-telegram') && from) {
    try {
      client = await connectLoggedIn()
    } catch (err) {
      console.log(`(user account not available: ${err instanceof Error ? err.message : String(err)})`)
    }
  }
  try {
    let senderUserId: number | undefined
    if (from && /^\d+$/.test(from)) senderUserId = Number(from)
    else if (from && client) senderUserId = await resolveUserId(client, from)

    const sources: ProfileWalletSource[] = []
    if (client) sources.push(new TdlibProfileSource(client))
    const token = optionalEnv('BOT_TOKEN')
    if (token) sources.push(new BotProfileSource(new BotApi(token)))

    const checker = new AddressChecker({
      store: new VaultStore(),
      ...(sources.length ? { profile: new LayeredProfileSource(sources) } : {}),
      reputation: new TonapiReputation(),
      ...(optionalEnv('TON_TESTNET_PAYER_MNEMONIC') ? { history: new PayerHistory() } : {}),
    })
    const started = Date.now()
    const v = await checker.check({ address, ...(senderUserId !== undefined ? { senderUserId } : {}) })
    console.log(`${v.headline}   [${v.level}, ${v.code}]`)
    for (const d of v.details) console.log(`  - ${d}`)
    console.log(`  family: ${v.family ?? 'unknown'} · profile: ${v.profile.status} · scam check: ${v.reputation} · ${Date.now() - started} ms`)
  } finally {
    if (client) await closeClient(client)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`check:address failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
