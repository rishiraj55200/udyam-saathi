// Udyam Digital - owner-facing single page app (no framework, no build step).
const $ = s => document.querySelector(s);
const app = $('#app');
const S = { lang: 'en', sid: null, view: 'home', chat: [], chips: [], multi: false, picked: new Set(), rec: null, quote: null, term: 12, docs: {}, kyc: null, consent: null, order: null, busy: false, config: {} };
try { S.lang = localStorage.getItem('ud_lang') || (navigator.language || '').slice(0, 2); } catch {}
if (!UI[S.lang]) S.lang = 'en';
const u = () => UI[S.lang];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const fmtDate = d => new Date(d).toLocaleDateString(S.lang === 'en' ? 'en-IN' : S.lang + '-IN', { day: 'numeric', month: 'short' });

async function api(path, body, method) {
  const opt = body instanceof FormData ? { method: 'POST', body } : body !== undefined ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method: method || 'GET' };
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

// ---------- shell ----------
const STEP_OF = { home: -1, chat: 0, quote: 1, consent: 2, kyc: 2, pay: 3, done: 4, track: 4 };
function renderSteps() {
  const i = STEP_OF[S.view];
  $('#steps').style.display = i < 0 ? 'none' : 'flex';
  $('#steps').innerHTML = u().steps.map((s, k) => `<span class="${k === i ? 'on' : k < i ? 'done' : ''}">${esc(s)}</span>`).join('');
}
function go(view) { S.view = view; render(); app.focus(); window.scrollTo(0, 0); }
function render() {
  document.documentElement.lang = S.lang;
  $('#lang').value = S.lang;
  renderSteps();
  ({ home: vHome, chat: vChat, quote: vQuote, consent: vConsent, kyc: vKyc, pay: vPay, done: vDone, track: vTrack })[S.view]();
}
$('#lang').onchange = e => setLang(e.target.value);
function setLang(l) { S.lang = l; try { localStorage.setItem('ud_lang', l); } catch {} render(); }
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); } });

