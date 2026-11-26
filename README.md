# Gramsight

**Gramsight checks who you're paying before you pay, without touching your phone.**

An AI wallet assistant for Telegram, on your Even Realities G2 glasses. Like Confirmation of Payee at UK banks, it checks that an address belongs to the person you think it does (the wallet on their own Telegram profile) before any money moves, and it hands out your own addresses safely when someone asks.

- **Give out your address (Flow A):** someone in a Telegram chat asks for your address. The request shows on your glasses, you say "can u send Ada my sol addy", check the confirmation card and tap. The reply goes out from your own Telegram account. The address comes from your owner-only vault, never from the AI.
- **Check before you pay (Flow B):** someone sends you an address. The glasses show a short verdict ("Matches their Telegram wallet", "New address, be careful", "Lookalike of contact Ada") and a one-line reason in plain words. If it is safe and you say "send 1 Gram", one tap sends a real **TON testnet** Gram transfer. A larger payment, or one to a new address, goes to your own wallet app for approval through TON Connect.

Built for the **Heads Up: Even Realities Hackathon** (DoraHacks, 23 to 29 Nov 2026).

> **Testnet only.** The hackathon build pays on TON testnet: hands-free from a testnet-only payer wallet funded from a faucet, or from your own testnet wallet app through TON Connect. It never touches real funds, never holds user funds and gives no financial advice.

## Tracks entered

- **Crypto & DeFi**: Gram Wallet on TON (testnet). Payments go through the hands-free testnet payer or TON Connect to your own wallet.
- **AI Assistants & Work**: OpenRouter (a free model by default; Claude behind a switch). The AI understands natural phrasing and explains warnings in one plain line. It never sees or writes an address.
- **Best Telegram integration** (open to every track): the owner-only vault bot, plus your own Telegram account through TDLib, which reads requests, replies as you, and reads the Gram Wallet card on people's profiles.

The organizers confirmed on 26 Nov that a project may enter two tracks, and that Telegram is fine on top of any track. One flow joins both tracks:
1. An address arrives in a Telegram chat.
2. It is checked against the sender's Telegram profile wallet (Gram Wallet).
3. The AI explains the verdict.
4. You pay on TON testnet.

## From testnet to Gram Wallet on mainnet

Hackathon demos must run on testnet. Gram Wallet, Telegram's built-in wallet, runs on TON, and the organizers confirmed that a TON testnet payment counts as a Gram Wallet integration. This is how each part of the build maps to mainnet:

| | Hackathon build (TON testnet) | Gram Wallet on mainnet |
|---|---|---|
| **Payee** | The address from the chat, checked against the sender's Telegram profile wallet. A TON address is the same account on both networks, so the demo pays the recipient's real Gram Wallet address, on testnet. | The same address and the same check, on mainnet. |
| **Address form** | Shown in testnet form (`0Q…` / `kQ…`) | Shown in mainnet form (`UQ…` / `EQ…`). Both are the same raw `workchain:hash`, which is what Gramsight compares. |
| **Payer and signing** | A testnet-only wallet funded from a faucet. The backend holds its key and signs only after the checker's guards pass and you tap to confirm. | Your own Gram Wallet. Gramsight holds no key: it sends a TON Connect `sendTransaction` request (recipient, amount, comment) to your wallet, and the wallet signs. |
| **Network** | toncenter testnet | TON mainnet |
| **Unchanged** | The checker and its verdicts, the payment guards, the glasses flow, and the rule that the AI never writes an address | Same |

