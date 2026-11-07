require('dotenv').config();
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { DATA_DIR, productById, catalogue } = require('./data');
const conversation = require('./conversation');
const advisor = require('./advisor');
const { quote } = require('./rules');
const kyc = require('./kyc');
const store = require('./store');
const propensity = require('./propensity');
const llm = require('./llm');
const { maskGstin, maskUdyam, maskName, maskPhone, safeLog } = require('./mask');

const app = express();
app.use(express.json({ limit: '200kb' }));
// Framing is denied by default (clickjacking protection). VIDEO_MODE=1 relaxes it only for recording the demo video locally.
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...(process.env.VIDEO_MODE === '1' ? {} : { 'X-Frame-Options': 'DENY' }) }); next(); });
app.use(express.static(path.join(__dirname, '..', 'public')));
// Documents are processed in memory and never written to disk (data minimisation). 5 MB cap, images/PDF only.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype)) });

const sessions = new Map(); // sessionId -> advisor + kyc state (in memory; expires after 2 h idle)
const id = (p, n = 6) => p + crypto.randomInt(10 ** (n - 1), 10 ** n);
function getSession(req, res) {
  const s = sessions.get(req.body.sessionId || req.query.sessionId);
  if (!s) { res.status(404).json({ error: 'Session expired - please start again' }); return null; }
  s.touched = Date.now();
  return s;
}
setInterval(() => { for (const [k, s] of sessions) if (Date.now() - s.touched > 2 * 3600e3) sessions.delete(k); }, 600e3).unref();

// ---------------- config ----------------
app.get('/api/config', (req, res) => res.json({ llm: llm.enabled(), model: llm.enabled() ? llm.MODEL : null, today: '2026-07-15', propensityAuc: propensity.testAuc }));
app.get('/api/catalogue', (req, res) => res.json(catalogue));

// ---------------- advisor ----------------
app.post('/api/advisor/start', (req, res) => {
  const lang = ['en', 'hi', 'mr', 'ta'].includes(req.body.lang) ? req.body.lang : 'en';
  const sid = crypto.randomUUID();
  const s = advisor.newSession(lang);
  s.id = sid; s.touched = Date.now(); s.kyc = { docs: {}, consent: null, result: null };
  sessions.set(sid, s);
  const out = conversation.start(s);
  s.messages.push({ role: 'bot', text: out.messages.join('\n') });
  res.json({ sessionId: sid, ...out });
});

app.post('/api/advisor/message', async (req, res) => {
  const s = getSession(req, res); if (!s) return;
  if (req.body.lang && ['en', 'hi', 'mr', 'ta'].includes(req.body.lang)) s.lang = req.body.lang;
  try {
    const out = await conversation.turn(s, { text: req.body.text, value: req.body.value });
    if (out.handoff) {
      const h = createHandoff(s, 'Asked for a human expert');
      out.messages = [require('./i18n').t(s.lang, 'human', { ref: h.ref })];
      out.handoffRef = h.ref;
    }
    s.messages.push({ role: 'bot', text: out.messages.join('\n') });
    res.json({ ...out, profile: publicProfile(s.profile) });
  } catch (e) {
    safeLog('advisor error', e.message);
    res.status(500).json({ error: 'Something went wrong - please try again.' });
  }
});

function publicProfile(p) {
  return { ...p, gstinNumber: p.gstinNumber ? maskGstin(p.gstinNumber) : undefined, legalName: undefined };
}

// ---------------- quote ----------------
app.post('/api/quote', (req, res) => {
  const s = getSession(req, res); if (!s) return;
  if (!s.recommendation) return res.status(400).json({ error: 'No recommendation yet' });
  const items = Array.isArray(req.body.items) ? req.body.items : s.recommendation.items;
  // owner may toggle / change quantities; anything unknown is ignored
  for (const it of items) {
    const line = s.recommendation.items.find(i => i.id === it.id);
    if (line) { line.selected = !!it.selected; line.qty = Math.max(1, Math.min(200, +it.qty || line.qty)); }
  }
  const term = [12, 24, 36].includes(+req.body.term) ? +req.body.term : 12;
  s.term = term;
  const q = quote(s.recommendation.items, s.recommendation.profile, term);
  s.recommendation.quote = q;
  res.json({ quote: q, items: s.recommendation.items, profile: publicProfile(s.profile), segment: s.recommendation.segmentName });
});

