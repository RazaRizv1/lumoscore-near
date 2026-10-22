// The LUMOS token page under /lumos/near: LUMOS is not on NEAR yet, so it shows LUMOS on Stellar and must say
// so. Injects browser/nearlumospage.js (notice, Stellar labels, Stellar-only actions sent to the Stellar page)
// and fixes the two static labels the chain engine would otherwise reskin to NEAR: the "≈ x APT" price meta
// (lx-ltdata only fills it while it reads "XLM") and the "LUMOS / APT" pool row. The Hedera fork's
// _hederalumospage.js, minus Rewards (RAZA 2026-10-22: "skip rewards on Near for now").
//
// Once LUMOS is on NEAR (_tools/near-lumos.js), this STRIPS its layer instead: the page then needs NEAR's own
// LUMOS, which is release work. Idempotent: our block is stripped by id first.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const { NEAR_LUMOS } = require(__dirname + '/near-lumos.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearlumospage';
const src = fs.readFileSync(__dirname + '/browser/nearlumospage.js', 'utf8');
if (src.indexOf('</' + 'script') >= 0) { console.error('  nearlumospage.js contains a closing script tag — aborting'); process.exit(1); }
const SCRIPT = '<script id="' + ID + '">\n' + src + '\n</' + 'script>';
const PAGE = /^lumoscore-lumos-token(-dark|-light|-mobile)?\.html$/;

// While this page shows LUMOS ON STELLAR, its Swap and Add Liquidity go to /lumos/stellar (the layer below),
// so Stellar's swap dialog (lx-swapcalc) and open-orders layer (lx-qorders) can never be used here. They still
// ran: lx-swapcalc quoted on load with its chip reskinned to "NEAR" — a Horizon strict-send for an asset coded
// NEAR, found by the monitor bot 2026-10-22 — and both carry the Stellar signer (window.lxSign). Stripped.
// lx-ltdata stays: it draws the Stellar LUMOS figures, and its one use of their globals is guarded.
const DEAD_HERE = ['lx-swapcalc', 'lx-qorders'];

let injected = 0, labels = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const key of Object.keys(json)) {
    if (!PAGE.test(key) || typeof json[key] !== 'string') continue;
    let h = stripById(json[key], ID).html;
    const before = h;
    h = h.split('<div class="price-native">≈ 0.00043 APT').join('<div class="price-native">≈ 0.00043 XLM')
         .split('<div class="pair-name">LUMOS / APT').join('<div class="pair-name">LUMOS / XLM');
    if (h !== before) labels++;
    if (!NEAR_LUMOS) {
      for (const id of DEAD_HERE) { const r = stripById(h, id); h = r.html; stripped += r.removed; }
      const bi = h.lastIndexOf('</' + 'body>');
      if (bi < 0) { console.error('ABORT ' + key + ': no closing body'); process.exit(1); }
      h = h.slice(0, bi) + SCRIPT + h.slice(bi);
      injected++;
    }
    json[key] = h;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near lumos page: ' + (NEAR_LUMOS ? 'layer REMOVED (LUMOS on NEAR)' : 'layer on ' + injected + ' page key(s)')
  + ', static labels fixed on ' + labels + ', Stellar swap/orders layers stripped ' + stripped);
if (!NEAR_LUMOS && injected !== 3) { console.error('  ! expected 3 page keys (lumos-token x3), got ' + injected); process.exit(1); }
