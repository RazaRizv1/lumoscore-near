// The NEAR bridge: replace the inherited Stellar bridge stack with the NEAR Intents (1Click) route.
//
// Ported from C:\LumosCore-XRPL\_tools\_xrplnearintents.js. The bridge page keys arrived carrying
// Stellar's whole bridge: a CCTP signing engine, a LayerZero USDT0 engine, a 1Click client for STELLAR
// origins, and the helpers around them. A NEAR page can sign none of it, so it is stripped by id and one
// client is injected: browser/nearswap.js (window.lxnSwap -- the fee account, its registration check and
// the unit arithmetic, shared with the swap so the 0.2% is computed in one place) then browser/nibridge.js.
//
// PER SCRIPT ON THE THREE BRIDGE KEYS (lumoscore-bridge, -dark, -mobile), inventoried 2026-10-22:
//   lx-cctp-js       STRIP  Stellar Circle CCTP engine (275KB): Soroban/Horizon signing. CCTP does not
//                           reach NEAR.
//   lx-lz-js         STRIP  LayerZero USDT0 from Stellar (Soroban OFT send). No NEAR leg.
//   lx-nearintents   STRIP  1Click from STELLAR origins (MEMO deposit, Stellar fee), built on the CCTP
//                           engine's hooks. Replaced by nibridge.js.
//   lx-bridge3js     STRIP  second writer of the review legs' network icons, copying the source chip's
//                           innerHTML on a 250ms interval; nibridge paints all four slots (XRPL stripped it
//                           for the same reason).
//   lx-bridgefee     STRIP  "Hold 250,000 LUMOS to bridge at 0.1%" box + review row + HIW step. The LUMOS
//                           tier is deferred on NEAR (RAZA 2026-10-21); nibridge writes its own fee row.
//   lx-feerate       STRIP  looks lumos.address up on Horizon for the Stellar LUMOS tier; a NEAR account
//                           there is a dead request. NEAR's fee is a flat 0.2% (as _nearwallet/_neardash).
//   lx-brstep2       PATCH  Stellar's step-2 runtime (From/To rows, names under tickers, QR scan, keypad):
//                           kept for the design it carries, with "From Stellar" made NEAR and the name
//                           line honouring the client's data-lxfull. Its LayerZero second face stays
//                           dormant: it only shows under html[data-lxroute*] attributes nothing sets now.
//   lx-bhiw          REPLACE in place by _nearbridgecopy.js (browser/bridgehiw.js).
//   lx-bridge2js, lx-brdnetjs, lx-bridgeassets, lx-bridgescroll, lx-gate, the unnamed __brstep / __brtx
//                    KEEP   the design's own dropdown, its search, chip artwork, step scrolling, the
//                           connect-wallet gate and step switching -- chain-neutral, kept by XRPL too.
//   lx-faq-ld        REWRITTEN by _nearbridgecopy.js to match the visible FAQ.
//   everything else (logo healer, lx-mc, lx-whead, lx-nearconnect, lx-nearsearch, nav, theme...) is
//   site-wide and untouched.
//
// THE TWO CHAIN LISTS MUST AGREE: the page's NI_CHAIN against the Function's CHAINS. The build refuses
// rather than leaving a comment asking someone to remember.
//
// Idempotent: every block is stripped by id before it is added; the lx-brstep2 patch carries a marker and
// is skipped when present; markup pairs replace a Stellar string that is gone after the first run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearnibridge';
const STRIP = ['lx-cctp-js', 'lx-lz-js', 'lx-nearintents', 'lx-bridge3js', 'lx-bridgefee', 'lx-feerate'];
const STRIP_STYLES = ['lx-nipick-css'];

const swap = require(__dirname + '/near-router.js').stamp(fs.readFileSync(__dirname + '/browser/nearswap.js', 'utf8'));
let page = fs.readFileSync(__dirname + '/browser/nibridge.js', 'utf8');
// Omni Bridge and Wormhole (window.lxnBr), between the two: it reads lxnSwap and nibridge reads it.
let bridges = fs.readFileSync(__dirname + '/browser/nearbridges.js', 'utf8');
for (const [n, src] of [['nearswap.js', swap], ['nearbridges.js', bridges], ['nibridge.js', page]]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  browser/' + n + ' contains a closing script tag — aborting'); process.exit(1); }
}