// ---------------- mock registry APIs ----------------
app.get('/api/gstin/:gstin', (req, res) => {
  const r = kyc.lookupGstin(req.params.gstin);
  safeLog('GSTIN lookup', req.params.gstin, r.found ? r.status : r.reason);
  res.json(r);
});
app.get('/api/udyam/:udyam', (req, res) => {
  const r = kyc.lookupUdyam(req.params.udyam);
  safeLog('Udyam lookup', req.params.udyam, r.found ? 'found' : r.reason);
  res.json(r);
});

// ---------------- Smart KYC ----------------
const CONSENT_VERSION = 'kyc-consent-v1.2 (2026-07-01)';
app.post('/api/kyc/consent', (req, res) => {
  const s = getSession(req, res); if (!s) return;
  if (!req.body.kyc) return res.status(400).json({ error: 'KYC consent is required to verify your documents' });
  const rec = store.insert('consents', {
    ref: id('CN'), sessionId: s.id, version: CONSENT_VERSION, at: new Date().toISOString(),
    purposes: { kyc_verification: true, service_updates: !!req.body.updates, marketing: !!req.body.marketing },
    channel: 'web', language: s.lang,
  });
  s.kyc.consent = rec;
  res.json({ ok: true, consentRef: rec.ref, version: CONSENT_VERSION });
});

function requireConsent(s, res) {
  if (!s.kyc.consent) { res.status(403).json({ error: 'Please give consent before uploading documents' }); return false; }
  return true;
}
function storeDoc(s, d) {
  // keep only extracted fields - the image itself is dropped right after OCR
  s.kyc.docs[d.type] = d;
  return { type: d.type, label: kyc.DOC_LABEL[d.type] || 'Unknown document', quality: d.quality, confidence: d.confidence, fields: maskFields(d.fields), missing: d.missing };
}
function maskFields(f) {
  const o = { ...f };
  if (o.gstin) o.gstin = maskGstin(o.gstin);
  delete o.gstin_raw;
  if (o.udyam_number) o.udyam_number = maskUdyam(o.udyam_number);
  if (o.id_no) o.id_no = o.id_no.replace(/\d(?=\d{2})/g, 'X');
  if (o.consumer_no) o.consumer_no = 'XXXXXX' + o.consumer_no.slice(-4);
  return o;
}

app.post('/api/kyc/document', upload.single('file'), async (req, res) => {
  const s = getSession(req, res); if (!s) return;
  if (!requireConsent(s, res)) return;
  if (!req.file) return res.status(400).json({ error: 'Please attach an image (JPG/PNG, max 5 MB)' });
  try {
    const d = await kyc.readDocument(req.file.buffer, req.body.docType);
    req.file.buffer = null;
    res.json(storeDoc(s, d));
  } catch (e) { safeLog('ocr error', e.message); res.status(500).json({ error: 'Could not read the document' }); }
});

// Demo helper: load one of the 12 specimen applicants (K01-K12) instead of uploading from a phone.
app.get('/api/kyc/samples', (req, res) => res.json(Array.from({ length: 12 }, (_, i) => 'K' + String(i + 1).padStart(2, '0'))));
app.post('/api/kyc/sample', async (req, res) => {
  const s = getSession(req, res); if (!s) return;
  if (!requireConsent(s, res)) return;
  const k = String(req.body.applicant || '').toUpperCase();
  if (!/^K(0[1-9]|1[0-2])$/.test(k)) return res.status(400).json({ error: 'Unknown sample' });
  const dir = path.join(DATA_DIR, 'kyc_documents');
  s.kyc.docs = {};
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.startsWith(k + '_'))) {
    const d = await kyc.readDocument(fs.readFileSync(path.join(dir, f)), f.slice(4, -4));
    out.push({ file: f, ...storeDoc(s, d) });
  }
  res.json({ applicant: k, documents: out });
});
app.get('/api/kyc/sample-image/:file', (req, res) => {
  const f = req.params.file;
  if (!/^K(0[1-9]|1[0-2])_[a-z_]+\.png$/.test(f)) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, 'kyc_documents', f));
});

app.post('/api/kyc/validate', (req, res) => {
  const s = getSession(req, res); if (!s) return;
  if (!requireConsent(s, res)) return;
  const r = kyc.validateApplication(s.kyc.docs, { gstin: s.profile.gstinNumber, business_name: s.profile.tradeName });
  s.kyc.result = r;
  // GST status from the documents feeds back into eligibility: GST-only products get blocked if GSTIN is not active
  if (s.recommendation) {
    // registry says cancelled/suspended => GST-only products are blocked; other GST problems (blur, typo, name) just need a re-upload
    const g = r.gstinActive ? 'verified' : r.gstinStatus && r.gstinStatus !== 'Active' ? 'inactive' : s.recommendation.profile.gstin;
    s.recommendation.profile.gstin = g;
    s.recommendation.quote = quote(s.recommendation.items, s.recommendation.profile, s.term || 12);
  }
  res.json({ ...r, quote: s.recommendation?.quote });
});

