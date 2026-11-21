// The Rewards page on NEAR (/rewards/near). PORTED FROM the XRPL fork's browser/rewards.js (its precedent: strip
// Stellar's lx-rewardsdata, read eligibility off the chain, leave the report honestly empty).
//
// RAZA 2026-11-12, ticket 368: "rewards on near will start from 1st Dec, not 15th Nov", the page said "Connect your
// Stellar wallet" and its round reports carried Stellar addresses and figures. _tools/_nearrewards.js fixes the
// static copy (the countdown's first date, the descriptions, the FAQ, the distributed bars); this file does what
// needs the chain or the connected account:
//   * WHAT YOU QUALIFY FOR, exactly as Stellar's lx-rewardsdata (RAZA 2026-11-12: "make it exactly like Stellar"; the
//     amounts are Stellar's, confirmed): skeleton bars, then each programme's "~N" estimate and "Your estimated total
//     this round". Native = 1,000,000 x the account's share of LUMOS/wNEAR pool 9001; Ecosystem = 100,000 x its share
//     of each LUMOS pool paired with one of the ten; Whale = 1,000,000 x its 5M-shares over every holder's, LumosCore's
//     own wallets and the two exchange contracts left out of both (Stellar's EXCLUDE). An excluded wallet still sees its
//     rows (RAZA: no "This is a LumosCore wallet" card) but holds no shares and is estimated nothing.
//   * ROUND REPORTS: no round has run on NEAR, so the table says so. The design's own report script draws sample
//     rows (generated G-addresses) whenever a tab, the network button or the round menu changes; those controls are
//     claimed first and repaint this state instead, and the CSV and on-chain-record buttons, which would describe
//     the sample, are hidden.
// EVERY WALLET GETS THE THREE ROWS (RAZA 2026-11-12): the 'This is a LumosCore wallet' card that replaced them for
// treasury/fees accounts is gone; the rows show holdings only, never a payout, so nothing is promised to a team wallet.
(function () {
  if (window.__lxnRewards) return;
  window.__lxnRewards = 1;

  var LUMOS = 'lumos.lumoscore.near', POOL = 9001, REF = 'v2.ref-finance.near';
  var START = new Date(2026, 11, 1);                       // the first round on NEAR, as RAZA set it
  var WHALE_UNIT = 5e6, WHALE_POOL = 1000000, NATIVE_POOL = 1000000, ECO_PER_POOL = 100000;   // Stellar's terms
  // Never paid and never in a denominator: the treasury, the fee account, and the two exchange contracts, whose LUMOS
  // is the pools' and the order book's (the LUMOS page's list). And our own wallets (RAZA 2026-11-21, admin review D02).
  var EXCLUDE = { 'treasury.lumoscore.near': 1, 'fees-lumoscore.near': 1, 'dclv2.ref-labs.near': 1, 'v2.ref-finance.near': 1,
    'lumoscore.near': 1, 'razarizv1.near': 1, 'lumos01.near': 1, 'lumoscore-near-testing.near': 1 };
  // The ten Ecosystem assets (RAZA, ticket 270; the LUMOS page's list): contract -> ticker.
  var ECO = { '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': 'USDC', 'usdt.tether-token.near': 'USDt',
    'qtc.omft.near': 'QTC', 'zec.omft.near': 'ZEC', 'batman-4.nearlytrade.near': 'BATMAN', 'token.rhealab.near': 'RHEA',
    'nearly-993927.nearlytrade.near': 'NEARLY', 'hoot-8ecf65.launchpad.justhoot.near': 'HOOT', 'lst.rhealab.near': 'rNEAR',
    'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near': 'USDT.e' };
  var NEAR_LOGO = '/assets/networks/near.png';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function me() {
    try { if (window.lxn && window.lxn.account) return window.lxn.account() || ''; } catch (e) {}
    return '';
  }
  function whole(v) { v = +v || 0; return v >= 1 ? Math.floor(v).toLocaleString('en-US') : String(Math.floor(v * 1e4) / 1e4); }
  function pc(x) { var q = (+x || 0) * 100; return (q >= 1 ? q.toFixed(1) : (q >= 0.01 ? q.toFixed(2) : q.toFixed(3))) + '%'; }
  function started() { return Date.now() >= START.getTime(); }
  var WHEN = 'Rounds on NEAR begin on 1 December 2026';

  // ---- what you qualify for ---------------------------------------------------------------------------
  // #eligBox:not(.lxrw) is held hidden by the inherited sheet; .lxrw lifts it once this has written.
  function box(title, sub) {
    var b = $('#eligBox');
    if (!b) return;
    b.__lxk = '';
    b.classList.add('lxrw');
    b.innerHTML = '';
    var w = el('div', 'lxrw-empty');
    w.appendChild(el('div', 't', title));
    if (sub) w.appendChild(el('div', 's', sub));
    b.appendChild(w);
  }
  function erBox(rows) {
    var b = $('#eligBox');
    if (!b) return;
    var key = JSON.stringify(rows);
    if (b.__lxk === key && b.querySelector('.er')) return;   // same rows already up: no repaint
    b.__lxk = key;
    b.classList.add('lxrw');
    b.innerHTML = '';
    rows.forEach(function (r) {
      var er = el('div', 'er' + (r[4] ? ' tot' : ''));
      var ek = el('div', 'ek');
      if (r[0]) { var dot = el('span', 'd'); dot.style.background = r[0]; ek.appendChild(dot); }
      var w = el('div');
      w.appendChild(el('div', 't', r[1]));
      if (r[2] === null) { var sb = el('div', 's'); sb.appendChild(el('span', 'lxrw-bar')); w.appendChild(sb); }
      else if (r[2]) w.appendChild(el('div', 's', r[2]));
      ek.appendChild(w);
      er.appendChild(ek);
      var ev = el('div', 'ev mono', r[3] == null ? '' : r[3]);
      if (r[3] == null) ev.appendChild(el('span', 'lxrw-bar'));
      er.appendChild(ev);
      b.appendChild(er);
    });
  }
  var asked = '', shown = '';
  // NO FLASH ON A RE-CHECK (RAZA 2026-11-12): the 1.5s safety re-read used to repaint 'Reading NEAR…' over rows
  // already on screen. Rows painted for this same account stay up while it re-reads, and through a failed re-read.
  function showing(a) { return shown === a && !!$('#eligBox .er'); }
  function num(n) { return Math.round(+n || 0).toLocaleString('en-US'); }
  function getJSON(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  // Every holder's whale shares, the exclusions left out. Kept once read (Stellar's __lxWhaleTS); a failure is never
  // kept, and a list that may be cut short (100 rows, the last still 5M+) is not a total: null, shown as "—".
  var WTS;
  function whaleTotal() {
    if (WTS !== undefined) return Promise.resolve(WTS);
    return getJSON('/lxapi/nearholders?i=' + encodeURIComponent(LUMOS)).then(function (j) {
      if (!j || !j.ok || !j.holders) return null;
      var C = window.lxnCore, t = 0, hs = j.holders, last = 0;
      hs.forEach(function (h) {
        var v = C.units(h.raw || '0', 18); last = v;
        if (!EXCLUDE[h.a] && v >= WHALE_UNIT) t += Math.floor(v / WHALE_UNIT);
      });
      WTS = (hs.length >= 100 && last >= WHALE_UNIT) ? null : t;
      return WTS;
    });
  }
  // B09 (2026-11-21): the shares the EXCLUDE accounts hold in a pool -- left out of the denominator, as the admin round
  // does, so a real provider's estimate matches the payout. Kept per pool; a failed read is never kept and counts as 0.
  var EXSH = {};
  function exclShares(id) {
    if (EXSH[id]) return EXSH[id];
    var C = window.lxnCore;
    var p = Promise.all(Object.keys(EXCLUDE).map(function (a) {
      return C.callView(REF, 'get_pool_shares', { pool_id: id, account_id: a }).then(function (v) { return Number(v || '0'); }, function () { return null; });
    })).then(function (xs) {
      if (xs.some(function (x) { return x === null; })) { delete EXSH[id]; return 0; }
      return xs.reduce(function (s, x) { return s + x; }, 0);
    });
    EXSH[id] = p;
    return p;
  }
  // The account's Ecosystem positions: LUMOS pools paired with one of the ten, and its share of each.
  // Null when the pools could not be read (then the row and the total say "—", never "not in any pool").
  function ecoMine(a) {
    var C = window.lxnCore;
    return getJSON('/lxapi/nearpools?q=' + encodeURIComponent(LUMOS) + '&full=1').then(function (j) {
      if (!j || !j.ok) return null;
      var ps = (j.rows || []).filter(function (r) {
        var ts = r.tokens || [];
        return ts.length === 2 && ts.some(function (t) { return t.i === LUMOS; }) && ts.some(function (t) { return ECO[t.i]; });
      });
      return Promise.all(ps.map(function (r) {
        var o = r.tokens.filter(function (t) { return t.i !== LUMOS; })[0];
        return Promise.all([C.callView(REF, 'get_pool_shares', { pool_id: +r.id, account_id: a }), C.callView(REF, 'get_pool', { pool_id: +r.id }), exclShares(+r.id)])
          .then(function (x) {
            var mine = Number(x[0] || '0'), tot = Math.max(0, Number((x[1] && x[1].shares_total_supply) || '0') - (x[2] || 0));
            return mine > 0 && tot > 0 ? { code: ECO[o.i], share: mine / tot } : null;
          });
      })).then(function (xs) { return xs.filter(Boolean); });
    }).catch(function () { return null; });
  }
  function eligibility() {
    var a = me(), C = window.lxnCore;
    if (!a) { asked = ''; shown = ''; box('Connect your NEAR wallet', 'See your live LUMOS balance and pool positions, and what you would earn this round.'); return; }
    if (a === asked) return;
    asked = a;
    if (!C) { asked = ''; box('Could not read your NEAR account right now', 'Reload the page to try again.'); return; }
    if (!showing(a)) erBox([['var(--accent)', 'Native LP Rewards', null, null], ['var(--blue)', 'Ecosystem LP Rewards', null, null],
      ['var(--green)', 'Whale Holder Rewards', null, null], ['', 'Your estimated total this round', '', null, true]]);
    var excl = !!EXCLUDE[a];
    Promise.all([
      C.callView(LUMOS, 'ft_balance_of', { account_id: a }),
      C.callView(REF, 'get_pool_shares', { pool_id: POOL, account_id: a }),
      C.callView(REF, 'get_pool', { pool_id: POOL }),
      ecoMine(a),
      exclShares(POOL)
    ]).then(function (r) {
      if (me() !== a) return;
      var lumos = C.units(r[0] || '0', 18);
      var mine = Number(r[1] || '0'), total = Math.max(0, Number((r[2] && r[2].shares_total_supply) || '0') - (r[4] || 0));
      var nShare = total > 0 ? mine / total : 0, nReward = excl ? 0 : NATIVE_POOL * nShare;
      var eco = r[3], eReward = 0;
      (eco || []).forEach(function (x) { eReward += excl ? 0 : ECO_PER_POOL * x.share; });
      var myShares = excl ? 0 : (lumos >= WHALE_UNIT ? Math.floor(lumos / WHALE_UNIT) : 0);
      var nSub = mine > 0 ? ('LUMOS/wNEAR · ' + pc(nShare) + ' of the pool') : 'Add LUMOS/wNEAR liquidity to qualify';
      var nVal = mine > 0 && !excl ? '~' + num(nReward) : '—';
      var codes = (eco || []).map(function (x) { return x.code; });
      var eSub = eco == null ? 'Could not read the Ecosystem pools right now'
        : codes.length ? (codes.length === 1 ? 'LUMOS/' + codes[0] + ' pool' : codes.length + ' pools · ' + codes.slice(0, 3).join(', ') + (codes.length > 3 ? '…' : ''))
        : 'Join an eligible LUMOS pool to qualify';
      var eVal = codes.length && !excl ? '~' + num(eReward) : '—';
      var wSub = excl ? (lumos > 0 ? whole(lumos) + ' LUMOS · ' : '') + 'LumosCore wallet, no shares'
        : myShares > 0 ? whole(lumos) + ' LUMOS · ' + myShares + ' share' + (myShares > 1 ? 's' : '')
        : (lumos > 0 ? whole(lumos) + ' LUMOS · below 5M' : 'Hold 5M+ LUMOS to qualify');
      function render(wReward, pending) {
        var wVal = myShares > 0 ? (pending ? '~…' : (wReward == null ? '—' : '~' + num(wReward))) : '—';
        var unknown = eco == null || (myShares > 0 && wReward == null && !pending);
        var tVal = pending ? '~… LUMOS' : unknown ? '—' : '~' + num(nReward + eReward + (wReward || 0)) + ' LUMOS';
        shown = a;
        erBox([
          ['var(--accent)', 'Native LP Rewards', nSub, nVal],
          ['var(--blue)', 'Ecosystem LP Rewards', eSub, eVal],
          ['var(--green)', 'Whale Holder Rewards', wSub, wVal],
          ['', 'Your estimated total this round', '', tVal, true]
        ]);
      }
      if (myShares <= 0) { render(0, false); return; }
      // A re-check with the total already read goes straight to the figures: no "~…" flash.
      if (WTS === undefined) render(0, true);
      whaleTotal().then(function (ts) {
        if (me() !== a) return;
        render(ts == null ? null : (ts > 0 ? WHALE_POOL * Math.min(1, myShares / ts) : 0), false);
      });
    }, function () {
      if (me() !== a) return;
      asked = '';
      if (showing(a)) return;
      box('Could not read your NEAR account right now', 'NEAR did not answer. Reload the page to try again.');
    });
  }

  // ---- round reports -----------------------------------------------------------------------------------
  function report() {
    var rows = $('#repRows');
    if (!rows) return;
    rows.innerHTML = '';
    var r = el('div', 'rr');
    r.style.cssText = 'justify-content:center;opacity:.7;padding:22px 8px;text-align:center';
    r.textContent = 'No distribution has run on NEAR yet. Recipients will be listed here once the first round, on 1 December 2026, has run.';
    rows.appendChild(r);
    var c = $('#repCount');
    if (c) {
      c.textContent = '0';
      var shown = c.previousElementSibling;
      if (shown && shown.tagName === 'B' && shown.textContent !== '0') shown.textContent = '0';
    }
    var t = $('#repTitle'); if (t) t.textContent = 'No rounds yet';
    var s = $('#repSub'); if (s) s.textContent = 'NEAR’s first round is 1 December 2026.';
    var p = $('#psum'); if (p) p.textContent = 'Native LP · Ecosystem · Whale Holder';
    // The sample's CSV and its on-chain record describe rounds that never ran on NEAR.
    ['#csvBtn', '#soroBtn'].forEach(function (sel) { var b = $(sel); if (b) b.style.display = 'none'; });
    var sel = $('#roundSel');
    if (sel && !sel.__lxn) {
      sel.__lxn = 1;
      sel.innerHTML = '';
      var o = document.createElement('option');
      o.value = '';
      o.textContent = 'No rounds yet';
      sel.appendChild(o);
      sel.disabled = true;
    }
    // The network button carried Stellar's name and mark.
    var ns = $('#netseg .ns');
    if (ns && ns.getAttribute('data-lxn') !== '1') {
      ns.setAttribute('data-lxn', '1');
      ns.setAttribute('data-logoed', '1');
      var img = ns.querySelector('img');
      if (img) img.src = NEAR_LOGO;
      [].forEach.call(ns.childNodes, function (n) { if (n.nodeType === 3 && n.nodeValue.trim()) n.nodeValue = 'NEAR'; });
    }
  }
  // Ahead of the design's own handlers, which redraw the sample report: the tabs still switch, the table stays honest.
  function claimControls() {
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var pt = t.closest('#ptabs .pt');
      if (pt) {
        e.preventDefault(); e.stopImmediatePropagation();
        [].forEach.call(pt.parentNode.querySelectorAll('.pt'), function (c) { c.classList.toggle('active', c === pt); });
        report();
        return;
      }
      if (t.closest('#netseg .ns, #csvBtn, #soroBtn, #moCsv')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'roundSel') { e.stopImmediatePropagation(); report(); }
    }, true);
  }

  function load() {
    if (!$('#eligBox') && !$('#repRows')) return;            // not the Rewards page
    claimControls();
    report();
    eligibility();
    // The design's own script writes its sample into these after DOMContentLoaded; ours goes back on top.
    setTimeout(report, 0);
    setTimeout(report, 1200);
    setTimeout(function () { asked = ''; eligibility(); }, 1500);
    window.addEventListener('storage', function (e) { if (e && e.key === 'lumos.address') { asked = ''; eligibility(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
