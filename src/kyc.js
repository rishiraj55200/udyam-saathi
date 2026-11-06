// Smart KYC: identifier validation, mock registry lookups, OCR extraction and cross-document checks.
const crypto = require('crypto');
const { TODAY, gstinRegistry, udyamRegistry } = require('./data');
const { maskGstin, maskUdyam, maskName } = require('./mask');

// ---------- GSTIN ----------
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GST_STATE = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu',
  '36': 'Telangana', '37': 'Andhra Pradesh',
};
// Format: 2-digit state, 10-char PAN (5 letters, 4 digits, 1 letter), entity number, 'Z', checksum.
// The README says the PAN's 4th char is always 'X' in this dataset, so we accept 'X' there (real PANs use C/P/H/F/A/T/B/L/J/G).
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function gstinChecksum(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const prod = GST_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

function validateGstinFormat(g) {
  g = (g || '').toUpperCase().trim();
  if (g.length !== 15) return { ok: false, reason: `GSTIN must be 15 characters (got ${g.length})` };
  if (!GSTIN_RE.test(g)) return { ok: false, reason: 'GSTIN structure is invalid (state code + PAN + entity + Z + checksum)' };
  if (!GST_STATE[g.slice(0, 2)]) return { ok: false, reason: `Unknown state code ${g.slice(0, 2)}` };
  if (gstinChecksum(g.slice(0, 14)) !== g[14]) return { ok: false, reason: 'GSTIN checksum digit does not match - likely a typo' };
  return { ok: true, state: GST_STATE[g.slice(0, 2)], pan: g.slice(2, 12) };
}

// OCR often confuses O/0, I/1, S/5, B/8, Z/2/7. Use the GSTIN's positional grammar + checksum to repair.
const TO_DIGIT = { O: '0', D: '0', Q: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6', T: '7' };
const TO_ALPHA = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G', 7: 'T', 4: 'A' };
function repairGstin(raw) {
  let s = (raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.length !== 15) return null;
  const c = s.split('');
  const digitPos = [0, 1, 7, 8, 9, 10], alphaPos = [2, 3, 4, 5, 6, 11];
  for (const i of digitPos) if (TO_DIGIT[c[i]]) c[i] = TO_DIGIT[c[i]];
  for (const i of alphaPos) if (TO_ALPHA[c[i]]) c[i] = TO_ALPHA[c[i]];
  if (c[13] !== 'Z') c[13] = 'Z';
  const base = c.join('');
  if (validateGstinFormat(base).ok) return base;
  // try swapping the ambiguous checksum / entity chars
  const alts = { 0: 'O', O: '0', 1: 'I', I: '1', 5: 'S', S: '5', 8: 'B', B: '8', 2: 'Z', Z: '2' };
  for (const i of [14, 12]) {
    if (alts[c[i]]) {
      const t = c.slice(); t[i] = alts[c[i]];
      if (validateGstinFormat(t.join('')).ok) return t.join('');
    }
  }
  return base;
}

function lookupGstin(g) {
  g = (g || '').toUpperCase().trim();
  const fmt = validateGstinFormat(g);
  if (!fmt.ok) return { found: false, valid: false, reason: fmt.reason };
  const r = gstinRegistry.get(g);
  if (!r) return { found: false, valid: true, reason: 'Not found in GST registry' };
  return {
    found: true, valid: true, gstin: g, status: r.status, legal_name: r.legal_name, trade_name: r.trade_name,
    constitution: r.constitution, address: r.principal_place_of_business, state: r.state, registration_date: r.registration_date,
  };
}

// ---------- Udyam ----------
const UDYAM_RE = /^UDYAM-([A-Z]{2})-(\d{2})-(\d{7})$/;
const UDYAM_STATE = {};
for (const r of udyamRegistry.values()) UDYAM_STATE[r.udyam_number.slice(6, 8)] = r.state;

function validateUdyamFormat(u) {
  u = (u || '').toUpperCase().trim();
  const m = u.match(UDYAM_RE);
  if (!m) return { ok: false, reason: 'Udyam number must look like UDYAM-XX-00-0000000' };
  if (!UDYAM_STATE[m[1]]) return { ok: false, reason: `Unknown state code ${m[1]}` };
  // README: this dataset always uses district code 00, so we accept it.
  return { ok: true, state: UDYAM_STATE[m[1]] };
}
function lookupUdyam(u) {
  u = (u || '').toUpperCase().trim();
  const fmt = validateUdyamFormat(u);
  if (!fmt.ok) return { found: false, valid: false, reason: fmt.reason };
  const r = udyamRegistry.get(u);
  if (!r) return { found: false, valid: true, reason: 'Not found in Udyam registry' };
  return {
    found: true, valid: true, udyam_number: u, enterprise_name: r.enterprise_name, enterprise_type: r.enterprise_type,
    major_activity: r.major_activity, nic_description: r.nic_description, state: r.state, city: r.city, registration_date: r.date_of_registration,
  };
}

// ---------- OCR ----------
let workerPromise = null;
const ocrCache = new Map();
async function ocr(buffer) {
  const key = crypto.createHash('sha256').update(buffer).digest('hex');
  if (ocrCache.has(key)) return ocrCache.get(key);
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker('eng');
  }
  const worker = await workerPromise;
  const { data } = await worker.recognize(buffer);
  const res = { text: data.text, confidence: data.confidence };
  ocrCache.set(key, res);
  return res;
}

function classify(text) {
  const t = text.toLowerCase();
  if (/udyam/.test(t)) return 'udyam_certificate';
  if (/gst(in)?\b|registration certificate|legal name|constitution/.test(t)) return 'gst_certificate';
  if (/billed to|consumer no|electricity|supply address|units consumed/.test(t)) return 'address_proof';
  if (/signatory|designation|for business|id no/.test(t)) return 'signatory_id';
  return 'unknown';
}

const lines = text => text.split('\n').map(l => l.trim()).filter(Boolean).filter(l => !/SPECIMEN|NOT A VALID|DOCUM/i.test(l));
function after(ls, label) {
  const re = new RegExp('^' + label + '\\s*[:.]?\\s*(.*)$', 'i');
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(re);
    if (m) return { value: m[1].trim(), index: i };
  }
  return null;
}
const DATE_RE = /(20\d{2})[-.](\d{2})[-.](\d{2})/;

