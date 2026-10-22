// Visible Stellar wording on NEAR pages that is SHARED page furniture, not a feature's own copy.
//
// Each pair is an exact markup string with its NEAR replacement, decided one by one — the same rule as
// _nearseo.js, never a regex over "Stellar". Feature copy (trustlines and XLM reserves, the listing fee
// in XLM, the Stellar network fee lines, FAQ answers) is NOT here: it is rewritten in the workstream
// that builds the NEAR version of that feature, so no sentence ever describes a feature that does not
// exist yet. Measured before writing this: 2,133 body mentions of Stellar/XLM across 96 built pages,
// most of them feature copy.
//
// Wording mirrors the XRPL fork's for the same strings, with NEAR where it says "the XRP Ledger".
// "the NEAR DEX" is the product's own DEX on NEAR; NEAR itself has no built-in exchange, which is why
// the sub-line says "on NEAR" rather than "on NEAR's decentralized exchange".
//
// Every pair must match somewhere, or the build aborts: zero hits means the design moved and a string
// would silently stay Stellar. Idempotent: replaced text no longer matches, and a pair whose NEAR form
// is already present counts as done rather than missing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const PAIRS = [
  // The search panel's footer, on every page with the search.
  ['<span>Search assets, pools and wallets on Stellar.</span>',
   '<span>Search assets, pools and wallets on NEAR.</span>'],
  // The Trade hero.
  ['<h1>Explore the <em>Stellar</em> DEX</h1>',
   '<h1>Explore the <em>NEAR</em> DEX</h1>'],
  // The phone's Trade heading: visually hidden, read aloud and indexed (found by the 2026-10-22 phone sweep).
  ['<h1 class="page-title lx-sronly">Explore the <span class="hl">Stellar</span> DEX</h1>',
   '<h1 class="page-title lx-sronly">Explore the <span class="hl">NEAR</span> DEX</h1>'],
  ['Discover, trade, and launch tokens on Stellar\'s decentralized exchange.',
   'Discover, trade, and launch tokens on NEAR.'],
  // The Pools strapline (desktop .dex-hero-sub, phone .page-subtitle.lx-sronly). browser/pools.js also
  // rewrites it at run time; this makes the served HTML, which search engines index, say NEAR too.
  ['Provide liquidity and earn fees on Stellar\'s on-chain AMM pools.',
   'Provide liquidity and earn fees on Rhea\'s pools on NEAR.'],
  // Screen-reader headings (visually hidden, read aloud and indexed).
  ['<h1 class="lx-srh1">Your Stellar wallet', '<h1 class="lx-srh1">Your NEAR wallet'],
  ['<h1 class="lx-srh1">Stellar liquidity pool', '<h1 class="lx-srh1">NEAR liquidity pool'],
];

const hits = PAIRS.map(() => 0), done = PAIRS.map(() => 0);
let files = 0, pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string') continue;
    const before = h;
    PAIRS.forEach(([from, to], i) => {
      const n = h.split(from).length - 1;
      if (n) { h = h.split(from).join(to); hits[i] += n; }
      else if (h.indexOf(to) >= 0) done[i]++;
    });
    if (h !== before) { json[key] = h; pages++; }
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
const missing = PAIRS.filter((p, i) => !hits[i] && !done[i]);
if (missing.length) {
  console.error('near copy ABORT: these strings were found nowhere — did the design move?\n  '
    + missing.map((p) => p[0]).join('\n  '));
  process.exit(1);
}
console.log('near copy: ' + hits.reduce((a, b) => a + b, 0) + ' replacement(s) on ' + pages + ' page key(s) across ' + files + ' container(s)');
PAIRS.forEach((p, i) => console.log('   ' + String(hits[i]).padStart(4) + ' new, ' + String(done[i]).padStart(4) + ' already  ' + p[1].slice(0, 60)));
