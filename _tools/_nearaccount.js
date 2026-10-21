// Inject the NEAR Account page layer (/account/near/<account id>). PORTED FROM the XRPL fork's _xrplaccount.js.
//
// The browser code is READ FROM FILES and injected verbatim, never assembled as strings here:
//   browser/nearcore.js  the NEAR reads the Wallet page uses (balances, token metadata, NearBlocks activity),
//                        shared rather than copied -- guarded, so a page carrying it twice runs it once
//   browser/account.js   the page: header, stats, Assets (with the design's pager), Pools, Recent activity
//
// THE INHERITED STELLAR LAYERS ON THIS PAGE, measured 2026-10-21, and what happens to each:
//   lx-accdata   Stellar's account layer (Horizon, stellar.expert, /lxapi/xlm). On /account/near/root.near it
//                read the id as no G-address and printed "No Stellar address in this link." STRIPPED.
//   lx-feerate   asks Horizon /accounts/<lumos.address> for the LUMOS fee tier on every load -- with a NEAR
//                wallet connected that is a request for root.near on the Stellar network. Nothing on this page
//                reads the tier (every __lxFeeRate / __lxAcct / lx:feetier reference here is inside the block
//                itself). STRIPPED on this page only; other pages are not this workstream.
//   lx-qrlib     the QR generator the design's QR button draws with. KEPT.
//   lx-identfn   window.lxIdent, the identicon. KEPT.
//   lx-acc-css   the design's own account stylesheet. KEPT -- everything account.js draws uses its classes.
//
// MARKUP, each an exact string with an exact expected count per page key, or the build aborts:
//   the "XLM balance" stat label                -> "NEAR balance"  (it was the first thing painted)
//   the network badge's title="Stellar"         -> title="NEAR", and NEAR's logo on it in markup
//   the phone crumb's /pools/stellar            -> /pools/near     (a link to the wrong chain's Pools)
//
// Idempotent: blocks are stripped by id before the new one is added, and a markup pair whose NEAR form is
// already present counts as done.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearaccount';
const STRIP = ['lx-accdata', 'lx-feerate'];
const core = fs.readFileSync(__dirname + '/browser/nearcore.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/account.js', 'utf8');
for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

// [from, to, appliesTo(key)]
const PAIRS = [
  ['<span class="l">XLM balance</span>', '<span class="l">NEAR balance</span>', () => true],
  ['id="accNet" title="Stellar"', 'id="accNet" title="NEAR"', () => true],
  // ...and NEAR's mark in the badge from the first paint (measured: an empty disc for ~40ms on a cold load
  // before account.js set it -- a placeholder -> logo swap, GUARDRAILS B7).
  ['<span class="acc-net" id="accNet" title="NEAR"></span>',
    '<span class="acc-net" id="accNet" title="NEAR" style="background-image:url(/assets/networks/near.png);background-size:cover"></span>', () => true],
  ['<a class="back-link" href="/pools/stellar" data-lxback="1">', '<a class="back-link" href="/pools/near" data-lxback="1">',
    (k) => /-mobile\.html$/.test(k)],
];

let files = 0, pages = 0;
const per = {}, hits = PAIRS.map(() => 0);
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (h.indexOf('id="accAssetsTbl"') < 0) continue;

    for (const sid of STRIP) {
      const g = stripById(h, sid);
      h = g.html;
      if (g.removed) per[sid] = (per[sid] || 0) + g.removed;
    }
    PAIRS.forEach(([from, to, applies], i) => {
      if (!applies(key)) return;
      const n = h.split(from).length - 1;
      if (n > 1) { console.error('  ABORT ' + key + ': "' + from + '" found ' + n + ' times'); process.exit(1); }
      if (n === 1) { h = h.split(from).join(to); hits[i]++; return; }
      if (h.indexOf(to) < 0) { console.error('  ABORT ' + key + ': neither "' + from + '" nor its NEAR form — did the design move?'); process.exit(1); }
    });

    h = stripById(h, ID).html;
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near account: layer on ' + pages + ' page key(s) across ' + files + ' container(s); stripped '
  + JSON.stringify(per) + '; markup ' + JSON.stringify(hits));
if (!pages) { console.error('  ! no page carried id="accAssetsTbl" — nothing was wired'); process.exit(1); }
