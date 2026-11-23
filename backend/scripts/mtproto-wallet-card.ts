// Test 4b, part 2: can the user-account (MTProto) client read a chat partner's TON wallet card?
//   npm run check:wallet-card-mtproto -- @username        (or a numeric user id from `npm run telegram:read -- --list`)
//
// Schema facts (checked 23 Nov 2026 against Telegram Desktop's api.tl, LAYER 234, and TDLib's telegram_api.tl):
//   userFull#b90c2afd ... wallet_card:flags2.19?wallet.Card ... = UserFull;
//   wallet.card#8ed043b1 flags:# stickers:flags.0?Vector<wallet.CardSticker> bg_nft_item:flags.1?wallet.NftItem address:string balance:long = wallet.Card;
//   wallet.getUserAddresses#5275dfdd flags:# force:flags.0?true id:Vector<InputUser> addresses:Vector<string> = wallet.UserAddresses;
// The server only sends wallet_card to clients that declare a layer that has it. This script reports the layer
// GramJS declares and whether the UserFull it gets back carries any wallet field.
import { Api, utils } from 'telegram'
import { LAYER } from 'telegram/tl/AllTLObjects.js'
import { connectFromEnv, closeClient } from '../src/telegram.ts'

const SCHEMA_LAYER_WITH_WALLET_CARD = 234 // newest layer checked; the field was added somewhere after 223

async function main(): Promise<void> {
  const target = process.argv[2]
  if (!target) throw new Error('Pass a @username or numeric user id of a chat partner')

  console.log(`GramJS declares MTProto layer ${LAYER}. Current schema with userFull.wallet_card: layer ${SCHEMA_LAYER_WITH_WALLET_CARD}.`)
  const client = await connectFromEnv()
  try {
    await client.getDialogs({ limit: 50 }) // fills the entity cache so numeric ids resolve
    const input = await client.getInputEntity(/^\d+$/.test(target) ? (BigInt(target) as never) : target)
    const res = await client.invoke(new Api.users.GetFullUser({ id: utils.getInputUser(input) }))
    const full = res.fullUser as unknown as Record<string, unknown>
    const walletKeys = Object.keys(full).filter((k) => /wallet|ton/i.test(k))
    console.log(`users.getFullUser OK. UserFull constructor: ${res.fullUser.className}`)
    console.log(`Wallet-related fields in the parsed UserFull: ${walletKeys.length ? walletKeys.join(', ') : 'none'}`)
    if (!walletKeys.length) {
      console.log(
        `Result: with GramJS (layer ${LAYER}) the user-account client CANNOT read the wallet card. ` +
          `It needs a client on layer >= the one that added wallet_card (TDLib 1.8.70 has it as userFullInfo.ton_wallet_card).`,
      )
    }
  } finally {
    await closeClient(client)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`check:wallet-card-mtproto failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
