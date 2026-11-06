// Udyam Saathi - the needs-discovery advisor.
// 1) understand the owner (rule-based multilingual parser, optionally boosted by an LLM)
// 2) ask only the missing questions
// 3) recommend a bundle that the rules engine has validated, with a plain-language reason for every line
const { cities, productById } = require('./data');
const { eligibility, validateBundle, quote } = require('./rules');
const { lookupGstin } = require('./kyc');
const { t, why } = require('./i18n');

const SEG_NAME = { micro: 'Micro retail & services', prof: 'Professional office', multi: 'Multi-site business', mfg: 'Small manufacturer' };
const SLOTS = ['businessType', 'city', 'employees', 'sites', 'gstin', 'currentInternet', 'needs'];

// ---------- vocabulary (English, Hinglish, Hindi, Marathi, Tamil) ----------
const BUSINESS = [
  [/kirana|grocery|general store|provision|किराना|किराणा|மளிகை/i, 'Kirana store', 'micro', 'retail'],
  [/salon|parlou?r|beauty|barber|सैलून|सलून|पार्लर|அழகு|சலூன்/i, 'Salon', 'micro', 'service'],
  [/pharmacy|chemist|medical store|medicals|दवा|फार्मेसी|औषध|மருந்து/i, 'Pharmacy', 'micro', 'retail'],
  [/bakery|bake|cake|बेकरी|பேக்கரி/i, 'Bakery', 'micro', 'retail'],
  [/sweet|mithai|मिठाई|मिष्ठान्न|இனிப்பு/i, 'Sweet shop', 'micro', 'retail'],
  [/stationery|book ?shop|स्टेशनरी/i, 'Stationery shop', 'micro', 'retail'],
  [/optician|optical|spectacle|चश्मा/i, 'Optician', 'micro', 'retail'],
  [/hardware|paint|हार्डवेयर/i, 'Hardware store', 'micro', 'retail'],
  [/boutique|tailor|garment|cloth|कपड़|बुटीक|துணி/i, 'Boutique', 'micro', 'retail'],
  [/mobile (repair|shop)|phone repair|मोबाइल/i, 'Mobile repair shop', 'micro', 'retail'],
  [/restaurant|cafe|café|dhaba|hotel|eatery|रेस्टोरेंट|ढाबा|होटल|உணவகம்/i, 'Restaurant', 'micro', 'food'],
  [/gym|fitness|जिम/i, 'Gym', 'micro', 'service'],
  [/dental|dentist|डेंटल|दंत|பல்/i, 'Dental clinic', 'prof', 'clinic'],
  [/physio/i, 'Physiotherapy clinic', 'prof', 'clinic'],
  [/diagnos|path ?lab|\blab\b|लैब|प्रयोगशाला/i, 'Diagnostic lab', 'prof', 'clinic'],
  [/clinic|doctor|hospital|nursing|क्लिनिक|डॉक्टर|दवाखाना|மருத்துவ/i, 'Clinic', 'prof', 'clinic'],
  [/\bca\b|chartered|accountant|audit|tax|सीए|लेखा|கணக்காளர்/i, 'CA firm', 'prof', 'office'],
  [/law|legal|advocate|lawyer|वकील|வழக்கறிஞர்/i, 'Law office', 'prof', 'office'],
  [/coaching|tuition|classes|institute|academy|कोचिंग|ट्यूशन|क्लासेस|பயிற்சி/i, 'Coaching centre', 'prof', 'office'],
  [/school|pre-?school|play ?school|स्कूल|शाळा|பள்ளி/i, 'Pre-school', 'prof', 'office'],
  [/architect|interior|design studio/i, 'Architecture studio', 'prof', 'office'],
  [/real estate|realty|property|broker|प्रॉपर्टी/i, 'Real estate agency', 'prof', 'office'],
  [/travel|tours/i, 'Travel agency', 'prof', 'office'],
  [/insurance|बीमा/i, 'Insurance agency', 'prof', 'office'],
  [/office|consult|agency|ऑफिस|कार्यालय|அலுவலகம்/i, 'Office', 'prof', 'office'],
  [/auto.?parts|automobile|textile|plastic|mould|packag|food processing|furniture|printing|press|factory|manufactur|workshop|\bunit\b|फैक्ट्री|कारखाना|उत्पादन|தொழிற்சாலை/i, 'Manufacturing unit', 'mfg', 'mfg'],
];
const CHAIN_RE = /\bchain\b|franchise|चेन|साखळी|சங்கிலி/i;
const CITY_ALIAS = {
  bangalore: 'bengaluru', bombay: 'mumbai', 'new delhi': 'delhi', calcutta: 'kolkata', madras: 'chennai', mysore: 'mysuru', vizag: 'visakhapatnam', cochin: 'kochi', baroda: 'vadodara',
  'मुंबई': 'mumbai', 'पुणे': 'pune', 'पुणे.': 'pune', 'दिल्ली': 'delhi', 'चेन्नई': 'chennai', 'कोलकाता': 'kolkata', 'हैदराबाद': 'hyderabad', 'बेंगलुरु': 'bengaluru', 'बैंगलोर': 'bengaluru',
  'अहमदाबाद': 'ahmedabad', 'जयपुर': 'jaipur', 'लखनऊ': 'lucknow', 'नागपुर': 'nagpur', 'इंदौर': 'indore', 'भोपाल': 'bhopal', 'पटना': 'patna', 'सूरत': 'surat', 'नाशिक': 'nashik', 'नासिक': 'nashik',
  'वडोदरा': 'vadodara', 'लुधियाना': 'ludhiana', 'कोच्चि': 'kochi', 'पुण्यात': 'pune', 'मुंबईत': 'mumbai', 'नागपूर': 'nagpur',
  'சென்னை': 'chennai', 'சென்னையில்': 'chennai', 'கோயம்புத்தூர்': 'coimbatore', 'கோவை': 'coimbatore', 'பெங்களூரு': 'bengaluru', 'மும்பை': 'mumbai', 'ஹைதராபாத்': 'hyderabad', 'கொச்சி': 'kochi',
};
const INTERNET = [
  [/hotspot|mobile data|phone (data|internet)|हॉटस्पॉट|मोबाइल डेटा|ஹாட்ஸ்பாட்/i, 'hotspot'],
  [/\bhome\b|घर|घरचे|வீட்டு/i, 'home'],
  [/leased line|ill\b|dedicated/i, 'leased'],
  [/mixed|different (isp|provider)s?|per site/i, 'mixed'],
  [/business broadband|office broadband|broadband|fibre|fiber|wifi|wi-fi|ब्रॉडबैंड|ब्रॉडबँड|பிராட்பேண்ட்/i, 'business'],
  [/\bnone\b|no internet|nothing|कुछ नहीं|नहीं है|काही नाही|எதுவும் இல்லை/i, 'none'],
];
const NEEDS = [
  [/backup|failover|downtime|never (go )?down|uptime|बैकअप/i, 'backup'],
  [/whats ?app|व्हाट्सएप|व्हॉट्सअ‍ॅप|வாட்ஸ்அப்/i, 'whatsapp'],
  [/\bsms\b|reminder|text message|एसएमएस/i, 'sms'],
  [/pos\b|billing|bill|invoice|upi|card machine|payment|बिलिंग|बिल|பில்/i, 'pos'],
  [/cctv|camera|surveillance|कैमरा|कॅमेरा|கேமரா/i, 'cctv'],
  [/email|e-mail|mail|office suite|ईमेल|மின்னஞ்சல்/i, 'email'],
  [/secur|virus|ransom|firewall|hack|data (safety|protection)|सुरक्षा|பாதுகாப்பு/i, 'security'],
  [/website|domain|online presence|google|वेबसाइट|இணையதளம்/i, 'website'],
  [/phone line|ivr|call centre|call center|telephony|landline|toll.?free|कॉल/i, 'phone'],
  [/guest wi-?fi|customer wi-?fi|free wi-?fi|wifi for customers/i, 'wifi'],
  [/machine|iot|sensor|energy|मशीन/i, 'iot'],
  [/vehicle|fleet|delivery van|truck|gps|गाड़ी|वाहन|வாகன/i, 'fleet'],
  [/backup (of )?(data|files)|cloud storage|storage|records|files/i, 'storage'],
  [/sim|mobile (plan|line|connection)|postpaid|सिम|மொபைல் இணைப்பு/i, 'mobile'],
];
const YES_RE = /^(yes|y|yeah|yep|haan|han|ha|haa|ji|hai|हाँ|हां|हा|जी|होय|हो|आहे|ஆம்|ஆமா|ஆமாம்|ok)\b/i;
const NO_RE = /^(no|n|nope|nahi|nahin|nai|नहीं|नही|ना|नाही|इल्लई|இல்லை|not yet|na)\b/i;
const GSTIN_IN_TEXT = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/i;
const devanagariDigits = s => s.replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d)).replace(/[௦-௯]/g, d => '௦௧௨௩௪௫௬௭௮௯'.indexOf(d));

