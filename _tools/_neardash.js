// Wire the Dashboard to NEAR. PORTED FROM the XRPL fork's _xrpldash.js + _xrpldashtop.js (strip the
// Stellar data layers, blank the static mock, inject the chain's own layer), against Stellar's CURRENT
// dashboard -- which NEAR's containers carry and XRPL's frozen base does not (the product boxes, the
// price panel's current stylesheet). Browser code is read from files and injected verbatim:
//   browser/dashtop.js    the NEAR price panel (.lx-xlmpanel), ported from the inherited lx-dashtop
//   browser/dashboard.js  the stats strip, the four product boxes, Platform Activity's empty state
//   browser/qorders.js    "Custom Swap / Orders" (#swapModal): Stellar's three-tab dialog on NEAR,
//                         ported from the XRPL fork's browser/qorders.js
//
// INHERITED LAYERS ON THE DASHBOARD KEYS, measured 2026-10-21, and what happens to each:
//   lx-realdata    Stellar stats + Platform Activity (Horizon, /lxapi/xlm, netstats, poolstats). Bails on a
//                  non-Stellar session today, but owns the same elements dashboard.js fills: STRIPPED.
//   lx-dashtop     Stellar's XLM panel; bails off-Stellar after running the card-reveal helper, which
//                  browser/dashtop.js carries over: STRIPPED and replaced.
//   lx-dashboxes   the product boxes, from Stellar's curated list, /lxapi/poolstats, dexassets, pools,
//                  assetsearch (all Stellar, all on every load): STRIPPED; dashboard.js fills the boxes.
//   lx-swapcalc, lx-qorders, lx-feerate   Stellar swap / limit orders / fee tier behind #modalSwap and
//                  #swapModal: STRIPPED (every path through them reads Horizon and signs for Stellar).
//                  Their STYLESHEETS stay — stripById only removes <script id="...">, so the
//                  <style id="lx-swapcalc-css"> and <style id="lx-qorders-css"> blocks beside them
//                  survive, and browser/qorders.js is written against exactly those classes. That is
//                  why this fork's dialog cannot drift from lumoscore.com's: it brings no CSS at all.
//   lx-dashqa      the Quick actions router: KEPT, its Stellar routes re-pointed (below).
//   lx-dashblogdata  the LumosCore blog (/lxapi/blog) -- chain-neutral content: KEPT.
//   lx-searchassets  the header search, on every page of the fork: not this workstream.
//
// MARKUP: the netcard's "Stellar" and its Stellar mark, the box links to /trade|pools/stellar, the pills'
// mock figures, "Platform Activity — Stellar" and "Launch tokens directly on the Stellar DEX." Each rule
// matches only the design's original text, so a second run is a no-op.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-neardash';
const CSS_ID = 'lx-neardash-css';
const top = fs.readFileSync(__dirname + '/browser/dashtop.js', 'utf8');
// The Cross-chain box counts the NEAR tokens the bridge can send: NEAR Intents' list (live) plus what only
// Omni or Wormhole carry -- that half is the same baked table the bridge page uses, stamped in as ids so
// the box and the page cannot disagree about it.
const BR_ROUTES = JSON.parse(fs.readFileSync(__dirname + '/nearbridgeroutes.generated.json', 'utf8'));
let dash = fs.readFileSync(__dirname + '/browser/dashboard.js', 'utf8');
if (dash.split('__LX_BR_IDS__').length !== 2) { console.error('  __LX_BR_IDS__ must appear once in browser/dashboard.js — aborting'); process.exit(1); }
dash = dash.split('__LX_BR_IDS__').join(JSON.stringify(Object.keys(BR_ROUTES.meta)));
// THE DIALOG'S TWO ENGINES, because the dashboard key carries NEITHER (measured on the built page:
// window.lxnCore and window.lxn are defined there, window.lxnSwap and window.lxnDcl are not — they
// ship with the wallet, Trade-Asset and bridge pages). nearcore.js is NOT re-injected: it is already
// on this key, and neither engine reads it. Both are IIFEs that return early on their own global
// (`if (window.lxnSwap) return`, `if (window.lxnDcl) return`), so a page that gains them elsewhere
// later is unharmed.
//
// nearswap.js GOES THROUGH stamp(). It carries a '__NEAR_ROUTER__' placeholder that near-router.js
// replaces with the swap router's account id; today that value is '' and the placeholder survives,
// which router() reads as "no router". Injecting the file raw would look identical NOW and quietly
// skip the router on the day it is deployed — and stamp() also asserts the placeholder is there
// exactly once, so a rename in nearswap.js fails this build instead of shipping a dead swap path.
const dcl = fs.readFileSync(__dirname + '/browser/neardcl.js', 'utf8');
const swapEngine = require(__dirname + '/near-router.js').stamp(fs.readFileSync(__dirname + '/browser/nearswap.js', 'utf8'));
const qord = fs.readFileSync(__dirname + '/browser/qorders.js', 'utf8');
for (const src of [top, dash, dcl, swapEngine, qord]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + top + '\n' + dash + '\n'
  + dcl + '\n' + swapEngine + '\n' + qord + '\n</' + 'script>';
// The panel's mark: the inherited sheet points it at Stellar's xlm.png. Three classes beat its two, so
// source order between the sheets cannot decide it.
// `.lxo-retry` is the Orders tab's "Try again" button. The inherited lx-qorders-css DOES survive here
// (see the note at the top of this file), but it is frozen at the Stellar build this fork was copied
// from, and that sheet predates the button -- so the rule has to be carried here or it renders as a bare
// browser control. Same selector and declarations as Stellar's, so a later re-inherit is a no-op.
const STYLE = '<style id="' + CSS_ID + '">.lx-xlmpanel .lx-xt-head .lx-xt-mark{'
  + 'background:url(/assets/networks/near.png) center/cover no-repeat,var(--surface-2)}'
  + '.lxo-retry{margin-top:12px;height:30px;padding:0 15px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:color .12s ease,border-color .12s ease,background .12s ease}'
  + '.lxo-retry:hover{color:var(--accent,#7c8cff);border-color:var(--accent,#7c8cff);background:rgba(124,140,255,.08)}</' + 'style>';

// lx-trending (+ its sheet, removed below: stripById takes scripts only) arrived with Stellar's base on
// 2026-10-29: Stellar's Trending list, 23 KB, on a dashboard that has no #trendingList and reads Horizon.
// It never shipped on NEAR and Stellar's own production deploy dropped it too.
const STRIP = ['lx-realdata', 'lx-dashtop', 'lx-dashboxes', 'lx-swapcalc', 'lx-qorders', 'lx-feerate', 'lx-trending'];
const STRIP_CSS = ['lx-trending-css'];
const NEAR_IMG = '<img src="/assets/networks/near.png" style="width:100%;height:100%;object-fit:cover;display:block" alt="">';

// [from, to] exact strings, applied to the dashboard keys (markup and the lx-dashqa router).
const TEXT = [
  ['<span class="lbl">Network</span><span class="val">Stellar</span>', '<span class="lbl">Network</span><span class="val">NEAR</span>'],
  ['href="/trade/stellar"', 'href="/trade/near"'],
  ['href="/pools/stellar"', 'href="/pools/near"'],
  // THE PRODUCT BOXES ARE LINKS THE DESIGN'S ROUTER MUST LEAVE ALONE (RAZA 2026-10-30: "on dashboard, when i
  // click cross chain or pools, it takes me to trade main page"). nxnav-js takes every click at capture,
  // and its rowTarget() read these cards as market rows and sent them to /trade/near. It skips anything
  // inside [data-lxnonav] -- the marker Stellar's own product cards already carry. Then the two boxes
  // that still pointed at the bare hub: Cross-chain and Launchpad go to their NEAR pages.
  ['<a class="lx-dbx-card" href="', '<a class="lx-dbx-card" data-lxnonav="1" href="'],
  ['data-lxnonav="1" href="/bridge"', 'data-lxnonav="1" href="/bridge/near"'],
  ['data-lxnonav="1" href="/launchpad"', 'data-lxnonav="1" href="/launchpad/near"'],
  ['Platform Activity — Stellar', 'Platform Activity — NEAR'],
  // RAZA 2026-10-28: match Stellar's shape, "on the <chain> DEX." — it read "directly on NEAR.",
  // which was the only Quick-actions line that dropped the DEX. NEAR stays capitalised, as everywhere
  // else in this fork.
  ['Launch tokens directly on the Stellar DEX.', 'Launch tokens directly on the NEAR DEX.'],
  // the phone's shorter Quick actions copy
  ['Launch tokens on the Stellar DEX.', 'Launch tokens on the NEAR DEX.'],
  // HEAL the wording this transform itself wrote on an earlier run. Every rule above matches only the
  // DESIGN'S original text, which is gone from a container the transform has already touched — so
  // without these two, changing NEAR's own copy would need a full --base rebuild, and an incremental
  // `node _tools/rebuild.js` would silently keep the old words. Both are no-ops on a fresh base.
  ['Launch tokens directly on NEAR.', 'Launch tokens directly on the NEAR DEX.'],
  ['Launch tokens on NEAR.', 'Launch tokens on the NEAR DEX.'],
  ['Trade pairs on Stellar DEX.', 'Trade pairs on NEAR.'],
  // The desktop card's subtitle. TRUE ON STELLAR, NOT HERE: a NEAR limit order rests in a Rhea DCL
  // pool and those are paired against NEAR, so "any pair" promised something the dialog this card now
  // opens refuses for most pairs. The same sentence, honest about this ledger — the wrong-chain-copy
  // case where identical words are correct on one fork and wrong on another.
  ['Swap instantly, or place a limit order on any pair.', 'Swap instantly, or place a limit order against NEAR.'],
  // lx-dashqa: Custom Swap / Orders OPENS THE DIALOG, as the design wires it and as the XRPL fork
  // leaves it (_xrpldash.js has no custom-swap rule at all). Only the no-dialog FALLBACK is re-pointed.
  //
  // RAZA 2026-10-28: "This pop up only opens up for a mini second and then redirect me to trade page."
  // That was these two rules: the design's own handler opened #swapModal and the router then returned a
  // url, so the dashboard navigated out from under the dialog it had just shown. They were right while
  // #swapModal had no driver on this fork — opening the design's mock ("1 APT ≈ 0.118 USDC", a Swap
  // button that prints success without touching a chain) would have been worse than leaving. Now
  // browser/qorders.js drives it, so the card opens it.
  ['if(t.indexOf("custom swap")===0&&!document.querySelector("#swapModal"))return "/trade/stellar";', 'if(t.indexOf("custom swap")===0&&!document.querySelector("#swapModal"))return "/trade/near";'],
  // HEAL the two rules this transform wrote on earlier runs. The dashboard keys in both containers
  // already carry them, and the forward rule above can never match those again — so without these an
  // incremental `node _tools/rebuild.js` would keep routing the card away and the dialog would stay
  // unreachable until a full --base rebuild. No-ops on a fresh base, and both are idempotent: the
  // strings they write do not contain the strings they match.
  ['if(t.indexOf("custom swap")===0)return null;', 'if(t.indexOf("custom swap")===0)return document.querySelector("#swapModal");'],
  ['if(t.indexOf("custom swap")===0)return "/trade/near";', 'if(t.indexOf("custom swap")===0&&!document.querySelector("#swapModal"))return "/trade/near";'],
  ['if(t==="add liquidity"&&!document.querySelector("#createPoolModal"))return "/pools/stellar";', 'if(t==="add liquidity"&&!document.querySelector("#createPoolModal"))return "/pools/near";'],
  // lx-dashblogdata's chain token, retargeted exactly as the XRPL fork's _xrplblogs.js does: the blog
  // card hides posts tagged for ANOTHER chain, and the inherited "stellar" showed Stellar-tagged posts here.
  ['var LXNET="stellar";', 'var LXNET="near";'],
  // ...and its filter knew only two networks, so a post tagged Arc or Hedera would show on NEAR's dashboard.
  // A post tagged for ANY other network is dropped; blank, "All" and old topic tags still show.
  ['return (c!=="stellar"&&c!=="xrpl")||c===LXNET; });', 'return ["stellar","xrpl","near","arc","hedera"].indexOf(c)<0||c===LXNET; });'],
  // (A failed /lxapi/blog read no longer says "No posts yet.": the Stellar base's own _dashblogs.js fixed that on
  // 2026-10-31 and NEAR inherits it with the base -- no NEAR change needed for it.)
];

function isDashboard(h) { return h.indexOf('id="activityList"') >= 0 && h.indexOf('status-row') >= 0; }

let files = 0, pages = 0, stripped = 0, texts = 0, pills = 0, imgs = 0;
const per = {};
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (!isDashboard(h)) continue;
    if (h.indexOf('id="lx-dashtop-css"') < 0) { console.error('  ' + key + ': the inherited lx-dashtop-css is gone — the panel would ship unstyled; aborting'); process.exit(1); }

    for (const sid of STRIP) {
      const g = stripById(h, sid);
      h = g.html;
      if (g.removed) { stripped += g.removed; per[sid] = (per[sid] || 0) + g.removed; }
    }
    for (const cid of STRIP_CSS) {
      const open = '<style id="' + cid + '">', close = '</' + 'style>';
      for (let i; (i = h.indexOf(open)) >= 0;) {
        const j = h.indexOf(close, i);
        if (j < 0) { console.error('  ' + key + ': ' + cid + ' has no closing tag; aborting'); process.exit(1); }
        h = h.slice(0, i) + h.slice(j + close.length); stripped++; per[cid] = (per[cid] || 0) + 1;
      }
    }
    for (const [from, to] of TEXT) {
      const n = h.split(from).length - 1;
      if (n) { h = h.split(from).join(to); texts += n; }
    }
    // The netcard's mark: whatever image the design baked in, NEAR's own.
    h = h.replace(/(<span class="status-pill lx-netcard"><span class="lx-netpill">)<img [^>]*>/g, function (m0, open) {
      if (m0.indexOf('/assets/networks/near.png') >= 0) return m0;
      imgs++;
      return open + NEAR_IMG;
    });
    // The pills' mock figures ("4,234", "12,532,325 NEAR", "$0.245"): em dashes in markup. The row is held
    // at opacity 0 until dashboard.js has written real ones, but crawlers and no-JS readers get markup.
    h = h.replace(/(<span class="status-pill">\s*<span class="lbl">[^<]*<\/span>\s*<span class="val">)([^<]*)(<\/span>)/g,
      function (m0, open, val, close) {
        if (val === '—') return m0;
        pills++;
        return open + '—' + close;
      });
    h = h.split('<span class="lbl">Stellar price</span>').join('<span class="lbl">NEAR price</span>');

    if (h.indexOf('id="lx-dashblogdata"') >= 0 && h.indexOf('var LXNET="near";') < 0) { console.error('  ' + key + ': lx-dashblogdata carries no NEAR LXNET — its chain filter changed shape; aborting'); process.exit(1); }
    if (h.indexOf('id="lx-dashblogdata"') >= 0 && h.indexOf('["stellar","xrpl","near","arc","hedera"].indexOf(c)<0') < 0) {
      console.error('  ' + key + ': lx-dashblogdata\'s network filter changed shape — Arc/Hedera posts would show here; aborting'); process.exit(1);
    }
    h = stripById(h, ID).html;
    h = h.replace(new RegExp('<style id="' + CSS_ID + '">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g'), '');
    if (h.indexOf('</head>') >= 0) h = h.split('</head>').join(STYLE + '</head>');
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
console.log('near dashboard: layer on ' + pages + ' page key(s) across ' + files + ' container(s); stripped '
  + stripped + ' ' + JSON.stringify(per) + '; ' + texts + ' text fix(es), ' + imgs + ' network mark(s), ' + pills + ' mock pill(s) blanked');
if (!pages) { console.error('  ! no dashboard page key found'); process.exit(1); }
