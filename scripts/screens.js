// End-to-end UI run in headless Edge/Chrome at phone size. Captures screenshots to docs/screens/ for the deck.
// Usage: node scripts/screens.js   (server must be running on :3000)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'];
const OUT = path.join(__dirname, '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const exe = process.env.BROWSER || BROWSERS.find(fs.existsSync);
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: path.join(require('os').tmpdir(), 'ud-shots-' + Date.now()), args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const shot = async (name, full = false) => { await wait(400); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full }); console.log('  saved', name); };
  const click = sel => page.$eval(sel, e => e.click());
  const chip = async label => { await page.evaluate(l => [...document.querySelectorAll('.chip')].find(c => c.textContent.trim().startsWith(l)).click(), label); await wait(700); };
  // set the value directly: keyboard typing mangles Tamil/Devanagari combining characters
  const say = async text => { await page.$eval('#t', (e, v) => { e.value = v; e.form.requestSubmit(); }, text); await wait(1200); };

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.setItem('ud_lang', 'en'));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await shot('01_home');

  // Advisor in English: one sentence, then chips
  await click('#startBtn'); await wait(800);
  await say('I run a dental clinic in Pune with 8 staff, one location. We have GST.');
  await chip('Business broadband');
  await page.evaluate(() => ['email', 'security', 'sms', 'backup'].forEach(v => document.querySelector(`.chip[data-v="${v}"]`).click()));
  await click('#doneBtn'); await wait(1200);
  await shot('02_advisor_reco');
  await say('also add CCTV'); await wait(300);
  await shot('03_advisor_edit');

  // Quote
  await chip('See my quote'); await wait(900);
  await page.evaluate(() => document.querySelector('[data-t="24"]').click()); await wait(900);
  await shot('04_quote');
  await shot('04b_quote_full', true);

  // Consent
  await click('#toKyc'); await wait(500);
  await shot('05_consent', true);
  await click('#cK'); await click('#agree'); await wait(800);

  // KYC with a problem applicant (cancelled GSTIN + blank Udyam), then a clean one
  await page.select('#sample', 'K01'); await wait(9000);
  await click('#verify'); await wait(1500);
  await shot('06_kyc_problem', true);
  await page.select('#sample', 'K06'); await wait(9000);
  await click('#verify'); await wait(1500);
  await shot('06b_kyc_typo', true);
  await page.select('#sample', 'K03'); await wait(9000);
  await shot('07_kyc_docs');
  await click('#verify'); await wait(1500);
  await shot('08_kyc_pass', true);

  // Pay
  await click('#toPay'); await wait(500);
  await page.type('#nm', 'Joseph Singh'); await page.type('#mb', '9876501234'); await page.type('#otp', '123456'); await click('#tc');
  await shot('09_pay');
  await click('#pay'); await wait(1500);
  await shot('10_order_done');
  const orderId = await page.$eval('.big-id', e => e.textContent);
  console.log('  order', orderId);

  // Tracker
  await click('#tr'); await wait(1200);
  await click('#adv'); await wait(800);
  await click('#adv'); await wait(800);
  await shot('11_tracker', true);

  // Hindi + Tamil advisor screenshots
  for (const [lang, text, file] of [['hi', 'जयपुर में मेरा सैलून है, 4 लोग काम करते हैं, एक दुकान, GST है', '12_advisor_hindi'], ['ta', 'சென்னையில் என் பல் மருத்துவமனை, 8 பேர் வேலை செய்கிறார்கள், ஒரு கிளை, GST உள்ளது', '13_advisor_tamil']]) {
    await page.evaluate(l => localStorage.setItem('ud_lang', l), lang);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await click('#startBtn'); await wait(800);
    await say(text);
    await page.evaluate(() => document.querySelector('.chip[data-v="hotspot"]').click()); await wait(800);
    await page.evaluate(() => document.querySelector('#skipBtn').click()); await wait(1200);
    await shot(file);
    // hand-off so the back office has a live lead
    await say(lang === 'hi' ? 'विशेषज्ञ से बात करनी है' : 'நிபுணருடன் பேச வேண்டும்');
  }

  // Back office
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1.5 });
  await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle0' });
  await page.type('#key', 'demo'); await page.keyboard.press('Enter'); await wait(1500);
  await shot('14_backoffice_handoffs');
  await page.evaluate(() => document.querySelector('[data-k="leads"]').click()); await wait(1500);
  await shot('15_backoffice_leads');
  await page.evaluate(() => document.querySelector('[data-k="model"]').click()); await wait(1200);
  await shot('16_backoffice_model');
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