On mainnet, approvals happen in your wallet. The plan follows the rule in [Safety design](#safety-design): small payments to verified addresses, within limits you set once in advance, stay hands-free; anything larger, or to a new address, is approved on your phone.

## Repository layout

| Path | What it is |
|---|---|
| `g2-app/` | The glasses app: a Vite + TypeScript web app that runs in the Even Realities app's WebView and draws on the G2 through the Even Hub SDK. Started from the official `minimal` template. |
| `backend/` | Node + TypeScript backend. Holds every credential, talks to Telegram (bot and user account), runs the address checker, speech-to-text and AI drafting, and signs testnet payments. |
| `.env.example` | Variable names only. Copy to `.env` and fill in. |

## Setup

Requirements: Node.js 20.17+ (or 22.13+), npm, git. Windows, macOS or Linux.

```powershell
# 1. Even Hub tooling (global)
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator

# 2. Dependencies
cd g2-app; npm install; cd ..
cd backend; npm install; cd ..

# 3. Configuration: copy the template, then fill .env in an editor
Copy-Item .env.example .env
```

Fill `.env` yourself in a text editor. Never paste its values into a chat, an issue or a commit.

| Variable | Where it comes from |
|---|---|
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | https://my.telegram.org, "API development tools" |
| `TELEGRAM_TDLIB_DB_KEY` | Generated by `npm run telegram:login` (below). Leave empty. |
| `TELEGRAM_TDLIB_DIR` | Optional. Where TDLib keeps the login database; default `~/.gramsight/tdlib`, outside the repo. |
| `BOT_TOKEN` | @BotFather |
| `BOT_OWNER_TELEGRAM_ID` | Your numeric Telegram user ID. `npm run telegram:login` fills it if empty. |
| `TON_TESTNET_PAYER_MNEMONIC` | Leave empty and run `npm run ton:new-payer` (below). No wallet app needed. |
| `TON_TESTNET_PAYER_WALLET_VERSION` | `v5r1` (default: W5 with the testnet wallet id) or `v4r2` |
| `TON_TESTNET_API_ENDPOINT` | `https://testnet.toncenter.com/api/v2/jsonRPC` (the default when empty) |
| `TON_TESTNET_API_KEY` | toncenter key for testnet (optional, raises rate limits) |
| `STT_API_KEY`, `LLM_API_KEY` | Speech-to-text and LLM providers (chosen later) |

### Log in the Telegram user account

The user-account client is [TDLib](https://core.telegram.org/tdlib) 1.8.70 through `tdl` and `prebuilt-tdlib` (no compiler needed). TDLib is used because it can read the TON wallet card on a Telegram profile (`userFullInfo.ton_wallet_card`) and look up which user owns an address (`getAddressTonWallet`). First check that it loads:

```powershell
cd backend; npm run tdlib:version
```

Then log in. Run this yourself in a terminal: you type the phone number, login code and 2FA password. The login is stored in TDLib's database folder, encrypted with `TELEGRAM_TDLIB_DB_KEY`, and nothing secret is printed.

```powershell
cd backend; npm run telegram:login
```

To end the backend's session later: `npm run telegram:login -- --logout`, or Telegram > Settings > Devices > "Gramsight backend".

### Create and fund the testnet payer wallet

```powershell
cd backend; npm run ton:new-payer
```

This generates a fresh 24-word mnemonic into `.env` (only if it is empty; it never overwrites one and never prints the words) and prints the W5 testnet address to fund. Send that address to @testgiver_ton_bot in Telegram for free test Gram, then check it with `npm run ton:balance`.

> **Never use your real Gram Wallet (the wallet inside Telegram) as the payer.** It is on mainnet and holds real funds. The payer is a separate, testnet-only wallet that exists only for this demo.

### Run the glasses app in the simulator

```powershell
# Terminal 1: dev server
cd g2-app; npm run dev
```

```powershell
# Terminal 2: simulator window pointed at the dev server
evenhub-simulator http://localhost:5173
```

On real glasses: `evenhub qr --url http://<your-lan-ip>:5173`, then scan the QR code in the Even Realities app.

### Run the backend

```powershell
cd backend; npm run dev
```

`npm run dev` starts the HTTP API for the glasses (on `127.0.0.1:8787` only), the Telegram request listener and the vault bot. `npm run bot` starts only the bot. Run one copy of the bot at a time: Telegram rejects a second one. TDLib allows one client per login, so stop `npm run dev` before running the `telegram:*` scripts.

| Setting (in `.env` or the shell) | Effect |
|---|---|
| `GRAMSIGHT_SEND=live` | Really send replies as your Telegram account. **Default is dry-run**, which logs what would be sent. |
| `GRAMSIGHT_DEV=1` | Enables `POST /api/dev/request` and the phone page's "simulate a request" form |
| `GRAMSIGHT_TELEGRAM=off` | Don't start TDLib (UI work with dry-run) |
| `GRAMSIGHT_BOT=off` | Don't start the vault bot in this process |
| `OPENROUTER_API_KEY` | AI through OpenRouter free models. Without it: built-in rules and fixed explanations only. |
| `GRAMSIGHT_AI` | `openrouter` (default with a key), `claude` (paid, needs `ANTHROPIC_API_KEY`) or `off` |
| `GRAMSIGHT_INTENT_MODEL` | Model id(s), comma-separated. The next one is tried when a free model is rate-limited. |
| `GRAMSIGHT_AI_DAILY_LIMIT` | AI requests per day before "AI busy" (default 40; free OpenRouter models allow about 50) |
| `GROQ_API_KEY` | Voice: Groq Whisper speech-to-text (free plan). Without it, type the command on the phone page. |
| `GRAMSIGHT_PAY=live` | Really pay on **TON testnet** from the testnet payer wallet. **Default is dry-run.** |
| `GRAMSIGHT_MAX_PAYMENT_GRAM`, `GRAMSIGHT_DAILY_LIMIT_GRAM` | Hands-free limits: per payment and per rolling 24 hours (default 1 and 3) |
| `GRAMSIGHT_TONCONNECT_MANIFEST_URL` | Turns on the wallet path (TON Connect). Public HTTPS URL of `docs/tonconnect/tonconnect-manifest.json`. |
| `GRAMSIGHT_WALLET_MAX_GRAM` | Max Gram per wallet-approved payment (default 10) |
| `TONAPI_KEY` | Optional tonapi.io key for higher scam-check rate limits |

### AI, voice and your wallet: one-time setup

1. **AI (free):** create a key at openrouter.ai → Keys and set `OPENROUTER_API_KEY`.
   - Free models are sometimes rate-limited upstream. Gramsight then shows a fixed explanation, or "AI busy, try again" for a command its rules didn't understand.
   - It never guesses.
2. **Voice (free plan):** create a key at console.groq.com → API Keys and set `GROQ_API_KEY`.
   - On a request or payable verdict card, **tap to talk**, speak, then tap again (or wait 6 s).
   - Only the short command audio goes to Groq, and nothing is stored.
3. **Your testnet wallet for TON Connect:**
   - Install Tonkeeper and add a **testnet** account (Tonkeeper's docs put it under Add Wallet → developer options).
   - Fund it once from @testgiver_ton_bot.
   - Never use your real Gram Wallet; that is mainnet.
   - Host `docs/tonconnect/tonconnect-manifest.json` over HTTPS. Easiest: make the repo public on GitHub and use the raw URL. Put your user name into the manifest and set `GRAMSIGHT_TONCONNECT_MANIFEST_URL`.
   - Then open the phone page, press **Connect wallet**, and approve in Tonkeeper.

### Flow A on the glasses (someone asks for your address)

1. Someone messages you, for example "can you send me your sol address?". In a group, this only counts when they tag you or reply to you.
2. The glasses show the request card: chat, who asked, what they asked.
3. You say (for now, type on the phone page) "send my Solana address".
4. The confirmation card shows the chat, the label ("Solana main") and the address's start, middle and end.
5. Tap the temple or the R1 ring to send it from your own account. Double-tap cancels.

What code enforces here, and never the AI:
- The address comes from the vault.
- The recipient is the chat on screen.
- The chain must match what was asked for.
- One tap sends exactly once, with no automatic retry.

Proof from the simulator is in [docs/proof/day3-flowA.md](docs/proof/day3-flowA.md).

### The address checker (someone sends you an address)

When an address arrives in a chat, Gramsight checks it in layers and shows one verdict card:

1. **Their Telegram profile wallet.** The Gram Wallet card on the sender's own profile, read by your account (TDLib), with the vault bot as a fallback.
   - **Matches their Telegram wallet** only when a card exists and it is the same address (compared as raw `workchain:hash`).
   - **Not their Telegram wallet** when the card shows a different address.
   - **No wallet on their profile** is neutral and never counts as a match.
2. **Your saved contacts** in the vault (`/contact` in the bot).
3. **Lookalikes.** Same visible start and end as something you trust, but a different address. "Trusted" means your own addresses, your contacts, addresses you have paid before, and the sender's real profile wallet. Only outgoing payments count, because address poisoning arrives as incoming dust.
4. **Scam reports:** tonapi.io `is_scam`, read from mainnet. The address is sent to tonapi for this lookup.

| Verdict | Payment |
|---|---|
| Not a valid address, flagged as scam, lookalike | **Blocked** |
| Not their Telegram wallet, new address, your own address, saved under another person | Needs a spoken "confirm" plus a tap |
| Matches their Telegram wallet, matches saved contact | One tap |

A layer that fails or times out (4 s) is shown as "couldn't check", never as safe. A full check takes about 1.3 s. Try it from the terminal with `npm run check:address -- <address> [--from @username]`. Proof: [docs/proof/day4-checker.md](docs/proof/day4-checker.md).

Only transfers the payer wallet signed count as "paid before". Dust that bounced off the wallet does not count, because that is how address poisoning plants lookalikes.

### Paying from the verdict card (Flow B)

1. On a verdict card that allows payment, say (for now, type) **"send 1 Gram"**. Code reads the amount and the token; the AI and the chat text never do.
2. The payment card shows the recipient, amount, network (TON testnet), the address's start, middle and end, and the verdict.
3. If the verdict needs it (new address, not their Telegram wallet), say **"confirm"** first. Until then, a tap does nothing.
4. **Tap** to pay. The glasses show "Paying…" at once, then "SENT 1 Gram → Ada · tx …". A double-tap cancels before the tap, never after.

Guards enforced in code:
- Blocked verdicts never reach a payment card.
- Only TON addresses can be paid.
- Limits apply per payment and per rolling 24 hours. They are counted from a ledger on disk, so a restart doesn't reset them.
- One tap pays at most once. A failed or unconfirmed payment is reported, never retried.

The payment step is pluggable. Today it is the hands-free testnet payer, or a dry run by default. A TON Connect step, where you approve in your own wallet app for larger payments or new addresses, can plug in without changing the glasses flow. Proof: [docs/proof/day5-payments.md](docs/proof/day5-payments.md).

### The address vault bot

Open your bot in Telegram from the account in `BOT_OWNER_TELEGRAM_ID` and send `/start`. Only that account, in a private chat, can use it.

| Command | What it does |
|---|---|
| `/add <chain> [name] <address>` | Saves a public address as, e.g., "Solana main". The address is checked for that chain (EIP-55, TON and base58/bech32 checksums). |
| `/list` | Shows saved addresses |
| `/remove <chain> [name]` | Removes one |
| `/chains` | Supported chains: ton, ethereum, base, arbitrum, optimism, polygon, bnb, solana, bitcoin, tron |
| `/contact <chain> <name> <address>` | Trusts someone else's address (used by the checker for matches and lookalikes) |
| `/contacts`, `/uncontact <chain> <name>` | Lists or forgets trusted contacts |

- Every change asks you to tap **Confirm** within 2 minutes, and one tap applies exactly one change. A replacement shows the old and new fingerprints.
- Anything that looks like a seed phrase or private key is deleted on sight, with a warning.
- Anyone else who starts the bot gets a short privacy note. The bot records only their user id, so their profile wallet can be checked later.
- The vault file is `~/.gramsight/vault.json`, outside the repo. It holds public addresses only.

### Tests

```powershell
cd backend; npm test
```

These are unit tests for address validation, secret detection, the vault store, and the bot's owner-only confirm flow (run against a fake Bot API).

### Risk checks and manual tests

| Command (in `backend/`) | What it checks |
|---|---|
| `npm run telegram:send-test -- me "text" --send` | Sends one message as you (Saved Messages by default) after you type SEND |

| Command (in `backend/`) | What it checks |
|---|---|
| `npm run tdlib:version` | TDLib loads on this machine (no login) |
| `npm run telegram:login` | TDLib user login; also prints `can_use_ton_wallet` |
| `npm run telegram:read -- <chat>` | Reads the last few messages of one chat (`--list` shows chat ids) |
| `npm run check:wallet-card` | Bot API `getChat` returns `ton_wallet_card` for a user who started the bot (fallback path) |
| `npm run check:wallet-card-user -- <user> [--address <addr>]` | User account reads a chat partner's wallet card and looks up who owns an address |
| `npm run ton:new-payer` | Creates the testnet payer mnemonic in `.env` (if empty) and prints the address to fund |
| `npm run ton:balance` | Derives the testnet payer address and reads its balance |
| `npm run ton:send-test -- <address> <amount>` | Sends a tiny testnet transfer (dry run unless you confirm) |

## Safety design

- **The AI never writes an address.** It only extracts intent (which label, which chat, which recipient). Code fetches the address from the vault and builds both the confirmation card and the outgoing message.
- **Chat text is untrusted input.** Nothing in a message can start an action; every send needs your voice command plus a tap. Real example from build day: 24 seconds after our testnet payer wallet was funded, an unknown account sent it 0.001 test Gram with a comment advertising a Telegram contact for "300 testnet TON". Unsolicited "send here" bait like that is exactly what Gramsight shows as untrusted and never acts on.
- **No keys on the glasses or in the AI.** In this hackathon build the only signing key is a testnet-only payer key held by the backend. The production path keeps signing in the user's own wallet, under limits the user sets once in advance.
- **Owner-only vault.** Only `BOT_OWNER_TELEGRAM_ID` can read or edit stored addresses. Public addresses only, never keys or seed phrases.
- **Payment guards in code:** flagged or lookalike addresses are blocked, new addresses need a second confirmation, per-payment and daily limits, one tap sends exactly one payment.
- **Secrets stay out of the repo and the app.** `.env` is git-ignored and TDLib's login database lives outside the repo, encrypted; the glasses app never sees an API key.
- **Addresses are compared as addresses, not strings.** TON addresses are parsed and compared as raw `workchain:hash`, because the `UQ…`, `EQ…`, `0Q…` and `kQ…` forms of one wallet are the same address.

## What existed before Nov 23

No Gramsight code existed before the build week started on 23 Nov 2026 (working name until then: SafeGlance). Everything in this repo was written during the hackathon, except:

- `g2-app/` started as an unmodified copy of the official [`even-realities/evenhub-templates/minimal`](https://github.com/even-realities/evenhub-templates) template (commit `1f50dec`). Every change after that commit is ours.
- Open-source libraries, used as published:
  - Even Hub SDK, CLI and simulator (`@evenrealities/*`);
  - TDLib 1.8.70 via `tdl` and `prebuilt-tdlib`;
  - TON SDK (`@ton/ton`, `@ton/core`, `@ton/crypto`) and TON Connect (`@tonconnect/sdk`);
  - `@noble/hashes`, `@scure/base`, `@scure/bip39` (checksums, base58/bech32, the BIP39 word list);
  - the Anthropic SDK (`@anthropic-ai/sdk`, only for the optional Claude provider);
  - `qrcode`, `dotenv`, `tsx`, Vite, TypeScript.
- Public APIs:
  - Telegram Bot API and Telegram MTProto API;
  - toncenter (TON testnet) and tonapi.io (scam flags);
  - OpenRouter (AI);
  - Groq (speech-to-text);
  - the TON Connect bridge.
- The 180×180 wallet icon in `docs/tonconnect/` was generated during the hackathon.

## Path to launch in Even Hub

To be written during build week.

## License

To be decided before submission.
