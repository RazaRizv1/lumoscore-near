// Pools -> My Pools on NEAR: the connected account's liquidity positions, read from the chain.
//
// Ported from the XRPL fork's browser/mypositions.js: host() for both builds, setCount() on the tab's own badge,
// reveal() past the fade-in gate, note() in the design's own panel, and Stellar's row (read off lumoscore.com's
// DOM there) -- # / pair / your liquidity / pool share / "View position".
//
// WHAT WAS THERE: the design's mock, presented as yours ("LUMOS / APT 1,842 APT ..."), then from 2026-10 a
// "coming soon" note. RAZA 2026-11-04: "Im connected with treasury, so why on pools main page, its not showing
// my pools. i do have a pool now". The positions are found by lxnCore.positions (nearcore.js), the same reader
// the account page uses: Rhea cannot list an account's pools, so candidates come from its deposits, its farm
// stakes and LumosCore's pool indexer, and every figure is the pool's own (get_pool_shares / the reserves).
//
// Fees Earned and Deposited are removed as on Stellar and XRPL: Rhea records neither per provider.
(function () {
  if (window.__lxnMyPos) return;
  window.__lxnMyPos = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var NEAR_LOGO = '/assets/networks/near.png';

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

  // Same URL as the All Pools rows (pools.js poolHref).
  function poolHref(id, syms) {
    var slug = (syms || []).map(function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); })
      .filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '');
    return '/pools/near/' + (slug || 'pool') + '/' + encodeURIComponent(id);
  }

  function fmt(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v > 0 && v < 0.0001) return '<0.0001';
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  function pctTxt(f) { var p = f * 100; return p > 0 && p < 0.01 ? '<0.01%' : p.toFixed(2) + '%'; }

  // A token disc: the market's logo, NEAR's mark for wNEAR, else initials. Logos are only ever an <img> src.
  function logo(cls, id, sym, logos) {
    var src = id === 'wrap.near' ? NEAR_LOGO : (logos[id] || '');
    var d = el('span', 'lxx-ic ' + cls);
    d.setAttribute('data-logoed', '1');
    d.style.cssText = 'display:inline-flex;width:32px;height:32px;flex:0 0 32px;border-radius:50%;overflow:hidden;align-items:center;'
      + 'justify-content:center;background:rgba(255,255,255,.12);color:#fff;font-size:12px;font-weight:800';
    if (/^(data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]|https:\/\/|\/assets\/)/i.test(src)) {
      var img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      img.onerror = function () { d.textContent = String(sym || '?').slice(0, 1).toUpperCase(); };
      img.src = src;
      d.appendChild(img);
    } else d.textContent = String(sym || '?').slice(0, 1).toUpperCase();
    return d;
  }

  function row(i, p, logos) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxmypool', p.href);
    tr.style.cursor = 'pointer';
    tr.appendChild(el('td', 'idx', (i + 1 < 10 ? '0' : '') + (i + 1)));
    var pc = el('td'), cell = el('div', 'pair-cell'), icons = el('div', 'pair-icons');
    icons.appendChild(logo('pa', p.ids[0], p.syms[0], logos));
    icons.appendChild(logo('pb', p.ids[1], p.syms[1], logos));
    cell.appendChild(icons);
    var meta = el('div');
    meta.appendChild(el('div', 'pair-name', p.syms.join(' / ')));
    cell.appendChild(meta);
    pc.appendChild(cell);
    tr.appendChild(pc);
    var liq = el('td');
    p.mine.forEach(function (v, k) { liq.appendChild(el('div', k ? 'pair-sub' : null, fmt(v) + ' ' + p.syms[k])); });
    tr.appendChild(liq);
    tr.appendChild(el('td', null, pctTxt(p.fraction)));
    var act = el('td', 'lx-viewcell'), a = document.createElement('a');
    a.href = p.href; a.className = 'lx-ammview'; a.textContent = 'View position →';
    act.appendChild(a);
    tr.appendChild(act);
    return tr;
  }

  // The phone's card for one position, in the design's own shape.
  function card(i, p, logos) {
    var a = el('a', 'pool-card my-pos');
    a.href = p.href;
    var head = el('div', 'pc-head'), icons = el('div', 'pair-icons');
    icons.appendChild(logo('a', p.ids[0], p.syms[0], logos));
    icons.appendChild(logo('b', p.ids[1], p.syms[1], logos));
    head.appendChild(icons);
    var info = el('div', 'pc-info');
    info.appendChild(el('div', 'pc-name', p.syms.join(' / ')));
    info.appendChild(el('div', 'pc-sub', 'Pool #' + p.id + (p.farm ? ' · farming' : '')));
    head.appendChild(info);
    a.appendChild(head);
    var stats = el('div', 'pc-stats');
    function stat(label, v, sub) {
      var s = el('div', 'pc-stat');
      s.appendChild(el('div', 'l', label));
      s.appendChild(el('div', 'v', v));
      if (sub != null) s.appendChild(el('div', 'vs', sub));
      return s;
    }
    stats.appendChild(stat('Your liquidity', fmt(p.mine[0]) + ' ' + p.syms[0], p.mine.length > 1 ? fmt(p.mine[1]) + ' ' + p.syms[1] : null));
    stats.appendChild(stat('Pool share', pctTxt(p.fraction)));
    a.appendChild(stats);
    var foot = el('div', 'pc-pos-row'), l = el('span', null, 'Tap to manage position');
    l.style.cssText = 'font-size:11.5px;color:var(--text-soft);font-weight:600';
    foot.appendChild(l);
    foot.appendChild(el('span', 'view-arrow', 'VIEW →'));
    a.appendChild(foot);
    return a;
  }

  // Stellar's My Pools stylesheet is scoped to #lx-mypanel; giving the panel that ancestor applies all of it
  // (the XRPL fork's finding, 2026-10-06). Nothing reads the id; it is a CSS hook only.
  function stellarPanelHook() {
    if (document.getElementById('lx-mypanel')) return;
    var p = document.getElementById('panelMyPositions');
    if (!p || !p.parentNode) return;
    var w = document.createElement('div');
    w.id = 'lx-mypanel';
    p.parentNode.insertBefore(w, p);
    w.appendChild(p);
  }

  var seq = 0;
  function load() {
    if (!host()) return;                                 // not a page with a positions list
    if ($('.lumos-hero-row')) return;                    // the $LUMOS page's table is not this list
    var me = addr();
    // The wallet restores a moment after the page does: wait ~5s for it before saying there is none.
    if (!me) {
      if ((load.waits = (load.waits || 0) + 1) < 12) { setTimeout(load, 400); return; }
      note('Connect a wallet to see your liquidity positions.');
      setCount(0);
      return;
    }
    load.waits = 0;
    var C = window.lxnCore;
    if (!C || !C.positions) { note('Could not read your positions — try again in a minute.'); setCount('—'); return; }
    var mySeq = ++seq;
    var h0 = host();
    if (!h0.node.querySelector('[data-lxmypool], a.my-pos')) note('Reading your positions…');
    Promise.all([C.positions(me), C.market().catch(function () { return null; })]).then(function (r) {
      if (mySeq !== seq) return;
      var res = r[0], logos = {};
      ((r[1] && r[1].rows) || []).forEach(function (t) { if (t && t.i && t.logo) logos[t.i] = t.logo; });
      if (!res.rows.length) {
        note(res.failed ? 'Could not read your positions — try again in a minute.' : 'No liquidity positions on this account.');
        setCount(res.failed ? '—' : 0);
        return;
      }
      // Each side's amount: the pool's reserve, in the token's own decimals, times this account's fraction.
      return Promise.all(res.rows.map(function (p) {
        return Promise.all(p.ids.map(function (t) { return C.tokenMeta(t).catch(function () { return null; }); })).then(function (ms) {
          p.mine = p.ids.map(function (t, k) {
            var m = ms[k];
            return m && m.d != null ? C.units(p.amounts[k], m.d) * p.fraction : null;
          });
          p.href = poolHref(p.id, p.syms);
          return p;
        });
      })).then(function (pos) {
        if (mySeq !== seq) return;
        var h = host(); if (!h) return;
        h.node.removeAttribute('data-lxnote');
        h.node.innerHTML = '';
        if (h.kind === 'table') {
          var tbl = h.node.closest && h.node.closest('table');
          // "Actions" is emptied, not removed: Stellar's header is five cells, the last blank over the button.
          if (tbl) $$('thead th', tbl).forEach(function (th) {
            var t = th.textContent || '';
            if (/fees earned|deposited/i.test(t) && th.parentNode) { th.parentNode.removeChild(th); return; }
            if (/actions/i.test(t)) { th.textContent = ''; th.removeAttribute('style'); }
          });
          stellarPanelHook();
        }
        var make = h.kind === 'table' ? row : card;
        pos.forEach(function (p, i) { h.node.appendChild(make(i, p, logos)); });
        reveal();
        setCount(pos.length);
      });
    }).catch(function () {
      if (mySeq !== seq) return;
      note('Could not read your positions — try again in a minute.');
      setCount('—');
    });
  }

  // A position row opens its pool; taken before the design's row handler, which switched tabs instead.
  window.addEventListener('click', function (e) {
    var tr = e.target && e.target.closest && e.target.closest('#panelMyPositions tr[data-lxmypool]');
    if (!tr) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.location.href = tr.getAttribute('data-lxmypool');
  }, true);
  // Re-read when the tab opens without our rows (the design's tab script toggles the panel) and when the wallet changes.
  window.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#poolTabs [data-tab="mine"], [data-tab="mine"]');
    if (!t) return;
    setTimeout(function () {
      reveal();
      var h = host();
      if (!h || !h.node.querySelector('[data-lxmypool], a.my-pos')) load();
    }, 60);
  }, true);
  window.addEventListener('storage', function (e) { if (e && e.key === 'lumos.address') load(); });
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) { load.waits = 0; load(); } });
  try { if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { setTimeout(load, 300); }); } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxnMyPosReload = load;
})();
