// Replace the Pools page's inherited Stellar layer with a NEAR one. Ported from the XRPL fork's
// _xrplpools.js (and the create-pool wiring of _xrplcreatepool.js, without its signing).
//
// `lx-ammdata` (~324KB, measured 2026-10-21) is Stellar's AMM layer. On the XRPL fork's frozen base it sat on
// four pages; Stellar has since spread it to EVERY page key -- 125 of the 126 in the NEAR containers (all but
// the desktop $LUMOS page). It walks Horizon, fills the Pools table, the pool page, the hero chip and the
// dashboard's pool widgets with STELLAR pools priced in XLM, and drives the Create Pool dialog with the
// account's Stellar holdings. It is the wrong chain on every one of those pages, so it is stripped from
// every key that carries it. Its window.lxNavigate wrapper goes with it; every caller of lxNavigate on these
// pages already falls back to location.href when it is absent (checked: home, dex-asset, docs-faq).
//
// It is INJECTED only where the thing it replaces lives:
//   lx-nearpools        browser/pools.js + browser/mypositions.js, on the Pools list (desktop #poolsBody,
//                       phone #panelAll). NOT on the $LUMOS page, whose #poolsBody is a different table.
//   lx-nearcreatepool   browser/createpool.js, wherever the design's #createPoolModal can be opened (the
//                       Pools pages and the dashboard). Without lx-ammdata, nothing else takes the clicks on
//                       the dialog's asset pickers, and the design's nav shim answers them by leaving the page.
// The pool detail page is _nearpooldetail.js.
//
// INHERITED WRITERS ON THE POOLS LIST, inventoried on the NEAR containers 2026-10-21 (every <script> on the
// amm page keys naming a pools id or class):
//   lx-ammdata                    Stellar's data layer -- STRIPPED here.
//   unnamed "Create Pool modal open/close" script: opens/closes the dialog, switches the All/My tabs, filters
//                                 the drawn rows on input, and sends every `tr[data-pool]` row to
//                                 __lxNav('lumoscore-amm-pool.html'). KEPT, as XRPL keeps it: the open/close
//                                 and tabs are the design's; its search listener is pre-empted at window
//                                 capture by pools.js, and its row listener was bound at DOMContentLoaded to
//                                 the design's mock rows, which pools.js replaces (our rows carry no
//                                 data-pool, and claimRowClicks navigates first at window capture).
//   unnamed asset-picker script   the dialog's dropdowns over the design's mock rows. KEPT; the mock rows are
//                                 hidden by the inherited `.ad-item:not(.lx-cpitem)` rule and createpool.js
//                                 takes the picker clicks first.
//   unnamed lcm fade-in reveal, lx-sidecard, lx-poolshero, lx-tabfix   layout only -- KEPT. pools.js and
//                                 mypositions.js lift the fade-in gate on what they write, and give
//                                 _sidecard its pager anchor (lx-netpag-host), as on XRPL.
//   the logo healer               kept; the layer uses its opt-outs (data-paired, data-logoed, svg/img children).
//
// Browser code is read from files and injected verbatim -- no browser code in quoted strings here.
// Idempotent: every block is stripped by id before being added again. Aborts when an anchor is missing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearpools';
const CP_ID = 'lx-nearcreatepool';
const pools = fs.readFileSync(__dirname + '/browser/pools.js', 'utf8');
const mine = fs.readFileSync(__dirname + '/browser/mypositions.js', 'utf8');
const cp = fs.readFileSync(__dirname + '/browser/createpool.js', 'utf8');
for (const src of [pools, mine, cp]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + pools + '\n' + mine + '\n</' + 'script>';
const CP_SCRIPT = '<script id="' + CP_ID + '">\n' + cp + '\n</' + 'script>';

const hasList = (x) => x.indexOf('id="poolsBody"') >= 0 || x.indexOf('id="panelAll"') >= 0;
// The desktop $LUMOS page, by its MARKUP. The bare class name also appears inside pools.js itself (its own
// guard), so matching the name alone made every page this transform had injected look like the $LUMOS page.
const isLumosPage = (x) => x.indexOf('class="lumos-hero-row') >= 0;

function beforeBody(h, block, key) {
  const bi = h.lastIndexOf('</' + 'body>');
  if (bi < 0) { console.error('  ' + key + ': no closing body — aborting'); process.exit(1); }
  return h.slice(0, bi) + block + h.slice(bi);
}

let files = 0, stripped = 0, injected = 0, cpInjected = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — aborting'); process.exit(1); }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    const before = h;

    const gone = stripById(h, 'lx-ammdata');
    h = gone.html;
    stripped += gone.removed;
    h = stripById(h, ID).html;
    h = stripById(h, CP_ID).html;

    const lumos = isLumosPage(h), list = hasList(h), modal = h.indexOf('id="createPoolModal"') >= 0;   // read before injecting
    if (list && !lumos) { h = beforeBody(h, SCRIPT, key); injected++; }
    if (modal && !lumos) { h = beforeBody(h, CP_SCRIPT, key); cpInjected++; }

    if (h !== before) json[key] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('near pools: stripped lx-ammdata from ' + stripped + ' page key(s); injected ' + ID + ' on ' + injected
  + ' and ' + CP_ID + ' on ' + cpInjected + ' page key(s) across ' + files + ' container(s)');
if (!injected) { console.error('  ! no page carried #poolsBody / #panelAll — nothing was wired'); process.exit(1); }
if (!cpInjected) { console.error('  ! no page carried #createPoolModal — the dialog was not held'); process.exit(1); }