/** Pull whatever we can out of a free-text answer. `expecting` is the slot we just asked about. */
function parseText(raw, expecting) {
  const text = devanagariDigits(String(raw || ''));
  const lower = text.toLowerCase();
  const u = {};
  for (const [re, type, seg, kind] of BUSINESS) if (re.test(text)) { u.businessType = type; u.segment = seg; u.kind = kind; break; }
  if (CHAIN_RE.test(text) && u.segment !== 'mfg') u.chain = true;

  for (const [k, c] of Object.entries(cities)) if (new RegExp('\\b' + k + '\\b', 'i').test(lower)) { u.city = c.city; u.tier = c.tier; u.state = c.state; break; }
  if (!u.city) for (const [alias, k] of Object.entries(CITY_ALIAS)) if (lower.includes(alias)) { const c = cities[k]; u.city = c.city; u.tier = c.tier; u.state = c.state; break; }
  if (/tier ?1|metro|बड़ा शहर|महानगर/i.test(text)) u.tier = 1;
  if (/tier ?2|small(er)? (city|town)|छोटा शहर|लहान शहर/i.test(text)) u.tier = 2;

  const emp = text.match(/(\d+)\s*(\+\s*)?(staff|employees?|people|persons?|workers?|members?|log|लोग|कर्मचारी|लोक|कामगार|பேர்|ஊழியர்)/i) || text.match(/team of (\d+)/i);
  if (emp) u.employees = +emp[1];
  const sites = text.match(/(\d+)\s*(branch(es)?|outlets?|stores?|shops?|sites?|locations?|centres?|centers?|units?|clinics?|offices?|दुकान(ें)?|शाखा(एँ)?|ब्रांच|ठिकाण(े)?|கிளை(கள்)?)/i);
  if (sites) u.sites = +sites[1];
  if (/single (shop|store|location|site|office|branch)|one (shop|store|location|branch|office|site)|एक (ही )?(दुकान|जगह|ब्रांच|शाखा|ठिकाण)|एकच|(ஒரு|ஒரே) (கிளை|கடை|இடம்|அலுவலகம்)/i.test(text)) u.sites = u.sites || 1;
  if (/only me|just me|alone|अकेला|अकेले|मी एकटा/i.test(text)) u.employees = 1;

  const gm = text.toUpperCase().match(GSTIN_IN_TEXT);
  if (gm) u.gstinNumber = gm[0];
  else if (/no gst|without gst|not registered|gst nahi|gst नहीं|जीएसटी नहीं|gst नाही|GST இல்லை|unregistered/i.test(text)) u.gstin = 'none';
  else if (/(have|with|registered|yes).{0,10}gst|gst\s*[:-]?\s*(yes|hai|haan|registered|है|हाँ|आहे|होय|உள்ளது|ஆம்)|जीएसटी है/i.test(text)) u.gstin = 'declared';

  for (const [re, v] of INTERNET) if (re.test(text) && (expecting === 'currentInternet' || /currently|right now|today|use|अभी|सध्या|இப்போது/i.test(text))) { u.currentInternet = v; break; }
  const needs = NEEDS.filter(([re]) => re.test(text)).map(([, n]) => n);
  if (needs.length) u.needs = needs;
  const budget = text.match(/(?:budget|under|within|below|upto|up to|max|बजट|तक)\D{0,10}(?:rs\.?|₹|inr)?\s*(\d[\d,]{2,})/i) || text.match(/(?:rs\.?|₹)\s*(\d[\d,]{2,})\s*(?:\/|per|a)?\s*(?:month|mo|महीना|महिना)/i);
  if (budget) u.budget = +budget[1].replace(/,/g, '');
  const cams = text.match(/(\d+)\s*(cameras?|cctv|कैमरे?)/i); if (cams) u.cameras = +cams[1];
  const lines = text.match(/(\d+)\s*(sims?|mobile lines?|phones?|connections?|सिम)/i); if (lines) u.mobileLines = +lines[1];
  const veh = text.match(/(\d+)\s*(vehicles?|vans?|trucks?|bikes?|गाड़ियाँ|वाहन)/i); if (veh) { u.vehicles = +veh[1]; u.needs = [...new Set([...(u.needs || []), 'fleet'])]; }

  // Bare answers to the question we just asked
  const n = gm ? null : text.match(/^\s*(\d+)\s*$/) || (expecting && text.match(/(\d+)/));
  if (expecting === 'employees' && u.employees == null && n) u.employees = +n[1];
  if (expecting === 'sites' && u.sites == null && n) u.sites = +n[1];
  if (expecting === 'gstin' && !u.gstinNumber && !u.gstin) {
    if (YES_RE.test(text.trim())) u.gstin = 'declared';
    else if (NO_RE.test(text.trim())) u.gstin = 'none';
  }
  if (expecting === 'businessType' && !u.businessType && text.trim().length > 1) { u.businessType = text.trim().slice(0, 40); u.segment = 'micro'; u.kind = 'retail'; u.guessed = true; }
  if (expecting === 'needs' && !u.needs && /skip|not sure|nothing else|you decide|आप बताइए|तुम्ही सांगा|நீங்களே/i.test(text)) u.needs = [];
  return u;
}

