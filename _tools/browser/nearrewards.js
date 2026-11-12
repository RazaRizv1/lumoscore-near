// The Rewards page on NEAR (/rewards/near). PORTED FROM the XRPL fork's browser/rewards.js (its precedent: strip
// Stellar's lx-rewardsdata, read eligibility off the chain, leave the report honestly empty).
//
// RAZA 2026-11-12, ticket 368: "rewards on near will start from 1st Dec, not 15th Nov", the page said "Connect your
// Stellar wallet" and its round reports carried Stellar addresses and figures. _tools/_nearrewards.js fixes the
// static copy (the countdown's first date, the descriptions, the FAQ, the distributed bars); this file does what
// needs the chain or the connected account:
//   * WHAT YOU QUALIFY FOR, read from NEAR: the LUMOS the account holds (lumos.lumoscore.near) and its share of
//     LUMOS/wNEAR pool 9001, the pool the Native LP programme names on NEAR. NO PAYOUT ESTIMATE: what each programme
//     pays per round on NEAR is not recorded anywhere in this repo, so a "~1,234 LUMOS" here would be invented. Each
//     row says what the account has and that rounds begin on 1 December 2026.
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
    b.classList.add('lxrw');
    b.innerHTML = '';
    rows.forEach(function (r) {
      var er = el('div', 'er' + (r[4] ? ' tot' : ''));
      var ek = el('div', 'ek');
      if (r[0]) { var dot = el('span', 'd'); dot.style.background = r[0]; ek.appendChild(dot); }
      var w = el('div');
      w.appendChild(el('div', 't', r[1]));
      if (r[2]) w.appendChild(el('div', 's', r[2]));
      ek.appendChild(w);
      er.appendChild(ek);
      er.appendChild(el('div', 'ev mono', r[3]));
      b.appendChild(er);
    });
  }
  var asked = '';
  function eligibility() {
    var a = me(), C = window.lxnCore;
    if (!a) { asked = ''; box('Connect your NEAR wallet', 'See your LUMOS balance and pool position on NEAR. ' + WHEN + '.'); return; }
    if (a === asked) return;
    asked = a;
    if (!C) { asked = ''; box('Could not read your NEAR account right now', 'Reload the page to try again.'); return; }
    box('Reading NEAR…', 'Checking your LUMOS balance and pool position.');
    Promise.all([
      C.callView(LUMOS, 'ft_balance_of', { account_id: a }),
      C.callView(REF, 'get_pool_shares', { pool_id: POOL, account_id: a }),
      C.callView(REF, 'get_pool', { pool_id: POOL })
    ]).then(function (r) {
      if (me() !== a) return;
      var lumos = C.units(r[0] || '0', 18);
      var mine = Number(r[1] || '0'), total = Number((r[2] && r[2].shares_total_supply) || '0');
      var share = total > 0 ? mine / total : 0;
      var shares = Math.floor(lumos / 5e6);
      var tail = started() ? '' : ' · from 1 December 2026';
      erBox([
        ['var(--accent)', 'Native LP Rewards', mine > 0 ? ('LUMOS/wNEAR · ' + pc(share) + ' of the pool' + tail) : 'Add LUMOS/wNEAR liquidity to qualify', '—'],
        ['var(--blue)', 'Ecosystem LP Rewards', 'Join an eligible LUMOS pool to qualify' + tail, '—'],
        ['var(--green)', 'Whale Holder Rewards', shares > 0 ? (whole(lumos) + ' LUMOS · ' + shares + ' share' + (shares > 1 ? 's' : '') + tail)
          : (lumos > 0 ? whole(lumos) + ' LUMOS · below 5M' : 'Hold 5M+ LUMOS to qualify'), '—'],
        ['', started() ? 'Your estimated total this round' : WHEN, '', '—', true]
      ]);
    }, function () {
      if (me() !== a) return;
      asked = '';
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
