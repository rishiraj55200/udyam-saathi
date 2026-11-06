// Scenario tests for the advisor: free-text in several languages, eligibility rules and dependencies.
process.env.DISABLE_LLM = process.env.WITH_LLM ? '' : '1';
const advisor = require('../src/advisor');
const conversation = require('../src/conversation');
const { validateBundle } = require('../src/rules');

const scenarios = [
  { name: 'Kirana tier-2, no GST', lang: 'en', turns: ['I have a kirana store in Nagpur, 2 people, one shop, no GST', 'hotspot', { value: 'pos,whatsapp' }], expect: { notIncluded: ['P15', 'P14', 'P03'], includes: ['P01', 'P19'] } },
  { name: 'Dental clinic Pune 8 staff GST', lang: 'en', turns: ['Dental clinic in Pune with 8 staff, single location, we have GST', 'business broadband', { value: 'email,security,sms' }], expect: { includes: ['P02', 'P16', 'P20', 'P14'] } },
  { name: 'Hindi: CA office Lucknow', lang: 'hi', turns: ['लखनऊ में मेरा CA ऑफिस है, 6 लोग काम करते हैं, एक ब्रांच, GST है', 'घर का ब्रॉडबैंड', { value: '__skip' }], expect: { includes: ['P02', 'P16'] } },
  { name: 'Manufacturer tier-2 wants 1G', lang: 'en', turns: ['Auto parts factory in Ludhiana, 40 workers, 1 site, GST registered', 'leased line', { value: 'iot,security' }], expect: { includes: ['P05', 'P24', 'P21'], notIncluded: ['P03'] } },
  { name: 'Restaurant chain 6 outlets Mumbai', lang: 'en', turns: ['Restaurant chain in Mumbai, 6 outlets, 60 staff, GST yes', 'mixed', { value: 'backup,pos,cctv,wifi' }], expect: { includes: ['P02', 'P09', 'P19', 'P23', 'P10'] } },
  { name: 'Small office 2 sites wants SD-WAN', lang: 'en', turns: ['Coaching centre in Indore, 12 staff, 2 branches, GST yes', 'home', { value: 'backup' }], expect: { notIncluded: ['P10'] } },
  { name: 'Solo salon Kochi budget 1500', lang: 'en', turns: ['salon in kochi, only me, one shop, no GST, budget 1500', 'hotspot', { value: 'cctv,wifi' }], expect: { includes: ['P01'], notIncluded: ['P15'] } },
  { name: 'Marathi: pharmacy Nashik', lang: 'mr', turns: ['नाशिक मध्ये औषध दुकान आहे, 3 लोक, एक दुकान, GST आहे', 'hotspot', { value: 'pos,whatsapp' }], expect: { includes: ['P01', 'P19', 'P15'] } },
  { name: 'Tamil: clinic Chennai', lang: 'ta', turns: ['சென்னையில் என் பல் மருத்துவமனை, 8 பேர் வேலை செய்கிறார்கள்', '1', { value: 'yes' }, { value: 'business' }, { value: 'email,security' }], expect: { includes: ['P02', 'P16'] } },
  { name: 'Cancelled GSTIN typed', lang: 'en', turns: ['Travel agency in Visakhapatnam, 4 people, 1 office', '37IHKXV5167L1ZS', 'home', { value: 'whatsapp' }], expect: { notIncluded: ['P15'] } },
];

(async () => {
  let pass = 0;
  for (const sc of scenarios) {
    const s = advisor.newSession(sc.lang);
    conversation.start(s);
    let last;
    for (const tn of sc.turns) last = await conversation.turn(s, typeof tn === 'string' ? { text: tn } : tn);
    const rec = s.recommendation;
    const ids = rec ? rec.items.map(i => i.id) : [];
    const problems = [];
    if (!rec) problems.push('no recommendation; stuck at ' + s.expecting + ' :: ' + JSON.stringify(s.profile));
    for (const x of sc.expect.includes || []) if (!ids.includes(x)) problems.push('missing ' + x);
    for (const x of sc.expect.notIncluded || []) if (ids.includes(x)) problems.push('should not include ' + x);
    if (rec) {
      const bad = validateBundle(rec.items.map(i => ({ id: i.id, qty: i.qty, selected: true })), rec.profile).filter(c => !c.ok);
      if (bad.length) problems.push('rule violations: ' + bad.map(b => b.id + ' ' + b.reasons).join(', '));
    }
    console.log((problems.length ? 'FAIL ' : 'PASS ') + sc.name.padEnd(36), rec ? `${rec.segment} core=₹${rec.quote.monthly} [${rec.items.map(i => i.id + (i.core ? '' : '?') + 'x' + i.qty).join(' ')}] excl=[${rec.excluded.map(e => e.id).join(',')}]` : '', problems.join('; '));
    if (process.argv.includes('-v')) console.log(last.messages.join('\n'), '\n');
    if (!problems.length) pass++;
  }
  console.log(`${pass}/${scenarios.length} passed`);
})();