// ---------- home ----------
function vHome() {
  app.innerHTML = `
  <section class="hero">
    <h1>${esc(u().tagline)}</h1>
    <p>${esc(u().sub)}</p>
    <div class="langs">${[['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी'], ['ta', 'தமிழ்']].map(([k, n]) => `<button data-l="${k}" class="${S.lang === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <button class="btn block" id="startBtn">${esc(u().start)} →</button>
    <p class="mini" style="text-align:center;margin:10px 0 0">${esc(u().minutes)}</p>
  </section>
  <div class="card">
    ${[['1', 'Advisor', 'Tell us about your business in your language - get the right bundle with a reason for every item.'], ['₹', 'One clear price', 'Monthly price + GST, add-ons you can switch on and off, no hidden codes.'], ['✓', 'KYC in minutes', 'GSTIN & Udyam checked instantly, documents read from a photo.'], ['⟶', 'Live tracker', 'See every step until activation - no need to call support.']]
      .map(([i, h, p]) => `<div class="feature" style="margin:8px 0"><span class="ic">${i}</span><div><b>${h}</b><div class="mini" style="font-size:13px">${p}</div></div></div>`).join('')}
  </div>
  <button class="btn ghost block" data-go="track">${esc(u().track)}</button>`;
  app.querySelectorAll('[data-l]').forEach(b => (b.onclick = () => setLang(b.dataset.l)));
  $('#startBtn').onclick = startAdvisor;
}

// ---------- advisor chat ----------
async function startAdvisor() {
  S.chat = []; S.rec = null; S.docs = {}; S.kyc = null; S.consent = null; S.order = null;
  go('chat');
  S.busy = true; vChat();
  const r = await api('/api/advisor/start', { lang: S.lang });
  S.sid = r.sessionId;
  absorb(r);
}
function absorb(r) {
  S.busy = false;
  for (const m of r.messages || []) S.chat.push({ role: 'bot', text: m });
  S.chips = r.chips || []; S.multi = !!r.multi; S.picked = new Set();
  if (r.recommendation) S.rec = r.recommendation;
  if (r.handoffRef) S.chat.push({ role: 'note', text: 'Ref ' + r.handoffRef });
  vChat();
  if (S.speak && r.messages?.length) speak(r.messages[r.messages.length - 1]);
}
async function send(text, value, label) {
  if (S.busy) return;
  if (value === '__quote') return openQuote();
  S.chat.push({ role: 'me', text: label || text });
  S.busy = true; S.chips = []; vChat();
  try { absorb(await api('/api/advisor/message', { sessionId: S.sid, text, value, lang: S.lang })); }
  catch (e) { S.busy = false; S.chat.push({ role: 'note', text: e.message }); vChat(); }
}
function vChat() {
  if (S.view !== 'chat') return;
  const chips = S.chips.map(c => `<button class="chip ${c.value === '__quote' ? 'primary' : ''} ${S.picked.has(c.value) ? 'on' : ''}" data-v="${esc(c.value)}">${esc(c.label)}</button>`).join('');
  app.innerHTML = `<div class="chat" id="chat">
    ${S.chat.map(m => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}
    ${S.busy ? '<div class="typing"><span class="spinner"></span> …</div>' : ''}
  </div>
  <div class="composer">
    <div class="chips">${chips}${S.multi ? `<button class="chip primary" id="doneBtn">${esc(u().done)} ✓</button><button class="chip" id="skipBtn">${esc(u().skip)}</button>` : ''}${S.rec ? `<button class="chip" id="expertBtn">${esc(u().expert)}</button>` : ''}</div>
    <form class="row" id="f"><input type="text" id="t" placeholder="${esc(u().type)}" autocomplete="off" aria-label="${esc(u().type)}">
      <button type="button" class="iconbtn" id="mic" title="Speak" aria-label="Speak">🎤</button>
      <button type="button" class="iconbtn ${S.speak ? 'on' : ''}" id="spk" title="Read replies aloud" aria-label="Read replies aloud">${S.speak ? '🔊' : '🔈'}</button>
      <button class="btn" style="padding:12px 14px">${esc(u().send)}</button></form>
  </div>`;
  const chat = $('#chat'); chat.lastElementChild?.scrollIntoView({ block: 'end' });
  $('#f').onsubmit = e => { e.preventDefault(); const v = $('#t').value.trim(); if (v) send(v); };
  app.querySelectorAll('.chip[data-v]').forEach(b => (b.onclick = () => {
    const v = b.dataset.v;
    if (S.multi) { S.picked.has(v) ? S.picked.delete(v) : S.picked.add(v); b.classList.toggle('on'); return; }
    send(null, v, b.textContent);
  }));
  if ($('#doneBtn')) $('#doneBtn').onclick = () => { const v = [...S.picked]; const labels = S.chips.filter(c => S.picked.has(c.value)).map(c => c.label).join(', '); send(null, v.length ? v.join(',') : '__skip', labels || u().skip); };
  if ($('#skipBtn')) $('#skipBtn').onclick = () => send(null, '__skip', u().skip);
  if ($('#expertBtn')) $('#expertBtn').onclick = () => send('talk to an expert');
  $('#mic').onclick = listen;
  $('#spk').onclick = () => { S.speak = !S.speak; vChat(); };
  if (!S.busy) $('#t').focus({ preventScroll: true });
}
// Voice: browser speech recognition + synthesis in the chosen Indian language
const VOICE = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN' };
function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { S.chat.push({ role: 'note', text: 'Voice input needs Chrome or Edge.' }); return vChat(); }
  const r = new SR(); r.lang = VOICE[S.lang]; r.interimResults = false;
  $('#mic').classList.add('rec');
  r.onresult = e => { const txt = e.results[0][0].transcript; send(txt); };
  r.onend = () => $('#mic') && $('#mic').classList.remove('rec');
  r.start();
}
function speak(text) {
  if (!window.speechSynthesis) return;
  const m = new SpeechSynthesisUtterance(text.replace(/[•₹]/g, ' ')); m.lang = VOICE[S.lang];
  speechSynthesis.cancel(); speechSynthesis.speak(m);
}

// ---------- quote ----------
async function openQuote() { go('quote'); await refreshQuote(); }
async function refreshQuote(items) {
  const r = await api('/api/quote', { sessionId: S.sid, term: S.term, items });
  S.quote = r.quote; S.rec.items = r.items; S.segment = r.segment;
  vQuote();
}
function vQuote() {
  if (!S.quote) { app.innerHTML = '<p><span class="spinner"></span></p>'; return; }
  const q = S.quote;
  const byId = Object.fromEntries(q.items.map(i => [i.id, i]));
  const lineHtml = it => {
    const qi = byId[it.id];
    const blocked = qi && !qi.ok;
    const price = qi ? qi.monthly : 0;
    const perUnit = !/per (site|account|pack)/.test(it.unit) || it.qty > 1;
    return `<div class="line ${it.selected ? '' : 'off'} ${blocked ? 'blocked' : ''}">
      <label class="switch"><input type="checkbox" data-id="${it.id}" ${it.selected ? 'checked' : ''} aria-label="${esc(it.name)}"><span></span></label>
      <div class="info"><div class="name">${esc(it.name)}${it.qty > 1 ? ` <span class="pill">×${it.qty}</span>` : ''}</div>
        <div class="why">${blocked ? '⚠ ' + esc(u().blocked) + ': ' + esc(qi.reasons.join('; ')) : esc(it.why)}</div>
        ${perUnit && it.selected ? `<div class="qty"><button data-q="-1" data-id="${it.id}" aria-label="less">−</button><span>${it.qty}</span><button data-q="1" data-id="${it.id}" aria-label="more">+</button><small class="mini">&nbsp;${esc(it.unit)}</small></div>` : ''}
      </div>
      <div class="price">${it.selected && qi ? inr(price) : '-'}<small>${it.selected && qi ? esc(u().perMonth) : ''}</small>${qi && qi.setup ? `<small>+${inr(qi.setup)} setup</small>` : ''}</div>
    </div>`;
  };
  const core = S.rec.items.filter(i => i.core), add = S.rec.items.filter(i => !i.core);
  app.innerHTML = `
  <h2>${esc(u().quoteTitle)}</h2>
  <p class="mini">${esc(S.segment || '')}</p>
  <div class="card">
    <h3 style="margin-top:0">${esc(u().term)}</h3>
    <div class="seg">${[12, 24, 36].map(t => `<button data-t="${t}" class="${S.term === t ? 'on' : ''}">${t} ${esc(u().months)}</button>`).join('')}</div>
    <p class="mini" style="margin:8px 0 0">${S.term === 36 ? esc(u().waived) : 'Longer contract = lower monthly price.'}</p>
  </div>
  <div class="card"><h3 style="margin-top:0">${esc(u().included)}</h3>${core.map(lineHtml).join('')}</div>
  ${add.length ? `<div class="card"><h3 style="margin-top:0">${esc(u().addons)}</h3>${add.map(lineHtml).join('')}</div>` : ''}
  ${S.rec.excluded?.length ? `<div class="card"><h3 style="margin-top:0">Not available for you yet</h3>${S.rec.excluded.map(e => `<div class="line"><div class="info"><div class="name">${esc(e.name)}</div><div class="why">${esc(e.reasons.join('; '))}${e.alternative ? ' → ' + esc(e.alternative) : ''}</div></div></div>`).join('')}</div>` : ''}
  <div class="card">
    <div class="total"><span>Monthly (before GST)</span><b>${inr(q.monthly)}</b></div>
    <div class="total"><span>${esc(u().gst)}</span><span>${inr(q.gst)}</span></div>
    <div class="total big"><span>${esc(u().totalMonthly)}</span><span>${inr(q.monthlyWithGst)}${esc(u().perMonth)}</span></div>
    <div class="total"><span>${esc(u().oneTime)}</span><span>${inr(q.oneTime)} + GST</span></div>
    <div class="total"><span>Contract</span><span>${q.contract} ${esc(u().months)}</span></div>
    <p class="mini">🛠 ${esc(u().install.replace('{d}', q.installDays))}</p>
  </div>
  <div class="sticky-cta">
    <button class="btn block" id="toKyc" ${q.blocked.length && q.items.every(i => !i.ok) ? 'disabled' : ''}>${esc(u().toKyc)} →</button>
    <div class="row" style="margin-top:8px"><a class="btn subtle small" style="flex:1" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('My Accel Business quote: ' + inr(q.monthlyWithGst) + '/month incl. GST - ' + q.items.filter(i => i.ok).map(i => i.name + (i.qty > 1 ? ' x' + i.qty : '')).join(', '))}">${esc(u().share)}</a>
    <button class="btn subtle small" style="flex:1" data-go="chat">← Advisor</button></div>
  </div>`;
  app.querySelectorAll('[data-t]').forEach(b => (b.onclick = () => { S.term = +b.dataset.t; refreshQuote(S.rec.items); }));
  app.querySelectorAll('input[data-id]').forEach(c => (c.onchange = () => { const it = S.rec.items.find(i => i.id === c.dataset.id); it.selected = c.checked; refreshQuote(S.rec.items); }));
  app.querySelectorAll('button[data-q]').forEach(b => (b.onclick = () => { const it = S.rec.items.find(i => i.id === b.dataset.id); it.qty = Math.max(1, it.qty + +b.dataset.q); refreshQuote(S.rec.items); }));
  $('#toKyc').onclick = () => go(S.consent ? 'kyc' : 'consent');
}

// ---------- consent (DPDP) ----------
function vConsent() {
  app.innerHTML = `
  <h2>${esc(u().consentTitle)}</h2>
  <p>${esc(u().consentBody)}</p>
  <div class="card consent">
    <h3 style="margin-top:0">📄 ${esc(u().collect)}</h3><ul>${u().collectList.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3>🎯 ${esc(u().purpose)}</h3><p>${esc(u().purposeText)}</p>
    <h3>⏱ ${esc(u().retention)}</h3><p>${esc(u().retentionText)}</p>
    <h3>🛡 ${esc(u().rights)}</h3><p>${esc(u().rightsText)}</p>
  </div>
  <div class="card">
    <label class="check"><input type="checkbox" id="cK"><span>${esc(u().cKyc)}</span></label>
    <label class="check"><input type="checkbox" id="cU" checked><span>${esc(u().cUpdates)}</span></label>
    <label class="check"><input type="checkbox" id="cM"><span>${esc(u().cMarketing)}</span></label>
  </div>
  <button class="btn block" id="agree" disabled>${esc(u().agree)} →</button>
  <p class="mini" style="text-align:center">Consent notice v1.2 · Digital Personal Data Protection Act, 2023</p>`;
  $('#cK').onchange = e => ($('#agree').disabled = !e.target.checked);
  $('#agree').onclick = async () => {
    const r = await api('/api/kyc/consent', { sessionId: S.sid, kyc: true, updates: $('#cU').checked, marketing: $('#cM').checked });
    S.consent = r; go('kyc');
  };
}

// ---------- Smart KYC ----------
const DOC_TYPES = ['gst_certificate', 'udyam_certificate', 'address_proof', 'signatory_id'];
const ICON = { gst_certificate: '🧾', udyam_certificate: '🏭', address_proof: '💡', signatory_id: '🪪' };
function vKyc() {
  const docRow = t => {
    const d = S.docs[t];
    const f = d?.fields || {};
    const summary = d ? Object.entries(f).filter(([k, v]) => v && !['address'].includes(k)).slice(0, 3).map(([, v]) => v).join(' · ') : '';
    return `<div class="doc ${d ? d.quality : ''}">
      <div class="thumb">${d?.preview ? `<img src="${d.preview}" alt="">` : ICON[t]}</div>
      <div class="info"><b>${esc(u().docs[t])}</b>${d ? (d.loading ? `<span class="spinner"></span> ${esc(u().reading)}` : `<div class="fields">${d.quality === 'poor' ? '⚠ unreadable - retake photo' : '✓ ' + esc(summary)}</div><span class="pill ${d.quality === 'good' ? 'ok' : 'bad'}">OCR ${d.confidence}%</span>`) : '<div class="fields">-</div>'}</div>
      <label class="btn small ghost">${d ? '↻' : '+'}<input type="file" accept="image/*" capture="environment" data-t="${t}" class="sr"></label>
    </div>`;
  };
  const k = S.kyc;
  app.innerHTML = `
  <h2>${esc(u().kycTitle)}</h2>
  <div class="card">
    <h3 style="margin-top:0">${esc(u().gstLookup)}</h3>
    <form class="row" id="gf"><input type="text" id="gin" class="field" maxlength="15" placeholder="27ABCDE1234F1Z5" style="text-transform:uppercase" aria-label="GSTIN"><button class="btn small">${esc(u().lookup)}</button></form>
    <div class="lookup" id="gres"></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">${esc(u().upload)}</h3>
    ${DOC_TYPES.map(docRow).join('')}
    <div class="row" style="margin-top:10px;flex-wrap:wrap">
      <select id="sample" class="field" aria-label="${esc(u().sample)}"><option value="">${esc(u().sample)}…</option>${Array.from({ length: 12 }, (_, i) => 'K' + String(i + 1).padStart(2, '0')).map(x => `<option>${x}</option>`).join('')}</select>
      <button class="btn small subtle" id="dl">${esc(u().digilocker)}</button>
    </div>
    <p class="mini">${esc(u().privacyNote)}</p>
  </div>
  <button class="btn block" id="verify" ${Object.keys(S.docs).length ? '' : 'disabled'}>${esc(u().verify)}</button>
  <div id="kres">${k ? kycResultHtml(k) : ''}</div>
  <p style="text-align:center"><button class="btn subtle small" id="del">${esc(u().deleteData)}</button></p>`;

  $('#gf').onsubmit = async e => {
    e.preventDefault();
    const g = $('#gin').value.trim().toUpperCase();
    if (!g) return;
    const r = await api('/api/gstin/' + encodeURIComponent(g));
    $('#gres').innerHTML = !r.valid ? `<span class="pill bad">Invalid</span> ${esc(r.reason)}` : !r.found ? `<span class="pill bad">Not found</span> ${esc(r.reason)}`
      : `<span class="pill ${r.status === 'Active' ? 'ok' : 'bad'}">${esc(r.status)}</span> <b>${esc(r.trade_name)}</b><div class="mini">${esc(r.constitution)} · ${esc(r.state)} · since ${esc(r.registration_date)}</div>`;
  };
  app.querySelectorAll('input[type=file]').forEach(inp => (inp.onchange = () => uploadDoc(inp.dataset.t, inp.files[0])));
  $('#sample').onchange = e => e.target.value && loadSample(e.target.value);
  // simulated DigiLocker pull: fetches a verified (clean) specimen set
  $('#dl').onclick = () => loadSample(['K03', 'K08', 'K09', 'K12'][Math.floor(Math.random() * 4)]);
  $('#verify').onclick = verify;
  $('#del').onclick = async () => { await api('/api/kyc/' + S.sid, undefined, 'DELETE'); S.docs = {}; S.kyc = null; S.consent = null; go('consent'); };
  if ($('#toPay')) $('#toPay').onclick = () => go('pay');
  if ($('#rmBlocked')) $('#rmBlocked').onclick = async () => { for (const b of S.quote.blocked) { const it = S.rec.items.find(i => i.id === b.id); if (it) it.selected = false; } await refreshQuote(S.rec.items); go('kyc'); };
}
async function uploadDoc(type, file) {
  if (!file) return;
  S.docs[type] = { loading: true, preview: URL.createObjectURL(file) }; vKyc();
  const fd = new FormData(); fd.append('sessionId', S.sid); fd.append('docType', type); fd.append('file', file);
  try {
    const r = await api('/api/kyc/document', fd);
    // the server may detect a different document type than the slot it was uploaded in
    const preview = S.docs[type].preview; delete S.docs[type];
    S.docs[r.type === 'unknown' ? type : r.type] = { ...r, preview };
  } catch (e) { delete S.docs[type]; alert(e.message); }
  S.kyc = null; vKyc();
}
async function loadSample(k) {
  S.docs = {}; S.kyc = null;
  DOC_TYPES.forEach(t => (S.docs[t] = { loading: true })); vKyc();
  const r = await api('/api/kyc/sample', { sessionId: S.sid, applicant: k });
  S.docs = {};
  for (const d of r.documents) S.docs[d.type] = { ...d, preview: '/api/kyc/sample-image/' + d.file };
  vKyc();
}
async function verify() {
  $('#verify').innerHTML = '<span class="spinner"></span>';
  S.kyc = await api('/api/kyc/validate', { sessionId: S.sid });
  if (S.kyc.quote) S.quote = S.kyc.quote;
  vKyc();
  $('#kres').scrollIntoView({ behavior: 'smooth' });
}
function kycResultHtml(k) {
  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  const ic = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
  const blocked = S.quote?.blocked || [];
  return `<div class="card" style="margin-top:12px">
    <div class="banner ${k.decision}">${esc(u().decision[k.decision])} · ${k.summary.pass} ✓ ${k.summary.warn ? '· ' + k.summary.warn + ' !' : ''} ${k.summary.fail ? '· ' + k.summary.fail + ' ✕' : ''}</div>
    ${k.checks.slice().sort((a, b) => order[a.status] - order[b.status]).map(c => `<div class="result ${c.status}"><span class="ic">${ic[c.status]}</span><div><b>${esc(c.label)}</b><small>${esc(c.detail)}</small></div></div>`).join('')}
    ${k.reupload.length ? `<p class="err">${esc(u().reupload)} ${k.reupload.map(t => esc(u().docs[t] || t)).join(', ')}</p>` : ''}
    ${blocked.length ? `<p class="err">⚠ ${blocked.map(b => esc(b.name) + ': ' + esc(b.reasons.join('; '))).join('<br>')}</p><button class="btn ghost block" id="rmBlocked">${esc(u().removeBlocked)}</button>` : ''}
    ${k.decision !== 'action_needed' && !blocked.length ? `<button class="btn block" id="toPay" style="margin-top:12px">${esc(u().toPay)} →</button>` : ''}
  </div>`;
}

// ---------- sign & pay ----------
function vPay() {
  const q = S.quote;
  app.innerHTML = `
  <h2>${esc(u().payTitle)}</h2>
  <div class="card">
    <div class="total big" style="border:0;margin:0;padding:0"><span>${esc(u().totalMonthly)}</span><span>${inr(q.monthlyWithGst)}</span></div>
    <div class="total"><span>${esc(u().oneTime)}</span><span>${inr(q.oneTimeWithGst)}</span></div>
    <p class="mini">${q.items.filter(i => i.ok).map(i => esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : '')).join(' · ')}</p>
  </div>
  <div class="card">
    <label class="mini">${esc(u().name)}</label><input class="field" id="nm" style="width:100%;margin:4px 0 10px" autocomplete="name">
    <label class="mini">${esc(u().mobile)}</label><input class="field" id="mb" style="width:100%;margin:4px 0 10px" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="98XXXXXXXX">
    <h3>✍ ${esc(u().esign)}</h3>
    <p class="mini">${esc(u().otpSent)}</p>
    <input class="field" id="otp" style="width:100%" inputmode="numeric" maxlength="6" placeholder="${esc(u().otp)}">
    <label class="check"><input type="checkbox" id="tc"><span>${esc(u().agreeTerms)}</span></label>
  </div>
  <button class="btn block" id="pay">${esc(u().payNow)} · ${inr(q.monthlyWithGst + q.oneTimeWithGst)}</button>
  <div id="perr" class="err"></div>`;
  $('#pay').onclick = async () => {
    $('#perr').textContent = '';
    if ($('#otp').value !== '123456') return ($('#perr').textContent = 'OTP is incorrect (demo OTP is 123456)');
    if (!$('#tc').checked) return ($('#perr').textContent = 'Please accept the Customer Application Form');
    $('#pay').innerHTML = '<span class="spinner"></span> ' + esc(u().placing);
    try {
      const r = await api('/api/orders', { sessionId: S.sid, name: $('#nm').value, mobile: $('#mb').value, esign: true });
      S.order = { id: r.orderId, last4: $('#mb').value.replace(/\D/g, '').slice(-4) };
      go('done');
    } catch (e) { $('#perr').textContent = e.message; $('#pay').textContent = u().payNow; }
  };
}
function vDone() {
  app.innerHTML = `<div class="card" style="text-align:center">
    <div style="font-size:44px">🎉</div><h2>${esc(u().orderPlaced)}</h2>
    <p class="mini">${esc(u().orderId)}</p><div class="big-id">${esc(S.order.id)}</div>
    <p>${esc(u().saveId)}</p>
    <button class="btn block" id="tr">${esc(u().trackTitle)} →</button></div>`;
  $('#tr').onclick = () => { S.trackLoaded = null; go('track'); };
}

// ---------- tracker ----------
async function vTrack() {
  const params = new URLSearchParams(location.search);
  const id = S.order?.id || params.get('order') || '', l4 = S.order?.last4 || '';
  if (!S.trackLoaded && id && l4) {
    try { S.trackLoaded = await api(`/api/orders/${id}?last4=${l4}&lang=${S.lang}`); } catch {}
  }
  const o = S.trackLoaded;
  if (!o) {
    app.innerHTML = `<h2>${esc(u().trackTitle)}</h2><div class="card">
      <label class="mini">${esc(u().orderId)}</label><input class="field" id="oid" style="width:100%;margin:4px 0 10px;text-transform:uppercase" value="${esc(id)}" placeholder="UD123456">
      <label class="mini">${esc(u().last4)}</label><input class="field" id="l4" style="width:100%;margin:4px 0 10px" inputmode="numeric" maxlength="4">
      <button class="btn block" id="find">${esc(u().find)}</button><div class="err" id="terr"></div></div>`;
    $('#find').onclick = async () => {
      try { S.trackLoaded = await api(`/api/orders/${$('#oid').value.trim()}?last4=${$('#l4').value.trim()}&lang=${S.lang}`); S.order = { id: S.trackLoaded.id, last4: $('#l4').value.trim() }; vTrack(); }
      catch (e) { $('#terr').textContent = e.message; }
    };
    return;
  }
  const nowIdx = o.timeline.findIndex(t => !t.done);
  app.innerHTML = `
  <h2>${esc(u().trackTitle)}</h2>
  <div class="card"><div class="row" style="justify-content:space-between"><div><div class="mini">${esc(u().orderId)}</div><b style="font-size:18px">${esc(o.id)}</b></div><div style="text-align:right"><div class="mini">${esc(o.business || '')}</div><b>${inr(o.monthly)}${esc(u().perMonth)}</b></div></div></div>
  <div class="card"><ul class="timeline">${o.timeline.map((t, i) => `<li class="${t.done ? 'done' : i === nowIdx ? 'now' : ''}"><span class="dot">${t.done ? '✓' : ''}</span><div class="t"><b>${esc(t.label)}</b><small>${t.done ? '✓ ' : esc(u().eta) + ' '}${fmtDate(t.at)}${t.note && !t.done ? ' · ' + esc(t.note) : ''}</small></div></li>`).join('')}</ul>
    ${nowIdx >= 0 ? `<button class="btn subtle small block" id="adv">⏭ ${esc(u().simulate)}</button>` : ''}</div>
  <div class="card"><h3 style="margin-top:0">${esc(u().items)}</h3>${o.items.map(i => `<div class="total"><span>${esc(i.name)}${i.qty > 1 ? ' ×' + i.qty : ''}</span><span class="pill ${i.status === 'live' ? 'ok' : i.status === 'installing' ? 'warn' : ''}">${esc(u()[i.status] || i.status)} · ${fmtDate(i.eta)}</span></div>`).join('')}</div>
  <div class="card"><h3 style="margin-top:0">💬 ${esc(u().updates)}</h3>${o.notifications.slice().reverse().map(n => `<div class="wa">${esc(n.text)}<small>${esc(n.channel)} · ${new Date(n.at).toLocaleString('en-IN')}</small></div>`).join('')}</div>
  <p class="mini" style="text-align:center">📞 ${esc(u().support)}</p>
  <button class="btn ghost block" id="again">${esc(u().restart)}</button>`;
  if ($('#adv')) $('#adv').onclick = async () => { S.trackLoaded = await api(`/api/orders/${o.id}/advance?lang=${S.lang}`, {}); vTrack(); };
  $('#again').onclick = () => { S.trackLoaded = null; S.order = null; go('home'); };
}

// ---------- boot ----------
api('/api/config').then(c => { S.config = c; $('#aiBadge').textContent = c.llm ? '✦ AI advisor: ' + c.model : '✦ Advisor: rule engine (offline mode)'; }).catch(() => {});
if (new URLSearchParams(location.search).get('order')) S.view = 'track';
render();
