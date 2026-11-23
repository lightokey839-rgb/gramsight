// Test 4b, part 2: can the user account (TDLib) read a chat partner's TON wallet card, and find who owns an address?
//   npm run check:wallet-card-user -- @username
//   npm run check:wallet-card-user -- 123456789 --address <TON address>
//   npm run check:wallet-card-user -- me
// Uses, from TDLib 1.8.70 (td_api.tl):
//   getUserFullInfo user_id -> userFullInfo.ton_wallet_card ("TON wallet card of the user; may be null if none")
//   getUserTonWalletAddresses user_ids  (needs getOption("can_use_ton_wallet"))
//   getAddressTonWallet address -> userTonWalletAddress { user_id, wallet_address }  (needs can_use_ton_wallet)
// Addresses are compared as raw workchain:hash, never as strings (UQ/EQ/0Q/kQ forms can be the same address).
import { Address } from '@ton/core'
import { TDLibError } from 'tdl'
import { addressFingerprint } from '../src/ton.ts'
import { closeClient, connectLoggedIn, getBooleanOption, resolveUserId } from '../src/telegram.ts'

function describe(raw: string): string {
  try {
    const a = Address.parse(raw)
    return `${addressFingerprint(a.toString({ bounceable: false, urlSafe: true }))}  (raw ${a.toRawString()})`
  } catch {
    return `unparseable address string of length ${raw.length}`
  }
}

function sameAddress(a: string, b: string): boolean {
  try {
    return Address.parse(a).equals(Address.parse(b))
  } catch {
    return false
  }
}

function errText(err: unknown): string {
  if (err instanceof TDLibError) return `TDLib error ${err.code}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--address')
  const addrIdx = args.indexOf('--address')
  const addressArg = addrIdx >= 0 ? args[addrIdx + 1] : undefined
  if (!target) throw new Error('Pass @username, a numeric user id, or "me"')

  const client = await connectLoggedIn()
  try {
    const canUseWallet = await getBooleanOption(client, 'can_use_ton_wallet')
    console.log(`TDLib option can_use_ton_wallet: ${canUseWallet === undefined ? 'not set' : canUseWallet}`)

    const userId = await resolveUserId(client, target)
    console.log(`\nTarget user id: ${userId}`)

    // 1. Profile wallet card (no need for them to have started our bot).
    let cardAddress: string | undefined
    try {
      const full = await client.invoke({ _: 'getUserFullInfo', user_id: userId })
      const card = full.ton_wallet_card
      if (card) {
        cardAddress = card.address
        console.log('getUserFullInfo.ton_wallet_card: PRESENT')
        console.log(`  address: ${describe(card.address)}`)
        console.log(`  stickers: ${card.stickers.length}`)
      } else {
        console.log('getUserFullInfo.ton_wallet_card: ABSENT (no wallet card on their profile, or hidden)')
      }
    } catch (err) {
      console.log(`getUserFullInfo failed: ${errText(err)}`)
    }

    // 2. Wallet addresses by user id.
    try {
      const res = await client.invoke({ _: 'getUserTonWalletAddresses', user_ids: [userId] })
      console.log(`getUserTonWalletAddresses: ${res.addresses.length} address(es)`)
      for (const a of res.addresses) console.log(`  user ${a.user_id}: ${describe(a.wallet_address)}`)
    } catch (err) {
      console.log(`getUserTonWalletAddresses failed: ${errText(err)}`)
    }

    // 3. Reverse lookup: who owns this address?
    const lookup = addressArg ?? cardAddress
    if (lookup) {
      try {
        const owner = await client.invoke({ _: 'getAddressTonWallet', address: lookup })
        console.log(`getAddressTonWallet(${addressArg ? 'given address' : 'their card address'}): owner user id ${owner.user_id || 'unknown (0)'}`)
        console.log(`  wallet address: ${describe(owner.wallet_address)}`)
        console.log(`  owner is the target user: ${owner.user_id === userId ? 'YES' : 'NO'}`)
        if (cardAddress && addressArg) console.log(`  given address equals their card address: ${sameAddress(addressArg, cardAddress) ? 'YES' : 'NO'}`)
      } catch (err) {
        console.log(`getAddressTonWallet failed: ${errText(err)}`)
      }
    } else {
      console.log('getAddressTonWallet: skipped (no --address given and no card address to look up)')
    }
  } finally {
    await closeClient(client)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`check:wallet-card-user failed: ${errText(err)}`)
    process.exit(1)
  })
