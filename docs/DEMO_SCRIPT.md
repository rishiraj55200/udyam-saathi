# 3-minute demo video script

**Setup before recording**
- Run `npm start`, open http://localhost:3000 in Chrome.
- Press F12 and use the device toolbar to pick a phone size, or just make the window narrow.
- Open http://localhost:3000/admin.html in a second tab.
- Use OBS or the Windows Game Bar (Win + Alt + R) to record. Speak slowly.

| Time | Do this on screen | Say this |
| --- | --- | --- |
| 0:00–0:15 | Home screen | "Only 7.4% of small-business leads become customers today. It takes 17.6 days and three follow-up calls. Udyam Saathi does it in one sitting, on a phone, in the owner's language." |
| 0:15–0:50 | Tap **हिन्दी**, then Start. Type: `जयपुर में मेरा सैलून है, 4 लोग काम करते हैं, एक दुकान, GST है`. Tap **मोबाइल हॉटस्पॉट**. Pick **बिलिंग और UPI** + **WhatsApp**, then tap Done | "One sentence in Hindi and the advisor already knows the business type, city, size and GST status, so it asks just two more questions. Every product it recommends comes with a reason, and the core bundle stays within ₹2,500 because micro businesses are price-sensitive." |
| 0:50–1:05 | Switch language to English, Start again. Type: `Auto parts factory in Ludhiana, 40 workers, 1 site, GST registered`. Answer `leased line`, then Skip | "The AI understands, but a rules engine decides. Ludhiana is tier 2, so 1 Gbps fibre is never offered. A leased line is offered because they have more than 10 staff and an active GSTIN." |
| 1:05–1:30 | Tap **See my quote**. Switch to 24 and then 36 months. Toggle an add-on | "One clear monthly price plus GST. No product codes. Longer contracts lower the price, and the owner switches add-ons on or off and sees the total change live." |
| 1:30–2:15 | Continue → consent screen (scroll, tick KYC) → load demo applicant **K01** → Verify. Then **K06** → Verify. Then **K03** → Verify | "Consent comes first, in plain language, with marketing off by default. Documents are read from a photo and never stored. K01: the GSTIN is cancelled and the Udyam number is blank, and the GST-only products get blocked straight away. K06: the checksum shows the GSTIN was mis-typed. K03: everything matches, approved in seconds." |
| 2:15–2:35 | Continue to sign & pay → name, mobile, OTP 123456, tick → Pay → Track → tap *Demo: next step* twice | "e-Sign with OTP, pay the first month by UPI, and the order is live. The tracker shows every step and every product's ETA, and sends WhatsApp updates, so the owner never needs to call support." |
| 2:35–3:00 | Admin tab → key `demo` → Hand-offs tab → Recoverable leads tab | "The partner back office gets every lead the advisor couldn't close, with full context, plus last quarter's dropped leads ranked by a propensity model and a next best action. Digital adds to the field force instead of replacing it. Thank you." |

Upload the video (YouTube unlisted or Google Drive "anyone with the link"). Put the link in `docs/deck/deck-config.json`, then run `node scripts/build-deck.js`.
