// Blank the pool-detail page's inherited figures IN THE MARKUP. Ported from the XRPL fork's
// _xrplpooldetailmock.js, with the same reasoning: the design ships a pool that does not exist -- "Pool ID:
// a468d4…0088", "0.000713 APT", "$0.000108 per LUMOS", 847 participants -- and a script at the end of the
// body cannot beat the first paint of the document that carries it. A value that must never be seen has to
// not be in the file.
//
// Three NEAR additions:
//   * the PHONE's participants pill reads "847 total" in a .card-head, which the XRPL rule (scoped to the
//     desktop .side-head) never matched. It sits in a tab panel and has no gate.
//   * the "Back to Pools" crumb links to /pools/stellar -- the Stellar base's own href. A NEAR pool page
//     sending its reader to the Stellar list is a wrong-chain link, fixed at the source here (pooldetail.js
//     also sets it at runtime).
//   * replacements are FUNCTIONS, never replacement strings: a "$" pattern in a replacement string
//     corrupted a file in this project once already.
//
// Targeted by the mock's own content rather than by structure, so a rearranged template cannot make it take
// a real value with it. Idempotent: once the mock is gone there is nothing to match. Aborts if no detail page
// is found, or if a first run (mock still present) matches nothing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const keep = (a, b) => (m, x, y) => x + y;      // keep the two captured halves, drop what was between
const RULES = [
  { id: 'count', find: /(<div class="side-head">[\s\S]{0,200}?<span class="count-pill">)\d[\d,]*(<\/span>)/g, fn: keep() },
  { id: 'count-phone', find: /(<span class="count-pill">)\d[\d,]* total(<\/span>)/g, fn: keep() },
  { id: 'poolid', find: /(<div class="ph-id">\s*<span>)(?:Pool )?ID: a468d4[^<]*(<\/span>)/g, fn: keep() },
  { id: 'copy', find: /data-copy="a468d4[^"]*"/g, fn: () => 'data-copy=""' },
  { id: 'price', find: /(<div class="(?:v|value)">)0\.000713 APT(<\/div>)/g, fn: keep() },
  { id: 'pricesub', find: /(<div class="(?:s|vs)">)\$0\.000108[^<]*(<\/div>)/g, fn: keep() },
  { id: 'crumb', find: /<a href="\/pools\/stellar" data-lxback="1">/g, fn: () => '<a href="/pools/near" data-lxback="1">' },
];

let pages = 0, detailPages = 0;
const applied = {};
const staged = [];
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — aborting'); process.exit(1); }
  const { json, s, e } = getContents(data);
  let touched = 0;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    if (json[key].indexOf('class="ph-id"') < 0) continue;          // the pool detail pages, and only those
    detailPages++;
    let h = json[key];
    const before = h;
    for (const r of RULES) {
      const n = (h.match(r.find) || []).length;
      if (!n) continue;
      h = h.replace(r.find, r.fn);
      applied[r.id] = (applied[r.id] || 0) + n;
      touched += n;
    }
    if (h !== before) { json[key] = h; pages++; }
  }
  staged.push({ file, data, s, e, json, touched });
}

if (!detailPages) { console.error('near pool detail mock: ABORT — no page carries class="ph-id"; has the detail page moved?'); process.exit(1); }
// A present mock that matched nothing is the silent failure: check the containers for the mock's tell.
for (const st of staged) {
  for (const k of Object.keys(st.json)) {
    const h = st.json[k];
    if (typeof h === 'string' && h.indexOf('class="ph-id"') >= 0 && /ID: a468d4/.test(h)) {
      console.error('near pool detail mock: ABORT — ' + k + ' still carries the mock pool id after the rules ran'); process.exit(1);
    }
  }
}
for (const st of staged) {
  if (!st.touched) continue;
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
}
const total = Object.keys(applied).reduce((n, k) => n + applied[k], 0);
console.log('near pool detail mock: ' + total + ' figure(s) blanked on ' + pages + ' of ' + detailPages + ' detail page key(s)'
  + (total ? ' — ' + Object.keys(applied).map((k) => k + ':' + applied[k]).join(', ') : ' (already clean)'));
