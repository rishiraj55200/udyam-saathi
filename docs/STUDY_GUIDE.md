# Study guide: understand everything in 30 minutes

## 1. The story in one breath
Accel Business loses 93% of small-business leads. There are three reasons:
- **No visit happens:** 827 leads dropped because the owner had no time or sales never scheduled it.
- **The quote fails:** 1,006 leads dropped because it was too costly, too complex or too slow.
- **Paperwork:** 273 leads dropped over missing or mismatched documents.

After purchase, customers chase status 3 times, and heavy chasers churn 5× more.

Our fix is one phone journey:
- an **advisor** replaces the visit
- a **one-screen quote** replaces the PDF
- **Smart KYC** replaces the paper file
- a **tracker** replaces the follow-up calls
- a **back office** sends partners only the leads that need a human

## 2. The numbers you must remember (all from `smb_leads.csv`)
| Fact | Number |
| --- | --- |
| Activation rate | 368 / 5,000 = **7.4%** |
| Biggest stage drop | needs assessed → quote accepted, **44%** pass |
| Lead → live | **17.6 days**, **3** status chases, CAC **₹15,053** |
| CAC per activation by source | field sales **₹24.3k**, partner **₹20.9k**, website **₹6.4k**, inbound **₹5.1k**, referral **₹4.1k** (and referral converts best, 14.8%) |
| GSTIN effect | **9.6%** activation with, **2.0%** without; 29% of leads have no GSTIN |
| Segments | prof offices 11.1% activation, ₹10.7k CAC, ₹6.8k bundle · micro 4.1%, ₹20k CAC, ₹2.5k bundle · multi-site ₹31k bundle, 10.8% churn |
| Chases vs churn | ≤1 chase → 5.9% churn, NPS −3 · >4 chases → 27.9% churn, NPS −63 |
| Propensity model | logistic regression, hold-out AUC **0.71** |

## 3. How each part works (say it like this)

**Advisor (`src/advisor.js`, `src/conversation.js`)**
- It needs 7 facts: business type, city, employees, sites, GST, current internet, needs.
- A rule-based parser pulls as many as it can from one sentence. It knows English, Hindi, Marathi and Tamil words, Devanagari digits and city names.
- If the rules find little, Claude (when a key is set) extracts the facts as strict JSON. Then the advisor asks only what is still missing.
- **The AI never picks products.** `recommend()` builds the bundle from segment logic:
  - **Connectivity per site:** fibre 100, 300 or 1G by size; leased line for factories with 10+ staff.
  - **Mobile lines**, plus need-driven items: POS, WhatsApp, CCTV, email, security, and so on.
- Every item then passes `rules.js`, which checks:
  - city tier
  - minimum employees and sites
  - GSTIN requirement
  - `requires_one_of` dependencies
- Ineligible items are shown with the reason and an alternative. Example: "WhatsApp API needs GSTIN, so use the free WhatsApp Business app now".
- A **budget guard** keeps the core bundle near the segment norm (micro ₹2,500). Everything else becomes an optional add-on.

**Quote (`src/rules.js → quote`)**
- **Price by contract term:** 12 months = top of the catalogue range, 24 = middle, 36 = floor plus 50% off setup. The contract can never be shorter than any product's minimum.
- **GST:** 18% is shown separately.
- **Install ETA:** the slowest product's `typical_install_days`, because installs run in parallel.

**Smart KYC (`src/kyc.js`)**
1. **Consent gate.** Uploads are refused without it.
2. **OCR.** tesseract.js reads the photo, the document type is auto-detected, and fields are extracted by label.
3. **Quality gate.** Low confidence or missing fields means "retake the photo", never a guess (K02, K04).
4. **GSTIN check.**
   - Structure: 2-digit state, PAN, entity, `Z`, checksum. The 4th PAN character `X` is accepted, as the README says.
   - The mod-36 **checksum** catches typos (K06, K10). OCR mistakes like 0/O are repaired by position first.
   - The **registry lookup** gives the status (cancelled/suspended → GST-only products are blocked: K01) and the name match (K07).
