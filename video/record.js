// Records the Hindi explainer + live demo video.
// 1) powershell -File video/tts.ps1   (creates video/audio/*.wav)   2) npm start   3) node video/record.js
// Output: video/out/Udyam_Saathi_Demo.mp4
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });
const APP = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scenes = JSON.parse(fs.readFileSync(path.join(DIR, 'script.json'), 'utf8'));
const exe = process.env.BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function audioMs(id) {
  const f = path.join(DIR, 'audio', id + '.wav');
  if (!fs.existsSync(f)) return null;
  return Math.round(parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) * 1000);
}

(async () => {
  // warm the OCR cache so KYC is snappy on camera
  await fetch(APP + '/api/config');
  const s = await (await fetch(APP + '/api/advisor/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"lang":"hi"}' })).json();
  await fetch(APP + '/api/kyc/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s.sessionId, kyc: true }) });
  for (const k of ['K01', 'K03']) await fetch(APP + '/api/kyc/sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s.sessionId, applicant: k }) });

  const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: path.join(require('os').tmpdir(), 'ud-video-' + Date.now()), args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto('file:///' + path.join(DIR, 'stage.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.evaluate(src => (document.getElementById('app').src = src), APP + '/');
  await sleep(1500);
  let f = () => page.frames().find(fr => fr.url().startsWith(APP));
  await f().evaluate(() => { localStorage.setItem('ud_lang', 'en'); location.reload(); });
  await sleep(1500);

  // ---- helpers inside the app frame ----
  const click = sel => f().$eval(sel, e => e.click());
  const chip = v => f().evaluate(v => document.querySelector(`.chip[data-v="${v}"]`)?.click(), v);
  const scroll = (y, smooth = true) => f().evaluate((y, smooth) => window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' }), y, smooth);
  const scrollEl = sel => f().evaluate(sel => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), sel);
  async function typeSlow(text, ms = 55) {
    for (let i = 1; i <= text.length; i++) { await f().$eval('#t', (e, v) => (e.value = v), text.slice(0, i)); await sleep(ms); }
    await f().$eval('#t', e => e.form.requestSubmit());
  }
  const chatBottom = () => f().evaluate(() => document.querySelector('#chat')?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' }));

  const ACTIONS = {
    async advisor() {
      await sleep(1200); await click('#startBtn'); await sleep(1500);
      await typeSlow('जयपुर में मेरा सैलून है, 4 लोग काम करते हैं, एक दुकान, GST है');
      await sleep(3500); await chip('hotspot'); await sleep(3000);
      await chip('pos'); await sleep(600); await chip('whatsapp'); await sleep(600); await chip('wifi'); await sleep(900);
      await click('#doneBtn'); await sleep(2500);
      await f().evaluate(() => { const m = [...document.querySelectorAll('.msg.bot')].pop(); m && m.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    },
    async quote() {
      await f().evaluate(() => document.querySelector('.chip[data-v="__quote"]').click()); await sleep(3000);
      await f().evaluate(() => document.querySelector('[data-t="24"]').click()); await sleep(2500);
      await f().evaluate(() => document.querySelector('[data-t="36"]').click()); await sleep(2500);
      await scroll(520); await sleep(1500);
      await f().evaluate(() => document.querySelector('input[data-id="P15"]')?.click()); await sleep(2000);
      await scroll(1400); await sleep(1500);
    },
    async kyc() {
      await click('#toKyc'); await sleep(1500);
      await scroll(400); await sleep(1800); await scroll(900); await sleep(1500);
      await click('#cK'); await sleep(700); await click('#agree'); await sleep(1500);
      await f().evaluate(() => { const s = document.querySelector('#sample'); s.value = 'K01'; s.dispatchEvent(new Event('change')); });
      await sleep(3500); await scroll(250); await sleep(1500);
      await click('#verify'); await sleep(2000); await scrollEl('#kres'); await sleep(4500);
      await scroll(0, false);
      await f().evaluate(() => { const s = document.querySelector('#sample'); s.value = 'K03'; s.dispatchEvent(new Event('change')); });
      await sleep(3000); await click('#verify'); await sleep(1800); await scrollEl('#kres'); await sleep(1500);
      await f().evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
    },
    async track() {
      await click('#toPay'); await sleep(1200);
      await f().type('#nm', 'Pooja Shah', { delay: 40 }); await f().type('#mb', '9876501234', { delay: 40 }); await f().type('#otp', '123456', { delay: 60 });
      await click('#tc'); await sleep(800); await click('#pay'); await sleep(2500);
      await click('#tr'); await sleep(2200); await click('#adv'); await sleep(1500); await click('#adv'); await sleep(1500);
      await scroll(700); await sleep(1500);
    },
    async backoffice() {
      await f().evaluate(() => sessionStorage.setItem('ud_admin', 'demo'));
      await page.evaluate(src => (document.getElementById('app').src = src), APP + '/admin.html');
      await sleep(4500);
      await f().evaluate(() => document.querySelector('[data-k="leads"]')?.click()); await sleep(3000);
    },
  };

  const recorder = await page.screencast({ path: path.join(OUT, 'raw.webm') });
  const t0 = Date.now();
  const timeline = [];
  for (const sc of scenes) {
    const dur = (audioMs(sc.id) || Math.round(sc.text.length * 75)) + 450; // small breath between scenes
    const start = Date.now() - t0;
    await page.evaluate((id, d, txt) => window.showScene(id, d, txt), sc.id, dur, sc.text);
    const act = ACTIONS[sc.id] ? ACTIONS[sc.id]().catch(e => console.warn(sc.id, 'action error:', e.message)) : Promise.resolve();
    await Promise.all([act, sleep(dur)]);
    timeline.push({ id: sc.id, start, end: Date.now() - t0 });
    console.log(sc.id.padEnd(11), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  await sleep(800);
  await recorder.stop();
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));

  // ---- audio: place each scene's narration at its real start time, then mux ----
  const final = path.join(OUT, 'Udyam_Saathi_Demo.mp4');
  const haveAudio = scenes.every(sc => fs.existsSync(path.join(DIR, 'audio', sc.id + '.wav')));
  const args = ['-y', '-i', path.join(OUT, 'raw.webm')];
  if (haveAudio) {
    scenes.forEach(sc => args.push('-i', path.join(DIR, 'audio', sc.id + '.wav')));
    const delays = timeline.map((t, i) => `[${i + 1}:a]aresample=48000,adelay=${t.start + 350}|${t.start + 350}[a${i}]`).join(';');
    const mix = timeline.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${timeline.length}:normalize=0,volume=1.6[aout]`;
    args.push('-filter_complex', delays + ';' + mix, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', final);
  execFileSync('ffmpeg', args, { stdio: 'ignore' });
  const d = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final]).toString());
  console.log('video:', final, d.toFixed(1) + 's', (fs.statSync(final).size / 1e6).toFixed(1) + ' MB', haveAudio ? 'with voice-over' : 'NO AUDIO (run tts.ps1 first)');
})().catch(e => { console.error(e); process.exit(1); });