function extract(type, text) {
  const ls = lines(text);
  const f = {};
  if (type === 'gst_certificate') {
    const g = after(ls, 'GSTIN');
    f.gstin_raw = g ? g.value : '';
    f.gstin = repairGstin(f.gstin_raw.split(/\s+/)[0]) || '';
    f.legal_name = after(ls, 'Legal name')?.value || '';
    f.trade_name = after(ls, 'Trade name')?.value || '';
    f.constitution = after(ls, 'Constitution')?.value || '';
    const a1 = after(ls, 'Address of principal'), a2 = after(ls, 'place of business');
    f.address = ((a1?.value || '') + (a2?.value || '')).replace(/-{2,}/g, '-');
    f.date_of_liability = (after(ls, 'Date of liability')?.value.match(DATE_RE) || [''])[0];
    const prop = f.legal_name.match(/^(.*?)\s*\(Prop\.\s*(.*?)\)\s*$/i);
    if (prop) { f.proprietor = prop[1].trim(); f.legal_business = prop[2].trim(); }
  } else if (type === 'udyam_certificate') {
    const u = after(ls, 'Udyam reg\\.? number');
    f.udyam_number = (u?.value || '').replace(/\s+/g, '').toUpperCase();
    f.enterprise_name = after(ls, 'Enterprise name')?.value || '';
    f.major_activity = after(ls, 'Major activity')?.value || '';
    f.city = after(ls, 'City')?.value || '';
    f.state = after(ls, 'State')?.value || '';
    f.registration_date = (after(ls, 'Date of registration')?.value.match(DATE_RE) || [''])[0];
  } else if (type === 'address_proof') {
    f.consumer_no = after(ls, 'Consumer no\\.?')?.value || '';
    f.billed_to = after(ls, 'Billed to')?.value || '';
    const a = after(ls, 'Supply address');
    if (a) {
      f.address = a.value;
      const next = ls[a.index + 1] || '';
      if (!/^Bill date/i.test(next)) f.address += next;
    }
    f.bill_date = (after(ls, 'Bill date')?.value.match(DATE_RE) || [''])[0];
  } else if (type === 'signatory_id') {
    const val = label => { const i = ls.findIndex(l => new RegExp('^' + label + '$', 'i').test(l)); return i >= 0 ? ls[i + 1] || '' : ''; };
    f.name = val('Name');
    f.designation = val('Designation');
    f.for_business = val('For business');
    f.id_no = val('ID no\\.?');
    const dates = ls.map(l => l.match(DATE_RE)).filter(Boolean);
    f.valid_till = dates.length ? dates[dates.length - 1][0] : '';
  }
  return f;
}

