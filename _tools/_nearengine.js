// Teach the inherited chain engine (lx-mc, from Stellar's _mc_engine.js) that NEAR exists.
//
// WHY. The engine decides which chain a page IS from its url, and it knows two: a /xrpl segment
// means XRPL, and any known section without one "can only be Stellar's". So /trade/near was read as
// Stellar: lxGetChain() answered "stellar", the page re-skinned the design's Aptos copy to Stellar and
// XLM, and every later NEAR layer asking "which chain am I on" would have been told the wrong one.
// Measured 2026-10-21 on the local three-way combine: /trade/near, no wallet -> lxGetChain() "stellar".
//
// WHAT IT CHANGES, inside lx-mc only, on every page key that carries it:
//   * chainFromPath: a /near segment returns 'near', tested BEFORE the Stellar fallthrough.
//   * CHAINS gains a "near" entry, so adoptChain('near') re-skins Aptos -> NEAR (name, ticker, logo).
//
// WHAT IT DOES NOT CHANGE: ORDER (which chains the switcher OFFERS) and chainHref (where a deliberate
// switch navigates). Offering NEAR is a launch decision for the chain switcher, not a cleanup.
//
// Idempotent: a marker comment is written into the script and a page already carrying it is skipped.
// Aborts without writing if any anchor is missing or appears more than once, so a rewritten engine
// fails the build instead of shipping half a patch.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const MARK = '/*lx-near-engine*/';
// One line, no line break in the anchor: the containers carry CRLF in places, so a two-line anchor
// written with \n matched nothing on some page keys.
const CFP_ANCHOR = "if(/\\/xrpl(\\/|$)/.test(p))return 'xrpl';";
const CFP_NEW = "if(/\\/near(\\/|$)/.test(p))return 'near';" + MARK + CFP_ANCHOR;
const CH_ANCHOR = 'var CHAINS={';
const CH_NEW = CH_ANCHOR + '"near":{"name":"NEAR","tk":"NEAR","logo":"/assets/networks/near.png"},';

const once = (s, a) => s.split(a).length - 1;
let patched = 0, already = 0, files = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    const h = json[key];
    if (typeof h !== 'string') continue;
    const re = /(<script\b[^>]*\bid="lx-mc"[^>]*>)([\s\S]*?)(<\/script>)/;
    const m = h.match(re);
    if (!m) continue;
    let body = m[2];
    if (body.indexOf(MARK) >= 0) { already++; continue; }
    if (once(body, CFP_ANCHOR) !== 1) { console.error('ABORT ' + file + ' ' + key + ': chainFromPath anchor found ' + once(body, CFP_ANCHOR) + 'x'); process.exit(1); }
    if (once(body, CH_ANCHOR) !== 1) { console.error('ABORT ' + file + ' ' + key + ': CHAINS anchor found ' + once(body, CH_ANCHOR) + 'x'); process.exit(1); }
    body = body.replace(CFP_ANCHOR, CFP_NEW).replace(CH_ANCHOR, CH_NEW);
    json[key] = h.replace(re, (_, a, __, c) => a + body + c);
    patched++;
  }
  const B = String.fromCharCode(92);
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('nearengine: lx-mc taught NEAR on ' + patched + ' page key(s), ' + already + ' already done, across ' + files + ' containers');
