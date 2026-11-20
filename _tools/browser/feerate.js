// NEAR fee tier: 0.2%, or 0.1% for an account holding 250,000+ LUMOS (wallet + LUMOS inside Rhea pools), the
// rule Stellar and XRPL use.
//
// LUMOS is not on NEAR yet (RAZA, 2026-10-21/22), so LUMOS below is '' and this publishes a flat 0.2% with no
// lookups at all. _nearfeerate.js stamps the NEAR LUMOS contract in from _tools/near-lumos.js once it is minted.
//
// Same globals the inherited Stellar `lx-feerate` exposed, because other inherited layers read them
// (__lxFeeRate, __lxFeeTier, the lx:feetier event); browser/nearswap.js takes its fee from __lxFeeRate. That
// layer looked the NEAR account up on Stellar's Horizon server on every page view, a guaranteed 404.
//
// A lookup that fails leaves the published rate as it was (0.2% unless already proven otherwise) and tries
// again; it never records "holds no LUMOS" for an account it could not read.
(function () {
  if (window.__lxFrBooted) return;
  window.__lxFrBooted = 1;
  var LUMOS = '__NEAR_LUMOS__';
  var THRESH = 250000, RATE = 0.002, LOW = 0.001;
  var RPC = 'https://free.rpc.fastnear.com';
  var POOLS = 'https://indexer.ref.finance/list-top-pools';
  var REF = 'v2.ref-finance.near';
  window.__lxFeeRate = RATE;
  window.__lxLumosBal = null;
  window.__lxLumosThresh = THRESH;
  function pub(bal) {
    window.__lxLumosBal = bal;
    window.__lxFeeRate = (LUMOS && typeof bal === 'number' && bal >= THRESH) ? LOW : RATE;
    try { window.dispatchEvent(new CustomEvent('lx:feetier', { detail: { bal: bal, rate: window.__lxFeeRate, thresh: THRESH } })); } catch (e) {}
  }
  window.__lxFeeTier = function () { return { bal: window.__lxLumosBal, rate: window.__lxFeeRate, thresh: THRESH }; };
  window.__lxFeeTierSet = pub;
  window.__lxAcctP = window.__lxAcctP || {};
  window.__lxAcct = function () { return Promise.resolve(null); };
  if (!LUMOS) { window.__lxFeeTierRefresh = function () { pub(null); }; return; }

  function view(contract, method, args) {
    // SHARED WITH nearcore (N21, 2026-11-20): the same read on one page is asked once, and a refusal moves to the
    // second RPC there. This file asks for itself only on a page without nearcore.
    var C = window.lxnCore;
    if (C && typeof C.callView === 'function') return C.callView(contract, method, args);
    return fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function',
        finality: 'final', account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args || {})) } }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.result || !d.result.result) throw new Error(method + ': ' + JSON.stringify((d && (d.error || d.result)) || d).slice(0, 120));
        return JSON.parse(new TextDecoder().decode(new Uint8Array(d.result.result)));
      });
  }
  function me() {
    try { if (window.lxn && typeof window.lxn.account === 'function') return window.lxn.account() || ''; } catch (e) {}
    return '';
  }
  var DEC = null;
  function decimals() {
    if (DEC != null) return Promise.resolve(DEC);
    return view(LUMOS, 'ft_metadata', {}).then(function (m) { DEC = +m.decimals || 0; return DEC; });
  }
  function units(raw, dec) {
    var s = String(raw || '0').replace(/^0+/, '') || '0';
    if (dec <= 0) return Number(s);
    if (s.length <= dec) s = new Array(dec - s.length + 2).join('0') + s;
    return Number(s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec));
  }
  // LUMOS the account owns inside Rhea's classic pools: its share of each pool's LUMOS reserve.
  function inPools(acc) {
    return fetch(POOLS).then(function (r) { if (!r.ok) throw new Error('rhea pools ' + r.status); return r.json(); })
      .then(function (pools) {
        var mine = (Array.isArray(pools) ? pools : []).filter(function (p) {
          return p && Array.isArray(p.token_account_ids) && p.token_account_ids.indexOf(LUMOS) >= 0;
        }).slice(0, 8);
        return Promise.all(mine.map(function (p) {
          return view(REF, 'get_pool_shares', { pool_id: +p.id, account_id: acc }).then(function (sh) {
            var total = BigInt(p.shares_total_supply || '0'), s = BigInt(sh || '0');
            if (total <= 0n || s <= 0n) return 0n;
            var k = p.token_account_ids.indexOf(LUMOS);
            return BigInt((p.amounts || [])[k] || '0') * s / total;
          });
        }));
      })
      .then(function (parts) { return parts.reduce(function (a, b) { return a + b; }, 0n); });
  }
  var forAcc = '', busy = false;
  function resolve(force) {
    var acc = me();
    if (!acc) { forAcc = ''; pub(null); return; }
    if (busy || (!force && forAcc === acc)) return;
    busy = true;
    Promise.all([decimals(), view(LUMOS, 'ft_balance_of', { account_id: acc }), inPools(acc)])
      .then(function (x) {
        if (me() !== acc) return;
        forAcc = acc;
        pub(units((BigInt(x[1] || '0') + x[2]).toString(), x[0]));
      })
      .catch(function (e) {
        try { console.warn('[fee tier] LUMOS balance unavailable, fee stays ' + (window.__lxFeeRate * 100) + '%: ' + ((e && e.message) || e)); } catch (_) {}
      })
      .then(function () { busy = false; });
  }
  window.__lxFeeTierRefresh = function () { resolve(true); };
  window.addEventListener('storage', function (e) { if (e && e.key === 'lumos.address') resolve(true); });
  resolve();
  setTimeout(resolve, 1200);
  setTimeout(resolve, 4000);
})();
