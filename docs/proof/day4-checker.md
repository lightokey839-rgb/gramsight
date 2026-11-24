# Day 4 proof: address checker and verdict cards (24 Nov 2026)

Backend in dry-run with a scratch vault that holds one trusted contact, `ada` (a TON address). Simulator 0.9.5. Each address was handed to Flow B with `POST /api/dev/share`, as if someone had sent it in a private chat, and dismissed with a real simulator double-tap.

| File | Incoming address | Verdict |
|---|---|---|
| `day4-01-lookalike-blocked.png` | A generated lookalike of Ada's address. The first 4 and last 4 readable characters are the same; the middle differs (`ECRWlp` vs `lpaWlp`). | **LOOKALIKE OF CONTACT ADA**, payment blocked |
| `day4-02-saved-contact.png` | Ada's real address | **MATCHES SAVED CONTACT ADA** |
| `day4-03-new-address.png` | The real testnet account that sent the payer 0.001 test Gram of spam on 23 Nov | **NEW ADDRESS, BE CAREFUL** (needs a second confirmation) |
| `day4-04-invalid.png` | That address with one character changed | **NOT A VALID ADDRESS** (TON checksum), payment blocked |

Live checks with `npm run check:address` (read-only):

- **Spam sender** `0QCxEal2…lo58GG`: tonapi has no mainnet scam flag on it, so the verdict is "new address". The scam list catches known mainnet scams; testnet spammers are stopped by the lookalike and new-address guards instead.
- **Faucet** `0QCSES0T…fo2A`: "new address", no scam reports.
- **One-character typo:** "not a valid address" in 9 ms.
- **Speed:** a full check (tonapi plus payer history) took about 1.2 to 1.4 s, well inside the glasses' ~30 s budget.

Not yet shown live: "Matches / Not their Telegram wallet". That needs a chat partner who has a Gram Wallet card on their Telegram profile. Unit tests cover all three profile outcomes, and that they never overlap.
