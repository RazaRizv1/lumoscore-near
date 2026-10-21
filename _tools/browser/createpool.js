// Create Pool on NEAR: the design's dialog, held in its disabled state until NEAR pool creation exists.
//
// The dialog (#createPoolModal) ships on the Pools page and the dashboard. On Stellar, lx-ammdata drives it:
// it fills the two asset dropdowns with the account's real holdings and, at window capture, takes the clicks
// on the pickers and the list -- because the design's own nav shim answers a click there with
// lxNavigate(["lumoscore-amm-pool-light.html", ...]) and LEAVES THE PAGE (traced on Stellar; see the note in
// _ammdata.js). lx-ammdata is stripped from this build (_nearpools.js), which would hand those clicks back
// to the shim: pressing "Select asset" would have navigated away.
//
// So this keeps the capture and nothing else: the pickers do nothing, the design's mock asset rows stay
// hidden by the inherited `.ad-item:not(.lx-cpitem){display:none}` rule, and the primary button is disabled
// with a label that says why -- the same treatment the NEAR token page gives swap and limit orders. The
// label is also written to data-lxorig / data-lxdis, which is what lx-gate restores on wallet connect, so
// connecting cannot hand the button back its enabled Stellar label.
(function () {
  if (window.__lxnCreatePool) return;
  window.__lxnCreatePool = 1;

  var LABEL = 'Pool creation on NEAR is coming soon';

  window.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#createPoolModal')) return;
    if (t.closest('#createPoolModal .asset-picker') || t.closest('#createPoolModal .ad-item')
      || t.closest('#createPoolModal .ad-search') || t.closest('#createPoolModal .ad-list')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  function hold() {
    [].forEach.call(document.querySelectorAll('#createPoolModal .modal-foot .btn-primary'), function (b) {
      b.setAttribute('data-lxorig', LABEL);
      b.setAttribute('data-lxdis', '1');
      if ((b.textContent || '').trim() === 'Connect wallet') return;     // lx-gate owns it until connect
      if (b.textContent !== LABEL) b.textContent = LABEL;
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      b.style.opacity = '.55';
      b.style.cursor = 'not-allowed';
    });
    [].forEach.call(document.querySelectorAll('#createPoolModal .asset-picker'), function (p) {
      p.setAttribute('aria-disabled', 'true');
      p.style.cursor = 'not-allowed';
    });
    // The dialog's own copy names the wrong chain ("Initialize a new liquidity pool on Stellar AMM") and its
    // summary carries the design's figures -- a 0.5% fee tier and "~0.00001 NEAR" (Stellar's fee, re-skinned
    // by the chain engine). On NEAR a new pool's fee is chosen at creation and nothing here can quote gas,
    // so both are em dashes, like the initial price beside them.
    [].forEach.call(document.querySelectorAll('#createPoolModal .modal-sub'), function (s) {
      if (/Stellar|Aptos/i.test(s.textContent || '')) s.textContent = 'Initialize a new liquidity pool on NEAR';
    });
    [].forEach.call(document.querySelectorAll('#createPoolModal .pool-summary .row'), function (r) {
      var k = r.querySelector('span'), v = r.querySelector('strong');
      if (!k || !v) return;
      if (/trading fee|network fee/i.test(k.textContent || '') && v.textContent !== '—') v.textContent = '—';
    });
  }

  // Again each time the dialog opens: anything that relabelled the button while it was closed is undone
  // before it can be seen.
  window.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#openCreatePool, .lx-cplink, [data-open="createPoolModal"]')) setTimeout(hold, 0);
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hold);
  else hold();
})();