// Right to erasure: delete everything collected in this session
app.delete('/api/kyc/:sessionId', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (s) { s.kyc = { docs: {}, consent: null, result: null }; }
  const n = store.remove('consents', c => c.sessionId === req.params.sessionId);
  res.json({ ok: true, deleted: { documents: true, consents: n } });
});

// ---------------- orders + tracker ----------------
const STAGES = [
  { key: 'placed', en: 'Order placed', hi: 'ऑर्डर हो गया', mr: 'ऑर्डर झाली', ta: 'ஆர்டர் செய்யப்பட்டது' },
  { key: 'kyc', en: 'KYC verified', hi: 'KYC सत्यापित', mr: 'KYC तपासले', ta: 'KYC சரிபார்க்கப்பட்டது' },
  { key: 'survey', en: 'Site survey', hi: 'साइट सर्वे', mr: 'साइट सर्वे', ta: 'இட ஆய்வு' },
  { key: 'install', en: 'Installation', hi: 'इंस्टॉलेशन', mr: 'इन्स्टॉलेशन', ta: 'நிறுவல்' },
  { key: 'active', en: 'Services live', hi: 'सेवाएँ चालू', mr: 'सेवा सुरू', ta: 'சேவைகள் இயங்குகின்றன' },
];
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400e3).toISOString();

