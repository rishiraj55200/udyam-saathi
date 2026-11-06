// Lead propensity model: logistic regression trained on last quarter's 5,000 leads (target = activated).
// Used by the back office to decide which leads deserve a human call, and who should make it.
const { leads } = require('./data');
const { maskName, maskPhone } = require('./mask');

const CAT = ['lead_source', 'segment', 'city_tier', 'current_internet', 'annual_turnover_band', 'contact_role'];
const LABEL = {
  has_gstin: 'Has GSTIN', has_udyam: 'Has Udyam', regional_lang: 'Prefers a regional language', log_emp: 'Bigger team', log_sites: 'More sites', log_spend: 'Higher current telecom spend',
};
function vocab() {
  const v = {};
  for (const c of CAT) v[c] = [...new Set(leads.map(l => l[c]))].sort();
  return v;
}
const V = vocab();
const featureNames = ['bias', 'has_gstin', 'has_udyam', 'regional_lang', 'log_emp', 'log_sites', 'log_spend', ...CAT.flatMap(c => V[c].slice(1).map(x => `${c}=${x}`))];

function features(l) {
  const f = [1, l.has_gstin === 'Y' ? 1 : 0, l.has_udyam === 'Y' ? 1 : 0, ['English', 'Hindi'].includes(l.preferred_language) ? 0 : 1,
    Math.log1p(+l.employee_count) / 5, Math.log1p(+l.num_sites) / 3, Math.log1p(+l.monthly_telecom_spend_inr) / 10];
  for (const c of CAT) for (const x of V[c].slice(1)) f.push(l[c] === x ? 1 : 0);
  return f;
}
const sigmoid = z => 1 / (1 + Math.exp(-z));

function train(rows, epochs = 300, lr = 0.5, l2 = 1e-3) {
  const X = rows.map(features), y = rows.map(l => (l.outcome === 'Activated' ? 1 : 0));
  const w = new Array(featureNames.length).fill(0);
  for (let e = 0; e < epochs; e++) {
    const g = new Array(w.length).fill(0);
    for (let i = 0; i < X.length; i++) {
      const err = sigmoid(X[i].reduce((s, x, j) => s + x * w[j], 0)) - y[i];
      for (let j = 0; j < w.length; j++) g[j] += err * X[i][j];
    }
    for (let j = 0; j < w.length; j++) w[j] -= lr * (g[j] / X.length + (j ? l2 * w[j] : 0));
  }
  return w;
}
function auc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rank = 0, sumPos = 0, nPos = 0;
  pairs.forEach(([, l], i) => { rank = i + 1; if (l) { sumPos += rank; nPos++; } });
  const nNeg = pairs.length - nPos;
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

// deterministic 80/20 split by lead id
const isTest = l => +l.lead_id.slice(1) % 5 === 0;
const trainRows = leads.filter(l => !isTest(l)), testRows = leads.filter(isTest);
let W = train(trainRows);
const testAuc = auc(testRows.map(l => sigmoid(features(l).reduce((s, x, j) => s + x * W[j], 0))), testRows.map(l => (l.outcome === 'Activated' ? 1 : 0)));
W = train(leads); // final model on all data

const score = l => sigmoid(features(l).reduce((s, x, j) => s + x * W[j], 0));
const drivers = featureNames.map((n, j) => ({ feature: LABEL[n] || n.replace('=', ': '), weight: +W[j].toFixed(2) })).filter(d => d.feature !== 'bias').sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 10);

const avgValue = {};
for (const seg of new Set(leads.map(l => l.segment))) {
  const a = leads.filter(l => l.segment === seg && l.outcome === 'Activated');
  avgValue[seg] = Math.round(a.reduce((s, l) => s + +l.monthly_bundle_value_inr, 0) / a.length);
}

// Drop reasons that a call can fix (vs. dead leads like wrong number)
const RECOVERABLE = new Set(['Owner had no time for a visit', 'Visit not scheduled by sales', 'Quote took too long to arrive', 'Quote too complex to understand', 'Price too high', 'Competitor offered cheaper plan', 'Decided to wait', 'Missing GST or Udyam document', 'Found paperwork too long', 'Authorised signatory not available', 'Document details did not match', 'Unreachable after 3 attempts', 'Installation delayed beyond 21 days', 'First payment failed']);

function nextBestAction(p, value, l) {
  if (/document|paperwork|signatory|GST/i.test(l.drop_reason)) return 'Send Smart KYC link (DigiLocker + e-sign)';
  if (/price|cheaper|complex/i.test(l.drop_reason)) return 'Send advisor link with transparent quote';
  if (p >= 0.12 && value >= 10000) return 'Field sales visit';
  if (p >= 0.08) return l.lead_source === 'Channel partner' ? 'Partner call-back' : 'Inside-sales call';
  return 'WhatsApp nudge to advisor';
}

function backOfficeLeads({ limit = 50, segment } = {}) {
  return leads
    .filter(l => l.outcome === 'Dropped' && RECOVERABLE.has(l.drop_reason) && (!segment || l.segment === segment))
    .map(l => {
      const p = score(l), value = avgValue[l.segment];
      return {
        lead_id: l.lead_id, business: l.business_name, segment: l.segment, city: l.city, language: l.preferred_language,
        contact: maskName(l.contact_name), stage: l.stage_reached, drop_reason: l.drop_reason, source: l.lead_source,
        propensity: +p.toFixed(3), expected_value: Math.round(p * value * 12), action: nextBestAction(p, value, l),
      };
    })
    .sort((a, b) => b.expected_value - a.expected_value)
    .slice(0, limit);
}

function scoreProfile(profile) {
  // score a live advisor session that did not close, using the same model
  const fake = {
    has_gstin: profile.gstin === 'verified' || profile.gstin === 'declared' ? 'Y' : 'N', has_udyam: 'N', preferred_language: { en: 'English', hi: 'Hindi', mr: 'Marathi', ta: 'Tamil' }[profile.lang] || 'English',
    employee_count: profile.employees || 1, num_sites: profile.sites || 1, monthly_telecom_spend_inr: 2000,
    lead_source: 'Website form', segment: { micro: 'Micro retail & services', prof: 'Professional offices', multi: 'Small multi-site businesses', mfg: 'Small manufacturers' }[profile.segment] || 'Micro retail & services',
    city_tier: String(profile.tier || 2), current_internet: { hotspot: 'Mobile hotspot', home: 'Home broadband', business: 'Business broadband', leased: 'Leased line', mixed: 'Mixed per site', none: 'None' }[profile.currentInternet] || 'Mobile hotspot',
    annual_turnover_band: '40 lakh - 1.5 cr', contact_role: 'Owner',
  };
  return +score(fake).toFixed(3);
}

module.exports = { score, scoreProfile, backOfficeLeads, drivers, testAuc: +testAuc.toFixed(3), avgValue };
