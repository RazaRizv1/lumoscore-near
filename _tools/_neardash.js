// Wire the Dashboard to NEAR. PORTED FROM the XRPL fork's _xrpldash.js + _xrpldashtop.js (strip the
// Stellar data layers, blank the static mock, inject the chain's own layer), against Stellar's CURRENT
// dashboard -- which NEAR's containers carry and XRPL's frozen base does not (the product boxes, the
// price panel's current stylesheet). Browser code is read from files and injected verbatim:
//   browser/dashtop.js    the NEAR price panel (.lx-xlmpanel), ported from the inherited lx-dashtop
//   browser/dashboard.js  the stats strip, the four product boxes, Platform Activity's empty state
//
// INHERITED LAYERS ON THE DASHBOARD KEYS, measured 2026-10-21, and what happens to each:
//   lx-realdata    Stellar stats + Platform Activity (Horizon, /lxapi/xlm, netstats, poolstats). Bails on a
//                  non-Stellar session today, but owns the same elements dashboard.js fills: STRIPPED.
//   lx-dashtop     Stellar's XLM panel; bails off-Stellar after running the card-reveal helper, which
//                  browser/dashtop.js carries over: STRIPPED and replaced.
//   lx-dashboxes   the product boxes, from Stellar's curated list, /lxapi/poolstats, dexassets, pools,
//                  assetsearch (all Stellar, all on every load): STRIPPED; dashboard.js fills the boxes.
//   lx-swapcalc, lx-qorders, lx-feerate   Stellar swap / limit orders / fee tier behind #modalSwap and
//                  #swapModal: STRIPPED. "Custom Swap / Orders" now routes to /trade/near (lx-dashqa's own
//                  fallback for a page without a working dialog), so neither Stellar dialog opens here.
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
const dash = fs.readFileSync(__dirname + '/browser/dashboard.js', 'utf8');
for (const src of [top, dash]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + top + '\n' + dash + '\n</' + 'script>';
// The panel's mark: the inherited sheet points it at Stellar's xlm.png. Three classes beat its two, so
// source order between the sheets cannot decide it.
const STYLE = '<style id="' + CSS_ID + '">.lx-xlmpanel .lx-xt-head .lx-xt-mark{'
  + 'background:url(/assets/networks/near.png) center/cover no-repeat,var(--surface-2)}</' + 'style>';

const STRIP = ['lx-realdata', 'lx-dashtop', 'lx-dashboxes', 'lx-swapcalc', 'lx-qorders', 'lx-feerate'];
const NEAR_IMG = '<img src="/assets/networks/near.png" style="width:100%;height:100%;object-fit:cover;display:block" alt="">';

// [from, to] exact strings, applied to the dashboard keys (markup and the lx-dashqa router).
const TEXT = [
  ['<span class="lbl">Network</span><span class="val">Stellar</span>', '<span class="lbl">Network</span><span class="val">NEAR</span>'],
  ['href="/trade/stellar"', 'href="/trade/near"'],
  ['href="/pools/stellar"', 'href="/pools/near"'],
  ['Platform Activity — Stellar', 'Platform Activity — NEAR'],
  ['Launch tokens directly on the Stellar DEX.', 'Launch tokens directly on NEAR.'],
  // the phone's shorter Quick actions copy
  ['Launch tokens on the Stellar DEX.', 'Launch tokens on NEAR.'],
  ['Trade pairs on Stellar DEX.', 'Trade pairs on NEAR.'],
  // lx-dashqa: Custom Swap / Orders never opens a Stellar dialog here; it routes to the NEAR market.
  ['if(t.indexOf("custom swap")===0)return document.querySelector("#swapModal");', 'if(t.indexOf("custom swap")===0)return null;'],
  ['if(t.indexOf("custom swap")===0&&!document.querySelector("#swapModal"))return "/trade/stellar";', 'if(t.indexOf("custom swap")===0)return "/trade/near";'],
  ['if(t==="add liquidity"&&!document.querySelector("#createPoolModal"))return "/pools/stellar";', 'if(t==="add liquidity"&&!document.querySelector("#createPoolModal"))return "/pools/near";'],
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
