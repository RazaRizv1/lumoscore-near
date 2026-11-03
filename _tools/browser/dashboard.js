// NEAR Dashboard: the network-stats strip, the four product boxes and Platform Activity.
//
// MODELLED ON the XRPL fork's _tools/browser/dashboard.js (paintStats: pills matched by slot, never by
// position in a guess; the row's orphaned `.status-row{opacity:0}` raised only once real figures are in)
// and on the markup Stellar's own layers write here: the pills are lx-realdata's `.lx-vpill` shape and the
// boxes are lx-dashboxes' `.lx-dbx-v[data-k]` slots, so the inherited stylesheets dress them unchanged.
// Both Stellar layers are stripped from NEAR pages by _neardash.js; this is what fills their elements.
//
// SOURCES, all asked from the browser:
//   /lxapi/nearstats    the strip's NETWORK-WIDE Assets, Pools and Accounts (NearBlocks + Rhea, at the edge)
//   /lxapi/neartrades   the strip's network-wide Trades (DexScreener over Rhea's most-traded pools)
//   /lxapi/nearmarket   the Trade box: listed tokens (Markets), main-pair volume and liquidity, NEAR/USD
//   /lxapi/nearpools    the Pools box: curated Rhea pools, liquidity, 24h volume (figures in NEAR, x usd)
//   /lxapi/nearoneclick?op=tokens   the Cross-chain box (since 2026-10-30): destinations NEAR Intents
//                       serves, and the NEAR tokens it takes plus those only Omni/Wormhole carry
// WHAT HAS NO NEAR SOURCE says so with the design's em dash: the Launchpad box (no NEAR launchpad
// deployed yet) and Platform Activity, which shows the design's own "No platform activity yet." row --
// until the platform's own NEAR writes are read (activity(), below).
(function () {
  if (window.__lxnDash) return;
  window.__lxnDash = 1;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  if (!$('.status-row') && !$('#activityList') && !$('.lx-dbx')) return;      // not the dashboard

  function j(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function market() {
    if (!window.__lxnMarketP) {
      var p = j('/lxapi/nearmarket').then(function (d) { return (d && d.ok && d.rows) ? d : null; }, function () { return null; });
      window.__lxnMarketP = p;
      p.then(function (d) { if (!d && window.__lxnMarketP === p) window.__lxnMarketP = null; });
    }
    return window.__lxnMarketP;
  }

  function count(v) { return (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString('en-US'); }
  function compact(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }
  function usd(v) { return (v == null || !isFinite(v)) ? '—' : '$' + compact(v); }

  // ---- network stats ---------------------------------------------------------------------------------
  // lx-realdata's pill, verbatim in shape: `.status-pill.lx-vpill` with a coloured `.lx-pico` glyph and a
  // `.lx-vpt` label/value pair, and the same four: Assets, Pools and Accounts are NETWORK-WIDE, as on
  // Stellar (RAZA 2026-10-29: Assets and Pools showed LumosCore's curated 71 and 182, and Transactions sat
  // where Accounts belongs). The Pools PRODUCT box below stays LumosCore's own list: it describes that page.
  // Both come from /lxapi/nearstats, which reads NearBlocks at the edge.
  var PICO = {
    Assets: ['#f7b733', '<ellipse cx="14.8" cy="8.6" rx="4.4" ry="2.1"></ellipse><path d="M10.4 8.6v3.4c0 1.16 1.97 2.1 4.4 2.1s4.4-.94 4.4-2.1V8.6"></path><ellipse cx="9.2" cy="14.4" rx="4.4" ry="2.1"></ellipse><path d="M4.8 14.4v3.4c0 1.16 1.97 2.1 4.4 2.1s4.4-.94 4.4-2.1v-3.4"></path>'],
    Pools: ['#38bdf8', '<path d="M12 3.4l3.9 4.7a5.1 5.1 0 1 1-7.8 0z"></path><ellipse cx="12" cy="17.6" rx="7.4" ry="2.5"></ellipse><path d="M8.6 15.9c.9.5 2.1.8 3.4.8s2.5-.3 3.4-.8"></path>'],
    Trades: ['#a855f7', '<path d="M4.8 9.2h13.6M15.4 6.2l3 3-3 3"></path><path d="M19.2 14.8H5.6M8.6 11.8l-3 3 3 3"></path>'],
    Accounts: ['#2dd4bf', '<circle cx="12" cy="8.7" r="3.5"></circle><path d="M5.5 19.4a6.5 6.5 0 0 1 13 0"></path>']
  };
  function pill(lbl, val, tip) {
    var e = PICO[lbl];
    var p = document.createElement('span');
    p.className = 'status-pill lx-vpill';
    p.setAttribute('data-lx-noswap', '');
    if (tip) p.title = tip;
    p.innerHTML = '<span class="lx-pico" style="color:' + e[0] + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
      + e[1] + '</svg></span><span class="lx-vpt"><span class="lbl"></span><span class="val"></span></span>';
    p.querySelector('.lbl').textContent = lbl;
    var v = p.querySelector('.val');
    v.textContent = val;
    if (val === '—' || val === '…') v.classList.add('lx-pending');
    return p;
  }
  var ST = { assets: null, pools: null, poolsSplit: '', trades: null, accounts: null, active: null, day: null, stale: '', tradesStale: '' };
  // What the network-wide pills' tooltips add: a figure the edge could not refresh says when it was read,
  // and a missing one says it could not be read -- neither may pass for an ordinary current number.
  function netNote(v, stale) {
    if (v != null && !isFinite(v)) return ' (could not be read just now)';
    stale = arguments.length > 1 ? stale : ST.stale;
    return stale ? ' (as of ' + stale + '; the latest read did not answer)' : '';
  }
  function paintStats() {
    var row = $('.status-row');
    if (!row) return;
    var net = row.querySelector('.lx-netcard');
    $$('.status-pill', row).forEach(function (p) { if (p !== net && p.parentNode) p.parentNode.removeChild(p); });
    row.appendChild(pill('Assets', ST.assets == null ? '…' : count(ST.assets), 'Every fungible token on NEAR (NearBlocks)' + netNote(ST.assets)));
    row.appendChild(pill('Pools', ST.pools == null ? '…' : count(ST.pools), 'Every pool on Rhea Finance, the main NEAR exchange'
      + (ST.poolsSplit ? ': ' + ST.poolsSplit : '') + netNote(ST.pools)));
    row.appendChild(pill('Trades', ST.trades == null ? '…' : count(ST.trades), 'Trades in the past 24 hours on Rhea Finance, the main NEAR exchange, across its most-traded pools'
      + netNote(ST.trades, ST.tradesStale)));
    row.appendChild(pill('Accounts', ST.accounts == null ? '…' : compact(ST.accounts),
      (ST.accounts != null && isFinite(ST.accounts) ? count(ST.accounts) + ' — ' : '') + 'every account ever created on NEAR, a running total rather than a daily figure'
      + (ST.active > 0 ? '. ' + count(ST.active) + ' were active on ' + ST.day + ' (UTC)' : '') + netNote(ST.accounts)));
    // The orphaned Stellar sheet holds `.status-row{opacity:0}` until its script raised it; that script is
    // gone, so the row is raised here -- and only once all four figures have answered (or failed to), so
    // the strip appears once, complete, rather than as "…" pills that change one by one. reveal() below is
    // the safety net if an answer never comes.
    if (ST.assets != null && ST.pools != null && ST.trades != null && ST.accounts != null) reveal();
  }
  function reveal() {
    var row = $('.status-row');
    if (!row) return;
    row.classList.add('lx-ready');
    row.style.setProperty('opacity', '1', 'important');
  }
  setTimeout(reveal, 8000);

  // Network-wide figures, cached in the browser for 30 minutes on top of the edge's own 6 hours. A failed
  // read is never stored, so the next visit asks again (and the pills say "—", not a stale or a zero).
  function netStats() {
    try {
      var c = JSON.parse(localStorage.getItem('lxn.netstats') || 'null');
      if (c && c.v && c.v.accounts > 0 && c.v.pools > 0 && Date.now() - c.t < 1800000) return Promise.resolve(c.v);
    } catch (e) {}
    return j('/lxapi/nearstats').then(function (d) {
      if (!d || !d.ok || !(d.accounts > 0) || !(d.assets > 0) || !(d.pools > 0)) return null;
      if (!d.stale) { try { localStorage.setItem('lxn.netstats', JSON.stringify({ v: d, t: Date.now() })); } catch (e) {} }
      return d;
    }).catch(function () { return null; });
  }

  // ---- the product boxes -------------------------------------------------------------------------------
  function box(k, v) {
    $$('.lx-dbx-v[data-k="' + k + '"]').forEach(function (el) {
      el.textContent = v;
      el.classList.remove('wait');
    });
  }

  // THE CROSS-CHAIN BOX, counted from what the bridge page offers (XRPL's rule: the card must not disagree
  // with the page it links to). Networks: the chains NEAR Intents serves -- Omni's and Wormhole's are all
  // among them. Assets: the NEAR tokens that can be SENT (XRPL's box names XRP, its one source), NEAR
  // Intents' origins plus the Omni/Wormhole-only tokens from the same baked table the bridge uses.
  var BR_IDS = __LX_BR_IDS__;
  function crossChain() {
    box('cvia', 'NEAR Intents · Omni · Wormhole');
    j('/lxapi/nearoneclick?op=tokens').then(function (d) {
      if (!d || !d.ok || !Array.isArray(d.tokens)) throw new Error('no list');
      var chains = {}, src = {};
      d.tokens.forEach(function (t) { if (t && t.blockchain && t.blockchain !== 'near') chains[t.blockchain] = 1; });
      (d.origins || []).forEach(function (o) { if (o && o.contract) src[o.contract] = 1; });
      if (src['wrap.near']) src.near = 1;                       // native NEAR rides on wNEAR's listing
      BR_IDS.forEach(function (id) { src[id] = 1; });
      var n = Object.keys(chains).length, a = Object.keys(src).length;
      if (!(n > 0)) throw new Error('no chains');
      box('cnet', count(n));
      box('casset', count(a));
    }).catch(function () { box('cnet', '—'); box('casset', '—'); });
  }

  // ---- Platform Activity ---------------------------------------------------------------------------------
  // The design's thirty invented rows stay behind their gate (#activityList:not([data-lxact])) until this
  // replaces them with the design's own empty row, then lifts the gate in the same breath.
  function activityEmpty() {
    var list = document.getElementById('activityList');
    if (!list || list.getAttribute('data-lxact') === '1') return;
    list.innerHTML = '<div class="activity-feed-row" style="justify-content:center;color:var(--text-soft);font-size:14px">No platform activity yet.</div>';
    list.setAttribute('data-lxact', '1');
  }

  // ...and then the platform's own NEAR writes (browser/nearcore.js platformActivity: every swap, limit order and
  // bridge pays its fee to fees-lumoscore.near in the same transaction). Stellar's row: the pair's logos, a
  // sentence, the verb and the trader, the time and the transaction link. A failed read keeps the empty row.
  var TX = 'https://nearblocks.io/txns/';
  var XPI = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ago(ms) {
    var s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }
  function amt(f) {
    if (!f) return '';
    var v = f.v == null ? '' : Number(f.v);
    var n = v === '' ? '' : (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(+v.toPrecision(6)));
    return '<b>' + esc((n ? n + ' ' : '') + f.s) + '</b>';
  }
  function logo(f) {
    var l = esc(String((f && f.s) || '?').charAt(0).toUpperCase());
    return '<span class="act-inl lx-dimg lx-fgi" data-l="' + l + '">' + (f && f.ic ? '<img src="' + esc(f.ic) + '" alt="" onerror="this.remove()">' : '') + '</span>';
  }
  function who(a) {
    var av = '';
    try { if (window.lxIdent) av = '<img class="lx-actav" width="20" height="20" alt="" src="data:image/svg+xml;utf8,' + encodeURIComponent(String(window.lxIdent(a, 20))) + '">'; } catch (e) {}
    var sh = a.length > 22 ? a.slice(0, 8) + '…' + a.slice(-6) : a;
    return '<a class="lx-actwho" href="/account/near/' + encodeURIComponent(a) + '" title="' + esc(a) + '">' + av + esc(sh) + '</a>';
  }
  // "Swap" is four letters, and the inherited logo painter treats any 1-5 letter span without a graphic as a
  // token-icon slot: it blanked the badge and painted a LUMOS logo over it. An empty svg inside is its opt-out
  // (the same trick createpool.js uses on MAX).
  var NOICON = '<svg width="0" height="0" aria-hidden="true" style="position:absolute"></svg>';
  function actRow(r) {
    var m = String(r.memo || ''), verb, cls, type;
    if (/limit order/i.test(m)) { verb = 'Order placed'; cls = 'swap'; type = 'Placed a limit order selling ' + amt(r.give); }
    else if (/^lx:(ni|om|wh)$/.test(m)) {
      verb = 'Bridge'; cls = 'bridge';
      type = 'Bridged ' + amt(r.give) + ' via ' + ({ 'lx:ni': 'NEAR Intents', 'lx:om': 'Omni Bridge', 'lx:wh': 'Wormhole' })[m];
    } else if (r.give && r.get) { verb = 'Swap'; cls = 'swap'; type = 'Swapped ' + amt(r.give) + ' for ' + amt(r.get); }
    else { verb = 'Trade'; cls = 'swap'; type = r.give ? ('Traded ' + amt(r.give)) : 'Traded on LumosCore'; }
    var b = (verb === 'Swap') ? r.get : null;
    var glyph = '<span class="lx-fg' + (b ? ' lx-fg2' : '') + '" aria-hidden="true"><span class="lx-fga">' + logo(r.give || r.get) + '</span>'
      + (b ? '<span class="lx-fgb">' + logo(b) + '</span>' : '') + '</span>';
    return '<div class="activity-feed-row lx-fr" data-lx-noswap="1">' + glyph
      + '<div class="info"><div class="type">' + type + '</div><div class="meta lx-actmeta"><span class="lx-actverb ' + cls + '" data-logoed="1">' + NOICON + verb + '</span>' + who(r.who) + '</div></div>'
      + '<div class="lx-frr"><div class="time">' + ago(r.ts) + '</div>'
      + '<a class="lx-actlink" href="' + TX + encodeURIComponent(r.h) + '" target="_blank" rel="noopener nofollow" title="View transaction">' + XPI + '</a></div></div>';
  }
  // Stellar's heading: "Platform Activity — [mark] NEAR" and an "N in 24h" pill on the right, counting the rows
  // shown (RAZA 2026-11-03). .lx-chainmark and .lx-act24 are Stellar's rules, already in this page's CSS.
  function head24(rows) {
    var list = document.getElementById('activityList'), card = list && list.closest('.activity-card');
    var h3 = card && card.querySelector('h3'), head = card && card.querySelector('.market-head');
    if (h3 && !h3.querySelector('.lx-chainmark')) {
      var pulse = h3.querySelector('.live-pulse');
      h3.textContent = '';
      if (pulse) h3.appendChild(pulse);
      h3.appendChild(document.createTextNode('Platform Activity — '));
      var cm = document.createElement('img');
      cm.className = 'lx-chainmark'; cm.src = '/assets/networks/near.png'; cm.alt = '';
      cm.setAttribute('aria-hidden', 'true'); cm.setAttribute('data-lxc', 'NEAR'); cm.setAttribute('data-lxpainted', '1');
      h3.appendChild(cm);
      h3.appendChild(document.createTextNode('NEAR'));
    }
    if (!head) return;
    var el = head.querySelector('.lx-act24');
    if (!el) { el = document.createElement('span'); el.className = 'lx-act24'; el.setAttribute('data-logoed', '1'); head.appendChild(el); }
    var cut = Date.now() - 864e5, n = 0;
    rows.forEach(function (r) { if (r.ts >= cut) n++; });
    el.textContent = n + ' in 24h';
    el.title = (n === 1 ? '1 transaction' : n + ' transactions') + ' through LumosCore in the last 24 hours';
  }
  function activity() {
    var C = window.lxnCore;
    // nearcore.js can arrive after this script: wait for it (up to 10s) rather than keep the empty row.
    if (!C || !C.platformActivity) { if ((activity.n = (activity.n || 0) + 1) < 40) setTimeout(activity, 250); return; }
    C.platformActivity(15).then(function (rows) {
      var list = document.getElementById('activityList');
      if (!list || !rows || !rows.length) return;
      list.innerHTML = rows.map(actRow).join('');
      head24(rows);
      list.setAttribute('data-lxact', '1');
      try { list.setAttribute('data-logoed', '1'); } catch (e) {}
    }, function () {
      // FastNEAR refused (its per-visitor allowance) or failed: one more try a minute later.
      if (!activity.retried) { activity.retried = 1; setTimeout(activity, 60000); }
    });
  }

  // ---- the Quick actions row -------------------------------------------------------------------------------
  // lx-dashqa (inherited, patched by _neardash.js) routes the cards. Nothing here.

  function load() {
    activityEmpty();
    activity();
    paintStats();
    ['ltok', 'lnew', 'lmint'].forEach(function (k) { box(k, '—'); });
    crossChain();

    market().then(function (d) {
      if (!d) {
        ['tvol', 'tliq', 'tmkt'].forEach(function (k) { box(k, '—'); });
        return;
      }
      var vol = 0, liq = 0;
      d.rows.forEach(function (r) { vol += +r.v || 0; liq += +r.t || 0; });
      box('tvol', usd(vol * d.usd));
      box('tliq', usd(liq * d.usd));
      box('tmkt', count(d.rows.length));
    });
    j('/lxapi/nearpools').then(function (p) {
      var s = (p && p.ok && p.summary) || null;
      if (!s || !(p.usd > 0)) throw new Error('no pools');
      box('ppool', count(s.pools));
      box('ptvl', usd(s.liquidity * p.usd));
      box('pvol', usd(s.vol24 * p.usd));
    }).catch(function () {
      ['ppool', 'ptvl', 'pvol'].forEach(function (k) { box(k, '—'); });
    });
    // Trades are network-wide too (RAZA 2026-10-29), from their own Function; not cached in the browser,
    // since the edge already holds them 10 minutes and the figure rolls.
    j('/lxapi/neartrades').then(function (d) {
      if (!d || !d.ok || !(d.trades > 0)) throw new Error('no trades');
      ST.trades = d.trades;
      ST.tradesStale = d.stale && d.at ? new Date(d.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
      paintStats();
    }).catch(function () { ST.trades = NaN; ST.tradesStale = ''; paintStats(); });
    netStats().then(function (v) {
      ST.assets = v ? v.assets : NaN; ST.accounts = v ? v.accounts : NaN; ST.pools = v ? v.pools : NaN;
      ST.poolsSplit = v && v.poolsClassic > 0 && v.poolsDcl > 0
        ? count(v.poolsClassic) + ' classic and ' + count(v.poolsDcl) + ' concentrated-liquidity' : '';
      ST.active = v ? v.active : null; ST.day = v ? v.day : null;
      ST.stale = v && v.stale && v.at ? new Date(v.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
      paintStats();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
