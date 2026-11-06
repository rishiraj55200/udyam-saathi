// Tiny JSON-file store for orders, consents and hand-offs (a real build would use Postgres with encryption at rest).
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'runtime');
fs.mkdirSync(DIR, { recursive: true });

function load(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8')); } catch { return []; }
}
function save(name, rows) { fs.writeFileSync(path.join(DIR, name + '.json'), JSON.stringify(rows, null, 1)); }

const tables = { orders: load('orders'), consents: load('consents'), handoffs: load('handoffs') };
const all = n => tables[n];
function insert(n, row) { tables[n].push(row); save(n, tables[n]); return row; }
function update(n, pred, patch) {
  const r = tables[n].find(pred);
  if (r) { Object.assign(r, typeof patch === 'function' ? patch(r) : patch); save(n, tables[n]); }
  return r;
}
function remove(n, pred) { const before = tables[n].length; tables[n] = tables[n].filter(r => !pred(r)); save(n, tables[n]); return before - tables[n].length; }

module.exports = { all, insert, update, remove };
