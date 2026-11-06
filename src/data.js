// Loads the synthetic data pack once at startup and builds lookup indexes.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DATA_DIR = path.join(__dirname, '..', 'data');
const read = f => parse(fs.readFileSync(path.join(DATA_DIR, f)), { columns: true, skip_empty_lines: true });

// "Today" for every date-based check, as the README instructs.
const TODAY = new Date('2026-07-15T00:00:00Z');

const catalogue = read('product_catalogue.csv').map(p => ({
  id: p.product_id,
  category: p.category,
  name: p.product_name,
  description: p.description,
  unit: p.unit,
  priceMin: +p.price_min_inr_per_month,
  priceMax: +p.price_max_inr_per_month,
  setup: +p.one_time_setup_inr,
  minContract: +p.min_contract_months,
  tiers: p.available_city_tiers.split(';').map(Number),
  minEmployees: +p.min_employees,
  minSites: +p.min_sites,
  requiresGstin: p.requires_gstin === 'Y',
  requiresOneOf: p.requires_one_of ? p.requires_one_of.split('|') : [],
  installDays: +p.typical_install_days,
  segments: p.target_segments.split(';'),
}));
const productById = Object.fromEntries(catalogue.map(p => [p.id, p]));

const gstinRegistry = new Map(read('mock_gstin_registry.csv').map(r => [r.gstin, r]));
const udyamRegistry = new Map(read('mock_udyam_registry.csv').map(r => [r.udyam_number, r]));
const leads = read('smb_leads.csv');

// City -> tier/state, learned from the leads file (all tier 1-2 cities Accel sells in).
const cities = {};
for (const l of leads) cities[l.city.toLowerCase()] = { city: l.city, tier: +l.city_tier, state: l.state };

module.exports = { DATA_DIR, TODAY, catalogue, productById, gstinRegistry, udyamRegistry, leads, cities };
