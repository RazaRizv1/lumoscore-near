// NEAR Launchpad, interim layer: the Stellar issuance layer is gone and the NEAR factory is not deployed
// yet, so nothing on these pages may look like it launched a token.
//
//   form page     unchanged: the design's own Next button navigates to review as before.
//   review page   "Confirm & Launch" disabled and relabelled, exactly like the swap's "coming soon" gate.
//   confirm page  its headline is "Launched Successfully!", and nobody launched anything, so it goes back
//                 to the form (the XRPL launchpad does the same when there is no launch result).
(function () {
  var SOON = 'Launching on NEAR is coming soon';
  var p = location.pathname;
  if (/\/launchpad\/confirm|lumoscore-launch-confirm/.test(p)) {
    try { location.replace('/launchpad/near'); } catch (e) {}
    return;
  }
  function gate() {
    [].slice.call(document.querySelectorAll('button,a')).forEach(function (b) {
      var t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (t !== 'Confirm & Launch' && t !== SOON) return;
      if (t !== SOON) b.textContent = SOON;
      b.setAttribute('disabled', '');
      b.setAttribute('aria-disabled', 'true');
      b.style.pointerEvents = 'none';
      b.style.opacity = '.55';
      if (b.tagName === 'A') b.removeAttribute('href');
    });
  }
  // Capture-phase guard as well, in case another script re-enables the button after gate() ran.
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('button,a');
    if (b && (b.textContent || '').replace(/\s+/g, ' ').trim() === SOON) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gate); else gate();
  setTimeout(gate, 600);
})();
