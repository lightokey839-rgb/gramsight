# Gramsight

**Gramsight checks who you're paying before you pay, without touching your phone.**

Hands-free crypto address safety for Even Realities G2 smart glasses, inside Telegram. Like Confirmation of Payee at UK banks, it checks that an address belongs to the person you think it does (the wallet on their own Telegram profile) before any money moves.

- **Give out your address (Flow A):** someone in a Telegram chat asks for your address. The request shows on your glasses, you say "send my Solana address to Ada", check the confirmation card and tap the ring. The reply goes out from your own Telegram account. The address comes from your owner-only vault bot, never from the AI.
- **Check before you pay (Flow B):** someone sends you an address. The glasses show a short verdict ("Matches their Telegram wallet", "New address, be careful", "Looks like a lookalike"). If it is safe and you say "send 10 Gram", one ring tap sends a real **TON testnet** Gram transfer.

Built for the **Heads Up: Even Realities Hackathon** (DoraHacks, 23 to 29 Nov 2026).

> **Testnet only.** The hackathon build pays from a testnet-only payer wallet funded with test Gram from a faucet. It never touches real funds, never holds user funds and gives no financial advice.

## Tracks entered

- **Messaging & News** (Telegram: vault bot + user-account client)
- **Crypto & DeFi** (Gram Wallet on TON testnet; fallback: Hyperliquid testnet `usdSend`)
- Eligible for **Best Telegram integration**

Flow B joins both in one flow: an address arrives in a Telegram chat, is checked against the sender's Telegram profile wallet (Gram Wallet), and is paid on TON testnet.

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
| `TELEGRAM_SESSION` | Written by `npm run telegram:login` (below). Leave empty. |
| `BOT_TOKEN` | @BotFather |
| `BOT_OWNER_TELEGRAM_ID` | Your numeric Telegram user ID |
| `TON_TESTNET_PAYER_MNEMONIC` | A **fresh testnet-only** wallet's 24 words, funded from a TON testnet faucet |
| `TON_TESTNET_PAYER_WALLET_VERSION` | `v5r1` (Tonkeeper W5, default) or `v4r2` |
| `TON_TESTNET_API_ENDPOINT` | `https://testnet.toncenter.com/api/v2/jsonRPC` |
| `TON_TESTNET_API_KEY` | toncenter key for testnet (optional, raises rate limits) |
| `STT_API_KEY`, `LLM_API_KEY` | Speech-to-text and LLM providers (chosen later) |

### Log in the Telegram user account

Run this yourself in a terminal. You type the phone number, login code and 2FA password; the script writes the session straight into `.env` and never prints it.

```powershell
cd backend; npm run telegram:login
```

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

### Day 1 risk checks

| Command (in `backend/`) | What it checks |
|---|---|
| `npm run telegram:login` | GramJS user login, session saved to `.env` |
| `npm run telegram:read -- <chat>` | Reads the last few messages of one chat |
| `npm run check:wallet-card` | Bot API `getChat` returns `ton_wallet_card` for a user who started the bot |
| `npm run check:wallet-card-mtproto -- <user>` | Whether the user-account client can read a chat partner's wallet |
| `npm run ton:balance` | Derives the testnet payer address and reads its balance |
| `npm run ton:send-test -- <address> <amount>` | Sends a tiny testnet transfer (dry run unless you confirm) |

## Safety design

- **The AI never writes an address.** It only extracts intent (which label, which chat, which recipient). Code fetches the address from the vault and builds both the confirmation card and the outgoing message.
- **Chat text is untrusted input.** Nothing in a message can start an action; every send needs your voice command plus a tap.
- **No keys on the glasses or in the AI.** In this hackathon build the only signing key is a testnet-only payer key held by the backend. The production path keeps signing in the user's own wallet, under limits the user sets once in advance.
- **Owner-only vault.** Only `BOT_OWNER_TELEGRAM_ID` can read or edit stored addresses. Public addresses only, never keys or seed phrases.
- **Payment guards in code:** flagged or lookalike addresses are blocked, new addresses need a second confirmation, per-payment and daily limits, one tap sends exactly one payment.
- **Secrets stay out of the repo and the app.** `.env` and Telegram session files are git-ignored; the glasses app never sees an API key.

## What existed before Nov 23

No Gramsight code existed before the build week started on 23 Nov 2026 (working name until then: SafeGlance). Everything in this repo was written during the hackathon, except:

- `g2-app/` started as an unmodified copy of the official [`even-realities/evenhub-templates/minimal`](https://github.com/even-realities/evenhub-templates) template (commit `1f50dec`). Every change after that commit is ours.
- Open-source libraries, used as published: Even Hub SDK, CLI and simulator (`@evenrealities/*`), GramJS (`telegram`), TON SDK (`@ton/ton`, `@ton/core`, `@ton/crypto`), `dotenv`, `tsx`, Vite, TypeScript.
- Public APIs: Telegram Bot API, Telegram MTProto API, toncenter (TON testnet).

## Path to launch in Even Hub

To be written during build week.

## License

To be decided before submission.
