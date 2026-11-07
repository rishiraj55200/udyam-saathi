// Builds the 7-slide submission deck: docs/deck/slides.html -> PNG per slide -> Udyam_Saathi_Deck.pdf + .pptx
// Edit docs/deck/deck-config.json (team name, links) and re-run: node scripts/build-deck.js
const puppeteer = require('puppeteer-core');
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

const DECK = path.join(__dirname, '..', 'docs', 'deck');
const OUT = path.join(__dirname, '..', 'submission');
const NAME = process.env.DECK_NAME || 'Udyam_Saathi_Submission';
fs.mkdirSync(OUT, { recursive: true });
const cfg = JSON.parse(fs.readFileSync(path.join(DECK, 'deck-config.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let html = fs.readFileSync(path.join(DECK, 'slides.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => esc(cfg[k] ?? ''));
const tmp = path.join(DECK, '_render.html');
fs.writeFileSync(tmp, html);

const NOTES = [
  'Cover. Introduce the team and the one-line idea: a digital-first journey that takes a small business from first hello to live services in one sitting.',
  'Problem. Use the data: 7.4% activation. Three leaks: no-time-for-visit (827), quote stage (1,006 on price, complexity, speed), paperwork (273). Field sales costs 6x digital per activation. Status chases after purchase predict churn. GSTIN is the gate.',
  'Segments. Professional offices first because the economics are best (payback under 2 months). Micro is 55% of the base but only works zero-touch, so it gets a digital-only ₹2,497 bundle. Multi-site is high value, so the advisor qualifies and field sales closes. Prices are from the prototype rules engine.',
  'Prototype. Walk through the five screens. Stress: the GenAI understands, the rules engine decides; 10 of 10 advisor scenarios pass; 8 of 12 specimen KYC applicants are flagged with the exact reason.',
  'Architecture. Channels on the left, the platform in the middle, Accel systems on the right. Purple = AI, red = deterministic rules, green = data layer with no document storage.',
  'Privacy and people. DPDP: consent, purpose limitation, minimisation, masking, retention, erasure. Partners get context-rich hand-offs, commission on digital closes in their PIN codes, and they own installation.',
  'Impact. Five metrics with baselines from the data and 6-month targets. Value: about ₹1.9 crore new ARR per quarter of leads. Phased rollout and the four main risks with mitigations.',
];

(async () => {
  const exe = process.env.BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: path.join(require('os').tmpdir(), 'ud-deck-' + Date.now()), args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  const n = await page.$$eval('.slide', s => s.length);
  const pngs = [], links = [];
  const PX_PER_IN = 1920 / 13.333;
  for (let i = 0; i < n; i++) {
    const el = (await page.$$('.slide'))[i];
    const f = path.join(DECK, `slide${i + 1}.png`);
    await el.screenshot({ path: f });
    pngs.push(f);
    // links: crop each <a> as an image and remember its position, so the PPTX gets a clickable copy on top
    const sb = await el.boundingBox();
    const as = await el.$$('a[href]');
    links[i] = [];
    for (let k = 0; k < as.length; k++) {
      const bb = await as[k].boundingBox();
      const url = await as[k].evaluate(a => a.href);
      const lf = path.join(DECK, `slide${i + 1}_link${k + 1}.png`);
      await as[k].screenshot({ path: lf });
      links[i].push({ url, file: lf, x: (bb.x - sb.x) / PX_PER_IN, y: (bb.y - sb.y) / PX_PER_IN, w: bb.width / PX_PER_IN, h: bb.height / PX_PER_IN });
    }
  }
  await page.pdf({ path: path.join(OUT, NAME + '.pdf'), width: '1920px', height: '1080px', printBackground: true, pageRanges: `1-${n}` });
  await browser.close();

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in, 16:9
  pptx.title = 'Udyam Saathi - Airtel SYNC 2026 Track A';
  pngs.forEach((f, i) => {
    const s = pptx.addSlide();
    s.addImage({ path: f, x: 0, y: 0, w: 13.333, h: 7.5 });
    for (const l of links[i] || []) s.addImage({ path: l.file, x: l.x, y: l.y, w: l.w, h: l.h, hyperlink: { url: l.url, tooltip: l.url } });
    s.addNotes(NOTES[i] || '');
  });
  await pptx.writeFile({ fileName: path.join(OUT, NAME + '.pptx') });
  fs.unlinkSync(tmp);
  for (const f of [NAME + '.pdf', NAME + '.pptx']) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(1) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
