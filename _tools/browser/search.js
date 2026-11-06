// Header search, on every NEAR page (desktop panel and the phone's lx-mobsearch, which opens the same
// #searchPopup). PORTED FROM the XRPL fork's _tools/browser/search.js (2026-10-21) and kept structurally
// parallel; its dated notes are that file's history and name the XRP Ledger where they do. The behaviour
// they protect -- the gate on the design's sample rows, the heading count held at what this layer last
// set, foreign filter pills removed, keystroke races, recents drawn back from data through the same row
// builders -- applies here unchanged.
//
// REPLACES lx-searchassets, the Stellar search, which on a NEAR page answered from Stellar's index
// (/lxapi/assetsearch, stellar.expert), fetched /lxapi/assetmeta on every load, and linked
// /trade/stellar/... and /account/stellar/....
//
// WHAT IS NEAR'S:
//   tokens    the curated list (/lxapi/nearmarket, the Trade roster), matched on symbol, name and contract,
//             exact symbol first, then by liquidity. wNEAR (wrap.near) is offered for "near"/"wnear".
//             Rows show the design's own price and 24h change cells. Links /trade/near/<contract>.
//   pools     /lxapi/nearpools (the Pools page's own list), any pool holding a token whose symbol IS the
//             term ("near" means wNEAR); "usdc near", "USDC/wNEAR" need every term. Links
//             /pools/near/id/<pool id>.
//   exact id  LEDGER-FIRST, as on XRPL: a typed NEAR account id (with a dot, or a 64-hex / 0x implicit id)
//             is asked of the chain even when no list holds it. ft_metadata answers -> it is a token, offer
//             its Trade page; otherwise view_account exists -> offer /account/near/<id>.
//   recents   the design's Recent list, under its own key: entries are NEAR rows only.
// Nothing here fetches on load: the lists are asked for when the panel is first used.
(function () {
  if (window.__lxnSearch) return;
  window.__lxnSearch = 1;
  var C = window.lxnCore;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var MIN = 2;
  var seq = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  function short(a) { return C.short(a); }
  // 129.2K, as Stellar's and XRPL's rows print a holder count.
  function compact(n) {
    n = +n || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }
  function money(v) {
    v = +v;
    if (!isFinite(v) || v <= 0) return '';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
    if (v >= 1) return '$' + v.toFixed(2);
    if (v >= 0.01) return '$' + v.toFixed(4);
    return '$' + v.toPrecision(3);
  }

  (function () {
    if (document.getElementById('lxn-sea-css')) return;
    var st = document.createElement('style');
    st.id = 'lxn-sea-css';
    st.textContent = '.lxx-sea-ic{width:30px;height:30px;flex:0 0 30px;border-radius:50%;'
      + 'display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;'
      + 'font-weight:800;color:#fff;background:rgba(255,255,255,.10)}'
      // 17.6px, NOT 14px, AND THE NUMBER IS NOT A TASTE DECISION. This is the search popup's own
      // gutter: the design sets `.sp-section-head{padding:15.4px 17.6px 6.6px}` and
      // `.sp-empty{padding:33px 17.6px}`, both inherited and both measured on the live build. At 14px
      // every message this layer writes sat 3.6px further left than the "Assets on the XRP Ledger"
      // heading directly above it, which is what RAZA saw as the text being too close to the edge —
      // not a big gap, but a misalignment against a fixed heading reads as one.
      //
      // Worth recording how long this hid: the obvious suspect was `.sp-empty`, the inherited empty
      // state — and that rule is BYTE-IDENTICAL between this build and Stellar's, so comparing the
      // two containers proved nothing and the bug looked unreproducible. It was never that class.
      // XRPL does not use it: `note()` below writes `.lxn-sea-note` for all five of its messages,
      // including "No XRP Ledger token matches that." So fixing the gutter here fixes every one of
      // them, and the vertical 18px stays — the complaint was horizontal.
      + '.lxn-sea-note{padding:18px 17.6px;text-align:center;opacity:.65;font-size:13.5px}'
      // THE ROWS WERE RENDERING AS DEFAULT BROWSER LINKS — blue and underlined.
      //
      // The row is an <a>, and the design's `.sp-row` rule sets layout only: display, gap, padding,
      // cursor. Nothing in it resets link colour or underline, because on Stellar the row also
      // carries `lx-searow`, added by Stellar's own search layer — and that layer's stylesheet is
      // not in this build, so the class exists there and nowhere here. Measured on both:
      // lumoscore.com gives rgb(246,245,243)/none, this build gave rgb(0,0,238)/underline.
      //
      // Declared here rather than by adding the Stellar class, so it does not depend on a
      // stylesheet this build does not ship.
      + '.sp-row.sp-row--asset{color:inherit;text-decoration:none}'
      // The price / 24h cells are the design's own (.sp-right .sp-price / .sp-change), as its sample rows use them.
      + '.lx-searow .sp-price{font-family:\'JetBrains Mono\',monospace;font-weight:700;font-size:13px}'
      + '.lx-searow .sp-change{font-size:12px;font-weight:700}'
      // A long pair (SHITZU / BLACKDRAGON) pushed the "Rhea pool" tag onto a line of its own: the pair gives way
      // with an ellipsis and the tag stays beside it.
      + '.lx-searow .sp-name-row:has(.lx-pool-pair){display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:nowrap}'
      + '.lx-searow .lx-pool-pair{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.lx-searow .sp-name-row:has(.lx-pool-pair) .sp-domain{flex:none;white-space:nowrap}'
      + '.lx-searow .sp-info{min-width:0}';
    document.head.appendChild(st);
  })();

  // A token's logo travels with its row (the curated list carries each token's own metadata icon), and
  // is accepted only as a data:image or https url -- an img cannot run script, so a data: SVG is safe --
  // or as the site's own /assets/ path, which is what LUMOS's curated logo is (RAZA 2026-11-05: "Fix missing
  // LUMOS token logo rendering in search"; it was refused here and drew the lettered disc, in pool rows too).
  // wNEAR's metadata has no icon, so it gets NEAR's own mark. No logo: a lettered disc, drawn as an
  // inline SVG data url so the logo healer (which repaints 1-5 character text) has no text to find.
  function okUrl(u) {
    u = String(u || '');
    return (/^data:image\//i.test(u) || /^https:\/\//i.test(u) || u.indexOf('/assets/') === 0) && u.length < 400000 ? u : '';
  }
  function letterUri(code) {
    var c = String(code || '?'), h = 0;
    for (var i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360;
    var t = c.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="hsl(' + h + ',60%,50%)"/><text x="20" y="26" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="15" fill="#fff">' + t + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  // ANY TOKEN'S LOGO BY ITS CONTRACT (RAZA 2026-11-06: "its appears when typing but not on recent searches"): a recent
  // stores no logo and only the curated list has one to give back, so an uncurated token came back as its letters.
  function iconOf(i) { return 'https://near-pool-indexer.usa282.workers.dev/icon?v=2&t=' + encodeURIComponent(i); }
  function icoImg(src, code) {
    var box = el('div', 'sp-ico lx-spico-on');
    box.style.cssText = 'position:relative;overflow:hidden';
    var im = document.createElement('img');
    im.alt = '';
    im.src = okUrl(src) || letterUri(code);
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    im.onerror = function () { im.onerror = null; im.src = letterUri(code); };
    box.appendChild(im);
    return box;
  }

  // THE TICK: membership of the curated list (the Trade roster), plus wNEAR -- the Wallet page's rule.
  // Decided when the row is drawn from the live list, never taken from a stored recent.
  function vBadge() {
    var vb = el('span', 'lx-seavfd');
    vb.setAttribute('title', 'Curated on LumosCore');
    var NSV = 'http://www.w3.org/2000/svg';
    var vs = document.createElementNS(NSV, 'svg');
    vs.setAttribute('viewBox', '0 0 24 24');
    vs.setAttribute('fill', 'none');
    vs.setAttribute('stroke', 'currentColor');
    vs.setAttribute('stroke-width', '3');
    vs.setAttribute('stroke-linecap', 'round');
    vs.setAttribute('stroke-linejoin', 'round');
    var vp = document.createElementNS(NSV, 'path');
    vp.setAttribute('d', 'M20 6L9 17l-5-5');
    vs.appendChild(vp);
    vb.appendChild(vs);
    return vb;
  }
  function tag(cls, text) { var e = el('span', cls, text); e.setAttribute('data-logoed', '1'); return e; }

  // t: { i contract, n symbol, nm name, logo, p price in NEAR, d 24h %, cur curated }
  function rowFor(t) {
    var a = document.createElement('a');
    a.className = 'sp-row sp-row--asset lx-searow';
    a.__lxnT = { k: 't', i: t.i, n: t.n, nm: t.nm, h: t.h };  // what a recent-search entry stores
    a.setAttribute('data-chain', 'near');
    a.href = '/trade/near/' + encodeURIComponent(t.i);
    a.appendChild(icoImg(t.i === C.WNEAR ? C.NEAR_LOGO : t.logo, t.n));

    var info = el('div', 'sp-info');
    var nameRow = el('div', 'sp-name-row', t.n || short(t.i));
    if (t.cur) nameRow.appendChild(vBadge());
    info.appendChild(nameRow);
    // STELLAR'S AND XRPL'S ROW (RAZA 2026-10-30, "fix the search like Stellar and XRPL"; read off lumoscore.com):
    // the second line is "CODE · Name · N holders" and the right side is the address chip alone. This row also
    // carried a price and a 24h change in the same right-hand cell, which ran into the chip as one string
    // ("$0.00165-2.45%token…near"). A token IS its contract on NEAR, so the contract is the chip.
    var nm = String(t.nm || '').trim(), sub = [t.n || short(t.i)];
    if (nm && nm.toLowerCase() !== String(t.n || '').toLowerCase()) sub.push(nm);
    if (t.h > 0) sub.push(compact(t.h) + ' holder' + (+t.h === 1 ? '' : 's'));
    info.appendChild(el('div', 'sp-sub', sub.join(' · ')));
    a.appendChild(info);

    var right = el('div', 'sp-right');
    var mini = el('div', 'sp-addr-mini', short(t.i));
    mini.setAttribute('data-copy', t.i);
    mini.setAttribute('data-copy-label', (t.n || 'Token') + ' contract');
    mini.setAttribute('data-logoed', '1');
    right.appendChild(mini);
    a.appendChild(right);
    return a;
  }

  // A 5x5 mirrored identicon drawn from the address, so every wallet has its own mark (RAZA 2026-09-16: "Use a unique identicon").
  function identSvg(addr, size) {
    var pal = ['#6f5ded', '#ef4444', '#22c55e', '#a855f7', '#06b6d4', '#f59e0b', '#ec4899', '#84cc16', '#ff894c', '#0ea5e9', '#14b8a6', '#facc15'];
    var h = 2166136261, i;
    addr = String(addr || '');
    for (i = 0; i < addr.length; i++) { h ^= addr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var bg = pal[h % pal.length], fg = pal[(h >>> 7) % pal.length];
    if (fg === bg) fg = pal[(h % pal.length + 5) % pal.length];
    var c = size / 5, rects = '', bits = h;
    function rect(x, y) { return '<rect x="' + (x * c).toFixed(2) + '" y="' + (y * c).toFixed(2) + '" width="' + c.toFixed(2) + '" height="' + c.toFixed(2) + '" fill="' + fg + '"></rect>'; }
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 3; x++) {
        bits = Math.imul(bits ^ (x * 7 + y * 13 + 1), 2654435761) >>> 0;
        if ((bits >>> 13) & 1) { rects += rect(x, y); if (x < 2) rects += rect(4 - x, y); }
      }
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="border-radius:50%;background:' + bg
      + ';display:block" xmlns="http://www.w3.org/2000/svg">' + rects + '</svg>';
  }

  // THE DESIGN'S SAMPLE RESULTS (RAZA 2026-09-16, on XRPL: "There's a flash bug on search … APT
  // aptosfoundation.org … This asset doesnt exist"). Its own list writes a row per keystroke -- APT, USDC,
  // aBTC on Aptos -- and, when none of them matches, its own "No assets match your search." Only rows and
  // notes this layer draws are shown; everything else in the list is held out of sight.
  (function () {
    if (document.getElementById('lxn-sea-gate')) return;
    var st = document.createElement('style');
    st.id = 'lxn-sea-gate';
    st.textContent = '#spAssetList .sp-row:not(.lx-searow){display:none!important}'
      + '#spAssetList>.sp-empty{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  })();

  // ---- the two lists ----------------------------------------------------------------------------------
  // Asked once, on first use of the panel. A failed answer is not kept: the next keystroke asks again.
  var USD = 0, TOKS = null, TOKS_P = null, POOLS = null, POOLS_P = null;
  function loadTokens() {
    if (TOKS) return Promise.resolve(TOKS);
    if (TOKS_P) return TOKS_P;
    TOKS_P = C.market().then(function (d) {
      TOKS_P = null;
      if (!d) return null;
      USD = +d.usd || 0;
      var out = [{ i: C.WNEAR, n: 'wNEAR', nm: 'Wrapped NEAR', logo: '', p: 1, d: null, t: Infinity, cur: true }];
      (d.rows || []).forEach(function (r) {
        if (!r || !r.i || !C.isAccountId(r.i)) return;
        out.push({ i: r.i, n: C.cleanSym(r.n) || short(r.i), nm: C.cleanSym(r.nm), logo: r.logo || '',
          p: r.p, d: r.d, t: +r.t || 0, h: +r.hc || 0, cur: true });
      });
      TOKS = out;
      return out;
    });
    return TOKS_P;
  }
  function loadPools() {
    if (POOLS) return Promise.resolve(POOLS);
    if (POOLS_P) return POOLS_P;
    POOLS_P = fetch('/lxapi/nearpools?n=200').then(function (r) { return r.json(); })
      .then(function (d) {
        POOLS_P = null;
        if (!d || !d.ok || !d.rows) return null;
        if (+d.usd > 0 && !USD) USD = +d.usd;
        POOLS = { usd: +d.usd || 0, rows: d.rows };
        return POOLS;
      }, function () { POOLS_P = null; return null; });
    return POOLS_P;
  }

  // EVERY TOKEN, NOT ONLY THE CURATED ONES (RAZA 2026-11-06: "Why am i unable to search this asset. its not curated").
  // Asked per query, after the curated rows are up, and only ever adds to them: a failed answer leaves those as they are.
  var WIDE = {};
  function wideHits(q) {
    if (WIDE[q]) return WIDE[q];
    var p = fetch('/lxapi/neartokensearch?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.rows) { delete WIDE[q]; return []; }
        return d.rows.filter(function (r) { return r && C.isAccountId(r.i); }).map(function (r) {
          return { i: r.i, n: C.cleanSym(r.n) || short(r.i), nm: C.cleanSym(r.nm), p: null, d: null, cur: false,
            logo: iconOf(r.i) };
        });
      }, function () { delete WIDE[q]; return []; });
    WIDE[q] = p;
    return p;
  }

  // Lower is better; -1 is no match. A contract id matches from its start, or anywhere once the query
  // itself has a dot -- every contract contains ".near", so a bare word must not match them all.
  function rank(t, q) {
    var sym = String(t.n || '').toLowerCase(), nm = String(t.nm || '').toLowerCase(), id = t.i;
    if (t.i === C.WNEAR && (q === 'near' || q === 'wnear' || q === 'wrap.near')) return 0;
    if (sym === q || id === q) return 0;
    if (sym.indexOf(q) === 0) return 1;
    if (nm.indexOf(q) === 0 || nm.indexOf(' ' + q) >= 0 || id.indexOf(q) === 0) return 2;
    if (sym.indexOf(q) >= 0) return 3;
    if (nm.indexOf(q) >= 0 || (q.indexOf('.') >= 0 && id.indexOf(q) >= 0)) return 4;
    return -1;
  }
  function tokenHits(toks, q) {
    var hits = [];
    toks.forEach(function (t) { var r = rank(t, q); if (r >= 0) hits.push({ r: r, t: t }); });
    hits.sort(function (a, b) { return (a.r - b.r) || ((b.t.t || 0) - (a.t.t || 0)); });
    return hits.slice(0, 20).map(function (h) { return h.t; });
  }
  // Pools: every term must BE one of the pool's token symbols ("near" stands for wNEAR).
  function poolHits(pools, q) {
    var terms = q.split(/[\s\/,]+/).filter(Boolean).map(function (x) { return x === 'near' ? 'wnear' : x; });
    if (!terms.length || terms.length > 4) return [];
    var out = pools.rows.filter(function (p) {
      var syms = (p.tokens || []).map(function (x) { return String(x.s || '').toLowerCase(); });
      return terms.every(function (term) { return syms.indexOf(term) >= 0; });
    });
    out.sort(function (a, b) { return (+b.liq || 0) - (+a.liq || 0); });
    return out.slice(0, 5);
  }

  // EVERY LIVE POOL, BY ITS ID OR ITS TOKENS (RAZA 2026-11-07, "3514" found nothing). The list above is the top 200; this
  // is the Pools page's own baked list, fetched once a query asks for it, and it only ever adds rows.
  var ALL_P = null;
  function allPools() {
    if (ALL_P) return ALL_P;
    ALL_P = fetch('/assets/allpools.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (list) {
      if (!Array.isArray(list)) { ALL_P = null; return []; }
      return list.map(function (x) {
        return { id: x[0], liq: x[3], tokens: (x[4] || []).map(function (t) { return { i: t[0], s: C.cleanSym(t[1]) }; }) };
      });
    }, function () { ALL_P = null; return []; });
    return ALL_P;
  }
  function allPoolHits(rows, q) {
    if (/^[0-9]+$/.test(q)) return rows.filter(function (p) { return String(p.id) === q; });
    return poolHits({ rows: rows }, q);
  }

  // ---- RECENT SEARCHES -------------------------------------------------------------------------------
  // The design's Recent list (.lx-rechead / .lx-recgrp / .lx-recrow, styled by the inherited sheet): five
  // per kind, shown whenever the box is empty, with Clear. What is stored is the row's DATA, never its
  // HTML, drawn back through the same builders, which write text only.
  //
  // ITS OWN KEY, NOT lumos.search.recent. Stellar's and XRPL's layers each rewrite that key keeping only
  // their own entries, so sharing it would have each chain erase the others' history on every save -- and
  // Stellar's would list NEAR rows on Stellar pages. Only NEAR entries are ever read back here: a token or
  // account must be a valid NEAR account id, a pool a Rhea pool id.
  var RKEY = 'lumos.search.recent.near', RMAX = 5;
  function recOk(x) {
    if (!x || typeof x !== 'object') return false;
    if (x.k === 't' || x.k === 'w') return C.isAccountId(x.i);
    if (x.k === 'p') return /^[0-9]{1,9}$/.test(String(x.i || ''));
    return false;
  }
  function recGet() {
    try {
      var a = JSON.parse(localStorage.getItem(RKEY) || '[]');
      if (!Array.isArray(a)) return [];
      var seen = {}, out = [];
      a.filter(recOk).forEach(function (x) { seen[x.k] = (seen[x.k] || 0) + 1; if (seen[x.k] <= RMAX) out.push(x); });
      return out;
    } catch (e) { return []; }
  }
  function recAdd(t) {
    try {
      if (!recOk(t)) return;
      var keep = { k: t.k, i: t.i };
      if (t.k === 't') { keep.n = String(t.n || '').slice(0, 24); keep.nm = String(t.nm || '').slice(0, 48); }
      if (t.k === 'p') keep.s = (t.s || []).slice(0, 4).map(function (x) { return { i: x.i, s: String(x.s || '').slice(0, 24) }; });
      var a = recGet().filter(function (x) { return !(x.k === keep.k && x.i === keep.i); });
      a.unshift(keep);
      localStorage.setItem(RKEY, JSON.stringify(a));
    } catch (e) {}
  }
  // A recent token is drawn from the LIVE list when it is in it (today's price, logo and tick), and from
  // what was stored otherwise -- never with a stored price.
  function recToken(x) {
    var live = null;
    (TOKS || []).forEach(function (t) { if (t.i === x.i) live = t; });
    return live || { i: x.i, n: x.n, nm: x.nm, logo: iconOf(x.i), p: null, d: null, cur: false };
  }
  function recPaint(list) {
    var a = recGet();
    list.innerHTML = '';
    if (!a.length) return false;
    var head = el('div', 'lx-rechead');
    head.appendChild(el('span', null, 'Recent'));
    var clr = el('button', 'lx-recclear', 'Clear');
    clr.type = 'button';
    clr.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      try { localStorage.removeItem(RKEY); } catch (x) {}
      list.innerHTML = '';
    });
    head.appendChild(clr);
    list.appendChild(head);
    [['t', 'Assets'], ['p', 'Pools'], ['w', 'Wallets']].forEach(function (g) {
      var group = a.filter(function (t) { return t.k === g[0]; });
      if (!group.length) return;
      list.appendChild(el('div', 'lx-recgrp', g[1]));
      group.forEach(function (t) {
        var r = g[0] === 'w' ? accountRow(t.i) : (g[0] === 'p' ? poolRow({ id: t.i, tokens: t.s || [] }) : rowFor(recToken(t)));
        r.classList.add('lx-recrow');
        list.appendChild(r);
      });
    });
    setCount(null);
    return true;
  }
  function recShowIfEmpty() {
    var inp = $('#spSearchInput'), list = $('#spAssetList');
    if (inp && list && !String(inp.value || '').trim()) recPaint(list);
  }
  if (!window.__lxnRecWired) {
    window.__lxnRecWired = 1;
    // Capture, because the row is a link and the entry must be written before the navigation it starts.
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.sp-addr-mini')) return;                     // the copy chip, not the row
      var row = t.closest('#spAssetList .sp-row--asset');
      if (row && row.__lxnT) { recAdd(row.__lxnT); return; }
      if (t.closest('input[data-sp-wired], .search-trigger, .topbar-search, [data-open-search], #headerSearchBtn, .lx-hsearch')) {
        setTimeout(recShowIfEmpty, 120);
      }
    }, true);
    // AND ON THE PRESS, because the click may never reach the document. The Trade page's row router
    // (browser/trade.js nav) takes every <a href> click at WINDOW capture and stops it there so the
    // browser follows the link -- measured: on /trade/near nothing below window ever saw the click, and
    // no recent was saved. A press on a row is recorded as it starts; the click, where it does arrive,
    // only moves the same entry to the top again.
    function onPress(e) {
      var t = e.target;
      if (!t || !t.closest || t.closest('.sp-addr-mini')) return;
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      if (e.type === 'pointerdown' && e.button !== 0 && e.button !== 1) return;
      var row = t.closest('#spAssetList .sp-row--asset');
      if (row && row.__lxnT) recAdd(row.__lxnT);
    }
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('keydown', onPress, true);
  }

  // ---- pools, accounts, and the exact id the lists do not hold -----------------------------------------
  // POOL URLS NAME THE PAIR (RAZA 2026-10-30: "The url for Pools-pool page on near needs to be fixed" -> "Use the
  // pair name"): /pools/near/stnear-wnear/3514. The symbols make it readable; the Rhea pool id stays as the last
  // segment because one pair can have several pools (classic, stable, different fees), so the name alone would
  // not say which. Symbols are chosen by whoever deployed the token, so only [a-z0-9] survive. Same function in
  // pools.js, search.js and pooldetail.js.
  function poolHref(id, syms) {
    var slug = (syms || []).map(function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); })
      .filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '');
    return '/pools/near/' + (slug || 'pool') + '/' + encodeURIComponent(id);
  }
  function poolRow(p) {
    var a = document.createElement('a');
    a.className = 'sp-row sp-row--asset lx-searow';
    a.setAttribute('data-chain', 'near');
    a.href = poolHref(p.id, (p.tokens || []).map(function (x) { return x && x.s; }));
    var toks = (p.tokens || []).slice(0, 4);
    a.__lxnT = { k: 'p', i: String(p.id), s: toks.map(function (x) { return { i: x.i, s: x.s }; }) };
    var ico = el('div', 'sp-ico lx-spico-on lx-poolico');
    toks.slice(0, 2).forEach(function (x, k) {
      var pi = el('span', 'lx-pi lx-pi-' + (k ? 'b' : 'a'));
      var live = null;
      (TOKS || []).forEach(function (t) { if (t.i === x.i) live = t; });
      var src = x.i === C.WNEAR ? C.NEAR_LOGO : (okUrl(x.logo) || (live && okUrl(live.logo)) || (x.i ? iconOf(x.i) : letterUri(x.s)));
      // The letters sit behind it: a token with no logo answers 404, which a background does not report.
      pi.style.backgroundImage = 'url("' + String(src).split('"').join('%22') + '"), url("' + String(letterUri(x.s)).split('"').join('%22') + '")';
      ico.appendChild(pi);
    });
    a.appendChild(ico);
    var info = el('div', 'sp-info');
    var nr = el('div', 'sp-name-row');
    nr.appendChild(tag('lx-pool-pair', toks.length ? toks.map(function (x) { return x.s || short(x.i); }).join(' / ') : 'Liquidity pool'));
    nr.appendChild(document.createTextNode(' '));
    nr.appendChild(tag('sp-domain', 'NEAR pool'));
    info.appendChild(nr);
    var usd = (p.liq != null && USD > 0) ? money(p.liq * USD) : '';
    info.appendChild(el('div', 'sp-sub', 'Liquidity pool' + (usd ? ' · ' + usd + ' TVL' : '')));
    a.appendChild(info);
    var right = el('div', 'sp-right');
    right.appendChild(tag('sp-addr-mini', '#' + p.id));
    a.appendChild(right);
    return a;
  }
  function accountRow(addr) {
    var a = document.createElement('a');
    a.className = 'sp-row sp-row--asset lx-searow';
    a.setAttribute('data-chain', 'near');
    a.href = '/account/near/' + encodeURIComponent(addr);
    a.__lxnT = { k: 'w', i: addr };
    var ico = el('div', 'sp-ico lx-spico-on');
    ico.style.cssText = 'position:relative;overflow:hidden';
    ico.innerHTML = identSvg(addr, 36);
    a.appendChild(ico);
    var info = el('div', 'sp-info');
    var nr = el('div', 'sp-name-row', 'NEAR account ');
    nr.appendChild(tag('sp-domain', 'wallet'));
    info.appendChild(nr);
    info.appendChild(el('div', 'sp-sub', 'Balances, tokens and activity'));
    a.appendChild(info);
    var right = el('div', 'sp-right');
    right.appendChild(tag('sp-addr-mini', short(addr)));
    a.appendChild(right);
    return a;
  }
  function dropNote(list) {
    [].forEach.call(list.querySelectorAll('.lxn-sea-note'), function (n) { n.parentNode.removeChild(n); });
  }

  // LEDGER-FIRST (the XRPL rule): an exact id is asked of the chain, not looked up in a list. Only ids that
  // cannot be a plain word -- a dot, or an implicit 64-hex / 0x id -- so typing "usdc" never costs an RPC.
  // Answers are remembered for the page view; a transient failure is not.
  var EXACT = {};
  function exactEligible(q) {
    return C.isAccountId(q) && (q.indexOf('.') > 0 || /^[0-9a-f]{64}$/.test(q) || /^0x[0-9a-f]{40}$/.test(q));
  }
  function resolveExact(q) {
    if (EXACT[q]) return EXACT[q];
    var p = C.callView(q, 'ft_metadata', {}).then(function (m) {
      if (m && m.decimals != null && isFinite(+m.decimals)) {
        return { kind: 'token', t: { i: q, n: C.cleanSym(m.symbol) || short(q), nm: C.cleanSym(m.name), logo: okUrl(m.icon), p: null, d: null, cur: false } };
      }
      throw { code: 'CALL' };
    }).catch(function (e) {
      if (e && e.transient) throw e;
      if (e && e.code === 'UNKNOWN_ACCOUNT') return { kind: 'none' };
      return C.view({ request_type: 'view_account', finality: 'final', account_id: q })
        .then(function () { return { kind: 'account' }; }, function (e2) {
          if (e2 && e2.transient) throw e2;
          return { kind: 'none' };
        });
    });
    EXACT[q] = p;
    p.catch(function () { if (EXACT[q] === p) delete EXACT[q]; });
    return p;
  }

  function note(list, text) {
    list.innerHTML = '';
    list.appendChild(el('div', 'lxn-sea-note', text));
  }

  // THE COUNT IS OURS ALONE (RAZA 2026-09-16: "THere's a flash bug on search. It shows a count for split seconds when i input
  // any character. Its on all letters"). The design counts its own sample rows the moment a key is pressed — "(1)", "(7)",
  // "(8)" — and those rows are hidden by the gate above, so the number described nothing on screen. It is held at whatever
  // this layer last set, and anything else written into it is taken straight back out.
  var ownCount = '';
  function setCount(n) {
    ownCount = n == null ? '' : '(' + n + ')';
    var c = $('#spAssetCount');
    if (!c) return;
    if (c.textContent !== ownCount) c.textContent = ownCount;
    watchCount(c);
  }
  function watchCount(c) {
    if (!c || c.__lxnCw || !window.MutationObserver) return;
    c.__lxnCw = new MutationObserver(function () {
      if (c.textContent !== ownCount) c.textContent = ownCount;
    });
    c.__lxnCw.observe(c, { childList: true, characterData: true, subtree: true });
  }
  // The element only exists once the panel has mounted, and the flash happens on the FIRST keystroke — so the watch is put
  // in place as soon as it appears, before any search of ours has run.
  (function findCount(tries) {
    var c = $('#spAssetCount');
    if (c) { watchCount(c); return; }
    if ((tries || 0) < 60) setTimeout(function () { findCount((tries || 0) + 1); }, 400);
  })(0);
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'spSearchInput') watchCount($('#spAssetCount'));
  }, true);

  // The design's search is multi-chain and groups its results behind per-chain filter pills. This
  // build searches ONE ledger, so the only pill that can mean anything is the XRP Ledger one — and
  // what actually shipped was a pill reading "Aptos (9)" carrying data-chain="hedera", from the
  // design's own scrambled chain-name map. Clicking it filtered to a chain with no results, and the
  // (9) was a count of rows that are not in the list.
  //
  // Removed rather than relabelled: renaming it would still leave a filter for something this build
  // does not search. Every row this layer creates is stamped data-chain="xrpl", so anything else is
  // by definition not ours.
  // CALLING THIS ONCE PER RENDER IS NOT ENOUGH: the design rebuilds its filter row after results
  // land, so the pill reappeared immediately after being removed. Watched instead, the same way the
  // launchpad watches its cost panel — the container is observed and any foreign pill is taken out
  // whenever it is put back.
  function dropForeignFilters() {
    [].forEach.call(document.querySelectorAll('.sp-filter-pill'), function (b) {
      var c = (b.getAttribute('data-chain') || '').toLowerCase();
      if (c && c !== 'near' && b.parentNode) b.parentNode.removeChild(b);
    });
  }

  function watchFilters() {
    if (window.__lxnSeaFilterWatch || !window.MutationObserver) return;
    var host = $('.sp-filters');
    if (!host) return;
    window.__lxnSeaFilterWatch = 1;
    // Removing a child mutates the container, so the observer re-enters. It is self-limiting because
    // the second pass finds nothing foreign left and mutates nothing — the same reasoning the
    // launchpad's cost observer relies on.
    new MutationObserver(dropForeignFilters).observe(host, { childList: true, subtree: true });
    dropForeignFilters();
  }

  function run(q) {
    var list = $('#spAssetList');
    if (!list) return;
    if (!q) { seq++; if (!recPaint(list)) list.innerHTML = ''; setCount(null); return; }
    if (q.length < MIN && !/^[0-9]+$/.test(q)) { note(list, 'Type at least ' + MIN + ' characters.'); setCount(null); return; }

    var mine = ++seq;
    var ql = q.toLowerCase();
    watchFilters();
    if (!TOKS) { setCount(null); note(list, 'Searching NEAR…'); }

    var exact = exactEligible(ql) ? resolveExact(ql) : null;
    var wide = wideHits(ql), wideRows = null, wholePools = allPools(), morePools = [];
    Promise.all([loadTokens(), loadPools()]).then(function (r) {
      if (mine !== seq) return;
      var toks = r[0], pools = r[1], xNow = null;
      var hits = toks ? tokenHits(toks, ql) : [];
      var phits = pools ? poolHits(pools, ql) : [];
      function draw() {
        var known = {};
        hits.forEach(function (t) { known[t.i] = 1; });
        var more = (wideRows || []).filter(function (t) { return !known[t.i]; });
        var seen = {};
        phits.forEach(function (p) { seen[p.id] = 1; });
        paint(list, hits.concat(more), phits.concat(morePools.filter(function (p) { return !seen[p.id]; })).slice(0, 5), xNow, !toks && !pools);
      }
      draw();
      // Still asking the wider index: "nothing matches" would be a guess.
      if (!hits.length && !phits.length && !exact) note(list, 'Searching NEAR…');
      wide.then(function (rows) {
        if (mine !== seq) return;
        wideRows = rows;
        if (rows.length || !exact) draw();
      });
      wholePools.then(function (rows) {
        if (mine !== seq) return;
        morePools = allPoolHits(rows, ql);
        if (morePools.length) draw();
      });
      if (!exact) return;
      if (!list.children.length) note(list, 'Looking up ' + ql + ' on NEAR…');
      exact.then(function (x) {
        if (mine !== seq) return;
        xNow = x;
        draw();
      }, function () {
        if (mine !== seq) return;
        xNow = { kind: 'down' };
        draw();
      });
    });
  }

  // One drawing for every state, so a late answer re-draws the whole list rather than patching it.
  function paint(list, hits, phits, x, listsDown) {
    list.innerHTML = '';
    var known = {};
    hits.forEach(function (t) { known[t.i] = 1; });
    var n = hits.length;
    if (x && x.kind === 'token' && !known[x.t.i]) { list.appendChild(rowFor(x.t)); n++; }
    hits.forEach(function (t) { list.appendChild(rowFor(t)); });
    if (phits.length) {
      list.appendChild(el('div', 'lx-recgrp', 'Pools'));
      phits.forEach(function (p) { list.appendChild(poolRow(p)); });
    }
    if (x && x.kind === 'account') {
      list.appendChild(el('div', 'lx-recgrp', 'Wallets'));
      list.appendChild(accountRow(String(($('#spSearchInput') || {}).value || '').trim().toLowerCase()));
    }
    if (!list.children.length) {
      // Three different empties, three different sentences: nothing matches; the lists could not be
      // asked; the chain could not be asked about the exact id.
      if (x && x.kind === 'down') note(list, 'Could not reach NEAR to look that up — try again in a moment.');
      else if (listsDown && !x) note(list, 'Search is unavailable right now.');
      else if (x === null && exactEligibleNow()) { setCount(null); return; }            // still asking the chain: keep the note
      else note(list, 'No NEAR token, pool or account matches that.');
    }
    setCount(n);
  }
  function exactEligibleNow() {
    var v = String(($('#spSearchInput') || {}).value || '').trim().toLowerCase();
    return exactEligible(v);
  }

  var timer = null;
  function onInput(e) {
    var q = String(e.target.value || '').trim();
    loadTokens(); loadPools();
    clearTimeout(timer);
    // Debounced: the upstream allows 333 requests a DAY per IP, and although this goes through our
    // own cached proxy, one request per keystroke would still be pointless load for no better answer.
    // Immediate once the lists are in hand -- nothing is fetched per keystroke; a short wait otherwise.
    timer = setTimeout(function () { run(q); }, TOKS ? 0 : 160);
  }

  function wire() {
    var inp = $('#spSearchInput');
    if (!inp || inp.__lxn) return;
    inp.__lxn = 1;
    inp.addEventListener('input', onInput);
    // Opening the panel is the first moment the roster is worth fetching — and the recents it paints on
    // focus are the rows that most need it, since their stored `vf` is whatever it was months ago.
    inp.addEventListener('focus', function () { loadTokens(); if (String(inp.value || '').trim()) onInput({ target: inp }); else recShowIfEmpty(); });
    // A recent token is drawn from the live list when it is in hand (price, tick); the first open of a
    // page has not asked for it yet, so the recents are drawn again once it lands.
    inp.addEventListener('focus', function () { if (TOKS) return; loadTokens().then(function () { if (!String(inp.value || '').trim() && $('#spAssetList .lx-recrow')) recShowIfEmpty(); }); });
    recShowIfEmpty();
    // The design's placeholder still offers Stellar; this layer decides what is searchable.
    try { inp.placeholder = 'Search assets, pools and wallets'; } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  // The popup is created/opened by lx-searchctl, which may mount the input after this runs.
  var tries = 0;
  var poll = setInterval(function () {
    wire();
    if (++tries > 40 || ($('#spSearchInput') && $('#spSearchInput').__lxn)) clearInterval(poll);
  }, 250);

  window.__lxnSearchRun = run;

  // THE HEADER'S OWN SEARCH BOX OPENS THE PANEL. This was lx-searchassets' job, and goes with it: the bare
  // topbar "Search assets" input is not the panel's #spSearchInput, so it becomes a launcher -- focusing it
  // (or having typed into it) opens the panel through the design's own opener and forwards the query.
  // Copied from the Stellar layer unchanged, including its strict scope (ONLY the topbar's .search-box
  // input: a looser match once hijacked the pickers inside the Bridge, Send, Swap and Create Pool dialogs).
  function launchPopup(seed) {
    var btn = document.getElementById('headerSearchBtn') || document.querySelector('[data-open-search]');
    var ov = document.getElementById('searchPopup');
    if (btn) { btn.click(); }
    else if (ov) {
      ov.style.display = 'flex'; ov.classList.add('open');
      // Focused NOW, not 90ms later: keys typed in that window otherwise land nowhere (the box they were
      // aimed at has just been blurred) -- measured as a lost query on a quick click-and-type.
      var si0 = document.getElementById('spSearchInput');
      if (si0) { try { si0.focus(); } catch (e) {} }
      if (!ov.__lxclose) {
        ov.__lxclose = 1;
        ov.addEventListener('click', function (e) { if (e.target === ov) { ov.style.display = 'none'; ov.classList.remove('open'); } });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.style.display !== 'none') { ov.style.display = 'none'; ov.classList.remove('open'); } });
      }
    }
    setTimeout(function () {
      wire();
      var si = document.getElementById('spSearchInput');
      if (si) {
        if (seed) { si.value = seed; try { si.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
        try { si.focus(); } catch (e) {}
      }
    }, 90);
  }
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.id === 'spSearchInput' || !t.closest) return;
    var box = t.closest('.search-box'); if (!box || !box.closest('.topbar')) return;
    if (t.closest('#searchPopup,[class*=modal],[class*=dropdown],[class*=menu],[class*=picker],[class*=popup],[role=dialog]')) return;
    var seed = (t.value || '').trim(); try { t.blur(); } catch (x) {}
    t.value = '';
    launchPopup(seed);
  }, true);
  // The panel mounts lazily on some pages; wire again when the header's search button is used.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('#headerSearchBtn,[data-open-search],.lx-hsearch');
    if (b) setTimeout(wire, 60);
  }, true);
})();
