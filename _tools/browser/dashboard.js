// NEAR Dashboard: the network-stats strip, the four product boxes and Platform Activity.
//
// MODELLED ON the XRPL fork's _tools/browser/dashboard.js (paintStats: pills matched by slot, never by
// position in a guess; the row's orphaned `.status-row{opacity:0}` raised only once real figures are in)
// and on the markup Stellar's own layers write here: the pills are lx-realdata's `.lx-vpill` shape and the
// boxes are lx-dashboxes' `.lx-dbx-v[data-k]` slots, so the inherited stylesheets dress them unchanged.
// Both Stellar layers are stripped from NEAR pages by _neardash.js; this is what fills their elements.
//
// SOURCES, all asked from the browser, none new:
//   /lxapi/nearmarket   listed tokens (Assets, Markets), 24h trades, main-pair volume and liquidity, NEAR/USD
//   /lxapi/nearpools    curated Rhea pools: count, liquidity, 24h volume (figures in NEAR, x usd)
//   NearBlocks /v1/stats  NEAR's running transaction total -- one call, kept 30 minutes in localStorage,
//                       because the free tier is rate-limited and the wallet's activity shares it
// WHAT HAS NO NEAR SOURCE says so with the design's em dash: the Cross-chain and Launchpad boxes (no NEAR
// bridge layer or launchpad in this build yet) and Platform Activity, which shows the design's own "No
// platform activity yet." row -- LumosCore has no NEAR activity marker to read until NEAR writes exist.
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
  // `.lx-vpt` label/value pair. The fourth Stellar pill is Accounts, a running total NEAR's public indexes
  // do not publish; NEAR's running total of transactions takes its slot under the same glyph family.
  var PICO = {
    Assets: ['#f7b733', '<ellipse cx="14.8" cy="8.6" rx="4.4" ry="2.1"></ellipse><path d="M10.4 8.6v3.4c0 1.16 1.97 2.1 4.4 2.1s4.4-.94 4.4-2.1V8.6"></path><ellipse cx="9.2" cy="14.4" rx="4.4" ry="2.1"></ellipse><path d="M4.8 14.4v3.4c0 1.16 1.97 2.1 4.4 2.1s4.4-.94 4.4-2.1v-3.4"></path>'],
    Pools: ['#38bdf8', '<path d="M12 3.4l3.9 4.7a5.1 5.1 0 1 1-7.8 0z"></path><ellipse cx="12" cy="17.6" rx="7.4" ry="2.5"></ellipse><path d="M8.6 15.9c.9.5 2.1.8 3.4.8s2.5-.3 3.4-.8"></path>'],
    Trades: ['#a855f7', '<path d="M4.8 9.2h13.6M15.4 6.2l3 3-3 3"></path><path d="M19.2 14.8H5.6M8.6 11.8l-3 3 3 3"></path>'],
    Transactions: ['#2dd4bf', '<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M8 10h8M8 14h5"></path>']
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
  var ST = { assets: null, pools: null, trades: null, txns: null };
  function paintStats() {
    var row = $('.status-row');
    if (!row) return;
    var net = row.querySelector('.lx-netcard');
    $$('.status-pill', row).forEach(function (p) { if (p !== net && p.parentNode) p.parentNode.removeChild(p); });
    row.appendChild(pill('Assets', ST.assets == null ? '…' : count(ST.assets), 'Tokens listed on LumosCore for NEAR (the curated Trade list)'));
    row.appendChild(pill('Pools', ST.pools == null ? '…' : count(ST.pools), 'Curated Rhea Finance liquidity pools on NEAR'));
    row.appendChild(pill('Trades', ST.trades == null ? '…' : count(ST.trades), 'Trades in the past 24 hours on the main market of every listed NEAR token'));
    row.appendChild(pill('Transactions', ST.txns == null ? '…' : compact(ST.txns),
      (ST.txns != null ? count(ST.txns) + ' — ' : '') + 'every transaction ever made on NEAR, a running total rather than a daily figure'));
    // The orphaned Stellar sheet holds `.status-row{opacity:0}` until its script raised it; that script is
    // gone, so the row is raised here -- and only once all four figures have answered (or failed to), so
    // the strip appears once, complete, rather than as "…" pills that change one by one. reveal() below is
    // the safety net if an answer never comes.
    if (ST.assets != null && ST.pools != null && ST.trades != null && ST.txns != null) reveal();
  }
  function reveal() {
    var row = $('.status-row');
    if (!row) return;
    row.classList.add('lx-ready');
    row.style.setProperty('opacity', '1', 'important');
  }
  setTimeout(reveal, 8000);

  function txTotal() {
    try {
      var c = JSON.parse(localStorage.getItem('lxn.neartxns') || 'null');
      if (c && c.v > 0 && Date.now() - c.t < 1800000) return Promise.resolve(c.v);
    } catch (e) {}
    return j('https://api.nearblocks.io/v1/stats').then(function (d) {
      var v = +(((d && d.stats) || [])[0] || {}).total_txns;
      if (!(v > 0)) return null;
      try { localStorage.setItem('lxn.neartxns', JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
      return v;
    }).catch(function () { return null; });
  }

  // ---- the product boxes -------------------------------------------------------------------------------
  function box(k, v) {
    $$('.lx-dbx-v[data-k="' + k + '"]').forEach(function (el) {
      el.textContent = v;
      el.classList.remove('wait');
    });
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

  // ---- the Quick actions row -------------------------------------------------------------------------------
  // lx-dashqa (inherited, patched by _neardash.js) routes the cards. Nothing here.

  function load() {
    activityEmpty();
    paintStats();
    ['cnet', 'casset', 'cvia', 'ltok', 'lnew', 'lmint'].forEach(function (k) { box(k, '—'); });

    market().then(function (d) {
      if (!d) {
        ['tvol', 'tliq', 'tmkt'].forEach(function (k) { box(k, '—'); });
        ST.assets = NaN; ST.trades = NaN;
        paintStats();
        return;
      }
      var vol = 0, liq = 0, trades = 0;
      d.rows.forEach(function (r) { vol += +r.v || 0; liq += +r.t || 0; trades += +r.x || 0; });
      ST.assets = d.rows.length;
      ST.trades = trades;
      paintStats();
      box('tvol', usd(vol * d.usd));
      box('tliq', usd(liq * d.usd));
      box('tmkt', count(d.rows.length));
    });
    j('/lxapi/nearpools').then(function (p) {
      var s = (p && p.ok && p.summary) || null;
      if (!s || !(p.usd > 0)) throw new Error('no pools');
      ST.pools = s.pools;
      paintStats();
      box('ppool', count(s.pools));
      box('ptvl', usd(s.liquidity * p.usd));
      box('pvol', usd(s.vol24 * p.usd));
    }).catch(function () {
      ST.pools = NaN; paintStats();
      ['ppool', 'ptvl', 'pvol'].forEach(function (k) { box(k, '—'); });
    });
    txTotal().then(function (v) { ST.txns = v == null ? NaN : v; paintStats(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