app.post('/api/orders', (req, res) => {
  const s = getSession(req, res); if (!s) return;
  if (!s.recommendation) return res.status(400).json({ error: 'No quote yet' });
  const k = s.kyc.result;
  if (!k || k.decision === 'action_needed') return res.status(400).json({ error: 'Please complete KYC first' });
  if (!req.body.esign) return res.status(400).json({ error: 'Please e-sign the order form' });
  const mobile = String(req.body.mobile || '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  const q = quote(s.recommendation.items, s.recommendation.profile, s.term || 12);
  if (q.blocked.length) return res.status(400).json({ error: 'Some items cannot be activated: ' + q.blocked.map(b => b.name).join(', ') });
  const now = new Date().toISOString();
  const d = q.installDays;
  // per-product install plan: each product has its own typical_install_days
  const products = q.items.filter(i => i.ok).map(i => ({ id: i.id, name: i.name, qty: i.qty, eta: addDays(now, i.installDays), installDays: i.installDays, status: 'scheduled' }));
  const verifiedName = s.kyc.docs.gst_certificate?.fields?.trade_name || s.kyc.docs.address_proof?.fields?.billed_to;
  const order = store.insert('orders', {
    id: id('UD'), createdAt: now, lang: s.lang, business: verifiedName || s.profile.tradeName || s.profile.businessType, city: s.profile.city,
    segment: s.recommendation.segmentName, mobileHash: crypto.createHash('sha256').update(mobile).digest('hex'), mobileLast4: mobile.slice(-4),
    contactName: maskName(req.body.name || ''), items: products, monthly: q.monthly, oneTime: q.oneTime, contract: q.contract, term: q.term,
    kycDecision: k.decision, consentRef: s.kyc.consent.ref, stageIndex: 1,
    timeline: [
      { key: 'placed', at: now, done: true }, { key: 'kyc', at: now, done: true },
      { key: 'survey', at: addDays(now, 1), done: false, note: 'Technician visit slot: 10:00-12:00' },
      { key: 'install', at: addDays(now, Math.max(1, d - 1)), done: false }, { key: 'active', at: addDays(now, d), done: false },
    ],
    notifications: [{ at: now, channel: 'WhatsApp', text: 'Order confirmed. Track it any time - no need to call.' }],
  });
  // KYC documents are no longer needed once the order is verified: drop extracted fields from memory
  s.kyc.docs = {};
  safeLog('order created', order.id, 'mobile', mobile);
  res.json({ orderId: order.id, eta: order.timeline[4].at });
});

function publicOrder(o, lang = 'en') {
  return {
    id: o.id, createdAt: o.createdAt, business: o.business, city: o.city, monthly: o.monthly, oneTime: o.oneTime, contract: o.contract,
    items: o.items, stageIndex: o.stageIndex, notifications: o.notifications,
    timeline: o.timeline.map(t => ({ ...t, label: (STAGES.find(s => s.key === t.key) || {})[lang] || t.key })),
  };
}
app.get('/api/orders/:id', (req, res) => {
  const o = store.all('orders').find(o => o.id === req.params.id.toUpperCase());
  // tracker is protected by the last 4 digits of the registered mobile
  if (!o || String(req.query.last4 || '') !== o.mobileLast4) return res.status(404).json({ error: 'Order not found. Check the order ID and the last 4 digits of your mobile.' });
  res.json(publicOrder(o, req.query.lang));
});
// Demo control: move the order to the next stage (in production this comes from the field-force / network systems)
app.post('/api/orders/:id/advance', (req, res) => {
  const o = store.update('orders', o => o.id === req.params.id.toUpperCase(), o => {
    const i = o.timeline.findIndex(t => !t.done);
    if (i < 0) return {};
    o.timeline[i].done = true; o.timeline[i].at = new Date().toISOString();
    const msg = { survey: 'Technician completed the site survey - fibre is feasible.', install: 'Installation done. Router and devices are set up.', active: 'All services are live. Welcome to Accel Business! One bill, one support number: 121.' }[o.timeline[i].key];
    o.notifications.push({ at: new Date().toISOString(), channel: 'WhatsApp', text: msg });
    if (o.timeline[i].key === 'active') o.items.forEach(it => (it.status = 'live'));
    if (o.timeline[i].key === 'install') o.items.forEach(it => (it.status = it.installDays <= 1 ? 'live' : 'installing'));
    return { stageIndex: i + 1 };
  });
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json(publicOrder(o, req.query.lang));
});

// ---------------- hand-off to humans ----------------
function createHandoff(s, reason) {
  const rec = s.recommendation;
  return store.insert('handoffs', {
    ref: id('HO'), at: new Date().toISOString(), reason, lang: s.lang, businessType: s.profile.businessType, city: s.profile.city,
    segment: rec?.segmentName || advisor.SEG_NAME[advisor.effectiveSegment(s.profile)], employees: s.profile.employees, sites: s.profile.sites,
    gstin: s.profile.gstin || 'unknown', quoteMonthly: rec?.quote?.monthly || null, propensity: propensity.scoreProfile({ ...s.profile, lang: s.lang, segment: advisor.effectiveSegment(s.profile) }),
    lastStep: s.kyc?.result ? 'KYC: ' + s.kyc.result.decision : rec ? 'Quote shown' : 'Discovery', owner: null,
  });
}
app.post('/api/handoff', (req, res) => {
  const s = getSession(req, res); if (!s) return;
  const h = createHandoff(s, String(req.body.reason || 'Needs help').slice(0, 120));
  res.json({ ref: h.ref });
});

// ---------------- back office (sales / partners) ----------------
const ADMIN_KEY = process.env.ADMIN_KEY || 'demo';
app.use('/api/admin', (req, res, next) => (req.get('x-admin-key') === ADMIN_KEY ? next() : res.status(401).json({ error: 'Back-office login required' })));
app.get('/api/admin/summary', (req, res) => {
  const orders = store.all('orders');
  res.json({
    model: { auc: propensity.testAuc, drivers: propensity.drivers },
    live: { orders: orders.length, monthlyValue: orders.reduce((s, o) => s + o.monthly, 0), handoffs: store.all('handoffs').length, consents: store.all('consents').length },
    analysis: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'analysis.json'), 'utf8')),
  });
});
app.get('/api/admin/handoffs', (req, res) => res.json(store.all('handoffs').slice().reverse()));
app.get('/api/admin/leads', (req, res) => res.json(propensity.backOfficeLeads({ limit: Math.min(200, +req.query.limit || 50), segment: req.query.segment })));
app.get('/api/admin/orders', (req, res) => res.json(store.all('orders').slice().reverse().map(o => ({ id: o.id, business: o.business, city: o.city, monthly: o.monthly, stage: o.timeline.filter(t => t.done).length, createdAt: o.createdAt, mobile: maskPhone(o.mobileLast4) }))));
app.post('/api/admin/handoffs/:ref/claim', (req, res) => {
  const h = store.update('handoffs', h => h.ref === req.params.ref, { owner: String(req.body.owner || 'Partner').slice(0, 40), claimedAt: new Date().toISOString() });
  res.json(h || { error: 'not found' });
});

const PORT = +process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log(`Udyam Digital running on http://localhost:${PORT}  (AI advisor: ${llm.enabled() ? llm.MODEL : 'rule-based mode, no API key'}; propensity AUC ${propensity.testAuc})`));
module.exports = app;
