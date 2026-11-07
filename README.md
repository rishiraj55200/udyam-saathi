# Udyam Saathi – Project Udyam Digital (Airtel SYNC 2026, Enterprise Track A)

A digital-first acquisition and onboarding journey for small businesses. On a phone, in their own language, an owner can:
discover the right bundle → see one transparent monthly price → finish KYC in minutes → track the order until it is live.

All companies, people and identifiers are fictional ("Accel Telecom / Accel Business"); the data comes from the hackathon pack.

## Run it

```bash
npm install
npm start            # http://localhost:3000   (back office: /admin.html, key "demo")
```

Optional AI mode: copy `.env.example` to `.env` and paste an Anthropic API key. Without a key the advisor runs on its
rule-based multilingual parser – every feature still works.

Tests and tools:

```bash
npm run test:advisor   # 10 advisor scenarios in 4 languages + catalogue rule checks
npm run test:kyc       # Smart KYC over the 12 specimen applicants
npm run analyse        # funnel / driver analysis of smb_leads.csv -> docs/analysis.json
node scripts/screens.js     # end-to-end UI run in headless Chrome, saves docs/screens/*.png
node scripts/build-deck.js  # builds submission/Udyam_Saathi_Submission.pdf + .pptx (edit docs/deck/deck-config.json first)
```

## What is inside

| Module | File | What it does |
| --- | --- | --- |
| Advisor | `src/advisor.js`, `src/conversation.js`, `src/i18n.js` | Understands free text (English, Hinglish, Hindi, Marathi, Tamil), asks only missing questions (max 7), recommends a bundle with a reason per line, handles "add CCTV", "cheaper", "talk to an expert" |
| AI layer | `src/llm.js` | Claude Opus 5.5 (low effort) for fact extraction in any language; identifiers redacted first; falls back to rules on any error |
| Rules engine | `src/rules.js` | City tier, min employees/sites, GSTIN requirement, `requires_one_of` dependencies, term-based pricing, GST, install ETA |
| Smart KYC | `src/kyc.js` | GSTIN format + checksum + OCR repair, GSTIN/Udyam registry lookup, OCR (tesseract.js) field extraction, 14 cross-document checks |
| Orders & tracker | `src/server.js` | Order with per-product ETA, stage timeline, WhatsApp-style updates, tracker locked by order ID + last 4 digits |
| Back office | `public/admin.html`, `src/propensity.js` | Hand-offs the advisor could not close, propensity-ranked recoverable leads, next best action |
| Privacy | `src/mask.js` + design | Consent ledger, masking in UI/logs, no document storage, delete-my-data endpoint |

Submission files are in `submission/`. Presenter material is in `docs/`.
