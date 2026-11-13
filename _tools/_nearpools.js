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
//   lx-nearcreatepool   browser/createpool.js, on EVERY page carrying the design's #createPoolModal — the
//                       Pools pages, the dashboard and the $LUMOS pages (eight keys, 2026-10-28). Without
//                       lx-ammdata nothing else takes the clicks on the dialog's asset pickers, and the
//                       design's nav shim answers them by leaving the page. The $LUMOS copy of the dialog
//                       ships no .asset-dropdown, so the design's own is carried into it first; see the
//                       carry-over block below.
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

// ---- the asset dropdown, for the $LUMOS pages, whose copy of the dialog does not ship it ---------------
//
// The $LUMOS pages carry the SAME #createPoolModal and five of their own ways to open it, but their copy
// has the two pickers WITHOUT the dropdown (measured 2026-10-28: 4,590 bytes against the Pools page's
// 11,042, no .asset-dropdown, no .ad-list) and without its stylesheet rules. They were excluded from this
// transform for that reason, which left a dialog that opens with dead pickers — and, with lx-ammdata
// stripped, a click on one hands the design's nav shim a lxNavigate() that LEAVES THE PAGE.
//
// This is the XRPL fork's fix, ported (_xrplcreatepool.js, RAZA 2026-09-17: "Add liquidity popup: im
// unable to select the asset 2" / "Lumos token page, add liqudity popup is breaking"). Nothing is
// invented: the design's own dropdown is carried over from the page that HAS it, minus its mock Stellar
// asset rows, and the rules are lifted verbatim from that page's stylesheet so the two copies cannot drift.
const DD_ID = 'lx-cpdd';
const DD_SELECTORS = /(^|,)\s*(\.asset-dropdown|\.ad-(search|search-input|list|item|ico|meta|tk|nm|bal))\b/;

// The dialog's extent, by counting <div>s from its own tag — so nothing outside it is ever touched.
function modalSlice(h) {
  const at = h.indexOf('id="createPoolModal"');
  if (at < 0) return null;
  const start = h.lastIndexOf('<div', at);
  if (start < 0) return null;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(h))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  return null;
}

function dropdownFrom(h) {
  const sl = modalSlice(h);
  if (!sl) return null;
  const seg = h.slice(sl.start, sl.end);
  const at = seg.indexOf('<div class="asset-dropdown"');
  if (at < 0) return null;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = at;
  let depth = 0, m, end = -1;
  while ((m = re.exec(seg))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) { end = m.index + m[0].length; break; }
  }
  if (end < 0) return null;
  // The mock rows go; the empty list stays, which is what createpool.js fills.
  return seg.slice(at, end).replace(/(<div class="ad-list">)[\s\S]*?(<\/div>\s*<\/div>)$/, '$1$2');
}

function dropdownCss(h) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(h))) {
    const sel = m[1].trim();
    const body = m[2];
    if (sel.length > 300 || sel.indexOf('function') >= 0 || sel.indexOf('var ') >= 0) continue;
    // THE ANCHOR COUNTS AS PART OF THE DROPDOWN. On XRPL the first attempt shipped without it and the
    // dropdown DID open — `position:absolute;left:0;right:0;top:calc(100% + 4px)` with no positioned
    // ancestor put it 1,440px wide, off the bottom of the page, which from the reader's side is
    // indistinguishable from a dead button. The design anchors it with `.asset-field{position:relative}`,
    // a selector that names none of the classes above, so it has to be matched on its own.
    const isAnchor = /\.asset-field\b/.test(sel) && /position\s*:/.test(body);
    if (!isAnchor && !DD_SELECTORS.test(sel)) continue;
    rules.push(sel.replace(/\s+/g, ' ') + '{' + body.replace(/\s+/g, ' ').trim() + '}');
  }
  return rules.join('\n');
}

