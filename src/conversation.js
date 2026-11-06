// One advisor turn: understand -> update profile -> ask next question or recommend / edit the bundle.
const A = require('./advisor');
const llm = require('./llm');
const { t } = require('./i18n');
const { productById } = require('./data');
const { eligibility } = require('./rules');

const QUESTION_KEY = { businessType: 'q_businessType', city: 'q_city', employees: 'q_employees', sites: 'q_sites', gstin: 'q_gstin', currentInternet: 'q_currentInternet', needs: 'q_needs' };

function chipValueToUpdates(slot, value) {
  const v = String(value);
  switch (slot) {
    case 'businessType':
      if (v === 'Retail chain') return { businessType: 'Retail chain', segment: 'multi', kind: 'retail', chain: true };
      return A.parseText(v, slot);
    case 'employees': return { employees: +v };
    case 'sites': return { sites: +v };
    case 'gstin': return { gstin: v === 'yes' ? 'declared' : 'none' };
    case 'currentInternet': return { currentInternet: v };
    case 'needs': return { needs: v && v !== '__skip' ? v.split(',').filter(Boolean) : [] };
    case 'tier': return { tier: +v };
    default: return {};
  }
}

function mergeLlm(rule, ai) {
  if (!ai) return rule;
  const out = { ...rule };
  for (const [k, v] of Object.entries(ai)) {
    if (v == null || k === 'intent' || k === 'productId') continue;
    if (k === 'needs') { if (v.length) out.needs = [...new Set([...(rule.needs || []), ...v])]; continue; }
    if (k === 'city' && rule.city) continue;
    if (out[k] == null || rule.guessed) out[k] = v;
  }
  if (ai.businessType && rule.guessed) delete out.guessed;
  return out;
}

function ask(s, slot, prefix = []) {
  s.expecting = slot;
  return { messages: [...prefix, t(s.lang, QUESTION_KEY[slot])], chips: A.chipsFor(slot, s.lang), slot, multi: slot === 'needs' };
}

async function finish(s, prefix = []) {
  s.expecting = null;
  const rec = A.recommend(s.profile, s.lang);
  s.recommendation = rec;
  let msg = A.recommendationMessage(s, rec);
  if (!['en', 'hi', 'mr', 'ta'].includes(s.lang)) msg = (await llm.phrase(msg, s.lang)) || msg;
  return { messages: [...prefix, msg], recommendation: rec, chips: [{ value: '__quote', label: t(s.lang, 'see_quote') }] };
}

async function turn(s, { text, value }) {
  if (text) s.messages.push({ role: 'user', text: String(text).slice(0, 500) });
  const historyLines = s.messages.slice(-6).map(m => `${m.role}: ${m.text}`);

  // ----- after a recommendation: edits -----
  if (s.recommendation && !s.expecting) {
    let intent = text ? A.editIntent(text) : null;
    let ai = null;
    if (!intent && text) {
      ai = await llm.extract(text, null, historyLines);
      if (ai && ['add', 'remove', 'cheaper', 'human'].includes(ai.intent)) intent = { intent: ai.intent, id: ai.productId };
    }
    if (intent?.intent === 'human') return { handoff: true, messages: [] };
    if (intent?.intent === 'cheaper') {
      for (const i of s.recommendation.items) if (!['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'].includes(i.id)) i.selected = false;
      const q = require('./rules').quote(s.recommendation.items, s.recommendation.profile, 12);
      s.recommendation.quote = q;
      return { messages: [t(s.lang, 'cheaper', { monthly: q.monthly.toLocaleString('en-IN') })], recommendation: s.recommendation, chips: [{ value: '__quote', label: t(s.lang, 'see_quote') }] };
    }
    if (intent && (intent.intent === 'add' || intent.intent === 'remove') && productById[intent.id]) {
      const p = productById[intent.id];
      if (intent.intent === 'remove') {
        s.recommendation.items = s.recommendation.items.filter(i => i.id !== p.id);
        return { messages: [t(s.lang, 'removed', { name: p.name })], recommendation: refresh(s), chips: [{ value: '__quote', label: t(s.lang, 'see_quote') }] };
      }
      const e = eligibility(p, s.recommendation.profile);
      if (!e.ok) return { messages: [t(s.lang, 'cannot_add', { name: p.name, reason: e.reasons.join('; ') })], recommendation: s.recommendation };
      const existing = s.recommendation.items.find(i => i.id === p.id);
      if (existing) existing.selected = true;
      else s.recommendation.items.push({ id: p.id, name: p.name, qty: 1, unit: p.unit, selected: true, core: false, why: require('./i18n').why(s.lang, p.id) });
      const rec = refresh(s);
      const blocked = rec.quote.blocked.find(b => b.id === p.id);
      if (blocked) return { messages: [t(s.lang, 'cannot_add', { name: p.name, reason: blocked.reasons.join('; ') })], recommendation: rec };
      return { messages: [t(s.lang, 'added', { name: p.name })], recommendation: rec, chips: [{ value: '__quote', label: t(s.lang, 'see_quote') }] };
    }
    // otherwise treat it as new facts about the business (e.g. "actually we have 12 staff") and re-recommend
    const u = mergeLlm(text ? A.parseText(text, null) : {}, ai);
    const changed = Object.keys(u).filter(k => u[k] != null && k !== 'guessed').length;
    if (changed) { const notes = A.applyUpdates(s, u); return finish(s, notes); }
    return { messages: [t(s.lang, 'fallback')], chips: [{ value: '__quote', label: t(s.lang, 'see_quote') }] };
  }

  // ----- discovery -----
  const slot = s.expecting;
  let u;
  if (value != null && value !== '') u = chipValueToUpdates(slot === 'city' && /^[12]$/.test(String(value)) ? 'tier' : slot, value);
  else {
    const rule = A.parseText(text || '', slot);
    const ruleHits = Object.keys(rule).filter(k => !['guessed', 'kind', 'segment'].includes(k)).length;
    // Ask the LLM when the rules found little - free sentences, other languages, spelling variations.
    const ai = ruleHits < 2 || rule.guessed ? await llm.extract(text || '', slot, historyLines) : null;
    u = mergeLlm(rule, ai);
    if (ai?.intent === 'human' || /talk to|expert|call me|विशेषज्ञ|तज्ञ|நிபுணர்/i.test(text || '')) return { handoff: true, messages: [] };
  }
  if (slot === 'city' && !u.city && !u.tier && text) {
    s.profile.cityText = text.slice(0, 40);
    return { messages: [t(s.lang, 'unknown_city')], chips: [{ value: '1', label: 'Tier 1 (metro)' }, { value: '2', label: 'Tier 2' }], slot: 'city' };
  }
  if (slot === 'city' && u.tier && !u.city) u.city = s.profile.cityText || 'your city';
  const notes = A.applyUpdates(s, u);
  const next = A.missingSlot(s.profile);
  if (next) {
    if (next === slot && !notes.length && !Object.keys(u).length) return ask(s, next, [t(s.lang, 'fallback')]);
    return ask(s, next, notes);
  }
  return finish(s, notes);
}

function refresh(s) {
  const q = require('./rules').quote(s.recommendation.items, s.recommendation.profile, 12);
  s.recommendation.quote = q;
  return s.recommendation;
}

function start(s) {
  s.expecting = 'businessType';
  return { messages: [t(s.lang, 'greet')], chips: A.chipsFor('businessType', s.lang), slot: 'businessType' };
}

module.exports = { turn, start };
