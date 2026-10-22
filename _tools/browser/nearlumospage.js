// The LUMOS token page reached under /lumos/near. LUMOS is not minted on NEAR yet (RAZA 2026-10-22: "we will do
// that before release"), so the page can only show LUMOS ON STELLAR, and must say so. The inherited page did
// not: the chain engine reskinned the chart legend to "LUMOS (NEAR)" and the price meta to "≈ … NEAR" (a
// Stellar figure in XLM, never updated because lx-ltdata only fills it while it reads "XLM").
//
// Ported from the Hedera fork's browser/hederalumospage.js (the sibling chain, same situation). This layer:
//   * puts a short notice above the page: what you are looking at, and where the Stellar page is;
//   * keeps the Stellar labels Stellar (the static "≈ x XLM" and "LUMOS / XLM" are fixed in _nearlumospage.js;
//     the chart legend is written at run time, so it is corrected here);
//   * sends the Stellar-only actions (Swap, Add Liquidity) to the Stellar page, where they work, instead of
//     opening a modal that would try to sign a Stellar transaction with a NEAR wallet.
// It is not injected once LUMOS is on NEAR (_tools/near-lumos.js), when this page gets NEAR's own LUMOS.
(function () {
  if (window.__lxnLumosPage) return; window.__lxnLumosPage = 1;
  var TO = '/lumos/stellar';
  var XLM_LOGO = '/assets/tokens/xlm.png';

  function notice() {
    if (document.getElementById('lxnLumosNote')) return;
    // Desktop: top of <main>. Phone: no <main>, so under the app bar (and its breadcrumb), never above it.
    var main = document.querySelector('main');
    var bar = main ? null : (document.querySelector('.crumb-bar') || document.querySelector('.appbar'));
    if (!main && !bar) return;
    var d = document.createElement('div');
    d.id = 'lxnLumosNote';
    d.setAttribute('role', 'note');
    d.style.cssText = 'margin:14px auto 4px;max-width:1240px;box-sizing:border-box;background:var(--accent-pale);' +
      'border:1px solid var(--accent-soft);border-radius:11px;padding:11px 14px;font-size:15px;line-height:1.5;color:var(--text-muted)';
    var b = document.createElement('strong'); b.style.color = 'var(--accent)'; b.textContent = 'LUMOS is not on NEAR yet. ';
    var t = document.createElement('span');
    t.textContent = 'Everything on this page is LUMOS on Stellar: price, supply and pools. ';
    var a = document.createElement('a'); a.href = TO; a.style.cssText = 'color:var(--accent);font-weight:600;white-space:nowrap';
    a.textContent = 'Open LUMOS on Stellar →';
    d.appendChild(b); d.appendChild(t); d.appendChild(a);
    if (main) main.insertBefore(d, main.firstChild);
    else { d.style.margin = '12px 16px 4px'; bar.parentNode.insertBefore(d, bar.nextSibling); }
  }

  // Text that must stay Stellar's, whoever wrote it last.
  function relabel() {
    document.querySelectorAll('.ct-name, .ct-net, .cc-legend .nm').forEach(function (e) {
      if (e.children.length) return;
      var t = e.textContent || '';
      if (/\bNEAR\b/.test(t)) { var n = t.replace(/\bNEAR\b/g, 'Stellar'); if (n !== t) e.textContent = n; }
    });
    document.querySelectorAll('.price-native, .sub-volume').forEach(function (e) {
      if (e.children.length) return;
      var t = e.textContent || '';
      if (/\bNEAR\b/.test(t)) e.textContent = t.replace(/\bNEAR\b/g, 'XLM');
    });
    // The price line is hidden from first paint (_nearlumospage.js) until it carries a real figure, not the
    // design's sample "≈ 0.00043 XLM".
    var pn = document.querySelector('.price-native');
    if (pn && !document.documentElement.classList.contains('lxn-ltp')) {
      var pt = (pn.textContent || '').trim();
      if (/\d/.test(pt) && !/^≈\s*0\.00043\s/.test(pt)) document.documentElement.classList.add('lxn-ltp');
    }
    // The USD price beside it: revealed once it is a non-zero figure ("$0" is lx-ltdata's interim value).
    var meta = document.querySelector('.lx-pricemeta');
    var usd = meta && meta.parentElement && meta.parentElement.querySelector(':scope > .price');
    if (usd && !document.documentElement.classList.contains('lxn-ltu')) {
      if (/[1-9]/.test(usd.textContent || '')) document.documentElement.classList.add('lxn-ltu');
    }
    document.querySelectorAll('.rmid, .pair-name').forEach(function (e) {
      if (e.children.length) return;
      var t = e.textContent || '';
      if (/LUMOS ?\/ ?NEAR\b/.test(t)) e.textContent = t.replace(/\bNEAR\b/g, 'XLM');
    });
    // The issuer chip says "Stellar" but the chain engine gave it NEAR's mark.
    document.querySelectorAll('.addr-row .net-tag').forEach(function (tag) {
      if (!/Stellar/.test(tag.textContent || '')) return;
      var im = tag.querySelector('img'), ico = tag.querySelector('.b-ico');
      if (im && im.getAttribute('src') !== XLM_LOGO) im.setAttribute('src', XLM_LOGO);
      if (ico && ico.style.background) ico.style.background = '';
    });
  }

  // Capture phase, so the inherited modal openers and the connect gate never see the click.
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest && ev.target.closest('[data-open-modal="modalSwap"],[data-open-modal="createPoolModal"]');
    if (!el) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    location.href = TO;
  }, true);

  function run() { notice(); relabel(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  try {
    var mo = new MutationObserver(relabel);
    var start = function () { mo.observe(document.body, { childList: true, subtree: true, characterData: true }); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  } catch (_) {}
})();