// stripById only removes <script id>, so the carried-over stylesheet needs its own removal or every
// rebuild leaves another copy behind and the stale rules win on source order.
function stripStyle(h, id) {
  const open = '<' + 'style id="' + id + '">', close = '<' + '/' + 'style>';
  for (;;) {
    const i = h.indexOf(open);
    if (i < 0) return h;
    const j = h.indexOf(close, i + open.length);
    if (j < 0) { console.error('  style id="' + id + '" has no closing tag — aborting'); process.exit(1); }
    h = h.slice(0, i) + h.slice(j + close.length);
  }
}

// Insert the block at the end of every asset field that has no dropdown of its own. A field ends after its
// `.field-foot`, which holds only spans — so the first `</div>` after its MAX button is its own.
function addDropdowns(h, block) {
  const sl = modalSlice(h);
  if (!sl) return { html: h, n: 0 };
  let seg = h.slice(sl.start, sl.end);
  if (seg.indexOf('asset-dropdown') >= 0) return { html: h, n: 0 };
  let n = 0, from = 0;
  for (;;) {
    const f = seg.indexOf('<div class="field-foot">', from);
    if (f < 0) break;
    const mx = seg.indexOf('max-btn', f);
    if (mx < 0) break;
    const close = seg.indexOf('</div>', mx);
    if (close < 0) break;
    const at = close + '</div>'.length;
    seg = seg.slice(0, at) + block + seg.slice(at);
    from = at + block.length;
    n++;
  }
  return { html: h.slice(0, sl.start) + seg + h.slice(sl.end), n };
}

// THE REWARDED POOLS TAB IN THE MARKUP, AND THE HEAD GATE (RAZA 2026-11-13: "replicate onto NEAR"). Both copied from
// the XRPL fork's _xrplpools.js, which mirrors Stellar's: the tab is baked so the bar never paints without it, and
// lx-rwgate decides in the HEAD -- before any row paints -- that ?tab=rewarded / #rewarded hides All Pools, through
// html.lx-rwpending. THE IDS ARE IDENTICAL TO BOTH (lx-rwgate, lx-rwgate-css, #panelAllPools, #panelAll,
// data-tab="rewarded"), or the CSS stops matching and the panels flash. browser/pools.js clears the class once it has
// hidden the panel for real; the 8s timeout is the safety if it never boots.
//
// ONE DIFFERENCE: the badge is EMPTY here. XRPL bakes its programme's count because all eleven of its pools exist;
// on NEAR most pairs have no pool yet, so a baked 11 would be a false number. browser/pools.js writes the count of
// pools found (/lxapi/nearrwpools) once it has it.
const RWTAB = '<button data-tab="rewarded"><span class="lx-tabic" aria-hidden="true">'
  + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"'
  + ' stroke-linejoin="round"><circle cx="12" cy="9.1" r="6.1"></circle>'
  + '<path d="M8.4 14.3 7 21.4l5-2.7 5 2.7-1.4-7.1"></path></svg></span>'
  + 'Rewarded Pools <span class="count" data-logoed="1"></span></button>';
const RWGATE = '<' + 'script id="lx-rwgate">(function(){try{'
  + 'if(!/(^|[?&])tab=rewarded|#rewarded/.test((location.search||"")+" "+(location.hash||"")))return;'
  + 'var d=document.documentElement;d.className+=" lx-rwpending";'
  + 'var o=new MutationObserver(function(){var bar=document.getElementById("poolTabs");if(!bar)return;'
  + 'o.disconnect();'
  + 'var bs=bar.querySelectorAll("button[data-tab]");'
  + 'for(var i=0;i<bs.length;i++){var t=bs[i].getAttribute("data-tab");'
  + 'if(t==="rewarded")bs[i].classList.add("active");else bs[i].classList.remove("active");}});'
  + 'o.observe(d,{childList:true,subtree:true});'
  + 'setTimeout(function(){try{o.disconnect();}catch(e){}'
  + 'd.classList.remove("lx-rwpending");},8000);'
  + '}catch(e){}})();</' + 'script>'
  + '<style id="lx-rwgate-css">html.lx-rwpending #panelAllPools,html.lx-rwpending #panelAll'
  + '{display:none!important}</style>';
