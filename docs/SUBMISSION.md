# DoraHacks submission draft (Heads Up: Even Realities Hackathon)

Draft only. The user reviews and submits it. Facts here must match the README and the demo video.

**Project name:** Gramsight

**One line:** An AI wallet assistant for Telegram on your G2 glasses. It checks who you're paying before you pay, without touching your phone.

**Tracks:** Crypto & DeFi (Gram Wallet on TON, testnet) + AI Assistants & Work (OpenRouter; Claude optional). Also for Best Telegram integration. The organizers confirmed on 26 Nov that two tracks are allowed and that Telegram is fine on top of any track.

## Problem

People share and paste crypto addresses in Telegram chats all day. Two things go wrong:

- **Scams.** Address-poisoning scams send you an address that starts and ends like one you trust, hoping you copy it. We saw it live: 24 seconds after our testnet wallet was funded, an unknown account sent it dust with a "get 300 TON" lure.
- **Mistakes.** Sending the wrong chain's address, or the wrong person's.

Checking all this means unlocking your phone, opening several apps and squinting at 48 characters.

## Who it is for

Telegram users who pay and get paid in crypto: freelancers, traders, friends splitting a bill, communities. They want a quick, trustworthy check at a glance.

## How it works

1. **Someone asks for your address.** The glasses show who asked and what they asked. You say "can u send Ada my sol addy", check the card (chat, "Solana main", the start, middle and end of the address) and tap. Gramsight replies from your own Telegram account. The address comes from your owner-only vault bot; the AI never writes an address.
2. **Someone sends you an address.** Gramsight checks it in layers:
   - the Gram Wallet on the sender's own Telegram profile;
   - your saved contacts;
   - lookalikes of anything you trust, including addresses you've paid;
   - tonapi scam reports.

   The glasses show one verdict ("Matches their Telegram wallet", "Lookalike of contact Ada", "New address, be careful") plus a one-line AI explanation. A blocked address can never be paid.
3. **You pay.** Say "send 1 Gram". A small payment to a verified address goes out with one tap, from a testnet-only payer. A larger payment, a new address, or "not their wallet" goes to your own wallet app through TON Connect: you approve on your phone, and Gramsight holds no key.

Built on: Even Hub SDK (G2), Telegram TDLib and Bot API, TON (W5 wallet, TON Connect, tonapi), OpenRouter, Groq Whisper (speech-to-text).

## Safety

- **No keys on the glasses or in the AI.** The AI only classifies what you said and explains verdicts; it never sees an address.
- **Chat text is untrusted.** Nothing in a message can start an action. Every send needs your voice command plus a tap.
- **Limits in code.**
  - Payments are capped per payment and per day.
  - One tap sends at most once, and nothing is ever retried.
- **Testnet only, no real funds.** On mainnet, payments are approved in your own Gram Wallet through TON Connect.

## Path to launch in Even Hub

TODO (Day 6): Even Hub packaging (.ehpk), pairing the phone with the backend, and a hosted backend.

## Links

- Repo: TODO (public GitHub URL)
- Demo video: TODO (3 minutes or less)
