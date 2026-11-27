# Feature requests from building Gramsight

Real gaps we hit during build week (23-29 Nov 2026).

## 1. Telegram: wallet lookups through the client API

- Our TDLib 1.8.70 account has `can_use_ton_wallet = false`.
- Both `getAddressTonWallet` and `getUserTonWalletAddresses` return `400 WALLET_UNAVAILABLE`.
- So an app can't answer "whose Telegram wallet is this address?", which would be the strongest anti-scam signal.
- We fall back to the `ton_wallet_card` on a sender's profile (`getUserFullInfo`, or the Bot API's `getChat` in private chats).
- A documented way to request access, or a read-only lookup, would help every wallet-safety app.

## 2. Telegram: wallet card in groups

The Bot API only returns `ton_wallet_card` for private chats. In groups, where most address sharing happens, a bot can't check the sender's card.

## 3. TON Connect: pairing a web wallet from a desktop browser

- Gram Wallet's web version (wallet.ton.org) has no route that accepts a TON Connect link. `connect.gramwallet.io` only hands off to the app or browser extension (`gramwallet-tc://`).
- So a user whose only wallet is a browser tab can't pair a desktop dApp without installing something.
- Keeper Web does take the link (`web.keeperwallet.com/ton-connect?…`).
- A web route, or a "paste a TON Connect link" box, in Gram Wallet web would close the gap.

## 4. Even Hub: a background status line for apps that aren't on screen

- Gramsight can't tell you "1 request waiting" unless it is open. For a request inbox, that is the biggest usefulness gap on G2.
- Something minimal would do: a one-line status or badge that an app can set while it is in the background. No pop-ups, and the user opens the app when they choose.

## 5. Even Hub: wallet approval requests on the glasses

- Today a payment above the hands-free limit has to go to the phone (TON Connect).
- A glasses-native approval step would make high-value payments hands-free too, with signing still in the paired wallet:
  - the glasses show the amount, the recipient's fingerprint and the verdict;
  - the user confirms with the ring;
  - the request is then handed to the paired wallet, which signs.
