// Dev helper: OCR every KYC specimen and dump raw text to data/ocr_cache.json
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

(async () => {
  const dir = path.join(__dirname, '..', 'data', 'kyc_documents');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  const worker = await createWorker('eng');
  const out = {};
  for (const f of files) {
    const { data } = await worker.recognize(path.join(dir, f));
    out[f] = data.text;
    process.stdout.write('.');
  }
  await worker.terminate();
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'ocr_cache.json'), JSON.stringify(out, null, 1));
  console.log('\ndone', files.length);
})();
