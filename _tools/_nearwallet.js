// Inject the NEAR wallet layer into the Wallet pages. PORTED FROM the XRPL fork's _xrplwallet.js; its long
// notes (the open-orders flash gate, the "Cancel all" gate, the random-walk chart, the insight-card mock)
// describe the same design this build carries, and each rule below is that file's rule with NEAR names.
//
// The browser code is READ FROM FILES and injected verbatim, never assembled as strings here:
//   browser/nearcore.js the NEAR reads (balances, token metadata, NearBlocks activity) -- window.lxnCore,
//                      shared with the Account page and the header search so there is one implementation
//   browser/wallet.js  balances (FastNEAR), the asset list on both layouts, activity (NearBlocks), the
//                      runtime Open orders tab bar (Claimable is not built on NEAR), the hero chart
//   browser/prices.js  prices and the Total Portfolio from /lxapi/nearmarket
//   browser/send.js    the design's Send and Receive dialogs; the Swap dialog's coming-soon state
// in that order: prices.js and send.js read window.__lxnData, which wallet.js publishes.
//
// THE INHERITED STELLAR LAYERS ON THESE PAGES, measured 2026-10-21, and what happens to each:
//   lx-walletdata  Stellar's wallet layer (Horizon, CoinGecko). Writes every element wallet.js writes.
//                  STRIPPED.
//   lx-mobwallet   the phone's Stellar wallet layer: writes #assetList and wires Send/Swap to a STELLAR
//                  transaction. STRIPPED (XRPL precedent, _xrplstripstellar.js).
//   lx-wclaim      Stellar claimable balances; it also BUILDS the Open orders / Claimable tab bar at
//                  runtime. STRIPPED; wallet.js buildTabs() builds the same bar (classes, copy, the two
//                  insight cards folded away) with Open orders only -- Claimable is hidden on NEAR
//                  (RAZA's decision), exactly as the XRPL build hides it.
//   lx-qorders     Stellar open orders (Horizon offers). STRIPPED; Open orders shows the design's empty
//                  state until NEAR limit orders exist.
//   lx-swapcalc    Stellar swap quoting (Horizon, Soroswap). STRIPPED; the Swap dialog's markup stays and
//                  send.js gives it a disabled "Swaps on NEAR are coming soon" button.
//   lx-feerate     looks the account up on Horizon for the LUMOS fee tier, read only by lx-swapcalc.
//                  STRIPPED with it.
//   lx-qrlib       the QR generator Receive draws with. KEPT (its "horizon" match is the word horizontal).
//   lx-searchassets  the header search (stellar.expert, /lxapi/assetsearch). NOT touched here: it is on
//                  every page of the fork, and _nearsearch.js replaces it everywhere.
//
// Idempotent: every block is stripped by id before it is added again, and the markup rules only match
// the design's mock text, which the first run has already replaced.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearwallet';
const core = fs.readFileSync(__dirname + '/browser/nearcore.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/wallet.js', 'utf8');
const px = fs.readFileSync(__dirname + '/browser/prices.js', 'utf8');
const wr = fs.readFileSync(__dirname + '/browser/send.js', 'utf8');
// Rhea DCL limit orders: the Open orders tab reads, cancels and collects them through this engine.
const dcl = fs.readFileSync(__dirname + '/browser/neardcl.js', 'utf8');
for (const src of [core, dcl, page, px, wr]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + dcl + '\n' + page + '\n' + px + '\n' + wr + '\n</' + 'script>';

const STRIP = ['lx-walletdata', 'lx-mobwallet', 'lx-wclaim', 'lx-qorders', 'lx-swapcalc', 'lx-feerate'];

// The open-orders flash gate and the "Cancel all" gate, in <head>, from _xrplwallet.js (see its notes):
// the panel's Aptos mock cards stay invisible until wallet.js's paintOrders() stamps data-lcm-done, and a
// 3s safety net EMPTIES an untouched panel (stashing one card as the row template) rather than revealing
// the mock. "Cancel all" stays hidden until paintOrders decides there is something to cancel.
const GATE_ID = 'lx-nordgate';
const GATE_JS = 'lx-nordgate-js';
const CA_SEL = '#cancelAllBtn,.order-cancel-all,[data-cancel-all]';
const GATE = '<style id="' + GATE_ID + '">'
  + '.orders-block:not([data-lcm-done])>*,.orders-stack:not([data-lcm-done])>*{visibility:hidden}'
  // Recent Activity ships thirty invented rows ("Received USDT from 0x0222…02b2 +500 USDT"), measured on
  // screen for ~1s of every cold load. Held invisible until wallet.js has replaced them with this account's
  // rows or one of its notes -- every exit of paintActivity/activityNote stamps data-lxact. No timer: if
  // the layer never runs, an empty card is the honest outcome, not the mock.
  + '.activity-block:not([data-lxact])>*{visibility:hidden}'
  + '#cancelAllBtn:not([data-lxca]),.order-cancel-all:not([data-lxca]),[data-cancel-all]:not([data-lxca])'
  + '{visibility:hidden!important}'
  + CA_SEL + '{color:var(--accent,#ea6a2c)!important;-webkit-text-fill-color:var(--accent,#ea6a2c)!important;'
  + 'text-decoration:none!important;font-weight:600}'
  + '</' + 'style>'
  + '<script id="' + GATE_JS + '">setTimeout(function(){try{'
  + 'var n=document.querySelectorAll(".orders-block,.orders-stack");'
  + 'for(var i=0;i<n.length;i++){var b=n[i];'
  + 'if(!b.getAttribute("data-lcm-done")){'
  + 'var t=b.querySelector(".order-row,.order-card");'
  + 'if(t&&!window.__lxOrdTpl)window.__lxOrdTpl=t.cloneNode(true);'
  + 'b.innerHTML="";}'
  + 'b.setAttribute("data-lcm-done","1");}'
  + '}catch(e){}},3000);</' + 'script>';

let files = 0, pages = 0, stellarLayers = 0, mockCharts = 0, mockHeadlines = 0, mockCards = 0, gated = 0;
const per = {};
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    if (!/^lumoscore-wallet(-(dark|light|mobile))?\.html$/.test(key)) continue;
    let h = json[key];
    // desktop has a table, mobile a card list -- both, or the phone is silently skipped.
    if (h.indexOf('id="assetsTable"') < 0 && h.indexOf('id="assetList"') < 0) continue;

    for (const sid of STRIP) {
      const g = stripById(h, sid);
      h = g.html;
      if (g.removed) { stellarLayers += g.removed; per[sid] = (per[sid] || 0) + g.removed; }
    }

    // The design's two random-walk writers on #heroChart bail through their own guards (XRPL note: both
    // carry `if (!wrap) return;` / `if (!tabs.length || !chartEl) return;`). Our own block is skipped by id.
    {
      const find = "getElementById('heroChart')";
      let from = 0;
      for (;;) {
        const at = h.indexOf(find, from);
        if (at < 0) break;
        const bs = h.lastIndexOf('<script', at);
        const be = h.indexOf('</' + 'script>', at);
        if (bs < 0 || be < at) break;
        const openTag = h.slice(bs, h.indexOf('>', bs) + 1);
        if (openTag.indexOf(ID) >= 0) { from = be; continue; }
        const block = h.slice(bs, be).split(find).join("getElementById('lx-design-mock-disabled')");
        h = h.slice(0, bs) + block + h.slice(be);
        mockCharts++;
        from = bs + block.length;
      }
    }

    // Insight-card headlines with digits in them are mock figures ("+12.42%", "3 Active", "3,442 APT"):
    // blanked in markup, so there is nothing to flash. "Across 2 pools" likewise.
    let blanked = 0;
    h = h.replace(/(<div class="headline[^"]*">)([^<]{1,40})(<\/div>)/g, function (m0, open, val, close) {
      if (!/\d/.test(val)) return m0;
      blanked++;
      return open + '—' + close;
    });
    h = h.replace(/(<div class="sub">\s*Across\s*<span class="nm">)([^<]*)(<\/span>)/g,
      function (m0, open, val, close) { if (val === 'your pools') return m0; blanked++; return open + 'your pools' + close; });
    // The headline balance "31,108.45 APT" over "≈ $12,847.62 USD" (desktop .value / .sub-value).
    // The unit span is KEPT (re-labelled NEAR): prices.js writes the figure as the text before it and the
    // unit into it. The XRPL rule dropped the span, which left this build's total with no unit at all.
    h = h.replace(/(<div class="value">)[^<]*(<span[^>]*>)\s*APT\s*(<\/span>)(<\/div>)/g,
      function (m0, open, sp, spc, close) { blanked++; return open + '— ' + sp + 'NEAR' + spc + close; });
    h = h.replace(/(<div class="sub-value">)\s*≈[^<]*(<\/div>)/g,
      function (m0, open, close) { blanked++; return open + close; });

    // The Open Orders and Liquidity Pools insight cards: buildTabs() hides them at runtime because the tabs
    // replace them, so they start hidden in markup and cannot flash.
    let hidden = 0;
    h = h.replace(/<div class="insight-card([^"]*)"([^>]*)>([\s\S]{0,900}?<div class="ttl">\s*(?:Open Orders|Liquidity Pools)\s*<\/div>)/g,
      function (m0, cls, rest, body) {
        if (/display\s*:\s*none/.test(rest)) return m0;
        if (/insight-card/.test(body)) return m0;
        hidden++;
        return '<div class="insight-card' + cls + '" style="display:none"' + rest + '>' + body;
      });
    mockCards += hidden;

    // THIS DESIGN'S "Cancel all" IS A .ctrl-btn, NOT #cancelAllBtn. The XRPL gate and paintOrders() know it
    // by id or [data-cancel-all], so here it stayed on screen above "No open orders on this account."
    // (measured 2026-10-21). The design's button gets the attribute both already key on -- the gate then
    // holds it hidden until paintOrders decides, and paintOrders hides it when there is nothing to cancel.
    h = h.replace(/<button class="ctrl-btn">(\s*<svg[\s\S]{0,700}?<\/svg>\s*Cancel all\s*<\/button>)/g,
      function (m0, rest) { blanked++; return '<button class="ctrl-btn" data-cancel-all="1">' + rest; });
    mockHeadlines += blanked;

    h = stripById(h, ID).html;
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    h = h.slice(0, bi) + SCRIPT + h.slice(bi);

    h = h.replace(new RegExp('<style id="' + GATE_ID + '">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g'), '');
    h = stripById(h, GATE_JS).html;
    if (h.indexOf('</head>') >= 0 && /orders-block|orders-stack/.test(h)) {
      h = h.split('</head>').join(GATE + '</head>');
      gated++;
    }

    json[key] = h;
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('near wallet: stripped ' + stellarLayers + ' Stellar layer(s) ' + JSON.stringify(per) + '; disabled ' + mockCharts
  + ' random-walk chart(s); blanked ' + mockHeadlines + ' mock figure(s); hid ' + mockCards
  + ' tab-replaced card(s); orders gate on ' + gated + '; layer on ' + pages + ' page key(s) across ' + files + ' container(s)');
if (!pages) { console.error('  ! no wallet page key found — nothing was wired'); process.exit(1); }