const REQUIRED = {
  gst_certificate: ['gstin', 'legal_name', 'trade_name', 'address'],
  udyam_certificate: ['udyam_number', 'enterprise_name', 'state'],
  address_proof: ['billed_to', 'address', 'bill_date'],
  signatory_id: ['name', 'designation', 'for_business', 'valid_till'],
};
const DOC_LABEL = { gst_certificate: 'GST certificate', udyam_certificate: 'Udyam certificate', address_proof: 'Address proof (utility bill)', signatory_id: 'Signatory ID' };

async function readDocument(buffer, hintedType) {
  const { text, confidence } = await ocr(buffer);
  const detected = classify(text);
  const type = detected !== 'unknown' ? detected : hintedType || 'unknown';
  const fields = type === 'unknown' ? {} : extract(type, text);
  const missing = (REQUIRED[type] || []).filter(k => !fields[k]);
  // Quality gate: low OCR confidence or unreadable key fields => ask for a clearer photo instead of guessing.
  // (A well-read GSTIN with a bad checksum is NOT a quality problem - it is a typo on the document, handled in validation.)
  const garbled = type === 'gst_certificate' && fields.gstin_raw && (fields.gstin || '').length !== 15;
  const quality = detected === 'unknown' || confidence < 60 || garbled || (missing.length && confidence < 85) ? 'poor' : 'good';
  return { type, detected, confidence: Math.round(confidence), quality, fields, missing };
}

// ---------- Cross-document validation ----------
const norm = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Levenshtein ratio
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}
const pin = s => ((s || '').match(/(\d{6})\s*$/) || (s || '').replace(/\s/g, '').match(/(\d{6})$/) || [])[1];
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
function nearestRegistryGstin(g, tradeName) {
  let best = null;
  for (const [k, r] of gstinRegistry) {
    if (k.slice(0, 2) !== g.slice(0, 2)) continue;
    let diff = 0;
    for (let i = 0; i < 15 && diff < 4; i++) if (k[i] !== g[i]) diff++;
    if (diff <= 3 && (!best || diff < best.diff) && (!tradeName || similarity(r.trade_name, tradeName) > 0.8)) best = { gstin: k, trade_name: r.trade_name, diff };
  }
  return best;
}
const AUTHORISED_ROLES = /owner|proprietor|partner|director|designated partner/i;

/**
 * docs: { gst_certificate?, udyam_certificate?, address_proof?, signatory_id? } each = readDocument() result
 * declared: optional { gstin, udyam_number, business_name } typed by the applicant
 */
