// Pools -> My Pools on NEAR: the design's empty state until NEAR liquidity positions can be read.
//
// Ported from the XRPL fork's browser/mypositions.js, keeping only the parts that handle the DESIGN --
// host() for both builds, setCount() on the tab's own badge, reveal() past the fade-in gate, note() in the
// design's own panel -- and none of the ledger reads.
//
// WHAT WAS THERE: the design's mock, presented as yours -- "LUMOS / APT  1,842 APT ~$772  0.054%
// +12.40 APT  May 14, 2026" and a second row, with the tab counting "2". Stellar's lx-ammdata replaced it
// with STELLAR positions read from Horizon for a G... address; that layer is stripped from this build
// (_nearpools.js), so without this file the invented positions would stand.
//
// WHY NOT READ THEM: Rhea keeps LP shares per pool in its contract (get_pool_shares), with no call that
// lists an account's pools, so reading them means one view call per listed pool for every visitor -- and
// adding or removing liquidity on NEAR is not built yet. Until it is, the panel says so: signed out it asks
// for a wallet (the design's own wording on every chain), signed in it says positions are coming. The
// count is a dash when connected, because "0" would claim the account holds nothing.
(function () {
  if (window.__lxnMyPos) return;
  window.__lxnMyPos = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // The NEAR session as lx-nearconnect states it: an account only when lumos.chain is near, so a
  // Stellar G... address left in storage by another build never reads as connected here.
  function addr() {
    try { if (window.lxn && window.lxn.account) return window.lxn.account() || ''; } catch (e) {}
    try { return localStorage.getItem('lumos.chain') === 'near' ? (localStorage.getItem('lumos.address') || '') : ''; } catch (e) { return ''; }
  }

  // Desktop is a table inside #panelMyPositions; the phone is a list of .pool-card anchors in #panelMine.
  function host() {
    var d = $('#panelMyPositions');
    var tb = d && d.querySelector('tbody');
    if (tb) return { node: tb, kind: 'table' };
    var m = $('#panelMine');
    if (m) return { node: m, kind: 'cards' };
    return null;
  }

  // The count on the My Pools tab, found by ITS OWN tab rather than by position. .lx-snapd is the
  // inherited sheet's marker that a real figure is in the cell -- without it the count stays hidden.
  function setCount(n) {
    var btn = $$('#poolTabs button, #poolTabs [data-tab]').filter(function (b) {
      return /position|my pools/i.test(b.textContent || '') || b.getAttribute('data-tab') === 'mine';
    })[0];
    var c = btn && btn.querySelector('.count');
    if (!c) return;
    c.textContent = String(n);
    c.setAttribute('data-logoed', '1');
    c.classList.add('lx-snapd');
  }

  // The panel sits behind the design's fade-in gate at opacity 0; released whenever this writes to it.
  function reveal() {
    var pn = $('#panelMyPositions');
    if (!pn) return;
    pn.setAttribute('data-lcm-done', '1');
    pn.classList.add('lcm-on');
    pn.classList.add('lcmu-in');
    pn.style.setProperty('opacity', '1', 'important');
    pn.style.setProperty('transform', 'none', 'important');
  }

  function note(msg) {
    var h = host(); if (!h) return;
    reveal();
    if (h.node.getAttribute('data-lxnote') === msg) return;      // already says it; no repaint
    h.node.setAttribute('data-lxnote', msg);
    h.node.innerHTML = '';
    if (h.kind === 'cards') {
      var d = el('div', null, msg);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
      return;
    }
    var tr = document.createElement('tr');
    var td = el('td', null, msg);
    td.colSpan = 7;
    td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
    tr.appendChild(td); h.node.appendChild(tr);
  }

  function load() {
    if (!host()) return;                                 // not a page with a positions list
    if ($('.lumos-hero-row')) return;                    // the $LUMOS page's table is not this list
    if (!addr()) {
      note('Connect a wallet to see your liquidity positions.');
      setCount(0);
      return;
    }
    note('Liquidity positions on NEAR are coming soon.');
    setCount('—');
  }

  // Re-said when the tab opens (the design's tab script toggles the panel) and when the wallet changes.
  window.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#poolTabs [data-tab="mine"], [data-tab="mine"]');
    if (!t) return;
    setTimeout(load, 60);
  }, true);
  window.addEventListener('storage', function (e) { if (e && e.key === 'lumos.address') load(); });
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) load(); });
  try { if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { setTimeout(load, 300); }); } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxnMyPosReload = load;
})();
