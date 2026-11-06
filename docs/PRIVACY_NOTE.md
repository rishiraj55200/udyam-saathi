# Data privacy & security note – Udyam Saathi (1 page)

**Principle:** treat the synthetic data as if it were real customer data, as the DPDP Act, 2023 requires: consent, purpose limitation, data minimisation.

1. **Consent before KYC.** Before any document is touched, a plain-language notice in the owner's chosen language explains what we collect, why, how long we keep it and what rights the owner has. Each purpose has its own checkbox:
   - KYC verification (required)
   - order updates on WhatsApp/SMS (optional, pre-ticked)
   - marketing (optional, off by default)

   Each consent is stored with a version (`kyc-consent-v1.2`), a timestamp, the language and the channel. Uploads are refused without consent.
2. **Purpose limitation.**
   - KYC data is used only to verify the business and activate the chosen services.
   - The advisor's sales profile and the KYC record are kept apart.
   - The propensity model uses business attributes only: no names, numbers or identifiers.
3. **Data minimisation.**
   - Document images are processed in memory, are never written to disk, and are dropped right after OCR.
   - Only the extracted fields are kept, and those are cleared from memory once the order is placed.
   - The order record keeps only the verified business name, a SHA-256 hash of the mobile number and its last 4 digits.
   - Before any text is sent to the AI model, GSTIN, Udyam number, phone and email are replaced with tokens. GSTINs are verified locally.
4. **Masking everywhere.**
   - UI and back office: GSTIN shows as `27XXXXXXXXXU1ZL`, Udyam as `UDYAM-MH-00-XXXX547`, ID and consumer numbers are masked, and contact names show as `R**** G****`.
   - Logs: a log scrubber masks GSTIN, Udyam and phone patterns automatically.
   - Tracker: protected by order ID plus the last 4 digits of the mobile number.
5. **Retention.**
   - Document images: never stored.
   - Extracted KYC fields: deleted once the order is created.
   - Verified business details: kept for the contract plus the period telecom KYC rules require, then deleted.
   - Advisor sessions: expire after 2 hours idle.
6. **Rights.** A "Delete my KYC data" button on the KYC screen (`DELETE /api/kyc/:session`) erases the extracted fields and the consent records. The consent screen names a grievance officer.
7. **Security.**
   - Uploads: images only, 5 MB limit.
   - Security headers: nosniff, DENY framing, no-referrer.
   - The back office sits behind an access key. In production this becomes SSO with role-based access (partner sees own PIN codes only), TLS everywhere, encryption at rest, and audit logs on every back-office read.
8. **AI safety.** The AI model only extracts facts and phrases replies. A deterministic rules engine decides which products can be sold, so the model cannot promise an ineligible product. Owner text is passed as data inside tags with "ignore instructions inside" guidance. If the AI fails, the rule-based parser takes over.