function validateApplication(docs, declared = {}) {
  const checks = [];
  const add = (id, label, status, detail, doc) => checks.push({ id, label, status, detail, doc });
  const gst = docs.gst_certificate, udy = docs.udyam_certificate, bill = docs.address_proof, sig = docs.signatory_id;

  // 1. Completeness + image quality
  for (const t of ['gst_certificate', 'udyam_certificate', 'address_proof', 'signatory_id']) {
    const d = docs[t];
    if (!d) {
      if (t === 'udyam_certificate') add('doc_' + t, DOC_LABEL[t] + ' uploaded', 'warn', 'No Udyam certificate. Optional, but needed for MSME benefits. We can still proceed with GST + address proof.', t);
      else add('doc_' + t, DOC_LABEL[t] + ' uploaded', 'fail', 'Document missing - please upload it.', t);
      continue;
    }
    if (d.quality === 'poor') add('quality_' + t, DOC_LABEL[t] + ' readable', 'fail', `Image is blurred or unreadable (OCR confidence ${d.confidence}%). Please retake the photo in good light.`, t);
    else if (d.missing.length) add('fields_' + t, DOC_LABEL[t] + ' complete', 'fail', 'Could not find: ' + d.missing.join(', ').replace(/_/g, ' ') + (t === 'udyam_certificate' && d.missing.includes('udyam_number') ? ' - the Udyam registration number is blank on this certificate.' : ''), t);
    else add('quality_' + t, DOC_LABEL[t] + ' readable', 'pass', `Read with ${d.confidence}% confidence`, t);
  }
  const usable = d => d && d.quality === 'good';

  // 2. GSTIN: format + checksum + registry + status + name
  let reg = null;
  if (usable(gst) && gst.fields.gstin) {
    const fmt = validateGstinFormat(gst.fields.gstin);
    if (!fmt.ok) {
      const near = nearestRegistryGstin(gst.fields.gstin, gst.fields.trade_name);
      add('gstin_format', 'GSTIN format & checksum', 'fail', fmt.reason + ` (certificate shows ${maskGstin(gst.fields.gstin) || gst.fields.gstin}).` +
        (near ? ` The GST registry has "${near.trade_name}" under a GSTIN that differs by ${near.diff} character(s) - the certificate looks mis-typed or altered. Please upload the original certificate.` : ''), 'gst_certificate');
    } else {
      add('gstin_format', 'GSTIN format & checksum', 'pass', `${maskGstin(gst.fields.gstin)} - valid structure, state ${fmt.state}`, 'gst_certificate');
      const lk = lookupGstin(gst.fields.gstin);
      if (!lk.found) add('gstin_registry', 'GSTIN found in GST registry', 'fail', 'This GSTIN is not in the GST registry.', 'gst_certificate');
      else {
        reg = lk;
        if (lk.status !== 'Active') add('gstin_status', 'GSTIN is active', 'fail', `GST registry shows status "${lk.status}". Products that need GST cannot be activated.`, 'gst_certificate');
        else add('gstin_status', 'GSTIN is active', 'pass', 'Registry status: Active', 'gst_certificate');
        const s1 = similarity(lk.legal_name, gst.fields.legal_name), s2 = similarity(lk.trade_name, gst.fields.trade_name);
        if (s1 < 0.9 || s2 < 0.9) add('gstin_name', 'Certificate matches GST registry', 'fail', `Registry says "${lk.trade_name}" / "${lk.legal_name}", certificate says "${gst.fields.trade_name}" / "${gst.fields.legal_name}".`, 'gst_certificate');
        else add('gstin_name', 'Certificate matches GST registry', 'pass', 'Legal and trade name match the registry', 'gst_certificate');
        if (pin(lk.address) && pin(gst.fields.address) && pin(lk.address) !== pin(gst.fields.address))
          add('gstin_address', 'Certificate address matches registry', 'fail', `Registry PIN ${pin(lk.address)} vs certificate PIN ${pin(gst.fields.address)}`, 'gst_certificate');
      }
      if (declared.gstin && declared.gstin.toUpperCase() !== gst.fields.gstin)
        add('gstin_declared', 'GSTIN matches what you entered', 'fail', 'The GSTIN on the certificate is different from the one entered earlier.', 'gst_certificate');
    }
    // Internal consistency: proprietor's business name inside legal name should equal trade name
    if (gst.fields.legal_business && similarity(gst.fields.legal_business, gst.fields.trade_name) < 0.9)
      add('gst_internal', 'Legal and trade name consistent', 'fail', `Legal name refers to "${gst.fields.legal_business}" but trade name is "${gst.fields.trade_name}".`, 'gst_certificate');
  }

  const bizName = (usable(gst) && gst.fields.trade_name) || (reg && reg.trade_name) || declared.business_name || '';

  // 3. Udyam
  if (usable(udy) && udy.fields.udyam_number) {
    const fmt = validateUdyamFormat(udy.fields.udyam_number);
    if (!fmt.ok) add('udyam_format', 'Udyam number format', 'fail', fmt.reason, 'udyam_certificate');
    else {
      const lk = lookupUdyam(udy.fields.udyam_number);
      if (!lk.found) add('udyam_registry', 'Udyam found in registry', 'fail', 'Udyam number not found in the Udyam registry.', 'udyam_certificate');
      else {
        add('udyam_registry', 'Udyam found in registry', 'pass', `${maskUdyam(lk.udyam_number)} - ${lk.enterprise_type}, ${lk.major_activity}`, 'udyam_certificate');
        if (similarity(lk.enterprise_name, udy.fields.enterprise_name) < 0.9)
          add('udyam_name', 'Udyam certificate matches registry', 'fail', `Registry name "${lk.enterprise_name}" vs certificate "${udy.fields.enterprise_name}"`, 'udyam_certificate');
        if (norm(lk.state) !== norm(udy.fields.state) || norm(lk.city) !== norm(udy.fields.city))
          add('udyam_place', 'Udyam location matches registry', 'fail', `Registry: ${lk.city}, ${lk.state}. Certificate: ${udy.fields.city}, ${udy.fields.state}`, 'udyam_certificate');
        if (lk.major_activity !== udy.fields.major_activity)
          add('udyam_activity', 'Udyam activity matches registry', 'info', `Registry lists ${lk.major_activity} (${lk.nic_description}), certificate prints ${udy.fields.major_activity}. Using the registry value.`, 'udyam_certificate');
      }
    }
    if (bizName && similarity(bizName, udy.fields.enterprise_name) < 0.9)
      add('udyam_vs_gst', 'Udyam name matches GST', 'fail', `"${udy.fields.enterprise_name}" vs GST trade name "${bizName}"`, 'udyam_certificate');
    if (reg && udy.fields.state && norm(reg.state) !== norm(udy.fields.state))
      add('udyam_state_vs_gst', 'Udyam state matches GST', 'fail', `GST: ${reg.state}, Udyam: ${udy.fields.state}`, 'udyam_certificate');
  }

  // 4. Address proof: name, address, recency (<= 90 days before "today")
  if (usable(bill)) {
    if (bizName && similarity(bizName, bill.fields.billed_to) < 0.9)
      add('bill_name', 'Bill is in the business name', 'fail', `Bill is in the name of "${bill.fields.billed_to}", business is "${bizName}".`, 'address_proof');
    else add('bill_name', 'Bill is in the business name', 'pass', bill.fields.billed_to, 'address_proof');
    const refAddr = (usable(gst) && gst.fields.address) || (reg && reg.address);
    if (refAddr) {
      const same = pin(refAddr) === pin(bill.fields.address) && similarity(refAddr, bill.fields.address) > 0.85;
      add('bill_address', 'Bill address matches GST address', same ? 'pass' : 'fail', same ? 'Address and PIN code match' : `GST: "${refAddr}" vs bill: "${bill.fields.address}"`, 'address_proof');
    }
    if (bill.fields.bill_date) {
      const age = daysBetween(new Date(bill.fields.bill_date + 'T00:00:00Z'), TODAY);
      if (age > 90) add('bill_recent', 'Bill is less than 90 days old', 'fail', `Bill dated ${bill.fields.bill_date} is ${age} days old. Please upload a bill from the last 90 days.`, 'address_proof');
      else if (age < 0) add('bill_recent', 'Bill is less than 90 days old', 'fail', `Bill date ${bill.fields.bill_date} is in the future.`, 'address_proof');
      else add('bill_recent', 'Bill is less than 90 days old', 'pass', `${age} days old`, 'address_proof');
    }
  }

  // 5. Signatory: valid, linked to business, authorised
  if (usable(sig)) {
    if (sig.fields.valid_till) {
      const exp = new Date(sig.fields.valid_till + 'T00:00:00Z');
      add('sig_valid', 'Signatory ID not expired', exp >= TODAY ? 'pass' : 'fail', `Valid till ${sig.fields.valid_till}`, 'signatory_id');
    }
    if (bizName && similarity(bizName, sig.fields.for_business) < 0.9)
      add('sig_business', 'Signatory ID is for this business', 'fail', `ID is for "${sig.fields.for_business}", business is "${bizName}".`, 'signatory_id');
    const constitution = (usable(gst) && gst.fields.constitution) || (reg && reg.constitution) || '';
    const proprietor = usable(gst) ? gst.fields.proprietor : null;
    if (/proprietor/i.test(constitution) && proprietor) {
      if (similarity(proprietor, sig.fields.name) >= 0.9) add('sig_authority', 'Signatory is authorised', 'pass', `${maskName(sig.fields.name)} is the proprietor`, 'signatory_id');
      else add('sig_authority', 'Signatory is authorised', 'fail', `For a proprietorship the proprietor (${maskName(proprietor)}) must sign, but the ID belongs to ${maskName(sig.fields.name)}.`, 'signatory_id');
    } else if (AUTHORISED_ROLES.test(sig.fields.designation) && !/owner/i.test(sig.fields.designation) || (/owner/i.test(sig.fields.designation) && !/llp|limited|company/i.test(constitution))) {
      add('sig_authority', 'Signatory is authorised', 'pass', `${sig.fields.designation} of a ${constitution || 'business'}`, 'signatory_id');
    } else {
      add('sig_authority', 'Signatory is authorised', 'warn', `Designation "${sig.fields.designation}" for a ${constitution || 'business'} needs an authorisation letter / board resolution (e-sign it in the next step).`, 'signatory_id');
    }
  }

  const fails = checks.filter(c => c.status === 'fail'), warns = checks.filter(c => c.status === 'warn');
  const decision = fails.length ? 'action_needed' : warns.length ? 'approved_with_notes' : 'approved';
  const gstinActive = !!(reg && reg.status === 'Active' && !fails.some(c => c.id.startsWith('gstin')));
  return {
    decision, gstinActive, gstinStatus: reg ? reg.status : null, checks,
    summary: { pass: checks.filter(c => c.status === 'pass').length, warn: warns.length, fail: fails.length },
    // a cancelled GSTIN can't be fixed by re-uploading - the owner continues without GST-only products instead
    reupload: [...new Set(fails.filter(c => c.id !== 'gstin_status').map(c => c.doc).filter(Boolean))],
  };
}

module.exports = { validateGstinFormat, repairGstin, gstinChecksum, lookupGstin, validateUdyamFormat, lookupUdyam, readDocument, validateApplication, DOC_LABEL };
