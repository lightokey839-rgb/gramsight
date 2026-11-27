# Feature requests from building Gramsight

Real gaps we hit during build week (23-29 Nov 2026), for the Even Realities, Telegram and TON teams.

## Telegram

1. **Wallet lookups through the client API.**
   - Our TDLib 1.8.70 account has `can_use_ton_wallet = false`.
   - Both `getAddressTonWallet` and `getUserTonWalletAddresses` return `400 WALLET_UNAVAILABLE`.
   - So an app can't answer "whose Telegram wallet is this address?", which would be the strongest anti-scam signal.
   - We fall back to the `ton_wallet_card` on a sender's profile (`getUserFullInfo`, or the Bot API's `getChat` in private chats).
   - A documented way to request access, or a read-only lookup, would help every wallet-safety app.
2. **Wallet card for groups.** The Bot API only returns `ton_wallet_card` for private chats. In groups, where most address sharing happens, a bot can't check the sender's card.

## TON Connect

3. **Pairing a web wallet from a desktop browser.**
   - Gram Wallet's web version (wallet.ton.org) has no route that accepts a TON Connect link. `connect.gramwallet.io` only hands off to the app or browser extension (`gramwallet-tc://`).
   - So a user whose only wallet is a browser tab can't pair a desktop dApp without installing something.
   - Keeper Web does take the link (`web.keeperwallet.com/ton-connect?…`).
   - A web route, or a "paste a TON Connect link" box, in Gram Wallet web would close the gap.

## Even Hub

4. **Glyphs.** The G2 font has no ✓ (we use plain words). A small set of status symbols would make one-glance cards clearer.
5. **Tap events.** A tap arrives with `eventType` undefined, because CLICK_EVENT is 0 and protobuf omits zero values. That's easy to miss, so it deserves a line in the SDK docs.
