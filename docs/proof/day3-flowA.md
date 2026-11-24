# Day 3 proof: Flow A on the glasses (simulator, 24 Nov 2026)

Setup: backend `npx tsx src/index.ts` with `GRAMSIGHT_SEND=dry-run` (logs instead of sending), `GRAMSIGHT_TELEGRAM=off`, `GRAMSIGHT_DEV=1`, and a scratch vault holding one public test address (`Solana main`). Glasses app on Vite (`/api` proxied to the backend), simulator 0.9.5 with `--automation-port 9898`. Requests were simulated with `POST /api/dev/request`, commands typed with `POST /api/command`, and taps sent as real simulator input (`POST /api/input`).

| File | Card |
|---|---|
| `day3-01-idle.png` | Home: "No address requests. Vault: 1 address" |
| `day3-02-request.png` | Request: "Ada asks (Solana)", the quoted message, "Say: send my Solana address" |
| `day3-03-confirm.png` | Confirmation: "SEND TO Ada · Weekend trip", "Solana main", start/middle/end fingerprint, "Tap: send / Double-tap: cancel" |
| `day3-04-sent.png` | After a simulator tap: "SENT, Solana main → Ada, Weekend trip" |
| `day3-05-wrong-chain.png` | Bo asked for Ethereum and the user said Solana: "They asked for Ethereum, not Solana. Nothing sent." |

What was checked:

- **Tap sends once.** A simulator `click` on the confirmation card reached the app (`[gramsight] input: tap on confirm c-…`). The backend then logged exactly one `[dry-run] would send 62 characters to chat 0` and `sent solana:main`.
- **Double-tap.** It dismissed a request, cleared an error card, and returned to the home card (`input: double-tap on request…`, `…on error…`).
- **Chain safety.** The wrong-chain command produced the error card above, and nothing reached the sender.
- **Fonts.** The G2 font has no ✓ glyph ("SENT ✓" rendered as "SENT"), so cards avoid it. `→`, `·` and `…` render.
- **Phone page.** At 375 px wide it shows the card mirror, the typed command box (which stands in for voice) and the dev simulate form.

Not yet shown: a live send as the user's account (`GRAMSIGHT_SEND=live`), and voice input (waiting on a speech-to-text key).
