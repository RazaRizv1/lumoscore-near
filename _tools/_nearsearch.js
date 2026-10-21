// Replace the inherited Stellar header search with a NEAR one, on every page. PORTED FROM the XRPL fork's
// _xrplsearch.js.
//
// The browser code is READ FROM FILES and injected verbatim, never assembled as strings here:
//   browser/nearcore.js  window.lxnCore: the curated list (/lxapi/nearmarket), FastNEAR RPC for the exact-id
//                        lookup, the account-id rule. Guarded, so the Wallet and Account pages, which carry
//                        it too, run it once.
//   browser/search.js    the panel: tokens, pools, the ledger-first exact id, recents, the header launcher
//
// STRIPPED, from EVERY page key (not only those with the panel -- lx-searchassets fetches /lxapi/assetmeta
// on load whether or not there is a panel to fill):
//   lx-searchassets (~56KB)  Stellar's search: stellar.expert / /lxapi/assetsearch, /lxapi/assetmeta on every
//                            load, Stellar rows linking /trade/stellar and /account/stellar. Its one piece of
//                            shared behaviour -- the topbar search box opening the panel -- is carried over
//                            into search.js unchanged.
//   lx-spico       (~176KB)  a ticker -> Stellar-logo map that paints any .sp-ico without an image, by TICKER.
//                            A ticker is not an identity on NEAR either; every row search.js draws carries its
//                            own image, so the map has nothing honest left to do. (XRPL precedent.)
// KEPT: lx-searchctl (the design's heading/empty-box control), lx-mobsearch (the phone's header button,
// which opens the same panel), and the stylesheets (lx-searchassets-css styles the .lx-searow rows, the
// recents head and the pool discs search.js draws).
//
// MARKUP: the panel's heading "Assets on Stellar (12)" -> "Assets on NEAR" with an EMPTY count: the (12) is
// the design's mock, and it was the first thing painted. Exactly one heading per panel page, or abort.
//
// Idempotent: blocks are stripped by id before the new one is added; a heading already in NEAR form counts.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearsearch';
const KILL = ['lx-searchassets', 'lx-spico'];
const core = fs.readFileSync(__dirname + '/browser/nearcore.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/search.js', 'utf8');
for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

// [from, to]: the landing page's panel says just "Assets" and keeps that wording; only its mock count goes.
const HEADS = [
  ['<h4>Assets on Stellar <span class="count" id="spAssetCount">(12)</span></h4>', '<h4>Assets on NEAR <span class="count" id="spAssetCount"></span></h4>'],
  ['<h4>Assets <span class="count" id="spAssetCount">(12)</span></h4>', '<h4>Assets <span class="count" id="spAssetCount"></span></h4>'],
];

let files = 0, pages = 0, heads = 0, bytes = 0;
const removed = {};
for (const k of KILL) removed[k] = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    const before = h.length;
    for (const k of KILL) {
      const g = stripById(h, k);
      if (g.removed) { removed[k] += g.removed; h = g.html; }
    }
    bytes += before - h.length;

    if (h.indexOf('id="spAssetList"') >= 0) {
      let found = 0;
      for (const [from, to] of HEADS) {
        const n = h.split(from).length - 1;
        if (n) { h = h.split(from).join(to); heads += n; }
        found += n + (h.split(to).length - 1 - n);
      }
      if (found > 1) { console.error('  ABORT ' + key + ': panel heading found ' + found + ' times'); process.exit(1); }
      if (found === 0) { console.error('  ABORT ' + key + ': no panel heading in either form — did the design move?'); process.exit(1); }

      h = stripById(h, ID).html;
      const bi = h.lastIndexOf('</' + 'body>');
      if (bi < 0) { console.error('  ABORT ' + key + ': no closing body'); process.exit(1); }
      h = h.slice(0, bi) + SCRIPT + h.slice(bi);
      pages++;
    }
    json[key] = h;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near search: layer on ' + pages + ' page key(s) across ' + files + ' container(s); headings ' + heads
  + '; stripped ' + JSON.stringify(removed) + ' (' + (bytes / 1024).toFixed(0) + ' KB)');
if (!pages) { console.error('  ! no page carried id="spAssetList" — nothing was wired'); process.exit(1); }
