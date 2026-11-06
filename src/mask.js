// Masking helpers: identifiers never appear in full in logs, the back office, or API responses that don't need them.
const maskGstin = g => (g && g.length === 15 ? g.slice(0, 2) + 'XXXXX' + g.slice(7, 11).replace(/./g, 'X') + g.slice(11) : g ? '***' : '');
const maskUdyam = u => (u ? u.replace(/\d{4}(\d{3})$/, 'XXXX$1') : '');
const maskName = n => (n ? n.split(/\s+/).map(w => w[0] + '*'.repeat(Math.max(1, w.length - 1))).join(' ') : '');
const maskPhone = p => (p ? 'XXXXXX' + String(p).slice(-4) : '');
const maskId = id => (id ? id.replace(/\d(?=\d{2})/g, 'X') : '');

// Safe logger: strips anything that looks like a GSTIN / Udyam / phone before it reaches stdout.
function safeLog(...args) {
  const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, m => maskGstin(m))
    .replace(/UDYAM-[A-Z]{2}-\d{2}-\d{7}/g, m => maskUdyam(m))
    .replace(/\b[6-9]\d{9}\b/g, m => maskPhone(m));
  console.log(new Date().toISOString(), s);
}

module.exports = { maskGstin, maskUdyam, maskName, maskPhone, maskId, safeLog };
