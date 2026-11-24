// NEAR market swap through Rhea Finance (v2.ref-finance.near): the ONE implementation of quoting, routing
// and transaction building. Both swap surfaces drive it -- the Trade-Asset panel (browser/dxaswap.js) and the
// wallet's Swap dialog (browser/swapmodal.js) -- so the arithmetic that decides how much money moves exists
// once. window.lxnSwap. No UI of its own.
//
// WHAT RHEA'S CONTRACT REQUIRES (v1.9.20 on mainnet, checked 2026-10-21; ref-contracts is no longer public on
// GitHub, so each point was checked against Rhea's own front end -- ref-finance/ref-ui src/services/swap.ts --
// and against real mainnet transactions):
//   * INSTANT SWAP needs no Rhea account. ft_transfer_call(receiver v2.ref-finance.near, msg = actions) swaps
//     in a virtual account and sends the output straight back. Seen on mainnet from accounts whose
//     storage_balance_of on v2.ref-finance.near is null (dontdump.near, paypass.near, 2026-10-21).
//   * The OUTPUT is an ft_transfer from Rhea to the swapper, so the swapper must be registered on the output
//     token (storage_balance_of non-null) -- registration goes first, as its own transaction.
//   * msg = {"force":0,"actions":[...],"skip_unwrap_near":bool}. Each action is {pool_id, token_in, token_out,
//     amount_in?, min_amount_out}; the first hop carries amount_in, later hops omit it and take the previous
//     hop's output (ref-ui and rhea-sdk both build it this way; mainnet multi-hop txs omit it too).
//     min_amount_out "0" on intermediate hops, the real floor on the last.
//   * Output NEAR: skip_unwrap_near:false makes Rhea call near_withdraw on wrap.near and send native NEAR
//     (mainnet: whyyyy.near RHEA->NEAR, 5trBhdfY..., logs "Withdraw ... NEAR from v2.ref-finance.near").
//     Absent, the output stays wNEAR -- so it is always written explicitly.
//   * A swap that fails inside Rhea refunds the INPUT through ft_resolve_transfer (paypass.near, 4PcCwgq5...);
//     the fee, transferred in the same receipt before it, is not refunded. Accepted for v1 (RAZA 2026-10-21).
//
// THE FEE ARRIVES AS wNEAR (RAZA 2026-11-10: "the fee always arrives as wNEAR, in the one transaction the user
// signs"). 0.2% of the INPUT (0.1% at the LUMOS tier, feeBps), taken in the same transaction as the swap:
//   * Input NEAR or wNEAR: an ft_transfer of wNEAR to FEE_ACCOUNT with the platform-fee memo, as before.
//   * Any other input X with a classic X/wNEAR pool: a second ft_transfer_call of the fee slice to Rhea, swapping
//     it X -> wNEAR through the deepest such pool with swap_out_recipient FEE_ACCOUNT, so Rhea pays the wNEAR
//     straight to the fee account (the field contracts/router sends, honoured by Ref 1.9.19 on testnet; mainnet runs
//     1.9.21). skip_unwrap_near:true keeps it wNEAR, on which the fee account is registered. Its floor is half the
//     slice's expected wNEAR. Then the main swap of the net amount, unchanged. If the fee swap fails, Rhea refunds
//     the slice to the user and the main swap still runs: accepted. The admin recognises these fees by this msg
//     (C:/LumosCore functions/lxapi/nearfees.js), as Rhea's transfer carries no memo of ours.
//   * X with no classic X/wNEAR pool: the fee stays in X as an ft_transfer, as before, so the fee account must be
//     registered on X (feeReady). A slice of 0 raw units (an input under 500 units) takes no fee at all.
// The wNEAR path needs no registration of ours on X, so an uncurated token can be sold. Gas: the fee call gets
// FEE_SWAP_GAS (a one-hop swap burns well under it) and the swap keeps SWAP_GAS, 270 TGas together, under NEAR's
// 300 per transaction with room for a wallet that adds its own. One transaction, so one approval.
// The fee and the swap share one receipt: an ft_transfer that fails (an unregistered fee account) reverts both, and
// the user pays gas for nothing, which is why feeReady is checked before the button lights. The user's
// transaction never carries a storage_deposit for the fee account: users do not pay for our registration.
//
// Amounts are integer STRINGS in raw units end to end (BigInt for the arithmetic); floats exist only for
// display.
(function () {
  if (window.lxnSwap) return;

  // ---- THE FEE ACCOUNT -------------------------------------------------------------------------------
  // Decided 2026-10-21 (RAZA): fees-lumoscore.near. It must be storage-registered on every token it is to
  // be paid in; until it is, swaps FROM that token stay "coming soon" (feeReady below). Change it here and
  // nowhere else.
  var FEE_ACCOUNT = 'fees-lumoscore.near';
  var FEE_BPS = 20;                                   // 0.2% of the input
  // 0.1% for a holder of 250,000+ LUMOS, as on Stellar and XRPL. The tier is published by browser/feerate.js
  // in window.__lxFeeRate, which stays 0.002 for everyone until LUMOS is live on NEAR (_tools/near-lumos.js).
  // Only the two known rates are honoured, so a stray value can never zero the fee.
  function feeBps() { return window.__lxFeeRate === 0.001 ? 10 : FEE_BPS; }
  var SLIP_BPS = 50;                                  // 0.5%, the figure the design displays

  // ---- THE ROUTER (contracts/router) ------------------------------------------------------------------
  // With a router, the fee is taken ONLY if Rhea fills the swap: one ft_transfer_call to the router, which
  // swaps the rest with the output sent straight to the user and either pays the fee or hands everything
  // back. Stamped from _tools/near-router.js at build time; '' (or an unstamped placeholder) = no router,
  // and the swap is today's two actions (fee transfer + ft_transfer_call to Rhea). A localhost-only
  // override exists for capture tests, like the fee account's.
  var ROUTER_STAMP = '__NEAR_ROUTER__';
  function router() {
    try {
      var t = window.__lxnRouterForTest;
      if (typeof t === 'string' && t && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return t;
    } catch (e) {}
    return /^[a-z0-9._-]{2,64}$/.test(ROUTER_STAMP) && ROUTER_STAMP.indexOf('__') !== 0 ? ROUTER_STAMP : '';
  }

  var REF = 'v2.ref-finance.near';
  // Rhea's concentrated-liquidity (DCL) contract, a second venue for an instant swap: for some tokens it is
  // the only real market (BATMAN: $312K in its DCL pool against $940 in its biggest classic pool, 2026-11-01).
  var DCL = 'dclv2.ref-labs.near', DCL_FEES = [100, 400, 2000, 10000];
  var WNEAR = 'wrap.near';
  var USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
  var USDT = 'usdt.tether-token.near';
  var HUBS = [WNEAR, USDC, USDT];                     // the token two-hop routes pass through
  var RPCS = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
  var TGAS = '000000000000';
  var MAX_TX_GAS = 300;                               // TGas per transaction
  // THE SWAP CALL GETS 180 TGas, NOT "WHATEVER IS LEFT UP TO 300". The transaction used to add up to exactly
  // NEAR's 300 TGas ceiling (10 + 10 + 30 + 250), and HOT refused it twice on mainnet (RAZA 2026-10-30) with
  // "User rejected the request" after he approved -- while the same session's one-action, 30-TGas
  // registration went straight through. A transaction AT the ceiling leaves nothing for a wallet that adds
  // to it. 180 is what Rhea's own app sends with a swap's ft_transfer_call (and what this file's DCL orders
  // use); real swaps here burned 18-28 TGas end to end. Unused gas is refunded either way.
  var SWAP_GAS = 180;
  var FEE_SWAP_GAS = 90;
  // A token sale's NEAR reserve (see build): attached gas x GAS_HOLD at the floor price, not SWAP_KEEP.
  var GAS_PRICE_FLOOR = '100000000', GAS_HOLD = 3;                              // the fee slice's one-hop swap to wNEAR (see the header)
  var NEAR_KEEP = '50000000000000000000000';          // 0.05 NEAR left behind by MAX, for gas and storage
  // A SWAP KEEPS 0.2 NEAR, NOT 0.05 (RAZA 2026-10-30: HOT refused three swaps of 0.005 NEAR from a 0.147 NEAR
  // balance with "User rejected the request"; Rhea's own app, same wallet, refuses the same swap with "Must have
  // 0.2N or more left in wallet for gas fee"). NEAR sets aside a transaction's whole prepaid gas up front, at a
  // pessimistic price, and refunds what goes unused -- a 200+ TGas swap needs far more on hand than the few
  // thousandths it finally costs. 0.2 is Rhea's figure; the 0.05 above stays for cheap calls (send, bridge).
  // 0.25, NOT 0.2 (RAZA 2026-11-15, 0.15 NEAR -> LUMOS, HOT): with ~0.357 NEAR the 0.2 check passed, the wrap landed,
  // and HOT refused the swap transaction with 0.2048 NEAR still spendable -- "User rejected the request" again. HOT's
  // floor is 0.2 PLUS the gas the swap itself attaches, so 0.2 exactly is a coin-flip. 0.25 keeps a margin above it,
  // and a refusal now happens here, before anything is signed, instead of after the wrap.
  var SWAP_KEEP = '250000000000000000000000';
  // Mainnet swaps through Rhea burn ~18-28 TGas end to end (measured on four real txs 2026-10-21:
  // 0.0016-0.0026 NEAR). Shown as the figure alone, as Stellar prints its network fee -- RAZA 2026-10-29
  // asked for the "~" to go, on the swap pane and the review popup alike. 0.003 is the ceiling of what was
  // measured, so the figure never understates the cost.
  var NET_FEE_EST = '0.003 NEAR';

  // A capture test may point the fee at a registered account. Honoured on a local host only, so a
  // production page can never be steered by it.
  function feeAccount() {
    try {
      var t = window.__lxnFeeAccountForTest;
      if (typeof t === 'string' && t && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return t;
    } catch (e) {}
    return FEE_ACCOUNT;
  }

  // ---- reads -----------------------------------------------------------------------------------------
  // A BUSY RPC IS NOT A DEAD ROUTE (RAZA 2026-11-07: "NEAR is busy right now" on AURORA to ZEC). A quote between two
  // tokens with no shared pool is 13 to 30 view calls, all at once, on one free host from the visitor's own IP: calm
  // it answers in a second, and a 429 on a few of them read as a failed quote. So: at most RPC_MAX at a time; a host
  // that refuses cools off and the other takes over; three tries each with growing pauses; and after RPC_TRIP calls
  // have failed outright within 10s, no more are sent for 8s, so a real outage cannot become a retry storm.
  var RPC_MAX = 4, RPC_TRIP = 6, rpcLive = 0, rpcWait = [], rpcCool = [0, 0], rpcFails = 0, rpcRecent = [], rpcOpenAt = 0;
  function rpcSlot() {
    return new Promise(function (res) {
      if (rpcLive < RPC_MAX) { rpcLive++; res(); } else rpcWait.push(res);
    });
  }
  function rpcFree() {
    var next = rpcWait.shift();
    if (next) next(); else rpcLive--;
  }
  function rpcHost() {
    var now = Date.now();
    if (now >= rpcCool[0]) return 0;
    if (now >= rpcCool[1]) return 1;
    return rpcCool[0] <= rpcCool[1] ? 0 : 1;
  }
  function rpcFailed() {
    var now = Date.now();
    rpcFails++;
    rpcRecent = rpcRecent.filter(function (t) { return now - t < 10000; });
    rpcRecent.push(now);
    if (rpcRecent.length >= RPC_TRIP) { rpcOpenAt = now + 8000; rpcRecent = []; }
  }
  function view(params, attempt) {
    attempt = attempt || 0;
    if (Date.now() < rpcOpenAt) { var shut = new Error('NEAR RPC busy'); shut.transient = 1; rpcFails++; return Promise.reject(shut); }
    return rpcSlot().then(function () {
      var at = rpcHost(), ctl = null;
      try { ctl = new AbortController(); } catch (e) {}
      var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 8000);
      return fetch(RPCS[at], {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'lxs', method: 'query', params: params }),
        signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        clearTimeout(timer);
        if (r.status === 429 || r.status >= 500) { var e1 = new Error('NEAR RPC busy (' + r.status + ')'); e1.transient = 1; throw e1; }
        return r.json();
      }, function (e) {
        clearTimeout(timer);
        var e0 = new Error((e && e.name === 'AbortError') ? 'NEAR did not answer in time' : 'NEAR RPC unreachable');
        e0.transient = 1; throw e0;
      }).then(function (j) {
        var err = j && j.error;
        if (err) {
          var e = new Error(String((err.cause && err.cause.name) || err.message || 'RPC error'));
          e.code = (err.cause && err.cause.name) || '';
          if (/timeout|too many|rate limit|overload|unavailable|no_synced/i.test(e.message)) e.transient = 1;
          throw e;
        }
        if (j && j.result && j.result.error) { var e2 = new Error(String(j.result.error)); e2.code = 'CALL'; throw e2; }
        return j.result;
      }).then(function (v) { rpcFree(); return v; }, function (e) {
        rpcFree();
        if (e && e.transient) rpcCool[at] = Date.now() + 3000 * (attempt + 1);
        throw e;
      });
    }).catch(function (e) {
      if (!(e && e.transient)) throw e;
      if (attempt >= 2) { rpcFailed(); throw e; }
      return new Promise(function (r) { setTimeout(r, 500 * (attempt + 1) + Math.random() * 300); })
        .then(function () { return view(params, attempt + 1); });
    });
  }
  function callView(contract, method, args) {
    return view({
      request_type: 'call_function', finality: 'final', account_id: contract,
      method_name: method, args_base64: btoa(JSON.stringify(args || {}))
    }).then(function (r) {
      var bytes = new Uint8Array((r && r.result) || []), txt = '';
      try { txt = new TextDecoder().decode(bytes); } catch (e) { for (var i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]); }
      return txt ? JSON.parse(txt) : null;
    });
  }

  // ---- integer strings -------------------------------------------------------------------------------
  function big(s) { return BigInt(String(s == null ? '0' : s)); }
  function toUnits(str, dec) {
    var s = String(str == null ? '' : str).trim().replace(/,/g, '');
    if (!/^[0-9]*\.?[0-9]*$/.test(s) || !/[0-9]/.test(s)) return null;
    var p = s.split('.'), whole = p[0] || '0', frac = p[1] || '';
    if (frac.length > dec) frac = frac.slice(0, dec);        // more decimals than the token has: truncated
    while (frac.length < dec) frac += '0';
    return (whole + frac).replace(/^0+/, '') || '0';
  }
  function fromUnits(raw, dec) {
    var s = String(raw == null ? '0' : raw).replace(/^0+/, '') || '0';
    if (!dec) return s;
    while (s.length <= dec) s = '0' + s;
    var w = s.slice(0, s.length - dec), f = s.slice(s.length - dec).replace(/0+$/, '');
    return f ? (w + '.' + f) : w;
  }
  function toNum(raw, dec) { return Number(fromUnits(raw, dec)); }
  function feeOf(raw) { return (big(raw) * BigInt(feeBps()) / BigInt(10000)).toString(); }
  function minOut(raw, slipBps) {
    var s = slipBps == null ? SLIP_BPS : slipBps;
    return (big(raw) * BigInt(10000 - s) / BigInt(10000)).toString();
  }

  // ---- tokens ----------------------------------------------------------------------------------------
  // id 'near' is native NEAR; every other id is a NEP-141 contract. Native NEAR routes as wrap.near.
  var META = {};
  META.near = { id: 'near', code: 'NEAR', dec: 24, native: true, logo: '/assets/networks/near.png' };
  META[WNEAR] = { id: WNEAR, code: 'wNEAR', dec: 24, logo: '/assets/networks/near.png' };
  function contractOf(id) { return id === 'near' ? WNEAR : id; }
  function remember(id, code, dec, logo) {
    if (!id || id === 'near' || dec == null) return;
    if (!META[id]) META[id] = { id: id, code: code || id, dec: +dec, logo: logo || '' };
  }
  function tokenInfo(id) {
    if (META[id]) return Promise.resolve(META[id]);
    return callView(id, 'ft_metadata', {}).then(function (m) {
      if (!m || m.decimals == null) throw new Error('not a token');
      remember(id, String(m.symbol || id).replace(/[\u0000-\u001f]/g, '').slice(0, 24), m.decimals, '');
      return META[id];
    });
  }

  // ---- pools -----------------------------------------------------------------------------------------
  var poolsP = null;
  function pools() {
    if (poolsP) return poolsP;
    var p = fetch('/lxapi/nearpools?n=200').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.rows) throw new Error('pool list unavailable');
      return d.rows;
    });
    poolsP = p;
    p.catch(function () { if (poolsP === p) poolsP = null; });     // a failure is not an answer
    return p;
  }
  // A TOKEN OUTSIDE THE CURATED LIST (RAZA 2026-11-01: BATMAN's own Trade page said "No route between those
  // two tokens on Rhea right now"). pools() is the curated top 200, so a token with no pool there could not
  // be routed even from its own page. Its Rhea pools come from the same endpoint's whole-of-Rhea lookup
  // (?q=<contract>, the one search and off-list pool pages use), still ranked by liquidity -- never "the
  // newest pool" -- and every candidate is quoted on Rhea itself before it can be used.
  var offP = {};
  function poolsWith(rows, id) {
    if (id === WNEAR || rows.some(function (r) { return (r.tokens || []).some(function (t) { return t.i === id; }); })) return Promise.resolve([]);
    if (!offP[id]) {
      offP[id] = fetch('/lxapi/nearpools?q=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
        return ((d && d.ok && d.rows) || []).filter(function (r) { return (r.tokens || []).some(function (t) { return t.i === id; }); });
      });
      offP[id].catch(function () { delete offP[id]; });         // a failure is not an answer
    }
    return offP[id].catch(function () { rpcFails++; return []; });
  }
  function poolsBetween(rows, a, b, k) {
    return rows.filter(function (r) {
      var ids = (r.tokens || []).map(function (t) { return t.i; });
      return ids.indexOf(a) >= 0 && ids.indexOf(b) >= 0;
    }).sort(function (x, y) { return (y.liq || 0) - (x.liq || 0); }).slice(0, k || 2);
  }

  function getReturn(poolId, tin, tout, amt) {
    return callView(REF, 'get_return', { pool_id: +poolId, token_in: tin, amount_in: String(amt), token_out: tout })
      .then(function (r) { return String(r || '0'); });
  }
  // A DCL pool's id is "<token>|<token>|<fee>", the two contracts sorted; its quote is DCL's own view.
  function dclReturn(poolId, tin, tout, amt) {
    return callView(DCL, 'quote', { pool_ids: [poolId], input_token: tin, output_token: tout, input_amount: String(amt), tag: null })
      .then(function (r) { return String((r && r.amount) || '0'); });
  }
  function legReturn(p, tin, tout, amt) { return p.dcl ? dclReturn(p.id, tin, tout, amt) : getReturn(p.id, tin, tout, amt); }
  function hopReturn(h, amt) { return legReturn(h.pool, h.tin, h.tout, amt); }
  // The best of several pools for one leg. More in always gives more out, so choosing the best pool per
  // leg greedily is also the best two-leg route.
  function bestLeg(cands, tin, tout, amt) {
    if (!cands.length) return Promise.resolve(null);
    return Promise.all(cands.map(function (p) {
      return legReturn(p, tin, tout, amt).then(function (o) { return { pool: p, out: o }; }, function () { return null; });
    })).then(function (rs) {
      var best = null;
      rs.forEach(function (x) { if (x && big(x.out) > BigInt(0) && (!best || big(x.out) > big(best.out))) best = x; });
      return best;
    });
  }

  // THE DCL POOLS OF A PAIR THAT CAN TRADE, from get_pool on each tier. A definite answer is kept for the page
  // session, so a keystroke's re-quote asks only the pools that exist; a failed read is not an answer.
  var DCLP = {};
  function dclPools(x, y) {
    var k = [x, y].sort().join('|');
    if (DCLP[k]) return DCLP[k];
    var p = Promise.all(DCL_FEES.map(function (fee) {
      return callView(DCL, 'get_pool', { pool_id: k + '|' + fee });
    })).then(function (rs) {
      var out = [];
      rs.forEach(function (r) {
        if (!r || r.state !== 'Running') return;
        if (big(r.liquidity) > BigInt(0) || big(r.total_order_x) > BigInt(0) || big(r.total_order_y) > BigInt(0)) out.push({ id: r.pool_id, dcl: 1 });
      });
      return out;
    });
    DCLP[k] = p;
    p.catch(function () { if (DCLP[k] === p) delete DCLP[k]; });
    return p;
  }

  function busyErr() { var e = new Error('NEAR is busy right now. Try again in a moment.'); e.busy = 1; return e; }

  // THE TWO-HOP ROUTE WHEN THE LEGS LIVE ON DIFFERENT CONTRACTS (RAZA 2026-11-05: AURORA -> QTC read "No route between
  // AURORA and QTC on NEAR right now"). AURORA's market is a classic pool (5469, AURORA/wNEAR, $60K) and QTC has no
  // classic pool at all, only DCL (QTC/wNEAR 1%, QTC/USDC 0.2%), so poolsBetween found no second leg and DCL was only
  // ever tried as one direct hop. This is the fallback when nothing above found a route, so a pair that already
  // trades keeps its route and its RPC cost. Both legs on DCL is one transaction ("Swap" takes a list of pool_ids;
  // its quote view gave the same figure chained as hop by hop, 2026-11-05). A classic leg and a DCL leg CANNOT be one
  // transaction: those are two contracts with two message formats, so the route is two swaps in a row (route.split),
  // the first ending in the hub token in the user's own wallet. It is not atomic: the second can fail, leaving the
  // hub token there, which is why an atomic route wins unless a split gives more than 1% more, why the screens say
  // so before signing, and why the second leg is quoted for, and sells, the FLOOR of the first (the 0.5% slippage):
  // it has to name an exact amount at signing, and the floor is the one amount the first leg guarantees.
  function viaHub(rows, a, m, b, amtRaw, asked) {
    function miss() { asked.failed = 1; return []; }           // a pool list we could not read is not "none"
    return Promise.all([dclPools(a, m).catch(miss), dclPools(m, b).catch(miss)]).then(function (d) {
      var c1 = poolsBetween(rows, a, m, 2), c2 = poolsBetween(rows, m, b, 2), d1 = d[0], d2 = d[1];
      if (!(c1.length || d1.length) || !(c2.length || d2.length)) return null;
      // BOTH KINDS OF FIRST LEG, NOT JUST THE BETTER ONE (RAZA 2026-11-18, "fix the LUMOS route through the tiny pool").
      // USDC -> wNEAR is about equal on the classic pool and on DCL, so taking only the better first leg could pin the
      // route to classic -- and then the only atomic second leg was classic pool 9001 ($0.57, 2,153 LUMOS for 10 USDC)
      // while DCL -> DCL, one transaction, gives 22,532. So each kind of first leg is followed by its own kind (atomic)
      // and by the other kind (split); the best atomic route wins unless a split gives more than 1% more.
      var code = (META[m] && META[m].code) || (m === USDC ? 'USDC' : 'USDt');
      function hop2(x1, x2) { return [{ pool: x1.pool, tin: a, tout: m, out: x1.out }, { pool: x2.pool, tin: m, tout: b, out: x2.out }]; }
      function whole(x1, l2) {
        if (!x1 || !l2.length) return Promise.resolve(null);
        return bestLeg(l2, m, b, x1.out).then(function (x2) { return x2 ? { hops: hop2(x1, x2), out: x2.out } : null; });
      }
      function split(x1, l2) {
        if (!x1 || !l2.length) return Promise.resolve(null);
        var floor = minOut(x1.out);
        return bestLeg(l2, m, b, floor).then(function (x2) { return x2 ? { hops: hop2(x1, x2), out: x2.out, split: { hub: m, code: code, amount: floor } } : null; });
      }
      return Promise.all([bestLeg(c1, a, m, amtRaw), bestLeg(d1, a, m, amtRaw)]).then(function (l1) {
        var xc = l1[0], xd = l1[1];
        return Promise.all([whole(xc, c2), whole(xd, d2), split(xc, d2), split(xd, c2)]).then(function (rs) {
          var w = null, s = null;
          [rs[0], rs[1]].forEach(function (r) { if (r && (!w || big(r.out) > big(w.out))) w = r; });
          [rs[2], rs[3]].forEach(function (r) { if (r && (!s || big(r.out) > big(s.out))) s = r; });
          if (s && (!w || big(s.out) * BigInt(100) > big(w.out) * BigInt(101))) return s;
          return w;
        });
      });
    });
  }
  // One hub at a time, so the first pass over a pair's get_pool reads never bursts the free RPC.
  function hubRoute(rows, a, b, amtRaw) {
    var whole = null, split = null, chain = Promise.resolve(), asked = {};
    HUBS.forEach(function (m) {
      if (m === a || m === b) return;
      chain = chain.then(function () { return viaHub(rows, a, m, b, amtRaw, asked); }).then(function (r) {
        if (!r) return;
        if (r.split) { if (!split || big(r.out) > big(split.out)) split = r; }
        else if (!whole || big(r.out) > big(whole.out)) whole = r;
      });
    });
    return chain.then(function () {
      if (whole && split && big(split.out) * BigInt(100) > big(whole.out) * BigInt(101)) return split;
      // "No route" only from pools that answered: a busy RPC says so instead.
      if (!whole && !split && asked.failed) throw busyErr();
      return whole || split;
    });
  }

  // Routes: every direct pool, and two hops through wNEAR, USDC or USDt. Quoted with get_return on Rhea itself,
  // and the route with the most output wins. Returns { hops:[{pool,tin,tout,out}], out, split? } or null.
  function route(fromId, toId, amtRaw) {
    var a = contractOf(fromId), b = contractOf(toId);
    if (a === b) return Promise.resolve(null);
    var fails0 = rpcFails;                                     // a read that failed under this route can hide a pool
    return pools().catch(function () { throw busyErr(); }).then(function (cur) {
      return Promise.all([poolsWith(cur, a), poolsWith(cur, b)]).then(function (x) { return cur.concat(x[0], x[1]); });
    }).then(function (rows) {
      var tries = [];
      tries.push(bestLeg(poolsBetween(rows, a, b, 3), a, b, amtRaw).then(function (x) {
        return x ? { hops: [{ pool: x.pool, tin: a, tout: b, out: x.out }], out: x.out } : null;
      }));
      // Direct through each DCL fee tier. A tier with no pool answers with an error, which is just "not here".
      var dclTry = Promise.all(DCL_FEES.map(function (fee) {
        var id = [a, b].sort().join('|') + '|' + fee;
        return dclReturn(id, a, b, amtRaw).then(function (o) { return { pool: { id: id, dcl: 1 }, out: o }; }, function () { return null; });
      })).then(function (rs) {
        var best = null;
        rs.forEach(function (x) { if (x && big(x.out) > BigInt(0) && (!best || big(x.out) > big(best.out))) best = x; });
        return best ? { hops: [{ pool: best.pool, tin: a, tout: b, out: best.out }], out: best.out } : null;
      });
      HUBS.forEach(function (m) {
        if (m === a || m === b) return;
        var l1 = poolsBetween(rows, a, m, 2), l2 = poolsBetween(rows, m, b, 2);
        if (!l1.length || !l2.length) return;
        tries.push(bestLeg(l1, a, m, amtRaw).then(function (x1) {
          if (!x1) return null;
          return bestLeg(l2, m, b, x1.out).then(function (x2) {
            return x2 ? { hops: [{ pool: x1.pool, tin: a, tout: m, out: x1.out }, { pool: x2.pool, tin: m, tout: b, out: x2.out }], out: x2.out } : null;
          });
        }));
      });
      // DCL wins only where the classic pools have no route, or give more than 1% less: the classic path is
      // the one tested end to end on mainnet, and a near-tie is not worth moving a pair onto the other contract.
      return Promise.all([Promise.all(tries), dclTry]).then(function (rs) {
        var best = null, d = rs[1];
        rs[0].forEach(function (r) { if (r && (!best || big(r.out) > big(best.out))) best = r; });
        if (d && (!best || big(d.out) * BigInt(100) > big(best.out) * BigInt(101))) best = d;
        if (!best) return hubRoute(rows, a, b, amtRaw);
        // A ROUTE THAT MOVES THE PRICE A LOT IS NOT THE END OF THE SEARCH (RAZA 2026-11-18). The hub routes through DCL
        // used to be tried only when nothing else was found, so any route at all -- even one through a $0.57 pool at
        // 91% price impact -- stopped the search. Now a route that moves the price more than POOR_PCT also asks the
        // hub routes, and the better answer wins (a split one only by more than 1%, as everywhere here). A route that
        // is fine costs one extra read; a failed hub search keeps the route already found.
        return poorRoute(best, amtRaw).then(function (isPoor) {
          if (!isPoor) return best;
          return hubRoute(rows, a, b, amtRaw).then(function (h) {
            if (!h) return best;
            return big(h.out) * BigInt(100) > big(best.out) * BigInt(h.split ? 101 : 100) ? h : best;
          }, function () { return best; });
        });
      });
    }).then(function (r) {
      if (!r && rpcFails !== fails0) throw busyErr();          // "no route" only when every read answered
      return r;
    });
  }
  // Does this route move the price more than POOR_PCT? Spot is the same route at a thousandth of the size, bumped like
  // quoteOnce's until the output is big enough to be a price. A spot read that fails says "not poor": the route stands.
  var POOR_PCT = 2;
  function poorRoute(r, amtRaw) {
    var net = big(amtRaw), t0 = net / BigInt(1000);
    if (t0 < BigInt(1)) t0 = BigInt(1);
    function at(t, n) {
      return along(r.hops, t.toString(), false).then(function (o) {
        if (big(o) < BigInt(100000) && n < 2 && t * BigInt(10) <= net / BigInt(100)) return at(t * BigInt(10), n + 1);
        return { t: t, o: o };
      });
    }
    return at(t0, 0).then(function (s) {
      if (!(big(s.o) > BigInt(0))) return true;
      var ex = Number(r.out) / Number(net), sp = Number(s.o) / Number(s.t);
      return sp > 0 && (1 - ex / sp) * 100 > POOR_PCT;
    }, function () { return false; });
  }

  // The same pools, re-asked hop by hop (spot price and the final refresh use this). A split route's second leg
  // sells the floor of the first, as it will on chain.
  function along(hops, amtRaw, split) {
    var p = Promise.resolve(String(amtRaw));
    hops.forEach(function (h, i) { p = p.then(function (amt) { return hopReturn(h, split && i ? minOut(amt) : amt); }); });
    return p;
  }

  // THE QUOTE. amountRaw is what the user pays; Rhea receives amountRaw - fee, and every output figure is
  // for that net amount. Price impact = execution vs spot, spot being the same route quoted at a tiny size.
  // A BUSY ANSWER IS ASKED AGAIN, QUIETLY: three more rounds over about 14 seconds, while the caller's button says
  // "Quoting…". e.noroute is an answer and is not. live(), when given, is the caller's "is this still the amount on
  // screen?": once it is not, the rounds stop, so only the latest typed amount spends RPC calls.
  function quote(fromId, toId, amountRaw, live) {
    var at = 0;
    function go() {
      return quoteOnce(fromId, toId, amountRaw).catch(function (e) {
        if (!(e && e.busy) || at >= 3 || (live && !live())) throw e;
        var wait = [1500, 4000, 8000][at++];
        return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
          if (live && !live()) throw e;
          return go();
        });
      });
    }
    return go();
  }
  function quoteOnce(fromId, toId, amountRaw) {
    var fee = feeOf(amountRaw);
    var net = (big(amountRaw) - big(fee)).toString();
    if (big(net) <= BigInt(0)) return Promise.reject(new Error('That amount is too small to swap.'));
    return route(fromId, toId, net).then(function (r) {
      if (!r) { var e = new Error('No route between those two tokens on NEAR right now.'); e.noroute = 1; throw e; }
      var tiny = big(net) / BigInt(1000);
      if (tiny < BigInt(1)) tiny = BigInt(1);
      function spotAt(t, n) {
        return along(r.hops, t.toString(), !!r.split).then(function (o) {
          // Too few output units to be a price: ask again ten times larger, up to a hundredth of the trade.
          if (big(o) < BigInt(100000) && n < 2 && t * BigInt(10) <= big(net) / BigInt(100)) return spotAt(t * BigInt(10), n + 1);
          return { amt: t.toString(), out: o };
        });
      }
      return Promise.all([spotAt(tiny, 0).then(function (s) { return s; }, function () { return null; }), feeVia(fromId, fee, net, r)]).then(function (x) {
        var spot = x[0], via = x[1], impact = null;
        if (spot && big(spot.out) > BigInt(0)) {
          // (out/net) / (spotOut/spotAmt) - 1, in floating point only for display.
          var ex = Number(r.out) / Number(net), sp = Number(spot.out) / Number(spot.amt);
          if (sp > 0) impact = Math.max(0, (1 - ex / sp) * 100);
        }
        return {
          from: fromId, to: toId, amount: String(amountRaw), fee: fee, net: net,
          out: r.out, min: minOut(r.out), slipBps: SLIP_BPS, hops: r.hops, split: r.split || null, impact: impact, at: Date.now(),
          feeVia: via, feeNear: via ? via.out : (contractOf(fromId) === WNEAR ? fee : null)
        };
      });
    });
  }

  // THE FEE SLICE'S POOL: the deepest classic X/wNEAR pool, from the pool rows the quote engine already holds (no
  // RPC call). Rejects when the rows could not be read, which is not "no pool".
  function wnearPool(c) {
    return pools().then(function (cur) {
      return poolsWith(cur, c).then(function (more) { return poolsBetween(cur.concat(more), c, WNEAR, 1)[0] || null; });
    });
  }
  // { pool, out, min } for the fee slice, or null when it is paid in X (no pool) or not at all. A route whose first hop
  // is that classic pool prices the slice off it at no cost (the slice is the smaller trade, so it is not overstated
  // beyond what the floor allows); otherwise one get_return.
  function feeVia(fromId, fee, net, r) {
    var c = contractOf(fromId);
    if (c === WNEAR || router() || big(fee) <= BigInt(0)) return Promise.resolve(null);
    return wnearPool(c).then(function (p) {
      if (!p) return null;
      var h = r.hops[0];
      var priced = (!h.pool.dcl && String(h.pool.id) === String(p.id) && h.tin === c && h.tout === WNEAR && !r.split)
        ? Promise.resolve((big(h.out) * big(fee) / big(net)).toString())
        : getReturn(p.id, c, WNEAR, fee);
      return priced.then(function (out) {
        if (!(big(out) > BigInt(1))) return null;               // a slice worth nothing in wNEAR takes no fee
        return { pool: +p.id, out: String(out), min: (big(out) / BigInt(2)).toString() };
      });
    }, function () { throw busyErr(); });
  }

  // ---- accounts --------------------------------------------------------------------------------------
  function storageOf(contract, account) { return callView(contract, 'storage_balance_of', { account_id: account }); }
  function storageMin(contract) {
    return callView(contract, 'storage_balance_bounds', {}).then(function (b) {
      var m = b && b.min != null ? String(b.min) : '';
      if (!/^[0-9]+$/.test(m)) throw new Error('This token did not say what registering costs.');
      return m;
    });
  }
  // Is the fee account registered on the token the user PAYS with? Definite answers are cached for the
  // page session; a failed read is not cached and answers null ("could not ask").
  var FEE_REG = {};
  function regReady(c, acct, what) {
    var k = acct + '|' + c;
    if (FEE_REG[k] === true || FEE_REG[k] === false) return Promise.resolve(FEE_REG[k]);
    if (FEE_REG[k] && FEE_REG[k].then) return FEE_REG[k];
    var p = storageOf(c, acct).then(function (sb) {
      FEE_REG[k] = !!sb;
      if (!sb) try { console.warn('[lxnSwap] ' + what + ' ' + acct + ' is not registered on ' + c + ' -- swaps from it stay disabled'); } catch (e) {}
      return FEE_REG[k];
    }, function () { delete FEE_REG[k]; return null; });
    FEE_REG[k] = p;
    return p;
  }
  // With a router, the router must be registered on the input token too: the user's tokens go to it first.
  // Without one, a token with a classic X/wNEAR pool pays its fee as wNEAR, so only wNEAR's registration counts.
  function feeReady(fromId) {
    var c = contractOf(fromId), acct = feeAccount(), rt = router();
    if (!acct) return Promise.resolve(false);
    if (!rt && c !== WNEAR) {
      return wnearPool(c).then(function (p) { return p ? regReady(WNEAR, acct, 'fee account') : regReady(c, acct, 'fee account'); },
        function () { return null; });
    }
    var checks = [regReady(c, acct, 'fee account')];
    if (rt) checks.push(regReady(c, rt, 'router'));
    return Promise.all(checks).then(function (r) {
      if (r.indexOf(null) >= 0) return null;
      return r.indexOf(false) < 0;
    });
  }

  // Raw balance the account can spend in this token. Native NEAR is the account balance less the storage
  // it must keep (as nearcore.js computes it); MAX later takes NEAR_KEEP off that.
  function balance(me, id) {
    if (id === 'near') {
      return view({ request_type: 'view_account', finality: 'final', account_id: me }).then(function (a) {
        var amt = big(a.amount), locked = big(a.locked || '0');
        var storage = big(a.storage_usage || 0) * big('10000000000000000000');
        var keep = storage > locked ? storage - locked : BigInt(0);
        var sp = amt > keep ? amt - keep : BigInt(0);
        return sp.toString();
      });
    }
    return callView(id, 'ft_balance_of', { account_id: me }).then(function (b) { return String(b || '0'); });
  }
  function maxSpend(id, rawBal) {
    if (id !== 'near') return String(rawBal);
    var v = big(rawBal) - big(NEAR_KEEP);
    return (v > BigInt(0) ? v : BigInt(0)).toString();
  }

  // ---- building ---------------------------------------------------------------------------------------
  // Everything the chain can tell us before the user signs: output registration, wrap.near registration
  // for a NEAR input, the fee account's registration. Resolves { txs, steps, deposits } or rejects with a
  // sentence for the user.
  // What a swap may spend of a balance: NEAR keeps SWAP_KEEP back for the gas (see above), tokens all of it.
  function swapRoom(id, rawBal) {
    if (id !== 'near') return String(rawBal);
    var v = big(rawBal) - big(SWAP_KEEP);
    return (v > BigInt(0) ? v : BigInt(0)).toString();
  }
  // The minter of a LumosCore Launchpad token on either side, or "" (RAZA 2026-11-24, minter fee share).
  function lxMinterN(me, inC, outC) {
    var ids = [outC, inC].filter(function (c) { return c && c !== WNEAR && c !== 'near'; });
    function one(i) {
      if (i >= ids.length) return Promise.resolve('');
      return fetch('/lxapi/minters?net=near&id=' + encodeURIComponent(ids[i])).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (!d || !d.minter) return one(i + 1); return d.minter !== me ? d.minter : '=self'; }).catch(function () { return ''; });
    }
    return Promise.race([one(0), new Promise(function (res) { setTimeout(function () { res(''); }, 2500); })]);
  }
  function build(me, q) {
    var acct = feeAccount();
    var inC = contractOf(q.from), outC = contractOf(q.to);
    var outNative = q.to === 'near';
    var sp = q.split || null;                        // two swaps in a row: see viaHub
    return Promise.all([
      balance(me, 'near'),
      feeReady(q.from),
      outNative ? Promise.resolve(true) : storageOf(outC, me),
      q.from === 'near' ? storageOf(WNEAR, me) : Promise.resolve(true),
      q.from === 'near' ? balance(me, WNEAR).catch(function () { return null; }) : Promise.resolve(null),
      sp ? storageOf(sp.hub, me) : Promise.resolve(true),
      sp ? balance(me, sp.hub).catch(function () { return null; }) : Promise.resolve(null),
      lxMinterN(me, inC, outC)
    ]).then(function (r0) {
      var nearHave = r0[0], r = r0.slice(1);
      var mnt = r0[7] || '', mintNear = BigInt(0), feeAmt = q.fee, viaMin = q.feeVia ? q.feeVia.min : null;
      // MINTER SHARE ONLY ON SWAPS WORTH 1+ (RAZA 2026-11-24).
      var _nv = (q.from === 'near' || inC === WNEAR) ? big(q.amount) : ((outNative || outC === WNEAR) ? big(q.out || q.min || '0')
        : (q.feeVia && q.feeVia.out ? big(q.feeVia.out) * BigInt(10000) / BigInt(feeBps()) : null));
      if (_nv !== null && _nv < big('1000000000000000000000000')) mnt = '';
      if (mnt && !router() && big(q.fee) > BigInt(0)) {
        if (q.from === 'near') { mintNear = big(q.fee) * BigInt(3) / BigInt(10); feeAmt = (big(q.fee) - mintNear).toString(); }
        else if (q.feeVia && big(q.feeVia.min) > BigInt(0)) {
          var _sh = big(q.fee) * BigInt(3) / BigInt(10);
          mintNear = big(q.feeVia.out || q.feeVia.min) * BigInt(3) / BigInt(10);
          feeAmt = (big(q.fee) - _sh).toString(); viaMin = (big(q.feeVia.min) - big(q.feeVia.min) * BigInt(3) / BigInt(10)).toString();
        }
      }
      var wnearBefore = r[3];
      if (r[0] !== true) throw new Error(r[0] === false ? 'Swaps from this token are not enabled yet.' : 'Could not check the fee setup — try again.');
      var needOut = !r[1], needWrap = !r[2], needHub = !r[4], hubBefore = r[5];
      return Promise.all([needOut ? storageMin(outC) : null, needWrap ? storageMin(WNEAR) : null, needHub ? storageMin(sp.hub) : null]).then(function (m) {
        var txs = [];
        if (needOut) {
          txs.push({ signerId: me, receiverId: outC, actions: [{ type: 'FunctionCall', params: {
            methodName: 'storage_deposit', args: { account_id: me, registration_only: true }, gas: '30' + TGAS, deposit: m[0] } }] });
        }
        // A split route's first swap pays the hub token out to the user, who must be registered on it like any output.
        if (needHub) {
          txs.push({ signerId: me, receiverId: sp.hub, actions: [{ type: 'FunctionCall', params: {
            methodName: 'storage_deposit', args: { account_id: me, registration_only: true }, gas: '30' + TGAS, deposit: m[2] } }] });
        }
        // WRAPPING IS ITS OWN TRANSACTION, as Rhea's own app does it (RAZA 2026-10-30: HOT refused the swap three
        // times with "User rejected the request" after he approved; nothing reached the chain). Every step of the
        // single transaction was valid on chain -- checked one by one -- but the fee and the swap spend wNEAR that
        // the wrap step only creates a moment earlier, and HOT pre-checks a transaction against the balances as
        // they stand before it. HOT sends a batch one transaction after the other, so by the time it checks the
        // swap, the wrap has landed and the wNEAR is there.
        if (q.from === 'near') {
          var wrap = [];
          if (needWrap) {
            wrap.push({ type: 'FunctionCall', params: { methodName: 'storage_deposit',
              args: { account_id: me, registration_only: true }, gas: '10' + TGAS, deposit: m[1] } });
          }
          wrap.push({ type: 'FunctionCall', params: { methodName: 'near_deposit', args: {}, gas: '10' + TGAS, deposit: (big(q.amount) - mintNear).toString() } });
          txs.push({ signerId: me, receiverId: WNEAR, actions: wrap });
        }
        var actions = [], used = 0;
        var rt = router();
        // The swap this transaction makes: the whole route, or a split route's first leg, ending in the hub token.
        var first = sp ? [q.hops[0]] : q.hops, firstOut = sp ? sp.hub : outC, firstMin = sp ? sp.amount : q.min, firstSkip = sp ? true : !outNative;
        var acts = first.every(function (h) { return h.pool.dcl; }) ? [] : first.map(function (h, i) {
          var a = { pool_id: +h.pool.id, token_in: h.tin, token_out: h.tout };
          // Through the router the first hop names no amount: Rhea then swaps exactly what the router
          // forwards, so a rounding difference can never leave part of it unused (which would read as a refund).
          if (i === 0 && !rt) a.amount_in = q.net;
          a.min_amount_out = i === first.length - 1 ? firstMin : '0';
          return a;
        });
        // THE FEE, first in the transaction: wNEAR through Rhea when X has a classic X/wNEAR pool (q.feeVia), else an
        // ft_transfer in X (wNEAR itself included); nothing when the slice is 0. See the header.
        var feeActs = function () {
          if (!(big(q.fee) > BigInt(0))) return;
          if (q.feeVia) {
            actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call',
              args: { receiver_id: REF, amount: feeAmt, msg: JSON.stringify({ force: 0, actions: [{ pool_id: q.feeVia.pool, token_in: inC, token_out: WNEAR,
                amount_in: feeAmt, min_amount_out: viaMin }], skip_unwrap_near: true, swap_out_recipient: acct }) },
              gas: FEE_SWAP_GAS + TGAS, deposit: '1' } });
            used += FEE_SWAP_GAS;
            return;
          }
          actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer',
            args: { receiver_id: acct, amount: feeAmt, memo: 'LumosCore platform fee ' + (feeBps() / 100) + '%' }, gas: '30' + TGAS, deposit: '1' } });
          used += 30;
        };
        if (!acts.length) {
          // A DCL SWAP: the fee and then ft_transfer_call to DCL, the shape the classic swap takes without a router
          // (the router speaks Rhea's classic actions only). The message is DCL's own, as Rhea's app sends it on
          // chain: {"Swap":{pool_ids, output_token, min_output_amount, skip_unwrap_near}}. The fee slice still goes
          // through a classic X/wNEAR pool when X has one.
          feeActs();
          actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call',
            args: { receiver_id: DCL, amount: q.net, msg: JSON.stringify({ Swap: { pool_ids: first.map(function (h) { return h.pool.id; }), output_token: firstOut,
              min_output_amount: firstMin, skip_unwrap_near: firstSkip } }) },
            gas: String(Math.min(SWAP_GAS, MAX_TX_GAS - used)) + TGAS, deposit: '1' } });
        } else if (rt) {
          // ONE action: the gross amount to the router, which takes the fee only if the swap fills.
          actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call',
            args: { receiver_id: rt, amount: q.amount, msg: JSON.stringify({ fee_bps: feeBps(), actions: acts, skip_unwrap_near: firstSkip }) },
            gas: String(Math.min(SWAP_GAS, MAX_TX_GAS - used)) + TGAS, deposit: '1' } });
        } else {
          feeActs();
          var msg = { force: 0, actions: acts, skip_unwrap_near: firstSkip };
          actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call',
            args: { receiver_id: REF, amount: q.net, msg: JSON.stringify(msg) },
            gas: String(Math.min(SWAP_GAS, MAX_TX_GAS - used)) + TGAS, deposit: '1' } });
        }
        txs.push({ signerId: me, receiverId: inC, actions: actions });
        if (mintNear > BigInt(0) && mnt !== '=self') txs.push({ signerId: me, receiverId: mnt, actions: [{ type: 'Transfer', params: { deposit: mintNear.toString() } }] });
        // A split route's second swap: the hub token the first left in the wallet, on the other contract. Its
        // own transaction, as wrapping is: HOT checks each one against the balances as they stand when it reaches it.
        if (sp) {
          var h2 = q.hops[1];
          txs.push({ signerId: me, receiverId: sp.hub, actions: [{ type: 'FunctionCall', params: { methodName: 'ft_transfer_call',
            args: { receiver_id: h2.pool.dcl ? DCL : REF, amount: sp.amount, msg: JSON.stringify(h2.pool.dcl
              ? { Swap: { pool_ids: [h2.pool.id], output_token: outC, min_output_amount: q.min, skip_unwrap_near: !outNative } }
              : { force: 0, actions: [{ pool_id: +h2.pool.id, token_in: h2.tin, token_out: h2.tout, amount_in: sp.amount, min_amount_out: q.min }], skip_unwrap_near: !outNative }) },
            gas: SWAP_GAS + TGAS, deposit: '1' } }] });
        }
        var dep = BigInt(0);
        if (needOut) dep += big(m[0]);
        if (needWrap) dep += big(m[1]);
        if (needHub) dep += big(m[2]);
        if (q.from !== 'near' && mnt !== '=self') dep += mintNear;
        // The gas reserve, checked here so every swap screen gets the same answer before anything is signed.
        // WHAT A TOKEN SALE HOLDS BACK (RAZA 2026-11-12: NEARLY -> NEAR refused with 0.1358 NEAR in the wallet). SWAP_KEEP's
        // 0.2 is Rhea's own rule and HOT's measured refusal for a swap that SPENDS NEAR. Selling a token spends no NEAR:
        // the chain only sets aside each transaction's attached gas, paid ahead at a price that may inflate before it is
        // used, and refunds the rest. So a token sale keeps GAS_HOLD times the attached gas at NEAR's floor gas price
        // (100 million yocto a unit of gas): 270 TGas reads 0.081 NEAR. Storage the swap registers is added on top.
        var keep = big(SWAP_KEEP);
        if (q.from !== 'near') {
          var tg = 0;
          txs.forEach(function (t) { t.actions.forEach(function (x) { tg += Number(String(x.params.gas || '0').slice(0, -12) || 0); }); });
          keep = BigInt(Math.ceil(tg * GAS_HOLD)) * big(GAS_PRICE_FLOOR) * BigInt(1000000000000);
        }
        var needNear = dep + (q.from === 'near' ? big(q.amount) : BigInt(0)) + keep;
        if (big(nearHave) < needNear) {
          var keepTxt = fromUnits(keep.toString(), 24), kd = keepTxt.indexOf('.');
          if (kd >= 0) keepTxt = keepTxt.slice(0, kd + 4);
          throw new Error('Keep at least ' + keepTxt + ' NEAR in your wallet for gas: NEAR sets the gas aside before a swap runs and refunds what is not used. '
            + 'You have ' + fromUnits(nearHave, 24).replace(/(\.\d{4})\d+$/, '$1') + ' NEAR.');
        }
        return { txs: txs, steps: txs.length, needOut: needOut, needWrap: needWrap, storage: dep.toString(),
          wrapped: q.from === 'near', wnearBefore: wnearBefore, me: me, split: sp, hubBefore: hubBefore };
      });
    });
  }

  // The NEAR a token-spending write keeps back for its gas, from the TGas its transactions attach: the rule build()
  // applies to a token sale, published so the Limit pane holds back the same (RAZA 2026-11-13, ticket 384).
  function gasKeep(tgas) {
    return (BigInt(Math.ceil((+tgas || 0) * GAS_HOLD)) * big(GAS_PRICE_FLOOR) * BigInt(1000000000000)).toString();
  }

  // Sign through NEAR Connect. One transaction -> signAndSendTransaction; registration + swap ->
  // signAndSendTransactions (all five pinned launch wallets list it in their manifest features).
  var LASTSIGN = null, LASTBUILT = null;
  function sign(b) {
    LASTSIGN = { me: b && b.txs && b.txs[0] && b.txs[0].signerId, b: b };
    LASTBUILT = b;
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    // A SIGNED SWAP TELLS THE PAGE (RAZA 2026-11-13: "i just did a swap ... Why its not showing in recent activity"): the
    // account's cached activity (nearcore activityData, kept 60s) is dropped and 'lxn:signed' fires, so lists that show
    // the account's own trades read them again instead of waiting out a cache.
    var signer = LASTSIGN.me || '';
    function landed(r) {
      try { if (signer) sessionStorage.removeItem('lxn.act.' + signer); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('lxn:signed', { detail: { me: signer } })); } catch (e) {}
      return r;
    }
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      if (b.txs.length === 1) {
        if (typeof w.signAndSendTransaction !== 'function') throw new Error('This wallet cannot sign transactions here.');
        return w.signAndSendTransaction(b.txs[0]).then(function (r) { return landed([r]); });
      }
      if (typeof w.signAndSendTransactions !== 'function') throw new Error('This wallet cannot sign several transactions at once.');
      return w.signAndSendTransactions({ signerId: b.txs[0].signerId, transactions: b.txs.map(function (t) {
        return { receiverId: t.receiverId, actions: t.actions };
      }) }).then(landed);
    });
  }

  // WHAT A WALLET ERROR ACTUALLY MEANT (RAZA 2026-10-30, a real NEAR -> USDC swap from HOT: approved, then "The
  // swap was not approved, so nothing was swapped"). It was approved: the first of the two transactions -- the
  // one-time USDC registration -- landed on chain, and the wallet stopped before the swap. The message came from
  // matching words like "closed" in the error, which says nothing about what reached the chain.
  //
  // So every swap screen hands the error here. When the swap began with a registration, the chain is asked
  // whether that registration now exists; if it does, the person is told exactly that. "Not approved" is said
  // only when the wallet said so AND nothing landed. Anything else shows the wallet's own words. The raw error
  // is always kept (window.__lxnLastSwapErr, and the console), so the next report can be read, not guessed.
  function afterError(e) {
    var m = String((e && e.message) || e || '');
    window.__lxnLastSwapErr = m;
    try { console.warn('[LumosCore swap] wallet error:', e); } catch (x) {}
    var L = LASTSIGN; LASTSIGN = null;
    var reg1 = !!(L && L.b && L.b.needOut && L.b.txs && L.b.txs.length > 1);
    var outC = reg1 ? L.b.txs[0].receiverId : '';
    var check = reg1 ? storageOf(outC, L.me).then(function (s) { return !!s; }, function () { return null; }) : Promise.resolve(null);
    // Did the wrap land without the swap? Then the person's NEAR is now wNEAR, and they must be told so.
    var wrapCheck = (L && L.b && L.b.wrapped && L.b.wnearBefore != null)
      ? balance(L.me, WNEAR).then(function (now) { return big(now) > big(L.b.wnearBefore) ? (big(now) - big(L.b.wnearBefore)).toString() : null; }, function () { return null; })
      : Promise.resolve(null);
    // Did a split route's first swap land without its second? Then the person now holds the hub token, and must be told.
    var hubCheck = (L && L.b && L.b.split && L.b.hubBefore != null)
      ? balance(L.me, L.b.split.hub).then(function (now) { return big(now) > big(L.b.hubBefore) ? (big(now) - big(L.b.hubBefore)).toString() : null; }, function () { return null; })
      : Promise.resolve(null);
    return Promise.all([check, wrapCheck, hubCheck]).then(function (rr) {
      var registered = rr[0], wrappedRaw = rr[1], hubRaw = rr[2];
      if (hubRaw) {
        var hc = L.b.split.code, hd = (META[L.b.split.hub] && META[L.b.split.hub].dec) || (L.b.split.hub === WNEAR ? 24 : 6);
        return 'Only the first step went through: you now hold ' + fromUnits(hubRaw, hd).replace(/([.][0-9]{6})[0-9]+$/, '$1') + ' ' + hc
          + ' in your wallet. The second step did not. Swap that ' + hc + ' from your wallet to finish.';
      }
      if (wrappedRaw) {
        return 'Your ' + fromUnits(wrappedRaw, 24).replace(/(\.\d{6})\d+$/, '$1') + ' NEAR was wrapped into wNEAR (it shows in your wallet as wNEAR), '
          + 'but the swap itself did not go through. Nothing is lost: wNEAR is NEAR one-to-one. The wallet said: "'
          + String(m || 'no reason given').replace(/\s+/g, ' ').slice(0, 140) + '".';
      }
      if (registered === true) {
        var code = (META[outC] && META[outC].code) || 'the token you are buying';
        return 'Only the first step went through: your account is now registered for ' + code + ' (a one-time deposit). '
          + 'The swap itself did not go through — check your wallet activity, then press Swap again to finish it.';
      }
      // THE WALLET'S OWN WORDS, BUT ONLY WHEN THEY SAY SOMETHING (RAZA 2026-11-03: "i want the error message to
      // be 'Cancelled by the user.' instead of whatever BS it currently says" -- the same wording now used on
      // Stellar and XRPL).
      //
      // This is deliberately NOT a plain rename, and the reasoning it replaces is why. HOT answered a GAS
      // SHORTFALL with "User rejected the request" (RAZA's second attempt, 2026-10-30): balance 0.147 NEAR,
      // Rhea needs 0.2 on hand, and nobody rejected anything. "Cancelled by the user." would state as fact
      // something that was false, and bury the one thing that would have explained it. Two checks stand
      // between the wallet's refusal and that sentence:
      //
      //   1. ASK THE CHAIN, NOT THE ERROR. build() already refuses under SWAP_KEEP before anything is signed,
      //      but HOT applies a threshold of its own and a balance can move between build and signature, so the
      //      balance is read again HERE. Below the gas floor, the shortfall is named and the person is not.
      //   2. READ THE WORDS. A bare "User rejected the request" carries nothing beyond the refusal itself, so
      //      wording it plainly loses no information. A message that ALSO mentions gas, balance, storage or a
      //      fee is carrying the evidence, and that is shown verbatim exactly as before.
      var words = m ? m.replace(/\s+/g, ' ').slice(0, 180).replace(/\.$/, '') : '';
      if (/reject|denied|cancel|declin/i.test(m)) {
        var tells = /gas|balance|insufficient|not enough|storage|deposit|fund|fee|0\.2/i.test(m);
        var who = (L && L.me) || '';
        var ask = who
          ? balance(who, 'near').then(function (raw) { return big(raw) < big(SWAP_KEEP) ? raw : null; },
                                      function () { return null; })
          : Promise.resolve(null);
        return ask.then(function (short) {
          if (short != null) {
            return 'The swap was not sent: your wallet is down to ' + fromUnits(short, 24).replace(/(\.\d{4})\d+$/, '$1')
              + ' NEAR, and a swap needs 0.25 NEAR on hand for gas. NEAR sets the gas aside before the swap runs '
              + 'and refunds what it does not use. Top up and try again.';
          }
          return tells ? ('Nothing was swapped. The wallet said: "' + words + '".') : 'Cancelled by the user.';
        });
      }
      return (words ? 'The wallet stopped: "' + words + '". ' : 'The swap could not be completed. ')
        + 'Check your wallet activity before trying again.';
    });
  }

  // What happened, from the swap transaction's outcome (the last one). ft_transfer_call returns the amount
  // the receiver USED: "0" means Rhea refused the swap and the input came back (the fee did not).
  function verdictOf(r) {
    var st = r && r.status;
    if (!st || typeof st !== 'object') return { ok: null };
    if (st.Failure) return { ok: false, why: 'failed' };
    if (st.SuccessValue != null) {
      var used = null;
      try { used = JSON.parse(atob(st.SuccessValue)); } catch (e) {}
      if (used === '0') return { ok: false, why: 'refunded' };
      return { ok: true, used: used };
    }
    return { ok: null };
  }
  // A split route is two swaps, so the last outcome alone is not the answer, and "refunded" would be untrue: what came
  // back from the second swap is the hub token, not what the person paid. stranded says the first landed and the
  // second did not; a screen that does not know the word still prints its safe "failed" line.
  function verdict(results) {
    var n = results ? results.length : 0, v = verdictOf(n ? results[n - 1] : null);
    if (!(LASTBUILT && LASTBUILT.split) || n < 2) return v;
    var first = verdictOf(results[n - 2]);
    if (first.ok === false) return { ok: false, why: 'failed' };
    if (v.ok === false) return { ok: false, why: 'failed', stranded: LASTBUILT.split.code };
    return v;
  }
  function txHash(results) {
    var r = results && results[results.length - 1];
    if (!r) return '';
    return (r.transaction && r.transaction.hash) || (r.transaction_outcome && r.transaction_outcome.id) || '';
  }

  window.lxnSwap = {
    get FEE_BPS() { return feeBps(); }, get ROUTED() { return !!router(); }, SLIP_BPS: SLIP_BPS, REF: REF, WNEAR: WNEAR, USDC: USDC, NET_FEE_EST: NET_FEE_EST,
    feeAccount: feeAccount, feeReady: feeReady, feeOf: feeOf, minOut: minOut, swapRoom: swapRoom, SWAP_KEEP: SWAP_KEEP, gasKeep: gasKeep,
    toUnits: toUnits, fromUnits: fromUnits, toNum: toNum, big: big,
    tokenInfo: tokenInfo, remember: remember, meta: function (id) { return META[id] || null; },
    pools: pools, quote: quote, along: along, balance: balance, maxSpend: maxSpend,
    build: build, sign: sign, verdict: verdict, txHash: txHash, callView: callView, afterError: afterError
  };
})();