// ---------- choices shown as tap-able chips ----------
const CHIPS = {
  businessType: [
    ['Kirana store', { en: 'Kirana / retail shop', hi: 'किराना / दुकान', mr: 'किराणा / दुकान', ta: 'மளிகை / கடை' }],
    ['Salon', { en: 'Salon / beauty', hi: 'सैलून / ब्यूटी', mr: 'सलून / ब्युटी', ta: 'சலூன் / அழகு' }],
    ['Pharmacy', { en: 'Pharmacy', hi: 'फार्मेसी / दवा दुकान', mr: 'औषध दुकान', ta: 'மருந்தகம்' }],
    ['Restaurant', { en: 'Restaurant / cafe', hi: 'रेस्टोरेंट / कैफ़े', mr: 'रेस्टॉरंट / कॅफे', ta: 'உணவகம்' }],
    ['Clinic', { en: 'Clinic / diagnostic lab', hi: 'क्लिनिक / लैब', mr: 'क्लिनिक / लॅब', ta: 'மருத்துவமனை / ஆய்வகம்' }],
    ['CA firm', { en: 'CA / law / office', hi: 'CA / वकील / ऑफिस', mr: 'CA / वकील / ऑफिस', ta: 'CA / வழக்கறிஞர் / அலுவலகம்' }],
    ['Coaching centre', { en: 'Coaching centre', hi: 'कोचिंग सेंटर', mr: 'कोचिंग क्लास', ta: 'பயிற்சி மையம்' }],
    ['Retail chain', { en: 'Chain with many branches', hi: 'कई ब्रांच वाली चेन', mr: 'अनेक शाखा असलेली चेन', ta: 'பல கிளைகள் கொண்ட சங்கிலி' }],
    ['Manufacturing unit', { en: 'Factory / manufacturing', hi: 'फैक्ट्री / उत्पादन', mr: 'कारखाना / उत्पादन', ta: 'தொழிற்சாலை' }],
  ],
  employees: [['1', '1-2'], ['4', '3-5'], ['8', '6-10'], ['18', '11-25'], ['60', '26-100'], ['120', '100+']],
  sites: [['1', '1'], ['2', '2'], ['4', '3-5'], ['8', '6+']],
  gstin: [['yes', { en: 'Yes, I have GST', hi: 'हाँ, GST है', mr: 'होय, GST आहे', ta: 'ஆம், GST உள்ளது' }], ['no', { en: 'No GST', hi: 'GST नहीं है', mr: 'GST नाही', ta: 'GST இல்லை' }]],
  currentInternet: [
    ['hotspot', { en: 'Phone hotspot', hi: 'मोबाइल हॉटस्पॉट', mr: 'मोबाइल हॉटस्पॉट', ta: 'மொபைல் ஹாட்ஸ்பாட்' }],
    ['home', { en: 'Home broadband', hi: 'घर का ब्रॉडबैंड', mr: 'घरचे ब्रॉडबँड', ta: 'வீட்டு பிராட்பேண்ட்' }],
    ['business', { en: 'Business broadband', hi: 'बिज़नेस ब्रॉडबैंड', mr: 'बिझनेस ब्रॉडबँड', ta: 'வணிக பிராட்பேண்ட்' }],
    ['leased', { en: 'Leased line', hi: 'लीज़्ड लाइन', mr: 'लीज्ड लाइन', ta: 'லீஸ்டு லைன்' }],
    ['mixed', { en: 'Different at each site', hi: 'हर ब्रांच पर अलग', mr: 'प्रत्येक शाखेत वेगळे', ta: 'ஒவ்வொரு கிளையிலும் வேறு' }],
    ['none', { en: 'No internet', hi: 'इंटरनेट नहीं', mr: 'इंटरनेट नाही', ta: 'இணையம் இல்லை' }],
  ],
  needs: [
    ['backup', { en: 'Internet that never goes down', hi: 'कभी बंद न होने वाला इंटरनेट', mr: 'कधीही बंद न पडणारे इंटरनेट', ta: 'தடையில்லா இணையம்' }],
    ['pos', { en: 'Billing & UPI payments', hi: 'बिलिंग और UPI पेमेंट', mr: 'बिलिंग आणि UPI', ta: 'பில்லிங் & UPI' }],
    ['whatsapp', { en: 'WhatsApp for customers', hi: 'ग्राहकों के लिए WhatsApp', mr: 'ग्राहकांसाठी WhatsApp', ta: 'வாடிக்கையாளர் WhatsApp' }],
    ['sms', { en: 'SMS reminders / offers', hi: 'SMS रिमाइंडर / ऑफर', mr: 'SMS आठवण / ऑफर', ta: 'SMS நினைவூட்டல்' }],
    ['cctv', { en: 'CCTV cameras', hi: 'CCTV कैमरे', mr: 'CCTV कॅमेरे', ta: 'CCTV கேமரா' }],
    ['email', { en: 'Business email', hi: 'बिज़नेस ईमेल', mr: 'बिझनेस ईमेल', ta: 'வணிக மின்னஞ்சல்' }],
    ['security', { en: 'Data security', hi: 'डेटा सुरक्षा', mr: 'डेटा सुरक्षा', ta: 'தரவு பாதுகாப்பு' }],
    ['website', { en: 'Website', hi: 'वेबसाइट', mr: 'वेबसाइट', ta: 'இணையதளம்' }],
    ['phone', { en: 'Business phone number / IVR', hi: 'बिज़नेस फोन नंबर / IVR', mr: 'बिझनेस फोन नंबर / IVR', ta: 'வணிக தொலைபேசி எண்' }],
    ['wifi', { en: 'Free Wi-Fi for customers', hi: 'ग्राहकों के लिए Wi-Fi', mr: 'ग्राहकांसाठी Wi-Fi', ta: 'வாடிக்கையாளர் Wi-Fi' }],
    ['iot', { en: 'Machine monitoring', hi: 'मशीन मॉनिटरिंग', mr: 'मशीन मॉनिटरिंग', ta: 'இயந்திர கண்காணிப்பு' }],
    ['fleet', { en: 'Vehicle tracking', hi: 'गाड़ी ट्रैकिंग', mr: 'वाहन ट्रॅकिंग', ta: 'வாகன கண்காணிப்பு' }],
  ],
};
function chipsFor(slot, lang) {
  return (CHIPS[slot] || []).map(([value, label]) => ({ value, label: typeof label === 'string' ? label : label[lang] || label.en }));
}

