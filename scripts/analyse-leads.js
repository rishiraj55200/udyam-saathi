// Funnel + driver analysis of data/smb_leads.csv. Writes docs/analysis.json and prints a summary.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const rows = parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'smb_leads.csv')), { columns: true });
const STAGES = ['Lead', 'Contacted', 'Needs assessed', 'Quote accepted', 'KYC complete', 'Activated'];
const stageIdx = r => STAGES.indexOf(r.stage_reached);
const act = r => r.outcome === 'Activated';
const num = v => (v === '' ? null : Number(v));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);

function groupBy(key) {
  const g = {};
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key];
    (g[k] = g[k] || []).push(r);
  }
  const out = {};
  for (const [k, rs] of Object.entries(g)) {
    const a = rs.filter(act);
    out[k] = {
      leads: rs.length,
      activated: a.length,
      activation_pct: pct(a.length, rs.length),
      quote_to_act_pct: pct(a.length, rs.filter(r => stageIdx(r) >= 3).length),
      cac_per_activation: a.length ? Math.round(rs.reduce((s, r) => s + num(r.acquisition_cost_inr), 0) / a.length) : null,
      avg_days: a.length ? +mean(a.map(r => num(r.days_lead_to_activation))).toFixed(1) : null,
      avg_bundle: a.length ? Math.round(mean(a.map(r => num(r.monthly_bundle_value_inr)))) : null,
      churn_pct: a.length ? pct(a.filter(r => r.churned_within_6_months === 'Y').length, a.length) : null,
      nps: a.length ? +npsOf(a).toFixed(0) : null,
    };
  }
  return out;
}
function npsOf(a) {
  const s = a.map(r => num(r.nps_score)).filter(x => x !== null);
  return 100 * (s.filter(x => x >= 9).length - s.filter(x => x <= 6).length) / s.length;
}

const A = rows.filter(act);
const funnel = STAGES.map((s, i) => ({ stage: s, count: rows.filter(r => stageIdx(r) >= i).length }));
const dropByStage = {};
for (const r of rows.filter(r => !act(r))) {
  const s = r.stage_reached;
  dropByStage[s] = dropByStage[s] || {};
  dropByStage[s][r.drop_reason] = (dropByStage[s][r.drop_reason] || 0) + 1;
}
const bucket = (v, cuts) => { for (const c of cuts) if (v <= c) return '<=' + c; return '>' + cuts[cuts.length - 1]; };

const productCount = r => r.bundle_products ? r.bundle_products.split(';').length : 0;
const out = {
  total: rows.length,
  activated: A.length,
  funnel,
  overall: {
    avg_days: +mean(A.map(r => num(r.days_lead_to_activation))).toFixed(1),
    avg_calls: +mean(A.map(r => num(r.customer_follow_up_calls))).toFixed(1),
    cac: Math.round(rows.reduce((s, r) => s + num(r.acquisition_cost_inr), 0) / A.length),
    median_bundle: A.map(r => num(r.monthly_bundle_value_inr)).sort((a, b) => a - b)[Math.floor(A.length / 2)],
    churn_pct: pct(A.filter(r => r.churned_within_6_months === 'Y').length, A.length),
    nps: +npsOf(A).toFixed(0),
  },
  by_source: groupBy('lead_source'),
  by_segment: groupBy('segment'),
  by_gstin: groupBy('has_gstin'),
  by_udyam: groupBy('has_udyam'),
  by_tier: groupBy('city_tier'),
  by_language: groupBy('preferred_language'),
  by_lang_match: groupBy(r => (r.preferred_language === 'English' || r.preferred_language === 'Hindi') ? 'English/Hindi' : 'Regional'),
  by_internet: groupBy('current_internet'),
  by_role: groupBy('contact_role'),
  by_turnover: groupBy('annual_turnover_band'),
  by_calls: groupBy(r => act(r) ? 'calls ' + bucket(num(r.customer_follow_up_calls), [1, 2, 3, 4]) : 'n/a'),
  by_days: groupBy(r => act(r) ? 'days ' + bucket(num(r.days_lead_to_activation), [10, 14, 18, 22]) : 'n/a'),
  by_bundle_size: groupBy(r => act(r) ? 'products ' + productCount(r) : 'n/a'),
  by_month: groupBy(r => r.created_date.slice(0, 7)),
  drop_reasons_by_stage: dropByStage,
};
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'analysis.json'), JSON.stringify(out, null, 1));

const show = (t, o) => { console.log('\n## ' + t); for (const [k, v] of Object.entries(o)) console.log(k.padEnd(30), JSON.stringify(v)); };
console.log('funnel', JSON.stringify(funnel), '\noverall', JSON.stringify(out.overall));
for (const k of ['by_source', 'by_segment', 'by_gstin', 'by_udyam', 'by_tier', 'by_language', 'by_lang_match', 'by_internet', 'by_role', 'by_turnover', 'by_calls', 'by_days', 'by_bundle_size', 'by_month']) show(k, out[k]);
show('drops', dropByStage);
