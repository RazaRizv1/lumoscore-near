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
// THE FEE: 0.2% of the INPUT, in the input token, as an ft_transfer to FEE_ACCOUNT in the SAME transaction
// and the SAME receipt as the ft_transfer_call. Same receipt means: if the fee transfer fails (the fee
// account is not registered on that token), the whole receipt reverts and nothing is swapped -- the user
// pays gas for nothing. So the fee account's registration is checked on the input token BEFORE the button
// is enabled, and a token it is not registered on is simply not swappable yet. The user's transaction
// never carries a storage_deposit for the fee account: users do not pay for our registration.
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
  var WNEAR = 'wrap.near';
  var USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
  var RPC = 'https://free.rpc.fastnear.com';
  var TGAS = '000000000000';
  var MAX_TX_GAS = 300;                               // TGas per transaction
  var NEAR_KEEP = '50000000000000000000000';          // 0.05 NEAR left behind by MAX, for gas and storage
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
  function view(params, attempt) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 15000);
    return fetch(RPC, {
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
      if (err) { var e = new Error(String((err.cause && err.cause.name) || err.message || 'RPC error')); e.code = (err.cause && err.cause.name) || ''; throw e; }
      if (j && j.result && j.result.error) { var e2 = new Error(String(j.result.error)); e2.code = 'CALL'; throw e2; }
      return j.result;
    }).catch(function (e) {
      if (!(e && e.transient) || (attempt || 0) >= 2) throw e;
      return new Promise(function (r) { setTimeout(r, 700 + 900 * (attempt || 0)); })
        .then(function () { return view(params, (attempt || 0) + 1); });
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
  // The best of several pools for one leg. More in always gives more out, so choosing the best pool per
  // leg greedily is also the best two-leg route.
  function bestLeg(cands, tin, tout, amt) {
    if (!cands.length) return Promise.resolve(null);
    return Promise.all(cands.map(function (p) {
      return getReturn(p.id, tin, tout, amt).then(function (o) { return { pool: p, out: o }; }, function () { return null; });
    })).then(function (rs) {
      var best = null;
      rs.forEach(function (x) { if (x && big(x.out) > BigInt(0) && (!best || big(x.out) > big(best.out))) best = x; });
      return best;
    });
  }

  // Routes: every direct pool, and two hops through wNEAR or USDC. Quoted with get_return on Rhea itself,
  // and the route with the most output wins. Returns { hops:[{pool,tin,tout,out}], out } or null.
  function route(fromId, toId, amtRaw) {
    var a = contractOf(fromId), b = contractOf(toId);
    if (a === b) return Promise.resolve(null);
    return pools().then(function (rows) {
      var tries = [];
      tries.push(bestLeg(poolsBetween(rows, a, b, 3), a, b, amtRaw).then(function (x) {
        return x ? { hops: [{ pool: x.pool, tin: a, tout: b, out: x.out }], out: x.out } : null;
      }));
      [WNEAR, USDC].forEach(function (m) {
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
      return Promise.all(tries).then(function (rs) {
        var best = null;
        rs.forEach(function (r) { if (r && (!best || big(r.out) > big(best.out))) best = r; });
        return best;
      });
    });
  }
  // The same pools, re-asked hop by hop (spot price and the final refresh use this).
  function along(hops, amtRaw) {
    var p = Promise.resolve(String(amtRaw));
    hops.forEach(function (h) { p = p.then(function (amt) { return getReturn(h.pool.id, h.tin, h.tout, amt); }); });
    return p;
  }

  // THE QUOTE. amountRaw is what the user pays; Rhea receives amountRaw - fee, and every output figure is
  // for that net amount. Price impact = execution vs spot, spot being the same route quoted at a tiny size.
  function quote(fromId, toId, amountRaw) {
    var fee = feeOf(amountRaw);
    var net = (big(amountRaw) - big(fee)).toString();
    if (big(net) <= BigInt(0)) return Promise.reject(new Error('That amount is too small to swap.'));
    return route(fromId, toId, net).then(function (r) {
      if (!r) { var e = new Error('No route between those two tokens on Rhea right now.'); e.noroute = 1; throw e; }
      var tiny = big(net) / BigInt(1000);
      if (tiny < BigInt(1)) tiny = BigInt(1);
      function spotAt(t, n) {
        return along(r.hops, t.toString()).then(function (o) {
          // Too few output units to be a price: ask again ten times larger, up to a hundredth of the trade.
          if (big(o) < BigInt(100000) && n < 2 && t * BigInt(10) <= big(net) / BigInt(100)) return spotAt(t * BigInt(10), n + 1);
          return { amt: t.toString(), out: o };
        });
      }
      return spotAt(tiny, 0).then(function (s) { return s; }, function () { return null; }).then(function (spot) {
        var impact = null;
        if (spot && big(spot.out) > BigInt(0)) {
          // (out/net) / (spotOut/spotAmt) - 1, in floating point only for display.
          var ex = Number(r.out) / Number(net), sp = Number(spot.out) / Number(spot.amt);
          if (sp > 0) impact = Math.max(0, (1 - ex / sp) * 100);
        }
        return {
          from: fromId, to: toId, amount: String(amountRaw), fee: fee, net: net,
          out: r.out, min: minOut(r.out), slipBps: SLIP_BPS, hops: r.hops, impact: impact, at: Date.now()
        };
      });
    });
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
  function feeReady(fromId) {
    var c = contractOf(fromId), acct = feeAccount(), rt = router();
    if (!acct) return Promise.resolve(false);
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
  function build(me, q) {
    var acct = feeAccount();
    var inC = contractOf(q.from), outC = contractOf(q.to);
    var outNative = q.to === 'near';
    return Promise.all([
      feeReady(q.from),
      outNative ? Promise.resolve(true) : storageOf(outC, me),
      q.from === 'near' ? storageOf(WNEAR, me) : Promise.resolve(true)
    ]).then(function (r) {
      if (r[0] !== true) throw new Error(r[0] === false ? 'Swaps from this token are not enabled yet.' : 'Could not check the fee setup — try again.');
      var needOut = !r[1], needWrap = !r[2];
      return Promise.all([needOut ? storageMin(outC) : null, needWrap ? storageMin(WNEAR) : null]).then(function (m) {
        var txs = [];
        if (needOut) {
          txs.push({ signerId: me, receiverId: outC, actions: [{ type: 'FunctionCall', params: {
            methodName: 'storage_deposit', args: { account_id: me, registration_only: true }, gas: '30' + TGAS, deposit: m[0] } }] });
        }
        var actions = [], used = 0;
        if (q.from === 'near') {
          if (needWrap) {
            actions.push({ type: 'FunctionCall', params: { methodName: 'storage_deposit',
              args: { account_id: me, registration_only: true }, gas: '10' + TGAS, deposit: m[1] } });
            used += 10;
          }
          actions.push({ type: 'FunctionCall', params: { methodName: 'near_deposit', args: {}, gas: '10' + TGAS, deposit: q.amount } });
          used += 10;
        }
        var rt = router();
        var acts = q.hops.map(function (h, i) {
          var a = { pool_id: +h.pool.id, token_in: h.tin, token_out: h.tout };
          // Through the router the first hop names no amount: Rhea then swaps exactly what the router
          // forwards, so a rounding difference can never leave part of it unused (which would read as a refund).
          if (i === 0 && !rt) a.amount_in = q.net;
          a.min_amount_out = i === q.hops.length - 1 ? q.min : '0';
          return a;
        });
        if (rt) {
          // ONE action: the gross amount to the router, which takes the fee only if the swap fills.
          actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call',
            args: { receiver_id: rt, amount: q.amount, msg: JSON.stringify({ fee_bps: feeBps(), actions: acts, skip_unwrap_near: !outNative }) },
            gas: String(MAX_TX_GAS - used) + TGAS, deposit: '1' } });
        } else {
          actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer',
            args: { receiver_id: acct, amount: q.fee, memo: 'LumosCore platform fee ' + (feeBps() / 100) + '%' }, gas: '30' + TGAS, deposit: '1' } });
          used += 30;
          var msg = { force: 0, actions: acts, skip_unwrap_near: !outNative };
          actions.push({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call',
            args: { receiver_id: REF, amount: q.net, msg: JSON.stringify(msg) },
            gas: String(Math.min(270, MAX_TX_GAS - used)) + TGAS, deposit: '1' } });
        }
        txs.push({ signerId: me, receiverId: inC, actions: actions });
        var dep = BigInt(0);
        if (needOut) dep += big(m[0]);
        if (needWrap) dep += big(m[1]);
        return { txs: txs, steps: txs.length, needOut: needOut, needWrap: needWrap, storage: dep.toString() };
      });
    });
  }

  // Sign through NEAR Connect. One transaction -> signAndSendTransaction; registration + swap ->
  // signAndSendTransactions (all five pinned launch wallets list it in their manifest features).
  var LASTSIGN = null;
  function sign(b) {
    LASTSIGN = { me: b && b.txs && b.txs[0] && b.txs[0].signerId, b: b };
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      if (b.txs.length === 1) {
        if (typeof w.signAndSendTransaction !== 'function') throw new Error('This wallet cannot sign transactions here.');
        return w.signAndSendTransaction(b.txs[0]).then(function (r) { return [r]; });
      }
      if (typeof w.signAndSendTransactions !== 'function') throw new Error('This wallet cannot sign several transactions at once.');
      return w.signAndSendTransactions({ signerId: b.txs[0].signerId, transactions: b.txs.map(function (t) {
        return { receiverId: t.receiverId, actions: t.actions };
      }) });
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
    return check.then(function (registered) {
      if (registered === true) {
        var code = (META[outC] && META[outC].code) || 'the token you are buying';
        return 'Only the first step went through: your account is now registered for ' + code + ' (a one-time deposit). '
          + 'The swap itself did not go through — check your wallet activity, then press Swap again: it is one transaction now.';
      }
      // THE WALLET'S OWN WORDS, ALWAYS (RAZA's second HOT attempt, 2026-10-30: approved, nothing reached the
      // chain, and the page said "not approved" -- HOT's error carried one of those words for a refusal of its
      // own). Which it was is only in that text, so it is shown rather than paraphrased.
      var words = m ? m.replace(/\s+/g, ' ').slice(0, 180).replace(/\.$/, '') : '';
      if (/reject|denied|cancel|declin/i.test(m)) return 'Nothing was swapped. The wallet said: "' + words + '".';
      return (words ? 'The wallet stopped: "' + words + '". ' : 'The swap could not be completed. ')
        + 'Check your wallet activity before trying again.';
    });
  }

  // What happened, from the swap transaction's outcome (the last one). ft_transfer_call returns the amount
  // the receiver USED: "0" means Rhea refused the swap and the input came back (the fee did not).
  function verdict(results) {
    var r = results && results[results.length - 1];
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
  function txHash(results) {
    var r = results && results[results.length - 1];
    if (!r) return '';
    return (r.transaction && r.transaction.hash) || (r.transaction_outcome && r.transaction_outcome.id) || '';
  }

  window.lxnSwap = {
    get FEE_BPS() { return feeBps(); }, get ROUTED() { return !!router(); }, SLIP_BPS: SLIP_BPS, REF: REF, WNEAR: WNEAR, USDC: USDC, NET_FEE_EST: NET_FEE_EST,
    feeAccount: feeAccount, feeReady: feeReady, feeOf: feeOf, minOut: minOut,
    toUnits: toUnits, fromUnits: fromUnits, toNum: toNum, big: big,
    tokenInfo: tokenInfo, remember: remember, meta: function (id) { return META[id] || null; },
    pools: pools, quote: quote, along: along, balance: balance, maxSpend: maxSpend,
    build: build, sign: sign, verdict: verdict, txHash: txHash, callView: callView, afterError: afterError
  };
})();
