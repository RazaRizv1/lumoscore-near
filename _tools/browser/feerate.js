// NEAR fee tier: a flat 0.2%. The LUMOS discount (0.1% at 250,000 LUMOS) is DEFERRED until LUMOS is minted
// on NEAR (RAZA, 2026-10-21), so there is no balance to look up.
//
// Same globals the inherited Stellar `lx-feerate` exposed, because other inherited layers read them
// (__lxFeeRate, __lxFeeTier, the lx:feetier event). That layer looked the NEAR account up on
// Stellar's Horizon server on every page view, a guaranteed 404. When LUMOS exists on NEAR this becomes the
// NEAR reader, as XRPL's _xrplfeerate did for its ledger.
(function () {
  if (window.__lxFrBooted) return;
  window.__lxFrBooted = 1;
  var THRESH = 250000, RATE = 0.002;
  window.__lxFeeRate = RATE;
  window.__lxLumosBal = null;
  window.__lxLumosThresh = THRESH;
  function pub() {
    window.__lxFeeRate = RATE;
    try { window.dispatchEvent(new CustomEvent('lx:feetier', { detail: { bal: null, rate: RATE, thresh: THRESH } })); } catch (e) {}
  }
  window.__lxFeeTier = function () { return { bal: null, rate: RATE, thresh: THRESH }; };
  window.__lxFeeTierSet = pub;
  window.__lxFeeTierRefresh = pub;
  window.__lxAcctP = window.__lxAcctP || {};
  window.__lxAcct = function () { return Promise.resolve(null); };
})();
