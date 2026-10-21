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
// AND, SINCE THE CONNECT WORKSTREAM (second marker), what makes this build NEAR's own:
//   * LOCAL_CHAIN is 'near' — the one chain whose wallet list this build can drive. Choosing Stellar or
//     XRPL in the "Choose a network" screen hands off to that build, as each build already does.
//   * ORDER offers NEAR in that screen, after Stellar and XRPL. ON NEAR'S PAGES ONLY: Stellar's own
//     engine is untouched, so whether lumoscore.com offers NEAR stays a launch decision.
//   * TO_NEAR and chainHref('near'), so a hand-off into NEAR keeps the section the reader was in.
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

const MARK2 = '/*lx-near-engine2*/';
const LOCAL_ANCHOR = "var LOCAL_CHAIN='stellar';";
const LOCAL_NEW = "var LOCAL_CHAIN='near';" + MARK2;
const ORDER_ANCHOR = 'var ORDER=["stellar","xrpl"];';
const ORDER_NEW = 'var ORDER=["stellar","xrpl","near"];';
const TOS_ANCHOR = 'var TO_STELLAR={';
const TOS_NEW = "var TO_NEAR={trade:'/trade/near',pools:'/pools/near',bridge:'/bridge/near',rewards:'/rewards/near',"
  + "lumos:'/lumos/near',mcp:'/mcp/near','list-your-token':'/list-your-token/near',launchpad:'/launchpad/near'};"
  + TOS_ANCHOR;
const HREF_ANCHOR = "if(to==='xrpl') return (sec&&TO_XRPL[sec])||'/trade/xrpl';";
const HREF_NEW = "if(to==='near') return (sec&&TO_NEAR[sec])||'/trade/near';" + HREF_ANCHOR;

const once = (s, a) => s.split(a).length - 1;
let patched = 0, already = 0, files = 0, patched2 = 0;

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
    const before = body;
    if (body.indexOf(MARK) >= 0) already++;
    else {
      if (once(body, CFP_ANCHOR) !== 1) { console.error('ABORT ' + file + ' ' + key + ': chainFromPath anchor found ' + once(body, CFP_ANCHOR) + 'x'); process.exit(1); }
      if (once(body, CH_ANCHOR) !== 1) { console.error('ABORT ' + file + ' ' + key + ': CHAINS anchor found ' + once(body, CH_ANCHOR) + 'x'); process.exit(1); }
      body = body.replace(CFP_ANCHOR, CFP_NEW).replace(CH_ANCHOR, CH_NEW);
      patched++;
    }
    if (body.indexOf(MARK2) < 0) {
      for (const a of [LOCAL_ANCHOR, ORDER_ANCHOR, TOS_ANCHOR, HREF_ANCHOR]) {
        if (once(body, a) !== 1) { console.error('ABORT ' + file + ' ' + key + ': anchor ' + a + ' found ' + once(body, a) + 'x'); process.exit(1); }
      }
      body = body.replace(LOCAL_ANCHOR, LOCAL_NEW).replace(ORDER_ANCHOR, ORDER_NEW)
        .replace(TOS_ANCHOR, TOS_NEW).replace(HREF_ANCHOR, HREF_NEW);
      patched2++;
    }
    if (body !== before) json[key] = h.replace(re, (_, a, __, c) => a + body + c);
  }
  const B = String.fromCharCode(92);
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('nearengine: lx-mc taught NEAR on ' + patched + ' page key(s), ' + already + ' already done; '
  + 'made NEAR the local chain on ' + patched2 + ', across ' + files + ' containers');
