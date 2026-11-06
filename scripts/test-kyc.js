// Runs Smart KYC over all 12 specimen applicants and prints the decision + failed checks.
const fs = require('fs');
const path = require('path');
const { readDocument, validateApplication } = require('../src/kyc');

(async () => {
  const dir = path.join(__dirname, '..', 'data', 'kyc_documents');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const verbose = process.argv.includes('-v');
  for (let k = 1; k <= 12; k++) {
    const id = 'K' + String(k).padStart(2, '0');
    const docs = {};
    for (const f of files.filter(f => f.startsWith(id))) {
      const d = await readDocument(fs.readFileSync(path.join(dir, f)), f.slice(4, -4));
      docs[d.type] = d;
      if (verbose) console.log('   ', f, d.type, d.quality, d.confidence, JSON.stringify(d.fields));
    }
    const r = validateApplication(docs);
    console.log(`${id}: ${r.decision.padEnd(20)} ${JSON.stringify(r.summary)}`);
    for (const c of r.checks.filter(c => c.status !== 'pass')) console.log(`     [${c.status}] ${c.label}: ${c.detail}`);
  }
  process.exit(0);
})();
