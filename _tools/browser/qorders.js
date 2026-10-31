// Dashboard → "Custom Swap / Orders": Stellar's three-tab dialog, on NEAR.
//
// RAZA 2026-10-28, two reports about the same card:
//   (5) "This pop up only opens up for a mini second and then redirect me to trade page."
//   (6) "The custom swap pop is totally different on Near compared to the pop up on Stellar. Fix the
//       custom swap pop on of Near and make it exactly like Stellar's swap pop up box - adding the
//       limit, orders options too."
// Both come from the same gap: `#swapModal` — the dialog the card is named after — had no driver on this
// fork, so it would have opened the design's mock (a fixed "1 APT ≈ 0.118 USDC" rate and a Swap button
// that prints "Swapped ✓" without touching a chain). `_neardash.js` therefore routed the card to
// /trade/near instead, which is the flash: the design's own handler opens the dialog, ours navigates
// away. With the dialog real, that override goes, and the card opens it — the XRPL fork's arrangement,
// where _xrpldash.js has no custom-swap rule at all.
//
// THE SAME DIALOG AS lumoscore.com, BUILT THE SAME WAY — this is a port of the XRPL fork's
// _tools/browser/qorders.js, which is itself Stellar's `lx-qorders` on another ledger. Stellar's layer
// renames the title, moves the existing swap form into a Swap pane, and adds Limit and Orders panes; its
// stylesheet (`lx-qorders-css`) and the swap pane's (`lx-swapcalc-css`) are BOTH STILL IN THIS BUILD,
// left behind when `_neardash.js` stripped those Stellar scripts — stripById only removes
// `<script id="...">`, so the `<style id="...">` blocks beside them survived (verified: 1 of each in
// lumoscore-home.html and lumoscore-home-mobile.html). So every class below — lxo-tabs, lxo-pane,
// lxq-fld, lxq-pick, lxq-menu, lxo-o, lx-dchip, lx-dbal, lx-swapmax, lx-swapd, lx-swap-err — is the one
// the live Stellar dialog uses, this file brings NO CSS of its own, and the two screens cannot drift.
// Disabling the CTA sets data-lxdis="1", because that is the selector already in lx-swapcalc-css.
//
// WHAT EACH TAB DOES ON NEAR — every chain call goes through a module that already exists and is already
// used by a shipped screen, so nothing here is a second implementation of a money path:
//   Swap    window.lxnSwap (browser/nearswap.js) — the wallet page's Swap dialog engine: Rhea route,
//           quote, 0.5% minimum received, the platform fee, storage registration, sign, verdict.
//   Limit   window.lxnDcl (browser/neardcl.js) — Rhea's DCL contract, the same engine the Trade-Asset
//           Limit pane (browser/dxalimit.js) drives. Limit orders are FREE: no platform fee
//           (RAZA 2026-08-19), so the Swap tab's fee rows are deliberately absent from this pane.
//   Orders  lxnDcl.activeOrders + buildCancel — the same source as the wallet page's Open orders.
//
// ONE REAL DIFFERENCE FROM STELLAR AND XRPL, AND IT IS THE LEDGER'S, NOT A SHORTCUT. A DCL limit order
// needs a Rhea pool, and `lxnDcl.poolFor` only finds pools of <token> against wNEAR — so on NEAR a limit
// order is <token> ↔ NEAR and nothing else. The pane still offers two pickers, exactly as the design
// draws it; pick a pair with no pool and the button stays disabled and says why, which is what
// dxalimit.js does on an unsupported token. Silently hiding one picker would be a different dialog.
//
// The design's own #swapModal script binds mock listeners to #swapAmtIn, #swapFlip and #swapGo. Those
// three nodes are replaced with clean clones before anything is wired — the second-writer shape this
// project has been bitten by repeatedly.
(function () {
  if (window.__lxnQOrders) return;
  window.__lxnQOrders = 1;

  var NEAR_LOGO = '/assets/networks/near.png';
  var CHEVRON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  var NOPOOL = 'Limit orders need a Rhea DCL pool for this pair';

  var S = function () { return window.lxnSwap; };
  var D = function () { return window.lxnDcl; };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function modal() { return document.getElementById('swapModal'); }
  function addr() {
    try { return (window.lxn && window.lxn.account && window.lxn.account()) || localStorage.getItem('lumos.address') || ''; }
    catch (e) { return ''; }
  }
  function connect() { try { if (window.lxn && window.lxn.open) window.lxn.open(); } catch (e) {} }

  // ---- text ------------------------------------------------------------------------------------------
  // The same four helpers browser/swapmodal.js formats with, so the dashboard dialog and the wallet
  // dialog never print the same figure two ways.
  function plain(el, text) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode(text == null ? '' : String(text)));
  }
  // TRUNCATE AS A STRING. toFixed ROUNDS, and a balance rounded up is a MAX that cannot be spent —
  // the trap this project has already paid for once. Everything that shows or fills an amount goes
  // through here, including the sentences that quote one back.
  function trunc(s, dp) {
    s = String(s);
    var i = s.indexOf('.');
    if (i < 0 || dp == null) return s;
    return dp <= 0 ? s.slice(0, i) : s.slice(0, i + 1 + dp).replace(/\.$/, '');
  }
  // A quotient as plain decimal text: String(1/8e6) is "1.25e-7", which trunc() would cut inside the exponent.
  function plainNum(n) { var t = String(n); return /e/i.test(t) ? Number(n).toFixed(20) : t; }
  function commas(s) { var p = String(s).split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); }
  function down(raw, dec, dp) { return trunc(S().fromUnits(raw, dec), dp == null ? 6 : dp); }
  function show(raw, dec, dp) {
    var t = down(raw, dec, dp);
    return commas(t === '' ? '0' : t);
  }
  // A float, for a figure that was never a raw integer (a rate, a price, a percentage).
  function fmtNum(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    return commas(trunc(n.toFixed(Math.min(20, dp == null ? 6 : dp)), dp == null ? 6 : dp));
  }
  function shortId(a) {
    a = String(a || '');
    return a.length > 20 ? a.slice(0, 9) + '…' + a.slice(-8) : a;
  }

  function asset(id, code, dec, logo) { return { id: id, code: code, dec: +dec, logo: logo || '' }; }
  var NEAR = asset('near', 'NEAR', 24, NEAR_LOGO);
  function same(a, b) { return !!a && !!b && a.id === b.id; }
  function isNear(a) { return !!a && (a.id === 'near' || a.id === (S() ? S().WNEAR : 'wrap.near')); }
  function logoOf(a) { return (a && a.logo) || (a && a.id === 'near' ? NEAR_LOGO : ''); }

  // send.js's toast, the shape browser/swapmodal.js already reuses.
  function toast(text, bad) {
    if (!document.getElementById('lx-toastbad-css')) {
      var st = document.createElement('style');
      st.id = 'lx-toastbad-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}'
        + '.lx-ctoast.bad .ci{background:#e5484d}';
      (document.head || document.documentElement).appendChild(st);
    }
    var stack = $('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast' + (bad ? ' bad' : '');
    var ic = document.createElement('span'); ic.className = 'ci'; ic.textContent = bad ? '!' : '✓';
    var tx = document.createElement('span'); tx.textContent = text;
    t.appendChild(ic); t.appendChild(tx);
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  // ---- the account -----------------------------------------------------------------------------------
  // H.who IS THE SETTLED MARKER, and it is set on a FAILED read too (H.failed records which it was).
  // "loaded" has to mean "we have asked and stopped", not "we succeeded" — a dialog that waits for
  // success waits for ever on a dead RPC. The balance LINE still refuses to print a figure it did not
  // get: not-yet-asked and could-not-ask both render an em dash, and only a real zero renders 0.
  var H = { who: '', loading: null, failed: false, held: [], bal: {}, balFail: {} };

  function heldFromPage() {
    var d = window.__lxnData, out = [];
    ((d && d.held) || []).forEach(function (t) {
      if (t.dec == null || !t.id) return;
      try { S().remember(t.id, t.display, t.dec, t.logo); } catch (e) {}
      var a = asset(t.id, t.display || t.id, t.dec, t.logo);
      a.human = +t.balance || 0;
      out.push(a);
    });
    return out;
  }

  function loadAccount(force) {
    var who = addr();
    if (!who) { H.who = ''; H.held = []; H.bal = {}; H.balFail = {}; return Promise.resolve(); }
    if (!force && H.who === who && !H.loading) return Promise.resolve();
    if (H.loading && H.loading.who === who && !force) return H.loading.p;
    // A DIFFERENT ACCOUNT'S FIGURES ARE NOT THIS ONE'S. Without this, reconnecting as someone else
    // keeps every per-token balance read for the previous wallet — numbers that are wrong rather than
    // missing, which is the worse of the two.
    if (H.who && H.who !== who) { H.bal = {}; H.balFail = {}; sw.feeOk = {}; gone = {}; }
    var held = heldFromPage();
    // THE DASHBOARD HAS NO __lxnData — only the wallet page publishes it — so here "You sell" listed NEAR alone
    // for an account holding 21 tokens (RAZA 2026-10-31: the Asset 1 list "differs on both Stellar and Near").
    // The same reader the wallet page uses (lxnCore.readHoldings) fills it in. A failed read leaves NEAR alone
    // listed, which is still true; it never invents a zero.
    var fromCore = held.length || !window.lxnCore ? Promise.resolve() : window.lxnCore.readHoldings(who).then(function (d) {
      ((d && d.held) || []).forEach(function (t) {
        if (t.dec == null || !t.id || t.id === S().WNEAR) return;
        try { S().remember(t.id, t.display, t.dec, t.logo); } catch (e) {}
        var x = asset(t.id, t.display || t.id, t.dec, t.logo);
        x.raw = String(t.raw || '0');
        held.push(x);
      });
    }, function () {});
    // NEAR itself is always spendable and is not in __lxnData.held, so its balance is read directly.
    var p = fromCore.then(function () { return S().balance(who, 'near'); }).then(function (raw) {
      H.bal['near'] = String(raw); H.balFail['near'] = 0; H.failed = false;
    }, function () {
      H.bal['near'] = null; H.balFail['near'] = 1; H.failed = true;
    }).then(function () {
      held.forEach(function (a) {
        // __lxnData.held carries a human figure the wallet page already read; keep it as raw units so
        // one formatter serves every row. A ZERO IS RECORDED AS A ZERO: skipping it would leave the
        // entry undefined, which this file reads as "never asked" and shows as an em dash — turning a
        // balance we know into one we appear not to have.
        try { H.bal[a.id] = a.raw != null ? a.raw : (S().toUnits(trunc(String(a.human || 0), a.dec), a.dec) || '0'); }
        catch (e) { H.bal[a.id] = null; H.balFail[a.id] = 1; }
      });
      H.held = [NEAR].concat(held);
      H.who = who;                      // settled, whichever way it went
      H.loading = null;
    });
    H.loading = { who: who, p: p };
    return p;
  }
  function settled() { return !!H.who && H.who === addr(); }
  function heldOf(a) {
    if (!a) return null;
    for (var i = 0; i < H.held.length; i++) if (H.held[i].id === a.id) return H.held[i];
    return null;
  }
  // THREE STATES, AND THEY MUST NOT COLLAPSE INTO ONE. undefined = never asked, null = asked and the
  // read failed, a string = a figure we actually have (including "0"). The balance line prints an em
  // dash for the first two and a number for the third, and the CTA refuses to go live on either of the
  // first two — a button that cannot know the balance cannot know the press will work.
  function rawBal(a) { return a ? H.bal[a.id] : undefined; }
  function roomRaw(a) {
    var r = rawBal(a);
    if (r == null) return r;                     // undefined or null, passed through as-is
    try { return S().swapRoom(a.id, r); } catch (e) { return null; }   // swaps and orders keep 0.2 NEAR for gas
  }
  // Why the pay side cannot be spent from yet, or '' when it can.
  function balWhy(a) {
    if (!a) return 'Choose two tokens';
    var r = rawBal(a);
    if (r === undefined) return 'Reading your balance…';
    if (r === null) return 'Could not read your ' + a.code + ' balance';
    return '';
  }
  // A token the wallet page never listed has no figure here; read it on demand, once, the way
  // browser/swapmodal.js's loadBal does. A failed read is recorded as a failure, never as a zero.
  function ensureBal(a) {
    if (!a || !addr() || H.bal[a.id] !== undefined) return Promise.resolve();
    return S().balance(addr(), a.id).then(function (raw) {
      H.bal[a.id] = String(raw); H.balFail[a.id] = 0;
    }, function () { H.bal[a.id] = null; H.balFail[a.id] = 1; });
  }
  function emptyWhy() {
    if (!addr()) return 'Connect a NEAR wallet';
    if (!settled()) return 'Reading your wallet…';
    if (H.failed) return 'Your wallet could not be read';
    return 'Nothing in this wallet to swap';
  }
  // Redraw a menu once the wallet settles: every picker here lists balances, so the race belongs in one
  // place rather than in each builder.
  function rebuildOnLoad(m, build) {
    build();
    if (settled()) return;
    loadAccount().then(function () {
      if (!m.parentNode) return;
      m.innerHTML = '';
      build();
    });
  }

  // ---- the curated roster (the receive side's universe) ----------------------------------------------
  // NEAR HAS NO LEDGER-WIDE TOKEN SEARCH, so there is no searchInto() here as there is on XRPL. The
  // platform's curated list IS the universe for a NEAR swap (/lxapi/nearmarket, the Trade roster, shared
  // through the promise prices.js publishes), and it is filtered locally — which is the same box to type
  // into, answering from a list instead of an index.
  function curatedList() {
    var p = window.__lxnMarketP;
    if (!p) {
      p = fetch('/lxapi/nearmarket').then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.ok && d.rows) ? d : null; }, function () { return null; });
      window.__lxnMarketP = p;
    }
    return p.then(function (d) {
      var out = [NEAR];
      if (d && +d.usd > 0) USD.near = +d.usd;
      ((d && d.rows) || []).forEach(function (r) {
        if (!r || !r.i || r.dc == null || r.i === S().WNEAR) return;
        try { S().remember(r.i, r.n, r.dc, r.logo); } catch (e) {}
        out.push(asset(r.i, r.n || r.i, r.dc, r.logo));
        if (r.vf) VSET[r.i] = 1;
        if (+r.p > 0 && USD.near > 0) USD[r.i] = +r.p * USD.near;
      });
      applyTicks();
      return out;
    });
  }
  // THE VERIFIED TICK AND THE DOLLAR FIGURES COME FROM THE SAME ROSTER AS THE LIST (RAZA 2026-10-31: "Verified
  // ticks are missing for the other assets in the drop down list"; "I need the amount in terms of dollar of
  // both asset 1 & 2 like it's appearing on Stellar's pop up"). Every listed NEAR token is curated, so it is
  // ticked — the rule the Trade table, the search rows and the wallet already apply (nearmarket's vf) — and
  // NEAR itself is ticked as Stellar ticks XLM in this same menu. A row drawn before the roster lands is
  // re-ticked when it does, through the data-lxqv marker.
  var VSET = {}, USD = {};
  function verified(a) { return !!a && (a.id === 'near' || a.id === (S() ? S().WNEAR : 'wrap.near') || !!VSET[a.id]); }
  // THE TICK'S SIZE. Stellar's .lx-vtick rule (14px green disc, 9px check) lives in the Trade and Account
  // stylesheets, which the dashboard does not load -- so here the bare svg grew to the width of the menu row
  // (RAZA 2026-11-01: a check mark the size of the dialog). The same rule, scoped to this dialog, once.
  function tickCss() {
    if (document.getElementById('lxq-vtick-css')) return;
    var st = document.createElement('style');
    st.id = 'lxq-vtick-css';
    st.textContent = '#swapModal .lx-vtick{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;'
      + 'margin-left:5px;border-radius:50%;background:var(--green,#35c07f);color:#fff;vertical-align:-2px;flex:0 0 14px}'
      + '#swapModal .lx-vtick svg{width:9px;height:9px;display:block}';
    document.head.appendChild(st);
  }
  function vtick() {
    tickCss();
    var s = document.createElement('span');
    s.className = 'lx-vtick';
    s.title = 'Curated on LumosCore';
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    return s;
  }
  function applyTicks() {
    $$('#swapModal [data-lxqv]').forEach(function (h) {
      if (verified({ id: h.getAttribute('data-lxqv') }) && !h.querySelector('.lx-vtick')) h.appendChild(vtick());
    });
  }
  // "≈ $1.23" for an amount of an asset, or '' when no price is known — never a guessed $0.
  function usdText(amount, a) {
    var px = a ? (isNear(a) ? USD.near : USD[a.id]) : 0;
    if (!(amount > 0) || !(px > 0)) return '';
    var v = amount * px;
    return '≈ $' + (v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(4) : v.toPrecision(2));
  }
  var CUR = [];
  function curated() { return CUR; }
  function curLoad() {
    if (curLoad.p) return curLoad.p;
    curLoad.p = curatedList().then(function (l) { CUR = l; return l; }, function () { return CUR; });
    return curLoad.p;
  }

  // ---- menus (shared by Swap and Limit) --------------------------------------------------------------
  function closeMenus() { $$('#swapModal .lxq-menu').forEach(function (m) { if (m.parentNode) m.parentNode.removeChild(m); }); }

  function paintIco(el, a) {
    var lg = logoOf(a);
    plain(el, lg ? '' : String((a && a.code) || '?').charAt(0).toUpperCase());
    el.setAttribute('data-logoed', '1');
    if (!lg) return;
    el.style.background = 'transparent';
    var im = document.createElement('img');
    im.alt = ''; im.src = lg;
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
    el.appendChild(im);
  }

  function menuRow(a, right, onPick) {
    var b = document.createElement('button');
    b.type = 'button';
    var ic = document.createElement('span'); ic.className = 'lxq-ic'; paintIco(ic, a);
    var tx = document.createElement('span'); tx.className = 'tx';
    var cd = document.createElement('span'); cd.className = 'cd'; cd.setAttribute('data-logoed', '1'); cd.textContent = a.code;
    cd.setAttribute('data-lxqv', a.id);
    if (verified(a)) cd.appendChild(vtick());
    var sb = document.createElement('span'); sb.className = 's';
    // "native asset", the words Stellar's menu puts under XLM.
    sb.textContent = a.id === 'near' ? 'native asset' : shortId(a.id);
    tx.appendChild(cd); tx.appendChild(sb);
    b.appendChild(ic); b.appendChild(tx);
    if (right) { var rt = document.createElement('span'); rt.className = 'rt'; rt.textContent = right; b.appendChild(rt); }
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); closeMenus(); onPick(a); }, true);
    return b;
  }
  function menuHead(m, text) { var h = document.createElement('div'); h.className = 'h'; h.textContent = text; m.appendChild(h); }

  function openMenu(host, anchor, build) {
    closeMenus();
    curLoad();
    var m = document.createElement('div');
    m.className = 'lxq-menu';
    m.style.top = (anchor.offsetTop + anchor.offsetHeight + 6) + 'px';
    rebuildOnLoad(m, function () { build(m); });
    m.addEventListener('click', function (e) { e.stopPropagation(); });
    host.appendChild(m);
  }

  // Opt an input out of the browser's own autofill history: the white list of previously typed amounts
  // covers the dialog while you type into it, and nothing in this file renders it.
  function noAuto(el) {
    if (!el) return;
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    if (el.hasAttribute('name')) el.removeAttribute('name');
  }

  // Digits and ONE point, clamped to the token's decimals. Shared by every amount field here, so the
  // Limit pane cannot accept a figure the Swap pane would refuse.
  function clean(el, dec) {
    var v = String(el.value).replace(/,/g, '').replace(/[^0-9.]/g, '');
    var i = v.indexOf('.');
    if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
    if (dec != null && i >= 0 && v.length - i - 1 > dec) v = v.slice(0, i + 1 + dec);
    if (v !== el.value) el.value = v;
    return v;
  }

  // One picker body, used by both panes: a type-to-filter box over a list we already hold.
  function filterInto(m, heading, placeholder, list, rightOf, onPick) {
    menuHead(m, heading);
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = placeholder;
    noAuto(inp);
    m.appendChild(inp);
    var res = document.createElement('div');
    m.appendChild(res);
    function draw() {
      var q = (inp.value || '').trim().toLowerCase();
      res.innerHTML = '';
      var rows = !q ? list : list.filter(function (a) {
        return ((a.code || '').toLowerCase().indexOf(q) >= 0) || ((a.id || '').toLowerCase().indexOf(q) >= 0);
      });
      if (!rows.length) { menuHead(res, 'No matches'); return; }
      rows.forEach(function (a) { res.appendChild(menuRow(a, rightOf ? rightOf(a) : '', onPick)); });
    }
    inp.addEventListener('input', draw);
    draw();
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0);
  }
  // Stellar's "You sell" menu is the holdings themselves: no heading, no search box, one row per asset with
  // its balance (RAZA 2026-10-31: "the drop down list of Asset 1 differs on both Stellar and Near").
  function listInto(m, list, rightOf, onPick) {
    list.forEach(function (a) { m.appendChild(menuRow(a, rightOf ? rightOf(a) : '', onPick)); });
  }
  // THE PICKER'S WORDS FOR EVERYTHING THE PLATFORM LISTS. Stellar reads "Search any asset" over "Code or issuer
  // address"; a NEAR token has no issuer — its identity is the contract account — so the second half says
  // contract, which is what this box actually matches on.
  var ANY_HEAD = 'Search any asset', ANY_PH = 'Code or contract address';
  function balRight(a) {
    var r = rawBal(a);
    return r == null ? '—' : show(r, a.dec, 6);
  }

  // ======================================================================================== SWAP
  var sw = { from: null, to: null, quote: null, seq: 0, busy: false, wired: false, feeOk: {} };

  function swapPane() { return $('#swapModal .lxo-pane[data-pane="swap"]'); }
  function blockOf(node) {
    var pane = swapPane();
    while (node && node.parentNode && node.parentNode !== pane) node = node.parentNode;
    return node && node.parentNode === pane ? node : null;
  }
  function swapSay(text, note) {
    var err = $('#swapModal .lx-swap-err');
    if (!err) return;
    err.textContent = text || '';
    err.style.display = text ? '' : 'none';
    err.style.color = text && note ? 'var(--text-muted,#8b90a0)' : 'var(--red,#ff5b5b)';
    err.style.fontWeight = text && note ? '500' : '600';
  }
  function setGo(enabled, label) {
    var go = $('#swapGo');
    if (!go) return;
    // A BUTTON THAT LOOKS LIVE MUST BE LIVE. A late quote can land while a swap is in flight, and
    // repainting it bright would offer a press that doSwap() refuses at its busy guard. One choke point.
    if (enabled && sw.busy) enabled = false;
    if (label) go.textContent = label;
    if (enabled) { go.removeAttribute('data-lxdis'); go.style.opacity = ''; go.style.cursor = 'pointer'; }
    else { go.setAttribute('data-lxdis', '1'); go.style.opacity = '0.55'; go.style.cursor = 'not-allowed'; }
  }
  function detail(k, v) { var s = $('#swapModal .lx-swapd [data-k="' + k + '"]'); if (s) s.textContent = v; }
  function showRate(txt) { var r = $('#swapRate'); if (r) r.textContent = txt || '—'; }

  // The selected chip's mark goes on the CHIP, not on the icon span: the design repaints that span's
  // style attribute wholesale, so an inline background there is erased rather than outranked. A
  // stylesheet rule reads the url off the chip, which that writer never touches.
  function chipArtCss() {
    if (document.getElementById('lxq-chipart-css')) return;
    var st = document.createElement('style');
    st.id = 'lxq-chipart-css';
    st.textContent = '.lx-dchip[data-lxart]>span:first-child{'
      // 18px INSIDE THE 24px BOX: Stellar's token art is a 24px image whose disc is 18px across (r=9), while a
      // NEAR logo from token metadata fills its square edge to edge -- so 'contain' drew USDC visibly bigger
      // than lumoscore.com does (RAZA 2026-10-31; measured: both boxes 24x24, the difference is the art).
      + 'background-image:var(--lxa)!important;background-size:18px 18px!important;'
      + 'background-position:center!important;background-repeat:no-repeat!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  function paintChip(which, a) {
    var id = which === 'from' ? 'swapFrom' : 'swapTo';
    var nameEl = document.getElementById(id);
    if (!nameEl) return;
    nameEl.textContent = a ? a.code : 'Select';
    nameEl.setAttribute('data-logoed', '1');
    var chip = nameEl.parentNode;
    var ic = chip && chip.firstElementChild;
    if (ic && ic !== nameEl) {
      ic.setAttribute('data-logoed', '1');
      var lg = a ? logoOf(a) : '';
      if (a && lg) {
        chipArtCss();
        ic.textContent = '';
        chip.style.setProperty('--lxa', 'url("' + lg + '")');
        chip.setAttribute('data-lxart', '1');
      } else {
        chip.removeAttribute('data-lxart');
        chip.style.removeProperty('--lxa');
        ic.textContent = a ? String(a.code || '?').charAt(0).toUpperCase() : '?';
      }
    }
    var block = blockOf(nameEl);
    var bal = block && $('.lx-dbal', block);
    if (bal) {
      // A ZERO NOBODY HAS VERIFIED IS NOT A BALANCE. rawBal is null both before the read and when it
      // failed, and both print an em dash; a read that came back zero prints 0.
      var r = a ? rawBal(a) : null;
      bal.textContent = (a && addr())
        ? ('Balance: ' + (r == null ? '—' : show(r, a.dec, 7)) + ' ' + a.code)
        : '';
    }
  }
  function paintSwap() { paintChip('from', sw.from); paintChip('to', sw.to); }

  function defaults() {
    if (!sw.from) sw.from = heldOf(NEAR) || NEAR;
    if (!sw.to) {
      // NEAR → USDC, the pair this build curates, rather than whatever happens to be first in the
      // wallet — the accident of ordering RAZA reported against XRPL's dialog.
      var u = null;
      try { u = S().meta(S().USDC); } catch (e) {}
      sw.to = u ? asset(u.id, u.code, u.dec, u.logo)
        : (curated().filter(function (c) { return c.code === 'USDC'; })[0] || null);
      if (!sw.to) sw.to = curated().filter(function (c) { return !same(c, sw.from); })[0] || null;
    }
    if (sw.to && sw.from && same(sw.to, sw.from)) {
      sw.to = curated().filter(function (c) { return !same(c, sw.from); })[0] || null;
    }
    paintSwap();
  }

  function clearQuote() {
    sw.quote = null;
    var out = $('#swapAmtOut'); if (out) plain(out, '');
    var det = $('#swapModal .lx-swapd'); if (det) det.style.display = 'none';
    showRate(spotTxt());
    setGo(false, 'Swap');
  }

  // THE RATE LINE WITH NO AMOUNT TYPED. The dialog opens with the field empty, so a rate learned only as
  // a side effect of quoting an amount would read "—" on open — which is what Stellar's own quoteRate()
  // exists to avoid. Asked of the MARKET: one quote at a small size through the same Rhea route, keyed on
  // the pair so a repaint does not re-ask, and sequence-guarded so a slow answer for an abandoned pair
  // cannot overwrite a newer one.
  var spot = { key: '', txt: '', seq: 0 };
  function spotTxt() { return spot.txt; }
  function quoteRate() {
    var f = sw.from, t = sw.to;
    if (!f || !t || !S()) { spot.key = ''; spot.txt = ''; showRate('—'); return; }
    var key = f.id + '>' + t.id;
    if (spot.key === key) { showRate(spot.txt); return; }
    spot.key = key; spot.txt = ''; showRate('—');
    var my = ++spot.seq;
    var one;
    try { one = S().toUnits('1', f.dec); } catch (e) { return; }
    S().quote(f.id, t.id, one).then(function (q) {
      if (my !== spot.seq) return;
      var got = Number(S().fromUnits(q.out, t.dec));
      if (!(got > 0)) return;
      spot.txt = '1 ' + f.code + ' ≈ ' + fmtNum(got, got < 1 ? 7 : 4) + ' ' + t.code;
      showRate(spot.txt);
    }, function () { if (my === spot.seq) showRate('—'); });
  }

  function quoteSwap() {
    var inEl = $('#swapAmtIn');
    if (!inEl || !S()) return;
    var my = ++sw.seq;
    var f = sw.from, t = sw.to;
    var typed = String(inEl.value || '').trim();
    if (!f || !t || !typed || !(Number(typed) > 0)) { clearQuote(); return; }
    if (!addr()) { clearQuote(); setGo(true, 'Connect wallet'); return; }
    var raw;
    try { raw = S().toUnits(trunc(typed, f.dec), f.dec); } catch (e) { clearQuote(); return; }
    if (!raw || raw === '0') { clearQuote(); return; }
    setGo(false, 'Quoting…');
    S().quote(f.id, t.id, raw).then(function (q) {
      if (my !== sw.seq) return;
      sw.quote = q;
      var out = $('#swapAmtOut'); if (out) plain(out, show(q.out, t.dec, 6));
      var det = $('#swapModal .lx-swapd'); if (det) det.style.display = '';
      var got = Number(S().fromUnits(q.out, t.dec)), paid = Number(S().fromUnits(q.amount, f.dec));
      detail('rate', paid > 0 ? ('1 ' + f.code + ' ≈ ' + fmtNum(got / paid, (got / paid) < 1 ? 7 : 4) + ' ' + t.code) : '—');
      // With the breakdown open, the rate lives in its "Rate" row only — Stellar blanks the line above it
      // (RAZA 2026-10-31: remove "1 NEAR ≈ 4.2700 USDC" between You receive and the breakdown).
      showRate(' ');
      detail('slip', (q.slipBps / 100) + '%');
      // The percentage belongs to the LABEL, "Swap fee (0.2%)", as on Stellar — not after the amount.
      detail('feelbl', 'Swap fee (' + (S().FEE_BPS / 100) + '%)');
      detail('fee', show(q.fee, f.dec, 7) + ' ' + f.code);
      // NET_FEE_EST is a finished string — '0.003 NEAR', unit included — and browser/swapmodal.js
      // prints it verbatim. Wrapping it read "≈ ~0.003 NEAR NEAR".
      detail('net', S().NET_FEE_EST);
      detail('min', show(q.min, t.dec, 6) + ' ' + t.code);
      if (q.impact != null && q.impact >= 1) swapSay('Price impact ' + fmtNum(q.impact, 2) + '% — this trade moves the pool.', true);
      else swapSay('');
      // EVERY MONEY CHECK THE PRESS WILL MAKE AGAIN, including the one that cannot be made: an unknown
      // balance keeps the button down and says which it is, rather than offering a press that fails at
      // signing. browser/swapmodal.js's blocker() refuses on the same two states.
      var room = roomRaw(f);
      if (room == null) {
        swapSay(balWhy(f) + '.', room === undefined);
        setGo(false, 'Swap');
        return;
      }
      if (S().big(raw) > S().big(room)) {
        swapSay(shortOf(f, rawBal(f), 'swap'));
        setGo(false, 'Swap');
        return;
      }
      if (sw.feeOk[f.id] === false) {
        swapSay(f.code + ' cannot be swapped here yet: the platform fee account is not registered on it.', true);
        setGo(false, 'Swap');
        return;
      }
      setGo(true, 'Swap');
    }, function (e) {
      if (my !== sw.seq) return;
      sw.quote = null;
      var out = $('#swapAmtOut'); if (out) plain(out, '');
      var det = $('#swapModal .lx-swapd'); if (det) det.style.display = 'none';
      showRate(spotTxt());
      swapSay((e && e.noroute) ? ('No route between ' + f.code + ' and ' + t.code + ' on Rhea right now.') : ((e && e.message) || 'No quote right now.'));
      setGo(false, 'Swap');
    });
  }

  // The fee-account registration check for the token being PAID with: a definite answer is remembered,
  // a failed read is not (null), so "could not ask" never hardens into "no".
  function checkFee(a) {
    if (!a || sw.feeOk[a.id] != null) return Promise.resolve();
    return S().feeReady(a.id).then(function (ok) { sw.feeOk[a.id] = ok; }, function () { sw.feeOk[a.id] = null; });
  }

  // THE REFUSAL, IN STELLAR'S WORDS (RAZA 2026-10-31: "edit ... from 'More than your spendable NEAR (0)' to
  // 'Insufficient NEAR balance — you have 0.0781800 NEAR' like it shows in Stellar's pop up"). The old line
  // named the SPENDABLE figure, which for NEAR is the balance less the 0.2 NEAR a swap keeps back for gas —
  // so a wallet holding 0.078 NEAR read "your spendable NEAR (0)", true and baffling. Now the sentence names
  // the balance the user can see, and when it is the gas keep (not the balance) that refuses, it says so:
  // Rhea's own app refuses the same swap with "Must have 0.2N or more left in wallet for gas fee".
  function shortOf(a, bal, verb) {
    var have = bal == null ? '—' : show(bal, a.dec, 7);
    var s = 'Insufficient ' + a.code + ' balance — you have ' + have + ' ' + a.code;
    if (isNear(a) && a.id === 'near') {
      var keep = show(S().SWAP_KEEP, 24, 2);
      s += ', and a NEAR ' + verb + ' keeps ' + keep + ' NEAR back for network fees';
    }
    return s + '.';
  }
  // The 50% LUMOS nudge Stellar draws under the breakdown, in its own markup and classes (lx-fee-banner,
  // styled by the inherited lx-swapcalc-css), pointing at NEAR's LUMOS page.
  var FEE_NUDGE = '<div class="lx-fee-banner nudge"><span class="lx-fee-ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-4 0-7-2.7-7-6.5 0-2.3 1.2-4 2.4-5.4.3.9 1 1.6 1.9 1.6 1.4 0 1.7-1 1.6-3.5-.1-2.4 1-4.6 3.1-6.2-.4 2 .3 3.2 1.6 4.6C19 9.6 19 11.8 19 16.5c0 3.8-3 6.5-7 6.5z"></path></svg></span><span class="txt"><b>50% off trading fees</b> — hold 250,000 <a class="lx-fee-buy" href="/lumos/near" data-logoed="1">LUMOS</a></span></div>';

  function swapUi() {
    var pane = swapPane();
    if (!pane || sw.wired) return;
    var fromEl = $('#swapFrom'), toEl = $('#swapTo'), inEl = $('#swapAmtIn'), goEl = $('#swapGo');
    if (!fromEl || !toEl || !inEl || !goEl) return;
    sw.wired = true;
    noAuto(inEl);
    pane.style.position = 'relative';

    [[fromEl, true], [toEl, false]].forEach(function (pair) {
      var block = blockOf(pair[0]);
      if (!block) return;
      var label = block.firstElementChild;
      // Only the PAY side carries a balance line: Stellar's "You receive" has none, and on NEAR it read
      // "Balance: — USDC" for every token the wallet does not hold (RAZA 2026-10-31).
      if (label && pair[1] && !$('.lx-dbal', label)) {
        label.style.cssText += ';display:flex;justify-content:flex-start;align-items:center;gap:8px';
        var bal = document.createElement('span');
        bal.className = 'lx-dbal';
        bal.style.cssText = 'font-size:12px;color:var(--text-muted,#8b90a0);font-weight:600;margin-left:auto';
        label.appendChild(bal);
        if (pair[1]) {
          var mx = document.createElement('button');
          mx.type = 'button'; mx.className = 'lx-swapmax'; mx.textContent = 'Max';
          label.appendChild(mx);
        }
      }
      var chipEl = pair[0].parentNode;
      chipEl.classList.add('lx-dchip');
      chipEl.setAttribute('data-lx-noswap', '');
      chipEl.setAttribute('data-side', pair[1] ? 'from' : 'to');
      if (!$('.lx-dcaret', chipEl)) {
        var car = document.createElement('span'); car.className = 'lx-dcaret'; car.innerHTML = CHEVRON;
        chipEl.appendChild(car);
      }
    });

    var out = $('#swapAmtOut');
    if (out) plain(out, '');
    showRate('—');

    if (!$('.lx-swapd', pane)) {
      var det = document.createElement('div');
      det.className = 'lx-swapd';
      det.style.display = 'none';
      det.innerHTML = '<div class="r"><span>Rate</span><strong data-k="rate">—</strong></div>'
        + '<div class="r"><span>Slippage tolerance</span><strong data-k="slip">—</strong></div>'
        + '<div class="r"><span data-k="feelbl">Swap fee</span><strong data-k="fee">—</strong></div>'
        + '<div class="r"><span>Network fee</span><strong data-k="net">—</strong></div>'
        + '<div class="r rtot"><span>Minimum received</span><strong data-k="min">—</strong></div>'
        + '<div data-k="feenote">' + FEE_NUDGE + '</div>';
      var err = document.createElement('div');
      err.className = 'lx-swap-err';
      err.style.display = 'none';
      goEl.parentNode.insertBefore(det, goEl);
      goEl.parentNode.insertBefore(err, goEl);
    }

    pane.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chipEl = t.closest('.lx-dchip');
      if (chipEl) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!addr()) { connect(); return; }
        var side = chipEl.getAttribute('data-side');
        openMenu(pane, blockOf(chipEl), function (m) {
          var other = side === 'from' ? sw.to : sw.from;
          function pick(picked) {
            if (side === 'from') { sw.from = heldOf(picked) || picked; if (same(sw.to, picked)) sw.to = null; }
            else { sw.to = picked; if (same(sw.from, picked)) sw.from = null; }
            var fi = $('#swapAmtIn'); if (fi) fi.value = '';
            swapSay('');
            paintSwap(); quoteRate(); clearQuote();
            Promise.all([checkFee(sw.from), ensureBal(sw.from)]).then(function () { paintSwap(); });
          }
          // PAY WITH WHAT YOU HOLD, RECEIVE ANYTHING THE PLATFORM LISTS — the same split as the wallet
          // dialog, and the heading says which list this is because the two boxes look identical.
          var list = (side === 'from' ? H.held : curated()).filter(function (a) { return !same(a, other); });
          if (side === 'from') {
            var mine = list.filter(function (a) { return a.id === 'near' || rawBal(a) == null || S().big(rawBal(a)) > BigInt(0); });
            if (!mine.length) { menuHead(m, emptyWhy()); return; }
            filterInto(m, 'Your assets', 'Symbol or contract', mine, balRight, pick);
          } else {
            if (!list.length) { menuHead(m, 'The token list could not be loaded'); return; }
            filterInto(m, ANY_HEAD, ANY_PH, list, null, pick);
          }
        });
        return;
      }
      if (t.closest('.lx-swapmax')) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!sw.from) { toast('Choose an asset to swap first.', true); return; }
        var room = roomRaw(sw.from);
        // SAY WHY, rather than writing a zero that is indistinguishable from a dead button — and quote
        // the refusal with the SAME formatter that fills the field, so the sentence and the number agree.
        // Still-loading and could-not-load are different sentences, because one of them is worth waiting for.
        if (room == null) { swapSay(balWhy(sw.from) + '.', room === undefined); return; }
        // IN THE DIALOG, NOT A TOAST: the toast's sentence was cut off at the screen's edge ("...network fees
        // an") and vanished — RAZA 2026-10-31. The error line under the form holds the whole sentence.
        if (!(S().big(room) > BigInt(0))) {
          var fz = $('#swapAmtIn'); if (fz) fz.value = '';
          clearQuote();
          swapSay(shortOf(sw.from, rawBal(sw.from), 'swap'));
          return;
        }
        var fi = $('#swapAmtIn');
        if (fi) { fi.value = down(room, sw.from.dec); swapSay(''); quoteSwap(); }
        return;
      }
      if (t.closest('#swapFlip')) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (sw.busy || !sw.from || !sw.to) return;
        var a = sw.from, b = sw.to;
        sw.from = heldOf(b) || b; sw.to = a;
        var fl = $('#swapAmtIn'); if (fl) fl.value = '';
        swapSay('');
        paintSwap(); quoteRate(); clearQuote();
        Promise.all([checkFee(sw.from), ensureBal(sw.from)]).then(function () { paintSwap(); });
        return;
      }
      if (t.closest('#swapGo')) {
        e.preventDefault(); e.stopImmediatePropagation();
        var go = $('#swapGo');
        if (go && go.getAttribute('data-lxdis') === '1') return;
        if (!addr()) { connect(); return; }
        doSwap();
        return;
      }
      if (!t.closest('.lxq-menu')) closeMenus();
    }, true);

    var tmr = null;
    pane.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'swapAmtIn') return;
      e.stopImmediatePropagation();
      clean(e.target, sw.from ? sw.from.dec : null);
      sw.quote = null;
      setGo(false, 'Swap');
      clearTimeout(tmr);
      tmr = setTimeout(quoteSwap, 350);
    }, true);
  }

  function doSwap() {
    if (sw.busy) return;
    var shown = sw.quote, f = sw.from, t = sw.to, who = addr();
    if (!shown || !f || !t || !who) return;
    sw.busy = true;
    swapSay('');
    setGo(false, 'Checking the route…');
    window.__lxnLastSwap = null;
    function stop(text, note) { sw.busy = false; setGo(!!sw.quote, 'Swap'); if (text) swapSay(text, note); }
    // The quote on screen may be seconds old: ask again, and refuse if the price moved past the floor
    // that was shown. Nothing is signed in that case.
    S().quote(shown.from, shown.to, shown.amount).then(function (fresh) {
      if (S().big(fresh.out) < S().big(shown.min)) {
        var e = new Error('The price moved past your ' + (shown.slipBps / 100) + '% slippage. Nothing was signed — check the new quote.');
        e.requote = 1; throw e;
      }
      return Promise.all([S().build(who, fresh), S().balance(who, 'near')]).then(function (r) {
        var bt = r[0], have = S().big(r[1]);
        if (fresh.from === 'near' && S().big(fresh.amount) + S().big(bt.storage) > have) {
          throw new Error('Not enough NEAR for this swap and the storage it needs.');
        }
        if (fresh.from !== 'near' && S().big(bt.storage) > have) {
          throw new Error('Not enough NEAR for the token registration this swap needs.');
        }
        setGo(false, bt.steps > 1 ? ('Approve ' + bt.steps + ' in your wallet…') : 'Confirm in wallet…');
        window.__lxnLastSwap = { quote: fresh, txs: bt.txs };
        return S().sign(bt).then(function (res) { return { res: res, q: fresh }; });
      });
    }).then(function (x) {
      var v = S().verdict(x.res);
      if (v.ok === false) {
        stop(v.why === 'refunded'
          ? (S().ROUTED
            ? 'Rhea did not fill the swap (the price moved). All of your ' + f.code + ' came back, the platform fee included.'
            : 'Rhea did not fill the swap (the price moved). Your ' + f.code + ' came back; the ' + (S().FEE_BPS / 100) + '% platform fee was kept.')
          : 'The swap failed on chain. Check your wallet activity.');
        return;
      }
      sw.busy = false;
      toast('Swapped ' + show(x.q.amount, f.dec) + ' ' + f.code + ' for ' + show(x.q.out, t.dec) + ' ' + t.code);
      var fi = $('#swapAmtIn'); if (fi) fi.value = '';
      clearQuote();
      H.bal[f.id] = null; H.bal[t.id] = null;
      loadAccount(true).then(function () { paintSwap(); });
    }).catch(function (e) {
      var msg = (e && e.message) || '';
      // After signing, the engine asks the chain what the wallet's error left behind (browser/nearswap.js).
      var signed = !!window.__lxnLastSwap && !(e && e.requote);
      (signed ? S().afterError(e) : Promise.resolve(msg || 'The swap could not be completed.')).then(function (tx) { stop(tx); });
      if (e && e.requote) setTimeout(quoteSwap, 50);
    });
  }

  // ======================================================================================== LIMIT
  // The pair is <token> ↔ NEAR, because that is the only pair Rhea's DCL contract has pools for (see the
  // header). lim.pool is the resolved pool for whichever side is the token; null means "asked, none", and
  // undefined means "not asked yet" — a failed read is neither, and is asked again.
  var lim = { s: null, b: null, pool: undefined, poolFor: '', busy: false };
  function lEl(s) { return $('#swapModal .lxo-pane[data-pane="limit"] ' + s); }
  function limSay(text) { var e = lEl('.lxq-err'); if (e) e.textContent = text || ''; }
  function limNote(text) { var n = lEl('.lxq-note'); if (n) n.textContent = text || ''; }
  function limGo(on, label) {
    var b = lEl('.lxq-go');
    if (!b) return;
    if (on && lim.busy) on = false;
    if (label) b.textContent = label;
    b.disabled = !on;
  }
  // Which side is the token, and which the NEAR: a DCL order is always one against the other.
  function limPair() {
    if (!lim.s || !lim.b) return null;
    if (isNear(lim.s) && !isNear(lim.b)) return { side: 'buy', token: lim.b, near: lim.s };
    if (isNear(lim.b) && !isNear(lim.s)) return { side: 'sell', token: lim.s, near: lim.b };
    return null;
  }

  function limitUi() {
    var pane = $('#swapModal .lxo-pane[data-pane="limit"]');
    if (!pane || pane.__b) return;
    pane.__b = 1;
    pane.innerHTML = '<div class="lxq-f">'
      + '<div class="lxq-fld"><div class="lxq-lab"><span>You sell</span>'
      + '<span><span class="bal">Available: <span class="lxq-balv">—</span></span> <button type="button" class="lxq-max">MAX</button></span></div>'
      + '<div class="lxq-lin"><div class="lxq-pick" data-side="sell"></div>'
      + '<input class="lxq-in lxq-amt" type="text" inputmode="decimal" placeholder="0.00"></div>'
      + '<div class="lxq-usd lxq-usds"></div></div>'
      + '<div class="lxq-fld"><div class="lxq-lab"><span>You buy</span></div>'
      + '<div class="lxq-lin"><div class="lxq-pick" data-side="buy"></div>'
      + '<span class="lxq-in lxq-recv">—</span></div>'
      + '<div class="lxq-usd lxq-usdb"></div></div>'
      + '<div class="lxq-fld"><div class="lxq-lab"><span>Price</span>'
      + '<span><span class="lxq-unit"></span> <button type="button" class="lxq-mkt">MARKET</button></span></div>'
      + '<div class="lxq-lin"><input class="lxq-in lxq-price" type="text" inputmode="decimal" placeholder="0.00"></div></div>'
      + '<div class="lxq-note"></div><div class="lxq-err"></div>'
      + '<button type="button" class="lxq-go" disabled>Place limit order</button></div>';
    noAuto(lEl('.lxq-amt'));
    noAuto(lEl('.lxq-price'));

    pane.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var p = t.closest('.lxq-pick');
      if (p) {
        e.preventDefault(); e.stopImmediatePropagation();
        var side = p.getAttribute('data-side');
        if (side === 'sell' && !addr()) { connect(); return; }
        openMenu(lEl('.lxq-f'), p.closest('.lxq-fld'), function (m) {
          function pick(a) {
            if (side === 'sell') { lim.s = heldOf(a) || a; if (same(lim.b, a)) lim.b = null; }
            else { lim.b = a; if (same(lim.s, a)) lim.s = null; }
            var pe = lEl('.lxq-price'); if (pe) pe.value = '';
            lim.pool = undefined; lim.poolFor = '';
            limitSync();
            limitPool();
            if (side === 'sell') ensureBal(lim.s).then(limitSync);
          }
          var other = side === 'sell' ? lim.b : lim.s;
          var list = (side === 'sell' ? H.held : curated()).filter(function (a) { return !same(a, other); });
          if (side === 'sell') {
            var mine = list.filter(function (a) { return a.id === 'near' || rawBal(a) == null || S().big(rawBal(a)) > BigInt(0); });
            if (!mine.length) { menuHead(m, emptyWhy()); return; }
            listInto(m, mine, balRight, pick);
          } else {
            if (!list.length) { menuHead(m, 'The token list could not be loaded'); return; }
            filterInto(m, ANY_HEAD, ANY_PH, list, null, pick);
            var note = document.createElement('div');
            note.className = 'h';
            note.style.textTransform = 'none';
            note.style.letterSpacing = '0';
            note.textContent = 'A limit order rests in a Rhea DCL pool, and those are paired against NEAR — so one side of the pair is NEAR.';
            m.appendChild(note);
          }
        });
        return;
      }
      if (t.closest('.lxq-max')) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!lim.s) { toast('Choose an asset to sell first.', true); return; }
        var room = roomRaw(lim.s);
        if (room == null) { limSay(balWhy(lim.s) + '.'); return; }
        // In the dialog, not a toast that runs off the screen (RAZA 2026-10-31).
        if (!(S().big(room) > BigInt(0))) {
          var iz = lEl('.lxq-amt'); if (iz) iz.value = '';
          limitSync();
          limSay(shortOf(lim.s, rawBal(lim.s), 'order'));
          return;
        }
        // "You sell" is ALWAYS the asset being sold, so MAX is simply what can be sold of it.
        var i = lEl('.lxq-amt');
        if (i) i.value = down(room, lim.s.dec, Math.min(lim.s.dec, 7));   // 7 places, as Stellar fills it; truncated, never rounded up
        limitSync();
        return;
      }
      if (t.closest('.lxq-mkt')) {
        e.preventDefault(); e.stopImmediatePropagation();
        var pr0 = limPair();
        if (!pr0 || !lim.pool) { toast('Pick a token against NEAR first.', true); return; }
        var mkt = D().tokenPriceAt(lim.pool, pr0.token.dec, lim.pool.cur);
        if (!(mkt > 0)) { toast('The pool did not give a market price.', true); return; }
        var pe = lEl('.lxq-price');
        if (pe) pe.value = trunc(String(mkt), mkt < 1 ? 10 : 6);
        limitSync();
        return;
      }
      if (t.closest('.lxq-go')) { e.preventDefault(); e.stopImmediatePropagation(); placeLimit(); return; }
      if (!t.closest('.lxq-menu')) closeMenus();
    }, true);

    pane.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('lxq-amt')) {
        clean(t, lim.s ? lim.s.dec : null);
        limitSync();
      } else if (t.classList.contains('lxq-price')) {
        clean(t, 24);
        limitSync();
      }
    }, true);
    limitSync();
  }

  function pill(el, a) {
    if (!el) return;
    el.innerHTML = '';
    var ic = document.createElement('span'); ic.className = 'lxq-ic';
    if (a) paintIco(ic, a);
    var cd = document.createElement('span'); cd.className = 'cv'; cd.setAttribute('data-logoed', '1');
    // Empty reads "Select asset" with no badge, as Stellar's Limit pane does.
    cd.textContent = a ? a.code : 'Select asset';
    var car = document.createElement('span'); car.className = 'car'; car.innerHTML = CHEVRON;
    if (a) el.appendChild(ic);
    el.appendChild(cd); el.appendChild(car);
  }

  // The pool behind the chosen pair. A definite answer (pool or none) is kept for the pair; a failed read
  // is NOT an answer and is asked again — one value must not mean both "there is none" and "could not ask".
  function limitPool() {
    var pr = limPair();
    if (!pr || !D()) { lim.pool = undefined; limitSync(); return; }
    var key = pr.token.id;
    if (lim.poolFor === key && lim.pool !== undefined) { limitSync(); return; }
    lim.poolFor = key; lim.pool = undefined;
    limitSync();
    D().poolFor(pr.token.id).then(function (p) {
      if (lim.poolFor !== key) return;
      lim.pool = p || null;
      // THE PRICE STARTS AT THE MARKET, as Stellar's does: with it empty, "You buy" had nothing to multiply
      // and stayed "—", and the order could not be placed until MARKET was found and pressed (RAZA
      // 2026-10-31: "it won't calculate and show me the buying amount of Asset 2"). Only an EMPTY field is
      // filled — a price the user typed is theirs.
      var pe = lEl('.lxq-price');
      if (p && pe && !String(pe.value || '').trim()) {
        var mkt = 0;
        try { mkt = D().tokenPriceAt(p, pr.token.dec, p.cur); } catch (e) {}
        if (mkt > 0) pe.value = trunc(String(mkt), mkt < 1 ? 10 : 6);
      }
      limitSync();
    }, function () {
      if (lim.poolFor !== key) return;
      lim.pool = undefined; lim.poolFor = '';
      limSay('The Rhea pool for this pair could not be read. Try again in a moment.');
      limGo(false, 'Place limit order');
    });
  }

  function limitSync() {
    var pane = $('#swapModal .lxo-pane[data-pane="limit"]');
    if (!pane || !pane.__b) return;
    pill(lEl('.lxq-pick[data-side="sell"]'), lim.s);
    pill(lEl('.lxq-pick[data-side="buy"]'), lim.b);

    var bv = lEl('.lxq-balv');
    if (bv) {
      var r = lim.s ? rawBal(lim.s) : null;
      bv.textContent = !lim.s ? '—' : (r == null ? '—' : (show(r, lim.s.dec, 6) + ' ' + lim.s.code));
    }

    var pr = limPair();
    var unit = lEl('.lxq-unit');
    if (unit) unit.textContent = pr ? ('NEAR per ' + pr.token.code) : '';

    var amtEl = lEl('.lxq-amt'), pxEl = lEl('.lxq-price'), recv = lEl('.lxq-recv');
    var amt = String((amtEl || {}).value || '').trim(), px = String((pxEl || {}).value || '').trim();

    // "YOU SELL" IS WHAT IS SOLD, ON BOTH SIDES (RAZA 2026-10-31). It used to hold the TOKEN amount whenever
    // NEAR was being sold — type 0.007 under "You sell NEAR" and the order was for 0.007 ZEC — so "You buy"
    // could never be read off it. The price is always NEAR per token, so selling a token buys amount x price
    // NEAR, and selling NEAR buys amount / price of the token. `tokAmt` is that token figure, truncated as a
    // string to the token's decimals, and it is what the DCL planner is given.
    var A = Number(amt), P = Number(px), got = 0, tokAmt = '';
    if (pr && A > 0 && P > 0) {
      got = pr.side === 'sell' ? A * P : A / P;
      tokAmt = pr.side === 'sell' ? amt : trunc(plainNum(got), pr.token.dec);
    }
    if (recv) {
      recv.textContent = got > 0
        ? (pr.side === 'sell' ? (fmtNum(got, 7) + ' NEAR') : (fmtNum(got, Math.min(8, pr.token.dec)) + ' ' + pr.token.code))
        : '—';
    }
    // The dollar line under each amount, as Stellar draws them.
    var us = lEl('.lxq-usds'); if (us) us.textContent = usdText(A, lim.s);
    var ub = lEl('.lxq-usdb'); if (ub) ub.textContent = usdText(got, lim.b);

    // THE BALANCE IS CHECKED AS SOON AS THERE IS AN AMOUNT, not only once a pair, a pool and a price exist —
    // Stellar says "You only hold …" with nothing chosen to buy yet, and so does this.
    var held = lim.s ? rawBal(lim.s) : null, typedRaw = null;
    if (lim.s && A > 0) { try { typedRaw = S().toUnits(trunc(amt, lim.s.dec), lim.s.dec); } catch (e) { typedRaw = null; } }
    if (addr() && typedRaw && held != null) {
      var room0 = roomRaw(lim.s);
      if (S().big(typedRaw) > S().big(held)) {
        limNote(''); limSay('You only hold ' + show(held, lim.s.dec, 7) + ' ' + lim.s.code + '.');
        limGo(false, 'Place limit order'); return;
      }
      if (room0 != null && S().big(typedRaw) > S().big(room0)) {
        limNote(''); limSay(shortOf(lim.s, held, 'order'));
        limGo(false, 'Place limit order'); return;
      }
    }

    if (!lim.s || !lim.b) { limNote(''); limSay(''); limGo(false, 'Place limit order'); return; }
    if (!pr) {
      limNote('');
      limSay(NOPOOL + ' — on NEAR one side has to be NEAR.');
      limGo(false, 'Place limit order');
      return;
    }
    if (lim.pool === undefined) { limNote('Checking Rhea for a ' + pr.token.code + ' / NEAR pool…'); limSay(''); limGo(false, 'Place limit order'); return; }
    if (lim.pool === null) { limNote(''); limSay(NOPOOL + ': there is no ' + pr.token.code + ' / NEAR pool.'); limGo(false, 'Place limit order'); return; }

    // Limit orders are still free; the "No LumosCore fee on limit orders." line is gone because Stellar's pane
    // does not carry it (RAZA 2026-10-31). What stays is the tick the order really rests at.
    var bits = [];
    var ord = null;
    if (tokAmt && Number(tokAmt) > 0) {
      try { ord = D().plan(lim.pool, pr.token.dec, pr.side, px, tokAmt); } catch (e) { ord = null; }
      if (ord && ord.rests > 0) {
        bits.push('Filled when 1 ' + pr.token.code + ' reaches ' + fmtNum(ord.rests, ord.rests < 1 ? 10 : 6) + ' NEAR (the pool’s nearest tick).');
      }
    }
    limNote(bits.join(' '));

    if (!addr()) { limSay(''); limGo(true, 'Connect wallet'); return; }
    if (!(Number(amt) > 0)) { limSay(''); limGo(false, 'Place limit order'); return; }
    if (!(Number(px) > 0)) { limSay(''); limGo(false, 'Place limit order'); return; }
    if (!ord) { limSay('That amount and price are too small to rest an order.'); limGo(false, 'Place limit order'); return; }

    var room = roomRaw(lim.s);
    if (room == null) { limSay(balWhy(lim.s) + '.'); limGo(false, 'Place limit order'); return; }
    if (S().big(ord.sellRaw) > S().big(room)) {
      limSay(shortOf(lim.s, rawBal(lim.s), 'order'));
      limGo(false, 'Place limit order');
      return;
    }
    limSay('');
    limGo(true, 'Place limit order');
  }

  function placeLimit() {
    if (lim.busy) return;
    var pr = limPair(), who = addr();
    if (!pr || !who || !lim.pool) return;
    var amt = String((lEl('.lxq-amt') || {}).value || '').trim();
    var px = String((lEl('.lxq-price') || {}).value || '').trim();
    var ord = null;
    // The same conversion limitSync makes: "You sell" is the sold asset, the planner wants the token amount.
    var A = Number(amt), P = Number(px);
    var tokAmt = (A > 0 && P > 0) ? (pr.side === 'sell' ? amt : trunc(plainNum(A / P), pr.token.dec)) : '';
    try { ord = D().plan(lim.pool, pr.token.dec, pr.side, px, tokAmt); } catch (e) { ord = null; }
    if (!ord) { limSay('That amount and price are too small to rest an order.'); return; }
    lim.busy = true;
    limSay('');
    limGo(false, 'Checking storage…');
    function stop(text) { lim.busy = false; limitSync(); if (text) limSay(text); }
    D().prereqs(who, ord).then(function (pre) {
      return S().balance(who, 'near').then(function (haveRaw) {
        var have = S().big(haveRaw), need = S().big(pre.storage);
        if (ord.sell === D().WNEAR) need += S().big(ord.sellRaw);
        if (need > have) throw new Error('Not enough NEAR for this order and the storage it needs (' + show(pre.storage, 24, 4) + ' NEAR).');
        var txs = D().buildPlace(who, ord, pre);
        limGo(false, txs.length > 1 ? ('Approve ' + txs.length + ' in your wallet…') : 'Confirm in wallet…');
        window.__lxnLastLimit = { order: ord, txs: txs };
        return D().sign(txs);
      });
    }).then(function (res) {
      var v = D().verdict(res);
      if (v.ok === false) {
        // ft_transfer_call returning "0" means the contract refused the order and the tokens came back.
        stop(v.why === 'refunded'
          ? 'Rhea did not accept the order, so nothing is resting — your ' + (pr.side === 'sell' ? pr.token.code : 'NEAR') + ' came back.'
          : 'The order failed on chain. Check your wallet activity.');
        return;
      }
      lim.busy = false;
      toast('Limit order placed');
      var ae = lEl('.lxq-amt'); if (ae) ae.value = '';
      var pe = lEl('.lxq-price'); if (pe) pe.value = '';
      H.bal[lim.s.id] = null;
      loadAccount(true).then(function () { limitSync(); });
    }).catch(function (e) {
      var msg = (e && e.message) || '';
      stop(e && e.lxnWallet ? D().walletErr(e, 'placed') : (msg || 'The order could not be placed.'));
    });
  }

  // ======================================================================================== ORDERS
  var gone = {};
  function oEl(s) { return $('#swapModal .lxo-pane[data-pane="orders"] ' + s); }
  function emptyState(title, sub) {
    return '<div class="lxo-empty">' + title + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>';
  }

  // A dead end needs a way out. The old failure text told the user to reopen the tab, but the pane is
  // built once (pane.__b), so reopening did not reliably re-run the load -- the advice did not work.
  function failState() {
    return '<div class="lxo-empty">Could not load your orders'
      + '<span class="sub">The network did not answer in time. Your orders are safe — this only failed to read them.</span>'
      + '<button type="button" class="lxo-retry" data-lxoretry="1">Try again</button></div>';
  }

  function ordersUi() {
    var pane = $('#swapModal .lxo-pane[data-pane="orders"]');
    if (!pane || pane.__b) return;
    pane.__b = 1;
    pane.innerHTML = '<div class="lxo-list">' + emptyState('Loading…') + '</div>';
    pane.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-lxoretry]')) {
        e.preventDefault(); e.stopImmediatePropagation();
        var l = oEl('.lxo-list');
        if (l) l.innerHTML = emptyState('Loading…');
        loadOrders();
        return;
      }
      var b = t.closest('[data-off]');
      if (!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      cancelOrder(b);
    }, true);
  }

  function leg(cap, a, amountRaw, dec) {
    var col = document.createElement('div'); col.className = 'lxo-col';
    var cp = document.createElement('div'); cp.className = 'lxo-cap'; cp.textContent = cap;
    var w = document.createElement('div'); w.className = 'lxo-side';
    var ic = document.createElement('span'); ic.className = 'lxq-ic'; paintIco(ic, a);
    var tx = document.createElement('div'); tx.className = 'lxo-tx';
    var q = document.createElement('div'); q.className = 'q';
    var txt = amountRaw == null ? '—' : show(amountRaw, dec, 7);
    q.textContent = txt; q.title = txt + ' ' + a.code;
    var c = document.createElement('div'); c.className = 'c'; c.setAttribute('data-logoed', '1'); c.textContent = a.code;
    tx.appendChild(q); tx.appendChild(c); w.appendChild(ic); w.appendChild(tx);
    col.appendChild(cp); col.appendChild(w);
    return col;
  }

  // Metadata for a contract id, from whatever this page already knows before it asks the chain.
  function metaOf(id) {
    if (id === 'near' || id === S().WNEAR) return Promise.resolve(NEAR);
    var m = null;
    try { m = S().meta(id); } catch (e) {}
    if (m) return Promise.resolve(asset(m.id, m.code, m.dec, m.logo));
    var h = null;
    for (var i = 0; i < H.held.length; i++) if (H.held[i].id === id) h = H.held[i];
    if (h) return Promise.resolve(h);
    for (var j = 0; j < CUR.length; j++) if (CUR[j].id === id) return Promise.resolve(CUR[j]);
    // tokenInfo resolves the module's own META record — { id, code, dec, logo } — NOT the raw
    // ft_metadata it reads to build one. A row whose decimals could not be read is DROPPED by the
    // caller rather than shown at a guessed scale: a limit order printed at the wrong decimals is a
    // wrong number, not a missing one.
    return S().tokenInfo(id).then(function (t) {
      return (t && t.dec != null) ? asset(t.id || id, t.code || shortId(id), t.dec, t.logo || '') : null;
    }, function () { return null; });
  }

  // RAZA hit "Orders tab taking too long to load" on STELLAR 2026-10-28, and the faults behind it are
  // shared by every fork of this dialog -- see _swapcalc.js for the measurements (the same request
  // answering in 282ms and in 21.8s). NEAR's load is worse-shaped than Stellar's: activeOrders is
  // followed by a metaOf call per token before anything paints, so the wait is two rounds deep.
  var ordersSeq = 0;
  function loadOrders() {
    var list = oEl('.lxo-list');
    if (!list) return;
    var me = addr();
    if (!me) { list.innerHTML = emptyState('Connect a wallet', 'Your open orders across every pair will show here.'); return; }
    if (!D()) { list.innerHTML = emptyState('Limit orders are not available right now.'); return; }
    var seq = ++ordersSeq;
    // The paint must belong to the NEWEST load: a cancel reloads the list, so a slow request can outlive
    // the one that replaced it, and the loser must not paint its stale list over the winner's.
    function stale() { return seq !== ordersSeq || !oEl('.lxo-list'); }
    // Only speaks up while a placeholder is showing -- with rows painted there is nothing to reassure
    // anyone about, and the note would replace real data with a status message.
    var slow = setTimeout(function () {
      if (stale()) return;
      var em = oEl('.lxo-empty');
      if (em) em.innerHTML = 'Still loading…<span class="sub">NEAR is answering slowly. This can take up to half a minute.</span>';
    }, 4000);
    D().activeOrders(me).then(function (raw) {
      if (stale()) { clearTimeout(slow); return; }
      var rows = (raw || []).filter(function (o) { return !gone[String(o.order_id)]; });
      if (!rows.length) {
        // cleared HERE and not at the top of this handler: the metaOf round below is the slow half, and
        // the note has to survive into it. Left running, it would overwrite "No open orders" at 4s.
        clearTimeout(slow);
        list.innerHTML = emptyState('No open orders', 'A limit order stays here until it fills or you cancel it.');
        return;
      }
      var ids = {};
      rows.forEach(function (o) { ids[o.sell_token] = 1; ids[o.buy_token] = 1; });
      var keys = Object.keys(ids);
      return Promise.all(keys.map(metaOf)).then(function (ms) {
        clearTimeout(slow);
        if (stale()) return;
        var M = {};
        keys.forEach(function (k, i) { M[k] = ms[i]; });
        list.innerHTML = '';
        rows.forEach(function (o) {
          var sa = M[o.sell_token], ba = M[o.buy_token];
          if (!sa || !ba) return;                 // decimals unknown: see metaOf
          var remain = o.remain_amount, orig = o.original_amount;
          var filled = D().big(remain) <= BigInt(0);

          // The resting price from the order's own point, in the pool's x/y space — the same conversion
          // the wallet page's rows use. Needs BOTH pool tokens' decimals, which are not always the two
          // order tokens (an order's pool is named token_x|token_y|fee).
          var xy = String(o.pool_id).split('|');
          var dx = M[xy[0]] ? M[xy[0]].dec : null, dy = M[xy[1]] ? M[xy[1]].dec : null;
          var per = null;
          if (dx != null && dy != null) {
            var pxy = Math.pow(1.0001, +o.point) * Math.pow(10, dx - dy);
            var v = xy[0] === o.sell_token ? pxy : 1 / pxy;
            if (v > 0 && isFinite(v)) per = v;
          }

          var row = document.createElement('div'); row.className = 'lxo-o';
          var top = document.createElement('div'); top.className = 'lxo-top';
          top.appendChild(leg('Selling', sa, filled ? orig : remain, sa.dec));
          // WHAT THE BUY LEG SHOWS IS DERIVED, not read: list_active_orders is not relied on for a
          // proceeds field this codebase has never used. For a resting order the receive amount is
          // what is still being sold times the resting price — the same two numbers as the price line,
          // so the row cannot contradict itself. A filled order's actual proceeds are not in hand here,
          // so it shows no figure and the footer says it is ready to collect instead of guessing one.
          var getRaw = null;
          if (!filled && per != null) {
            try {
              var human = Number(S().fromUnits(remain, sa.dec)) * per;
              if (human > 0 && isFinite(human)) getRaw = S().toUnits(trunc(String(human), ba.dec), ba.dec);
            } catch (e) { getRaw = null; }
          }
          top.appendChild(leg(filled ? 'Bought' : 'Receive', ba, getRaw, ba.dec));
          var ft = document.createElement('div'); ft.className = 'lxo-ft';
          var pw = document.createElement('div'); pw.className = 'lxo-pw';
          var pk = document.createElement('span'); pk.className = 'lxo-k'; pk.textContent = filled ? 'Filled' : 'Price';
          var pn = document.createElement('span'); pn.className = 'lxo-px';
          var txt = per != null ? (fmtNum(per, per < 1 ? 10 : 6) + ' ' + ba.code + ' per ' + sa.code) : '—';
          pn.textContent = filled ? 'Ready to collect' : txt;
          pn.title = pn.textContent;
          pw.appendChild(pk); pw.appendChild(pn); ft.appendChild(pw);
          var cb = document.createElement('button');
          cb.type = 'button';
          cb.setAttribute('data-off', String(o.order_id));
          if (filled) cb.setAttribute('data-collect', '1');
          cb.textContent = filled ? 'Collect' : 'Cancel';
          ft.appendChild(cb);
          row.appendChild(top); row.appendChild(ft);
          list.appendChild(row);
        });
        if (!list.querySelector('.lxo-o')) {
          list.innerHTML = emptyState('No open orders', 'A limit order stays here until it fills or you cancel it.');
        }
      });
    }).catch(function () {
      clearTimeout(slow);
      if (stale()) return;
      var el = oEl('.lxo-list');
      if (!el) return;
      // A FAILED REFRESH MUST NOT WIPE ROWS THAT ARE ALREADY ON SCREEN. This loader runs again after a
      // cancel, with the list painted; wiping it tells the user their orders cannot be read when they
      // are right there and correct. The toast carries the failure instead.
      if (el.querySelector('.lxo-o')) { toast('Could not refresh your orders. The list below may be out of date.', true); return; }
      el.innerHTML = failState();
    });
  }

  function cancelOrder(btn) {
    if (btn.__busy) return;
    var me = addr();
    if (!me || !D()) return;
    var id = btn.getAttribute('data-off');
    var collect = btn.getAttribute('data-collect') === '1';
    btn.__busy = 1; btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Checking…';
    D().buildCancel(me, [id]).then(function (b) {
      window.__lxnLastCancel = b;
      btn.textContent = b.txs.length > 1 ? ('Approve ' + b.txs.length + '…') : 'Confirm…';
      return D().sign(b.txs);
    }).then(function (res) {
      var v = D().verdict(res);
      btn.__busy = 0; btn.disabled = false; btn.textContent = label;
      if (v.ok === false) { toast(collect ? 'The collect failed on chain.' : 'The cancel failed on chain.', true); return; }
      toast(collect ? 'Collected' : 'Order cancelled');
      gone[String(id)] = 1;
      var row = btn.closest('.lxo-o');
      if (row && row.parentNode) row.parentNode.removeChild(row);
      var list = oEl('.lxo-list');
      if (list && !list.querySelector('.lxo-o')) {
        list.innerHTML = emptyState('No open orders', 'A limit order stays here until it fills or you cancel it.');
      }
      loadAccount(true);
    }).catch(function (e) {
      btn.__busy = 0; btn.disabled = false; btn.textContent = label;
      var msg = (e && e.message) || '';
      toast(e && e.lxnWallet ? D().walletErr(e, collect ? 'collected' : 'cancelled')
        : (msg || 'Could not ' + (collect ? 'collect' : 'cancel') + ' the order.'), true);
    });
  }

  // ======================================================================================== SHELL
  function show_(name) {
    var m = modal();
    if (!m) return;
    closeMenus();
    $$('.lxo-pane', m).forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
    $$('.lxo-tabs button', m).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pane') === name); });
    if (name === 'limit') {
      limitUi();
      // The Limit pane opens EMPTY, as Stellar's does (RAZA 2026-10-29: it opened on the Swap pane's
      // NEAR / USDC). Nothing is chosen for the trader on an order that rests on the book.
      limitSync();
      limitPool();
      loadAccount().then(function () { return ensureBal(lim.s); }).then(limitSync);
    }
    if (name === 'orders') { ordersUi(); loadOrders(); }
  }

  function build() {
    var m = modal();
    if (!m) return false;
    var card = m.firstElementChild;
    if (!card) return false;
    if (card.__lxqo) return true;
    var head = card.firstElementChild;
    if (!head || !document.getElementById('swapAmtIn')) return false;
    card.__lxqo = 1;

    // The design's mock listeners go with the nodes they were bound to: its own script wires a fixed
    // rate on #swapAmtIn, an asset swap on #swapFlip and a fake "Swapped" on #swapGo.
    ['swapAmtIn', 'swapFlip', 'swapGo'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n && n.parentNode) n.parentNode.replaceChild(n.cloneNode(true), n);
    });

    var ttl = head.firstElementChild;
    if (ttl) ttl.textContent = 'Custom Swap / Orders';
    var swap = document.createElement('div');
    swap.className = 'lxo-pane';
    swap.setAttribute('data-pane', 'swap');
    while (head.nextSibling) swap.appendChild(head.nextSibling);
    var tabs = document.createElement('div');
    tabs.className = 'lxo-tabs';
    tabs.innerHTML = '<button type="button" data-pane="swap" class="on">Swap</button>'
      + '<button type="button" data-pane="limit">Limit</button>'
      + '<button type="button" data-pane="orders">Orders</button>';
    var limitP = document.createElement('div');
    limitP.className = 'lxo-pane'; limitP.setAttribute('data-pane', 'limit'); limitP.hidden = true;
    var ordersP = document.createElement('div');
    ordersP.className = 'lxo-pane'; ordersP.setAttribute('data-pane', 'orders'); ordersP.hidden = true;
    card.appendChild(tabs); card.appendChild(swap); card.appendChild(limitP); card.appendChild(ordersP);
    tabs.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-pane]') : null;
      if (!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      show_(b.getAttribute('data-pane'));
    }, true);

    swapUi();
    clearQuote();
    return true;
  }

  // The design opens this dialog by setting display:flex; .open is watched too because the dashboard's
  // other dialogs use the class and a future change here would otherwise go unnoticed.
  function isOpen(m) {
    return !!m && (m.style.display === 'flex' || m.classList.contains('open'))
      && getComputedStyle(m).display !== 'none';
  }

  // A REOPENED DIALOG IS A FRESH ONE. Closing only hides the node, so a half-typed amount, its converted
  // output, a stale error and whichever tab was last open would all survive — and the figures beside
  // them are recomputed on open, so the dialog could show an old amount against a new price. The asset
  // PAIR is deliberately kept: defaults() re-picks it anyway, and it is the typed numbers that go stale.
  function resetForms() {
    var i = $('#swapAmtIn'); if (i) i.value = '';
    var o = $('#swapAmtOut'); if (o) plain(o, '');
    swapSay('');
    clearQuote();
    var la = lEl('.lxq-amt'); if (la) la.value = '';
    var lp = lEl('.lxq-price'); if (lp) lp.value = '';
    // The Limit PAIR is cleared too: unlike the Swap pane, it starts empty every time.
    if (!lim.busy) { lim.s = null; lim.b = null; lim.pool = undefined; lim.poolFor = ''; }
    limSay(''); limNote('');
    show_('swap');
  }

  function onOpen() {
    var m = modal();
    if (!m || !S()) return;
    build();
    resetForms();
    curLoad().then(function () { defaults(); quoteRate(); });
    loadAccount(true).then(function () {
      // REPAINT ONCE THE BALANCES ARE REAL: paintChip prints an em dash until the read settles, so
      // without this the dialog would hold "Balance: —" for as long as it stayed open.
      defaults();
      paintSwap();
      quoteRate();
      return Promise.all([checkFee(sw.from), ensureBal(sw.from)]);
    }).then(function () {
      paintSwap();
      var lpane = $('#swapModal .lxo-pane[data-pane="limit"]');
      if (lpane && !lpane.hidden) limitSync();
      var opane = $('#swapModal .lxo-pane[data-pane="orders"]');
      if (opane && !opane.hidden) loadOrders();
    });
  }

  function boot() {
    var m = modal();
    if (!m || !S() || !D()) return false;
    build();
    var was = isOpen(m);
    if (window.MutationObserver) {
      new MutationObserver(function () {
        var now = isOpen(m);
        if (now && !was) onOpen();
        if (!now) closeMenus();
        was = now;
      }).observe(m, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen(m)) { m.style.display = 'none'; m.classList.remove('open'); }
    });
    m.addEventListener('click', function (e) {
      if (e.target === m || (e.target.closest && e.target.closest('[data-swapclose]'))) {
        m.style.display = 'none';
        m.classList.remove('open');
      }
    });
    // A WALLET CHANGE INVALIDATES EVERY BALANCE AND EVERY ORDER ON SCREEN, and window.lxn has no
    // onChange to subscribe to (its surface is open / account / wallet / connector / validAccount), so
    // the address is compared on each open instead — onOpen already forces a fresh read, which covers
    // connecting, disconnecting and switching between two opens. Polling for a change while the dialog
    // sits open would be a timer running on every dashboard visit to catch a case that needs the
    // wallet's own UI, which is behind this dialog.
    if (was) onOpen();
    return true;
  }

  // The engines load on demand, so boot retries rather than assuming they are there — the same wait
  // browser/swapmodal.js uses.
  (function wait(n) {
    if (boot()) return;
    if (n < 80) setTimeout(function () { wait(n + 1); }, 100);
  })(0);
})();