5. **Udyam check.** Format `UDYAM-XX-00-0000000`, registry match, and the same name and state as the GST record.
6. **Address proof check.** Same business name, same address and PIN as GST, and **dated within 90 days of 2026-07-15** (K11 is 257 days old).
7. **Signatory check.**
   - The ID must not be expired and must be for this business.
   - A proprietorship must be signed by the proprietor named in the GST legal name.
   - An "Owner" signing for an LLP or Pvt Ltd needs an authorisation letter (K05, K10, K11).
8. **Decision.** Approved / approved with notes / action needed, plus a list of what to re-upload.

**Tracker.**
- The order stores a per-product ETA and 5 stages: placed, KYC, survey, install, live.
- WhatsApp-style updates are sent at each stage.
- Lookup needs the order ID plus the last 4 digits of the mobile.
- The "demo: next step" button stands in for field-force events.

**Back office (`src/propensity.js`)**
- **The model:** logistic regression trained on the 5,000 leads. Features: GSTIN, Udyam, size, spend, segment, tier, source, internet, turnover, role, regional language.
- **Recoverable leads:** dropped leads with a fixable reason, ranked by propensity × segment bundle value × 12.
- **Next best action:**
  - paperwork problem → send the KYC link
  - price problem → send the transparent quote
  - high value → field visit
  - otherwise → partner or inside-sales call, or a WhatsApp nudge
- **Hand-offs:** live hand-offs from "talk to an expert" carry the full profile and quote.

## 4. Likely judge questions and good answers
- **"What if the AI hallucinates a product?"** It can't sell one. The AI only extracts facts. Products come from the rules engine, which enforces every catalogue rule. There are 10 regression scenarios, and the app also runs with no AI at all.
- **"Why professional offices first, not micro?"** Micro is 55% of leads, but CAC (₹20k) is 8× its monthly bundle (₹2.5k). Professional offices convert at 11% and pay back acquisition cost in under 2 months. Micro works only at near-zero touch, so it gets the digital-only path in phase 2.
- **"How is this DPDP compliant?"**
  - consent is granular and versioned, and marketing is off by default
  - purpose-limited use
  - images are never stored and fields are dropped after the order
  - identifiers are masked everywhere and redacted before the AI sees any text
  - erasure is one tap
- **"Won't partners resist?"** They keep commission on digital closes in their PIN codes, receive warm hand-offs with context, and own installation. Field sales focus on multi-site and manufacturers, where the value is.
- **"How did you catch the KYC problems?"** Walk through the checks above. Show K01, K06 and K07 live.
- **"Is OCR reliable?"** On clear photos it reads 91–95%. On blurred photos we refuse to guess and ask for a retake. In production we'd add DigiLocker pulls (verified at the source) and a vision model.
- **"How would this scale to production?"** Swap the mocks for live services: GSTN/Udyam APIs, DigiLocker, an e-sign provider, and the CRM and provisioning systems. Move storage to Postgres with encryption. WhatsApp Business API becomes a channel using the same advisor API.
- **"Why these targets?"** 12% activation means closing roughly half the gap between today (7.4%) and the referral channel (14.8%), which already behaves like a warm, low-friction journey. A CAC of ₹7,500 is a blend of digital (₹4–6k) and field sales for high-value deals only.
- **"Which languages?"** English, Hindi, Marathi and Tamil in the UI. Hindi and Marathi are the top two non-English languages in the leads. With an AI key, free text in any Indian language works. Voice input uses the browser's speech recognition.

## 5. Files to know
- `src/` – server code · `public/` – screens · `scripts/` – tests, analysis, screenshots, deck builder
- `docs/analysis.json` – every number in the deck · `docs/deck/slides.html` – deck source
- `submission/` – the PDF and PPTX to upload