// Swapped in place; only on pages with the tab bar, and REMOVED from any page without one (XRPL's syncGate).
function syncGate(h) {
  const open = '<' + 'script id="lx-rwgate">';
  const at = h.indexOf(open);
  const wants = h.indexOf('id="poolTabs"') >= 0;
  if (at >= 0) {
    const end = h.indexOf('</style>', at);
    if (end < 0) return h;
    return h.slice(0, at) + (wants ? RWGATE : '') + h.slice(end + 8);
  }
  if (!wants) return h;
  const hc = h.indexOf('</head>');
  if (hc < 0) return h;
  return h.slice(0, hc) + RWGATE + h.slice(hc);
}
// The third button, before My Pools (XRPL's bakeTabs, the label renamed as there). Idempotent.
function bakeTabs(h) {
  const bar = h.indexOf('id="poolTabs"');
  if (bar < 0) return h;
  const close = h.indexOf('</div>', bar);
  if (close < 0) return h;
  let bl = h.slice(bar, close);
  if (bl.indexOf('data-tab="rewarded"') >= 0) return h;
  const m = bl.indexOf('<button data-tab="mine"');
  const me = m < 0 ? -1 : bl.indexOf('</button>', m);
  if (me < 0) return h;
  const mineBtn = bl.slice(m, me + 9).replace('My Positions', 'My Pools');
  bl = bl.slice(0, m) + RWTAB + mineBtn + bl.slice(me + 9);
  return h.slice(0, bar) + bl + h.slice(close);
}

let files = 0, stripped = 0, injected = 0, cpInjected = 0, dds = 0, baked = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — aborting'); process.exit(1); }
  const { json, s, e } = getContents(data);
  files++;

  // The donor: whichever key in this container ships the dialog WITH its dropdown.
  let donor = null;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    if (json[key].indexOf('id="createPoolModal"') < 0) continue;
    const block = dropdownFrom(json[key]);
    // Marked, so a later rebuild can tell this page's dropdown was carried over and still needs the sheet.
    if (block) {
      donor = {
        block: block.replace('<div class="asset-dropdown"', '<div data-lxcpdd class="asset-dropdown"'),
        css: dropdownCss(json[key])
      };
      break;
    }
  }

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
    if (list && !lumos) {
      const b0 = h; h = bakeTabs(h); if (h !== b0) baked++;
      h = beforeBody(h, SCRIPT, key); injected++;
    }
    h = syncGate(h);                                         // head gate where the tab bar is; gone where it is not
    if (modal) {
      // The $LUMOS pages are no longer skipped: they get the design's dropdown carried over first, and
      // then the same driver as everywhere else. The Pools list layer above still skips them, because
      // their #poolsBody is a different table.
      h = stripStyle(h, DD_ID);
      if (donor) {
        const r = addDropdowns(h, donor.block);
        // Carried over by an earlier run: the markup is already in the page, and the stylesheet just
        // stripped has to go back, or the dropdown opens unstyled on the second build.
        if (r.n || h.indexOf('data-lxcpdd') >= 0) {
          h = r.html;
          const hi = h.lastIndexOf('</' + 'head>');
          const style = '<style id="' + DD_ID + '">' + donor.css + '</' + 'style>';
          h = hi >= 0 ? h.slice(0, hi) + style + h.slice(hi) : style + h;
          dds += r.n;
        }
      }
      h = beforeBody(h, CP_SCRIPT, key);
      cpInjected++;
    }

    if (h !== before) json[key] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('near pools: stripped lx-ammdata from ' + stripped + ' page key(s); injected ' + ID + ' on ' + injected
  + ' and ' + CP_ID + ' on ' + cpInjected + ' page key(s) across ' + files + ' container(s)'
  + (dds ? '; carried the asset dropdown into ' + dds + ' field(s)' : '') + (baked ? '; baked the Rewarded tab on ' + baked : ''));
if (!injected) { console.error('  ! no page carried #poolsBody / #panelAll — nothing was wired'); process.exit(1); }
if (!cpInjected) { console.error('  ! no page carried #createPoolModal — the dialog was not wired'); process.exit(1); }