// ---------- session handling ----------
function newSession(lang = 'en') {
  return { lang, profile: { needs: null }, expecting: 'businessType', messages: [], recommendation: null, closed: false, handoff: null };
}

function applyUpdates(s, u) {
  const p = s.profile, notes = [];
  for (const k of ['businessType', 'segment', 'kind', 'city', 'tier', 'state', 'employees', 'sites', 'currentInternet', 'budget', 'cameras', 'mobileLines', 'vehicles', 'chain']) if (u[k] != null && !(u.guessed && p.businessType)) p[k] = u[k];
  if (u.needs) p.needs = [...new Set([...(p.needs || []), ...u.needs])];
  if (u.gstinNumber) {
    const lk = lookupGstin(u.gstinNumber);
    p.gstinNumber = u.gstinNumber;
    if (!lk.valid) { p.gstin = 'none'; notes.push(t(s.lang, 'gst_invalid', { reason: lk.reason })); }
    else if (!lk.found) { p.gstin = 'none'; notes.push(t(s.lang, 'gst_notfound')); }
    else if (lk.status !== 'Active') { p.gstin = 'inactive'; notes.push(t(s.lang, 'gst_bad', { status: lk.status })); }
    else {
      p.gstin = 'verified'; p.legalName = lk.legal_name; p.tradeName = lk.trade_name;
      notes.push(t(s.lang, 'gst_ok', { name: lk.trade_name }));
      if (!p.state) p.state = lk.state;
    }
  } else if (u.gstin) p.gstin = u.gstin;
  if (p.chain && (p.sites == null || p.sites < 3)) p.sites = p.sites && p.sites >= 3 ? p.sites : p.sites || null;
  return notes;
}

