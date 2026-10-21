// Replace the Trade-Asset page's inherited Stellar layer with a NEAR one. Ported from the XRPL fork's
// _xrpldexasset.js WITHOUT its limit-order, swap and fee-collector layers (those are a later phase), so
// only browser/dexasset.js is injected and no core library.
//
// `lx-dxadata` (~337KB) is Stellar's page layer. It ignores the token in the URL and renders Stellar LUMOS
// -- XLM prices, Stellar holders, a title naming Stellar -- and the NEAR Trade table now links every row
// here, so it goes with this layer rather than racing it.
//
// INHERITED WRITERS ON THE SAME ELEMENTS, inventoried on the NEAR containers 2026-10-21 (every <script> on
// the page keys that names a dex-asset id or class):
//   lx-dxadata            Stellar's data layer -- STRIPPED here.
//   unnamed design script the design's own chart / order book / tabs with Aptos sample data. KEPT, as the
//                         XRPL build keeps it: it owns the tab switching, the trade-pane tabs and the
//                         Buy/Sell toggle, and every element it fills is either gated by the design's own
//                         lx-dxa-css (.lxda / .lxp) or replaced by this layer in the same frame (the
//                         panel observer in browser/dexasset.js). Disabling it would take those controls.
//   the 128KB logo healer kept; the layer uses its opt-outs (data-logoed, data-lxc, svg/img children).
//   lx-mobtrade (phone)   kept, as on XRPL: it aliases the phone's classes and clears the "100" inputs. It
//                         also stamps an XLM mark on the phone's chips; the head stylesheet below lets the
//                         layer's data-lxxc / --lxx-logo win, the same two hooks the XRPL limit layer uses.
//   lx-feemodal, lx-gate, lx-tradeprefill, lx-feetier, lx-wrongchain-js
//                         touch the trade panel only through its action buttons, which this layer disables
//                         until NEAR swaps exist.
//
// THE HEAD STYLESHEET (lx-neardexasset-css) exists because the design's gates do not cover everything the
// layer replaces: the trade panel's Buy/Sell labels, its chips and pre-filled inputs, the phone's summary
// values, the order-book headings, and the exchanges table / filters / footer all paint the Aptos mock on
// first paint otherwise. A <style> in <head> is parsed before the first paint; one created by the script
// at the end of <body> may not be. The layer lifts them by adding html.lxn-dxa / html.lxn-dxa-id.
//
// Idempotent: both blocks are removed by id before being added again. Aborts when an anchor is missing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-neardexasset';
const CSS_ID = 'lx-neardexasset-css';
const page = fs.readFileSync(__dirname + '/browser/dexasset.js', 'utf8');
// Market SWAP, after dexasset.js in the same block (RAZA approved wiring it 2026-10-21): nearswap.js is the
// engine (Rhea routing, 0.2% fee to FEE_ACCOUNT in the same transaction, registration first when needed)
// and dxaswap.js drives the design's swap pane with it. Nothing signs on its own — a person approves every
// transaction in their own wallet — and the CTA stays "coming soon" for any input token the fee account is
// not registered on.
const swapEngine = fs.readFileSync(__dirname + '/browser/nearswap.js', 'utf8');
const swapPane = fs.readFileSync(__dirname + '/browser/dxaswap.js', 'utf8');
for (const [n, src] of [['dexasset.js', page], ['nearswap.js', swapEngine], ['dxaswap.js', swapPane]]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  browser/' + n + ' contains a closing script tag — aborting'); process.exit(1); }
}

const CSS = [
  'html:not(.lxn-dxa) #dxaPanelFilters,html:not(.lxn-dxa) #mdxaPanelFilters,html:not(.lxn-dxa) #dxaPanel .panel-foot,'
    + 'html:not(.lxn-dxa) #dxaPanel .ex-table,html:not(.lxn-dxa) #mdxaExList{visibility:hidden}',
  'html:not(.lxn-dxa-id) [class*="dxa-side-btn"],html:not(.lxn-dxa-id) [class*="dxa-trade-asset"],'
    + 'html:not(.lxn-dxa-id) [class*="dxa-trade-ir"] input,html:not(.lxn-dxa-id) [class*="dxa-trade-cta"],'
    + 'html:not(.lxn-dxa-id) .mdxa-trade-frow .mono,html:not(.lxn-dxa-id) .mdxa-tsum .mono,'
    + 'html:not(.lxn-dxa-id) [class*="dxa-ob-head"] span,html:not(.lxn-dxa-id) [class*="dxa-ob-spread"] .mono{visibility:hidden}',
  '.mdxa-trade-asset.lxmt-chip[data-lxxc]::after{content:attr(data-lxxc)!important}',
  '.mdxa-trade-asset.lxmt-chip[data-lxxc]::before{background-image:var(--lxx-logo,none)!important}',
].join('\n');
if (CSS.indexOf(B) >= 0) { console.error('  stylesheet carries a backslash — aborting'); process.exit(1); }

const STYLE = '<style id="' + CSS_ID + '">\n' + CSS + '\n</style>';
const SCRIPT = '<script id="' + ID + '">\n' + page + '\n' + swapEngine + '\n' + swapPane + '\n</' + 'script>';

function stripStyle(h, id) {
  const open = '<style id="' + id + '">', close = '</style>';
  let n = 0;
  for (;;) {
    const i = h.indexOf(open);
    if (i < 0) break;
    const j = h.indexOf(close, i);
    if (j < 0) throw new Error('style id="' + id + '" has no closing tag');
    h = h.slice(0, i) + h.slice(j + close.length);
    n++;
  }
  return h;
}

let files = 0, pages = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (h.indexOf('id="dxaObAsks"') < 0 && h.indexOf('id="mdxaObAsks"') < 0) continue;

    const gone = stripById(h, 'lx-dxadata');
    h = gone.html;
    stripped += gone.removed;

    h = stripById(h, ID).html;
    h = stripStyle(h, CSS_ID);

    const hi = h.indexOf('</' + 'head>');
    if (hi < 0) { console.error('  ' + key + ': no closing head — aborting'); process.exit(1); }
    h = h.slice(0, hi) + STYLE + h.slice(hi);

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — aborting'); process.exit(1); }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('near dex-asset: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped the Stellar layer from ' + stripped);
if (!pages) { console.error('  ! no page carried the order-book ids — nothing was wired'); process.exit(1); }
