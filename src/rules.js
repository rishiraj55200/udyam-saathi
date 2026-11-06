// Catalogue rules engine: eligibility, dependencies and transparent pricing.
// This is the single source of truth - the AI advisor can suggest, but only this module decides what is sellable.
const { productById } = require('./data');

/**
 * profile: { tier: 1|2, employees: n, sites: n, gstin: 'verified'|'declared'|'none'|'inactive' }
 * returns { ok, reasons[] } for one product
 */
function eligibility(product, profile) {
  const reasons = [];
  if (profile.tier && !product.tiers.includes(profile.tier)) reasons.push(`only sold in tier ${product.tiers.join('/')} cities`);
  if ((profile.employees || 1) < product.minEmployees) reasons.push(`needs at least ${product.minEmployees} employees`);
  if ((profile.sites || 1) < product.minSites) reasons.push(`needs at least ${product.minSites} sites`);
  if (product.requiresGstin && !['verified', 'declared'].includes(profile.gstin))
    reasons.push(profile.gstin === 'inactive' ? 'needs an active GSTIN (yours is cancelled/suspended)' : 'needs a GST registration (GSTIN)');
  return { ok: reasons.length === 0, reasons };
}

/** Check every line of a bundle, including requires_one_of dependencies on the other lines. */
function validateBundle(lines, profile) {
  const ids = new Set(lines.filter(l => l.qty > 0).map(l => l.id));
  return lines.map(l => {
    const p = productById[l.id];
    const e = eligibility(p, profile);
    if (p.requiresOneOf.length && !p.requiresOneOf.some(d => ids.has(d)))
      e.reasons.push('works only with ' + p.requiresOneOf.map(d => productById[d].name).join(' or '));
    return { ...l, ok: e.reasons.length === 0, reasons: e.reasons };
  });
}

// Contract term sets where in the catalogue range the price sits: longer commitment => lower price.
const TERMS = { 12: 0, 24: 0.5, 36: 1 };
function unitPrice(p, term) {
  const f = TERMS[term] ?? 0;
  return Math.round((p.priceMax - (p.priceMax - p.priceMin) * f) / 1) ;
}

/**
 * lines: [{ id, qty, selected }]
 * Returns a fully itemised quote: monthly, one-time, GST, contract, install ETA.
 */
function quote(lines, profile, term = 12) {
  const checked = validateBundle(lines.filter(l => l.selected !== false), profile);
  const items = checked.map(l => {
    const p = productById[l.id];
    const price = unitPrice(p, term);
    const setup = term >= 36 ? Math.round(p.setup * 0.5) : p.setup;
    return {
      id: p.id, name: p.name, category: p.category, unit: p.unit, qty: l.qty, unitPrice: price,
      monthly: price * l.qty, setup: setup * l.qty, setupWaived: term >= 36 && p.setup > 0 ? Math.round(p.setup * 0.5) * l.qty : 0,
      minContract: p.minContract, installDays: p.installDays, ok: l.ok, reasons: l.reasons,
    };
  });
  const sellable = items.filter(i => i.ok);
  const monthly = sellable.reduce((s, i) => s + i.monthly, 0);
  const oneTime = sellable.reduce((s, i) => s + i.setup, 0);
  const contract = Math.max(term, ...sellable.map(i => i.minContract), 1);
  const installDays = sellable.length ? Math.max(...sellable.map(i => i.installDays)) : 0;
  const gst = Math.round(monthly * 0.18);
  return {
    term, contract, items, monthly, oneTime, gst, monthlyWithGst: monthly + gst,
    oneTimeWithGst: Math.round(oneTime * 1.18), installDays, blocked: items.filter(i => !i.ok),
  };
}

module.exports = { eligibility, validateBundle, quote, unitPrice, TERMS };