function missingSlot(p) {
  if (!p.businessType) return 'businessType';
  if (!p.tier) return 'city';
  if (p.employees == null) return 'employees';
  if (p.sites == null) return 'sites';
  if (!p.gstin) return 'gstin';
  if (!p.currentInternet) return 'currentInternet';
  if (p.needs == null) return 'needs';
  return null;
}

function effectiveSegment(p) {
  if (p.segment === 'mfg') return 'mfg';
  if ((p.sites || 1) >= 3 || p.chain) return 'multi';
  return p.segment || 'micro';
}

// ---------- recommendation ----------
const BUDGET = { micro: 2500, prof: 9000, multi: 40000, mfg: 30000 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function recommend(p, lang = 'en') {
  const seg = effectiveSegment(p);
  const emp = p.employees || 1, sites = p.sites || 1;
  const needs = new Set(p.needs && p.needs.length ? p.needs : {
    micro: ['pos', 'whatsapp'], prof: ['email', 'security', 'storage'], multi: ['backup', 'pos', 'cctv'], mfg: ['email', 'security', 'iot'],
  }[seg]);
  const profile = { tier: p.tier, employees: emp, sites, gstin: p.gstin };
  const picks = []; // {id, qty, core, why}
  const pick = (id, qty, core) => { if (!picks.find(x => x.id === id)) picks.push({ id, qty: Math.max(1, Math.round(qty)), core }); };

  // 1. primary connectivity, one per site
  let primary;
  if (seg === 'mfg') primary = emp >= 60 ? 'P06' : emp >= 10 ? 'P05' : 'P02';
  else if (seg === 'prof') primary = emp >= 20 ? 'P03' : emp >= 6 ? 'P02' : 'P01';
  else if (seg === 'multi') primary = 'P02';
  else primary = p.currentInternet === 'none' && p.noFibre ? 'P04' : 'P01';
  if (p.noFibre && ['P01', 'P02'].includes(primary)) primary = 'P04';
  // fall back down the ladder if the rules say no (e.g. 1G not sold in tier 2, leased line needs GSTIN)
  const ladder = { P06: ['P05', 'P03', 'P02'], P05: ['P03', 'P02'], P03: ['P02'], P02: ['P01'], P01: ['P04'], P04: [] };
  const excluded = [];
  let cur = primary;
  while (cur) {
    const e = eligibility(productById[cur], profile);
    if (e.ok) break;
    excluded.push({ id: cur, reasons: e.reasons, alt: ladder[cur][0] });
    cur = ladder[cur][0];
  }
  primary = cur;
  if (primary) pick(primary, sites, true);
  const hasFibre = ['P01', 'P02', 'P03'].includes(primary);

  // 2. mobile lines
  const lines = p.mobileLines || { micro: 1, prof: clamp(Math.ceil(emp / 5), 1, 5), multi: clamp(sites, 2, 12), mfg: clamp(Math.ceil(emp / 20), 2, 6) }[seg];
  pick(seg === 'micro' ? 'P07' : 'P08', lines, true);

  // 3. needs-driven products (core when it is the segment's typical need, add-on otherwise)
  const retailish = ['retail', 'food'].includes(p.kind);
  if (needs.has('backup') || seg === 'multi') pick('P09', sites, seg === 'multi' || needs.has('backup'));
  else if (seg === 'prof' && p.kind === 'clinic') pick('P09', 1, false);
  if (needs.has('pos') || (seg === 'micro' && retailish) || (seg === 'multi' && retailish)) pick('P19', seg === 'multi' ? sites : 1, seg !== 'prof');
  if (needs.has('whatsapp') || seg === 'micro') pick('P15', 1, needs.has('whatsapp') || seg === 'micro');
  if (needs.has('sms') || (seg === 'prof' && p.kind === 'clinic')) pick('P14', 1, needs.has('sms'));
  if (needs.has('cctv') || seg === 'multi' || retailish) pick('P23', p.cameras || (seg === 'multi' ? 2 * sites : seg === 'mfg' ? 4 : 2), needs.has('cctv'));
  if (needs.has('wifi') || ['food', 'service'].includes(p.kind) || p.kind === 'clinic') pick('P22', sites, needs.has('wifi'));
  if (needs.has('email') || ['prof', 'multi', 'mfg'].includes(seg)) pick('P16', seg === 'mfg' ? Math.min(emp, 15) : seg === 'multi' ? Math.min(emp, sites * 3) : emp, seg === 'prof' || needs.has('email'));
  if (needs.has('storage') || seg === 'prof') pick('P17', 1, seg === 'prof' || needs.has('storage'));
  if (needs.has('security') || seg === 'prof' || seg === 'mfg') pick('P20', seg === 'mfg' ? Math.min(emp, 15) : Math.max(1, Math.ceil(emp * 0.8)), needs.has('security') || seg === 'prof');
  if ((needs.has('security') && emp >= 10) || seg === 'mfg') pick('P21', 1, seg === 'mfg');
  if (needs.has('phone') || (seg === 'prof' && emp >= 3 && ['clinic', 'office'].includes(p.kind))) pick('P12', 2, needs.has('phone'));
  if (seg === 'multi' && (needs.has('phone') || emp >= 25)) pick('P13', 1, false);
  if (seg === 'multi' && sites >= 3 && emp >= 10) pick('P10', sites, false);
  if (needs.has('website') || (seg === 'micro' && !retailish) || seg === 'prof') pick('P18', 1, needs.has('website'));
  if (needs.has('iot') || (seg === 'mfg' && emp >= 10)) pick('P24', 5, needs.has('iot') || seg === 'mfg');
  if (needs.has('fleet')) pick('P25', p.vehicles || 3, true);
  if (needs.has('cctv') && seg !== 'micro' && hasFibre) pick('P11', 1, false);

  // 4. rules engine pass: drop anything ineligible (with reason + alternative), respecting dependencies
  const ALT = { P15: 'free WhatsApp Business app now; register GST to unlock the verified API', P14: 'use WhatsApp Business app broadcasts', P12: 'business mobile lines cover calls for now', P13: 'use a business mobile number', P21: 'Endpoint Security on each device', P10: 'a Backup Failover router at each site', P24: 'ask us about a pilot once you cross 10 employees', P11: 'leased lines already include static IPs', P22: 'a standard router Wi-Fi', P09: 'a second mobile line as backup' };
  let lineList = picks.map(x => ({ id: x.id, qty: x.qty, selected: true }));
  let checked = validateBundle(lineList, profile);
  for (const c of checked.filter(c => !c.ok)) excluded.push({ id: c.id, reasons: c.reasons, altText: ALT[c.id] });
  const kept = picks.filter(x => checked.find(c => c.id === x.id).ok);

  // 5. keep the core bundle within a sensible budget for the segment; overflow becomes add-ons
  const budget = p.budget || BUDGET[seg];
  const PRIORITY = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P19', 'P15', 'P16', 'P09', 'P20', 'P17', 'P24', 'P21', 'P25', 'P23', 'P10', 'P12', 'P14', 'P22', 'P18', 'P11', 'P13'];
  // connectivity first, then what the owner explicitly asked for, then our suggestions
  const NEED_OF = { P09: 'backup', P19: 'pos', P15: 'whatsapp', P14: 'sms', P23: 'cctv', P16: 'email', P20: 'security', P21: 'security', P18: 'website', P12: 'phone', P13: 'phone', P22: 'wifi', P24: 'iot', P25: 'fleet', P17: 'storage' };
  const rank = x => (['P01', 'P02', 'P03', 'P04', 'P05', 'P06'].includes(x.id) ? 0 : p.needs && p.needs.includes(NEED_OF[x.id]) ? 100 : 200) + PRIORITY.indexOf(x.id);
  kept.sort((a, b) => rank(a) - rank(b));
  let running = 0, budgetTrimmed = false;
  for (const x of kept) {
    const pr = productById[x.id].priceMax * x.qty;
    if (x.core && running + pr > budget && !['P01', 'P02', 'P03', 'P04', 'P05', 'P06'].includes(x.id)) { x.core = false; budgetTrimmed = true; }
    if (x.core) running += pr;
  }
  const items = kept.map(x => ({ id: x.id, name: productById[x.id].name, qty: x.qty, unit: productById[x.id].unit, selected: x.core, core: x.core, why: why(lang, x.id) }));
  const q = quote(items.map(i => ({ id: i.id, qty: i.qty, selected: i.selected })), profile, 12);
  const uniqExcluded = [];
  for (const e of excluded) if (!uniqExcluded.find(x => x.id === e.id) && !kept.find(k => k.id === e.id)) uniqExcluded.push({ id: e.id, name: productById[e.id].name, reasons: e.reasons, alternative: e.alt ? productById[e.alt].name : e.altText || '' });
  return { segment: seg, segmentName: SEG_NAME[seg], profile, items, excluded: uniqExcluded, quote: q, budget, budgetTrimmed };
}

function recommendationMessage(s, rec) {
  const p = s.profile, L = s.lang;
  const out = [t(L, 'rec_intro', { type: p.businessType, emp: p.employees, sites: p.sites, plural: p.sites > 1 ? 's' : '', city: p.city || 'tier ' + p.tier })];
  for (const i of rec.items.filter(i => i.core)) out.push(`• ${i.name}${i.qty > 1 ? ' ×' + i.qty : ''} - ${i.why}`);
  out.push(t(L, 'rec_total', { monthly: rec.quote.monthly.toLocaleString('en-IN'), setup: rec.quote.oneTime.toLocaleString('en-IN'), days: rec.quote.installDays }));
  if (rec.budgetTrimmed) out.push(t(L, 'budget_note', { budget: rec.budget.toLocaleString('en-IN') }));
  if (rec.excluded.length) {
    out.push(t(L, 'rec_excluded'));
    for (const e of rec.excluded) out.push(`• ${e.name}: ${e.reasons.join('; ')}${e.alternative ? ' - ' + t(L, 'alt', { alt: e.alternative }) : ''}`);
  }
  if (p.gstin === 'none' || p.gstin === 'inactive') out.push(t(L, 'rec_nogst'));
  return out.join('\n');
}

// ---------- post-recommendation edits: add / remove / cheaper / human ----------
const PRODUCT_WORDS = [
  [/cctv|camera|कैमरा/i, 'P23'], [/whats ?app/i, 'P15'], [/\bsms\b/i, 'P14'], [/backup|failover/i, 'P09'], [/pos|billing/i, 'P19'],
  [/email|mail/i, 'P16'], [/antivirus|endpoint/i, 'P20'], [/firewall/i, 'P21'], [/website/i, 'P18'], [/wi-?fi/i, 'P22'],
  [/static ip/i, 'P11'], [/toll.?free/i, 'P13'], [/ivr|telephony|phone line/i, 'P12'], [/sd-?wan/i, 'P10'], [/leased line/i, 'P05'],
  [/1 ?g(bps)?|gigabit/i, 'P03'], [/airfiber|5g/i, 'P04'], [/storage|cloud backup/i, 'P17'], [/iot|machine/i, 'P24'], [/fleet|gps|vehicle/i, 'P25'],
];
function editIntent(text) {
  const tx = text.toLowerCase();
  if (/human|agent|expert|call me|sales ?person|someone|talk to|विशेषज्ञ|बात करनी|कॉल करो|तज्ञ|நிபுணர்/i.test(tx)) return { intent: 'human' };
  if (/cheap|less|lower|reduce|discount|budget|सस्ता|कम|स्वस्त|மலிவு/i.test(tx) && !/add/i.test(tx)) return { intent: 'cheaper' };
  const prod = PRODUCT_WORDS.find(([re]) => re.test(tx));
  if (prod && /remove|drop|delete|don'?t need|no need|without|हटा|नहीं चाहिए|नको|வேண்டாம்/i.test(tx)) return { intent: 'remove', id: prod[1] };
  if (prod && /add|want|need|include|also|चाहिए|जोड़|हवे|வேண்டும்/i.test(tx)) return { intent: 'add', id: prod[1] };
  return null;
}

module.exports = { parseText, newSession, applyUpdates, missingSlot, recommend, recommendationMessage, chipsFor, editIntent, effectiveSegment, SLOTS, SEG_NAME };