// ---- THE TWO CHAIN LISTS MUST AGREE ------------------------------------------------------------------
const fn = fs.readFileSync(__dirname + '/../functions/lxapi/nearoneclick.js', 'utf8');
const fnBlock = fn.match(/const CHAINS = \{([\s\S]*?)\n\};/);
const pgBlock = page.match(/var NI_CHAIN = \{([\s\S]*?)\n  \};/);
if (!fnBlock || !pgBlock) { console.error('  could not read the CHAINS / NI_CHAIN maps — aborting'); process.exit(1); }
const keysOf = (s) => [...s.replace(/\/\/[^\n]*/g, '').matchAll(/(?:^|[\s,{])([a-z][a-z0-9]*)\s*:/g)].map((m) => m[1]).sort();
const fnKeys = keysOf(fnBlock[1]);
const pgKeys = keysOf(pgBlock[1]);
const missingOnPage = fnKeys.filter((k) => pgKeys.indexOf(k) < 0);
const missingOnServer = pgKeys.filter((k) => fnKeys.indexOf(k) < 0);
if (missingOnPage.length || missingOnServer.length) {
  console.error('  CHAINS and NI_CHAIN disagree — aborting');
  if (missingOnPage.length) console.error('    priced by the function, not offered by the page: ' + missingOnPage.join(', '));
  if (missingOnServer.length) console.error('    offered by the page, not priced by the function: ' + missingOnServer.join(', '));
  process.exit(1);
}

// ---- THE SHIPPED ARTWORK, STAMPED IN ------------------------------------------------------------------
// NEAR pages resolve /assets against Stellar's tree in the combined deploy, plus this repo's own assets/
// (added there by the combine, never replacing a Stellar file). So "which logos exist" is the union of the
// two, read-only on the Stellar side; the version is a hash of the bytes, because /assets is immutable
// for a year in the browser.
const STELLAR_ASSETS = 'C:' + path.sep + 'LumosCore' + path.sep + 'assets';
const OWN_ASSETS = path.join(__dirname, '..', 'assets');
function listPng(dir) {
  const o = {};
  try { fs.readdirSync(dir).forEach((f) => { const m = f.match(/^([A-Za-z0-9._-]+)\.png$/); if (m) o[m[1]] = path.join(dir, f); }); } catch (e) {}
  return o;
}
const NET = Object.assign({}, listPng(path.join(STELLAR_ASSETS, 'networks')), listPng(path.join(OWN_ASSETS, 'networks')));
const NI = Object.assign({}, listPng(path.join(STELLAR_ASSETS, 'tokens', 'ni')), listPng(path.join(OWN_ASSETS, 'tokens', 'ni')));
const ICONV = (() => {
  const h = crypto.createHash('md5');
  Object.keys(NET).sort().forEach((n) => { h.update(n); h.update(fs.readFileSync(NET[n])); });
  return h.digest('hex').slice(0, 8);
})();
const NET_FILES = {}; Object.keys(NET).forEach((k) => { NET_FILES[k] = 1; });
const NI_TOKENS = {}; Object.keys(NI).forEach((k) => { NI_TOKENS[k] = 1; });
for (const tok of ['__LX_ICONV__', '__LX_NI_TOKENS__', '__LX_NET_FILES__']) {
  if (page.indexOf(tok) < 0) { console.error('  ' + tok + ' is not in browser/nibridge.js — aborting'); process.exit(1); }
}
page = page.split('__LX_ICONV__').join(ICONV)
  .split('__LX_NI_TOKENS__').join(JSON.stringify(NI_TOKENS))
  .split('__LX_NET_FILES__').join(JSON.stringify(NET_FILES));
// ---- THE OMNI / WORMHOLE ROUTE TABLE, stamped in -------------------------------------------------------
// From _tools/_nearbridgeroutes.js (run by hand before a release, like the holder counts). A token whose
// art already ships under /assets/tokens/ni loses its inline logo here, so the page carries each image once.
// '<' is escaped so nothing in a logo can end the script element.
const ROUTES_FILE = path.join(__dirname, 'nearbridgeroutes.generated.json');
if (!fs.existsSync(ROUTES_FILE)) { console.error('  nearbridgeroutes.generated.json is missing — run node _tools/_nearbridgeroutes.js'); process.exit(1); }
const ROUTES = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
for (const k of ['wh_chain', 'meta', 'om', 'wh']) {
  if (!ROUTES[k] || typeof ROUTES[k] !== 'object') { console.error('  nearbridgeroutes.generated.json has no ' + k + ' — aborting'); process.exit(1); }
}
Object.keys(ROUTES.meta).forEach((id) => {
  const m = ROUTES.meta[id];
  if (m.logo && NI_TOKENS[String(m.s || '').replace(/[^A-Za-z0-9._-]/g, '')]) delete m.logo;
});
const ROUTES_AGE = (Date.now() - Date.parse(ROUTES.generated)) / 86400000;
if (ROUTES_AGE > 30) console.warn('  WARNING: the Omni/Wormhole route table is ' + Math.round(ROUTES_AGE) + ' days old — re-run node _tools/_nearbridgeroutes.js');
if (bridges.indexOf('__LX_BR_ROUTES__') < 0) { console.error('  __LX_BR_ROUTES__ is not in browser/nearbridges.js — aborting'); process.exit(1); }
delete ROUTES.generated;
bridges = bridges.split('__LX_BR_ROUTES__').join(JSON.stringify(ROUTES).replace(/</g, B + 'u003c'));
if (bridges.indexOf('</' + 'script') >= 0) { console.error('  the stamped route table contains a closing script tag — aborting'); process.exit(1); }

const want = [...(page.match(/var NET_FILE = \{([\s\S]*?)\n  \};/) || [null, ''])[1].matchAll(/:\s*'([a-z0-9]+)'/g)].map((m) => m[1]);
const noArt = [...new Set(want.filter((f) => !NET_FILES[f]))];

const SCRIPT = '<script id="' + ID + '">' + '\n' + swap + '\n' + bridges + '\n' + page + '\n</' + 'script>';

// ---- lx-brstep2, patched in place ----------------------------------------------------------------------
// Exact strings from Stellar's _bridgepolish.js output. Every anchor must be present exactly once, or the
// build stops: a half-patched step-2 layer would say "From Stellar" over a NEAR transfer.
const MARK = '/*lx-near-brstep2*/';
const NEAR_IMG = '/assets/networks/near.png';
const S2_PATCH = [
  ["'<span class=\"lx-s2pill\"><span class=\"lx-s2ic\">' + (srcIcon ? '<img src=\"' + esc(srcIcon.getAttribute('src')) + '\" alt=\"\">' : '') + '</span>'",
   "'<span class=\"lx-s2pill\"><span class=\"lx-s2ic\" data-logo=\"\" data-logoed=\"1\"><img src=\"" + NEAR_IMG + "\" alt=\"\"></span>'"],
  ["'<span class=\"lx-s2nm\">Stellar</span></span>'",
   "'<span class=\"lx-s2nm\" data-logoed=\"1\">NEAR</span></span>'"],
  ["var FULL = { USDC: 'USD Coin',",
   MARK + "var FULL = { NEAR: 'NEAR', wNEAR: 'Wrapped NEAR', USDT: 'Tether USD', USDC: 'USD Coin',"],
  ["var full = (viaOther && dside && dside.contains(a) && de.getAttribute('data-lxroute-name')) || FULL[code] || (((window.LX_ASSETS || {})[code] || {}).dom) || '';",
   "var full = a.hasAttribute('data-lxfull') ? (a.getAttribute('data-lxfull') || '') : ((viaOther && dside && dside.contains(a) && de.getAttribute('data-lxroute-name')) || FULL[code] || '');"],
];
// THE PAGE FROZE ON A SOURCE THAT REACHES NO CHOSEN DESTINATION (RAZA 2026-11-12, ticket 355: NEARLY with Arbitrum
// picked). nibridge.js empties the destination, and lx-brstep2 then wrote 'Choose network' into the pill whenever its
// text differed from the EMPTY name -- which 'Choose network' always does -- so every write fired its own observer
// and wrote again, forever, on the main thread. It now compares against what it would write. Applied on its own
// (and idempotently), so a container patched before this rule existed takes it too.
const S2_FIX = [
  ["if (nm && nm.textContent !== d.name) nm.textContent = d.name || 'Choose network';",
   "if (nm && nm.textContent !== (d.name || 'Choose network')) nm.textContent = d.name || 'Choose network';"],
];
function fixStep2(body) {
  for (const [from, to] of S2_FIX) {
    if (body.indexOf(to) >= 0) continue;
    const n = body.split(from).length - 1;
    if (n !== 1) { console.error('  lx-brstep2 fix anchor found ' + n + ' times (want 1): ' + from.slice(0, 70)); process.exit(1); }
    body = body.split(from).join(to);
  }
  return body;
}
function patchStep2(h) {
  const open = '<script id="lx-brstep2">';
  const i = h.indexOf(open);
  if (i < 0) return { html: h, state: 'absent' };
  const j = h.indexOf('</' + 'script>', i);
  let body = fixStep2(h.slice(i + open.length, j));
  if (body.indexOf(MARK) >= 0) return { html: h.slice(0, i + open.length) + body + h.slice(j), state: 'already' };
  for (const [from, to] of S2_PATCH) {
    const n = body.split(from).length - 1;
    if (n !== 1) { console.error('  lx-brstep2 anchor found ' + n + ' times (want 1): ' + from.slice(0, 70)); process.exit(1); }
    body = body.split(from).join(to);
  }
  return { html: h.slice(0, i + open.length) + body + h.slice(j), state: 'patched' };
}

// ---- static markup the scripts would only overwrite after first paint ----------------------------------
// The step-1 source chip and the review leg are hidden until painted, but they are in the document a
// crawler reads; exact pairs, so a later design change surfaces as "not found" rather than a bad edit.
const MARKUP = [
  ['<span class="nm">Stellar</span><span class="st">Connected</span>', '<span class="nm">NEAR</span><span class="st">Connected</span>'],
  ['<div class="s" data-rv="sendnet">Stellar</div>', '<div class="s" data-rv="sendnet">NEAR</div>'],
  // Stellar's step-2 sheet (lx-brpolish) prints the delivered unit as a CONSTANT, because CCTP always
  // delivers USDC. Here the asset changes per destination and nibridge writes the ticker into the figure,
  // so the constant printed "~ 0.0004 ETH USDC". The one rule goes; nothing else in the sheet changes.
  ['.br-step[data-step="2"] .br-io > .br-side:last-child .br-amt .v::after{content:" USDC"}', ''],
];

let files = 0, pages = 0, stripped = 0, s2 = { patched: 0, already: 0, absent: 0 }, marks = 0;
const perId = {};
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    // GUARDED ON br-steps, the bridge's own step rail: exactly the three bridge keys (XRPL measured that
    // br-netbox also sits on the account pages).
    if (h.indexOf('br-steps') < 0) continue;
    for (const id of STRIP.concat([ID])) {
      const gone = stripById(h, id);
      h = gone.html;
      if (id !== ID && gone.removed) { stripped += gone.removed; perId[id] = (perId[id] || 0) + gone.removed; }
    }
    // STELLAR'S NEAR INTENTS PICKER LEFT ITS STYLESHEET (stripped-scripts-leave-their-stylesheets). Every rule
    // in it is "html:not(.lx-ni-on) .brd-opt...{display:none !important}" -- hide the NEAR Intents chains
    // until Stellar's toggle switches them on. There is no toggle here, so it hid 25 of NEAR's 35
    // destinations (every .lx-niopt, plus BNB Chain, Solana, Sui, Scroll, Starknet) the moment the design's
    // open handler cleared the inline display nibridge sets (RAZA 2026-10-30: "why does near only have 10
    // destination networks"). stripById takes <script id> only, so the sheet goes here.
    for (const sid of STRIP_STYLES) {
      const re = new RegExp('<style id="' + sid + '">[^<]*</' + 'style>', 'g');
      const n = (h.match(re) || []).length;
      if (n) { h = h.replace(re, ''); stripped += n; perId[sid] = (perId[sid] || 0) + n; }
    }
    // ...AND THE LAYERZERO PICKER LEFT THE SAME KIND OF RULE inside lx-lzpick-css, which also carries the
    // route panel's layout, so only the hide rules go: Berachain, Hyperliquid, Monad, Plasma and X Layer
    // (.lx-lzopt) vanished from the opened menu, measured on staging 67d42b9d after the sheet above went.
    const lzHide = /html:not\(\.lx-lz-on\) \.brd-opt[^{]*\{display:none !important\}/g;
    const lzN = (h.match(lzHide) || []).length;
    if (lzN) { h = h.replace(lzHide, ''); stripped += lzN; perId['lx-lzpick-css rules'] = (perId['lx-lzpick-css rules'] || 0) + lzN; }
    const p = patchStep2(h); h = p.html; s2[p.state]++;
    for (const [from, to] of MARKUP) {
      const n = h.split(from).length - 1;
      if (n) { h = h.split(from).join(to); marks += n; }
    }
    // THE SOURCE CHIP'S MARK, IN THE MARKUP (RAZA 2026-10-30: "it shows stellar logo for split seconds when
    // the page is refreshed"). Stellar's chip ships its logo inline and nibridge's paintSource() replaces it
    // only once it runs -- a JS fix for a flash in markup that precedes it never works (lumoscore-flash-pattern).
    // Whatever image the chip's icon holds becomes NEAR's here, before the page is served. Idempotent.
    const chipRe = /(<div class="br-netchip"><span class="br-ic"[^>]*>)<img src="(?!\/assets\/networks\/near\.png)[^"]*"/g;
    const chipN = (h.match(chipRe) || []).length;
    if (chipN) { h = h.replace(chipRe, '$1<img src="' + NEAR_IMG + '"'); marks += chipN; }
    // The same Stellar mark on the hidden steps: step 2's source-address row (not the receiving row, which is
    // .brw-in) and step 3's "You send" asset. Repainted before anyone reaches them, but the markup should not
    // hold another chain's logo at all.
    for (const re of [
      /(<div class="br-wallet"><span class="br-ic lx-netic"[^>]*>)<img src="(?!\/assets\/networks\/near\.png)[^"]*"/g,
      /(You send<\/div><div class="v"><span class="ic lx-rvnet" data-rvnet><\/span><span class="ic"[^>]*>)<img src="(?!\/assets\/networks\/near\.png)[^"]*"/g,
    ]) {
      const n = (h.match(re) || []).length;
      if (n) { h = h.replace(re, '$1<img src="' + NEAR_IMG + '"'); marks += n; }
    }
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — aborting'); process.exit(1); }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}

console.log('near NEAR Intents bridge: injected on ' + pages + ' page key(s) across ' + files + ' container(s); '
  + fnKeys.length + ' destination chains agree with the Pages Function; stripped ' + stripped + ' Stellar bridge block(s)'
  + (stripped ? ' (' + Object.keys(perId).map((k) => k + ' ' + perId[k]).join(', ') + ')' : ''));
console.log('  lx-brstep2: ' + s2.patched + ' patched, ' + s2.already + ' already NEAR, ' + s2.absent + ' absent; '
  + marks + ' static Stellar label(s) made NEAR');
console.log('  logos: ' + Object.keys(NET_FILES).length + ' network, ' + Object.keys(NI_TOKENS).length + ' token, v=' + ICONV
  + (noArt.length ? ('; no artwork yet for ' + noArt.join(', ')) : ''));
if (!pages) { console.error('  ! no page carried br-steps — nothing was wired'); process.exit(1); }
