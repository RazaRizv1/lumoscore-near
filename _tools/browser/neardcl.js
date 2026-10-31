// NEAR LIMIT ORDERS through Rhea Finance's DCL contract (dclv2.ref-labs.near): the ONE implementation of
// pool lookup, price <-> point math, the order book, and building place / cancel / collect transactions.
// The Trade-Asset Limit pane (browser/dxalimit.js), the order book (browser/dexasset.js) and the Wallet
// page's Open orders (browser/wallet.js) all drive it. window.lxnDcl. No UI of its own.
//
// WHAT THE CONTRACT DOES (v2.3.15, checked 2026-10-21 against Rhea's own SDK -- github ref-finance/ref-sdk
// src/dcl-swap/swap.ts + limit-order.ts + src/utils.ts -- and against real mainnet transactions):
//   * PLACE = ft_transfer_call of the SELL token to dclv2.ref-labs.near, 1 yocto, 180 TGas, with msg
//     {"LimitOrderWithSwap":{pool_id, buy_token, point, client_id:"", referral_id:""}}. A price that crosses
//     the pool swaps first and rests the remainder. ft_transfer_call returns the amount USED: "0" means the
//     contract refused the order and the tokens came back.
//   * Before it (separate transactions, SDK order): storage_deposit on the BUY token if the account is not
//     registered there, then storage_deposit {registration_only:true} on dclv2 if storage_balance_of is null
//     -- min from storage_balance_bounds, 0.5 NEAR today. Each resting order then holds 0.01 NEAR of that
//     storage (measured: 0.1 NEAR base + 0.01 per order on four accounts, 2026-10-21), so an account with
//     less than one order's worth available is topped up by 0.1 NEAR first. (The SDK does not check this;
//     an order without storage would be refused.)
//   * Paying NEAR: the sell token is wrap.near. The same transaction registers on wrap.near if needed,
//     near_deposit's the amount and then calls ft_transfer_call -- the shape browser/nearswap.js uses.
//   * CANCEL = cancel_order {order_id, amount: remain_amount} on dclv2, 0 deposit, 180 TGas. COLLECT (a
//     filled order's proceeds) = cancel_order {order_id, amount:"0"}. Both ft_transfer the remaining sell
//     token AND the bought amount straight to the owner (mainnet 6dVpDC9F..., AUuWGP3K..., 2026-10-21); an
//     owner not registered on a token gets it parked in the contract instead, so registration goes first.
//   * Views: get_pool, get_marketdepth (liquidity ranges + resting orders either side of the price),
//     list_active_orders, get_order, storage_balance_of / storage_balance_bounds.
//
// PRICE <-> POINT is the SDK's own math, ported exactly (getPointByPrice / priceToPoint / pointToPrice):
// a point p means "1 raw token_x = 1.0001^p raw token_y". The SDK floors the point to the pool's
// point_delta on the SELL token's price, then negates it when the sell token is token_y -- so the resting
// price is always at, or up to one point_delta worse than, the price typed. The Limit pane shows the
// snapped price in "Filled when".
//
// Amounts are integer STRINGS in raw units (BigInt arithmetic); floats only for display and for the
// logarithm the SDK itself takes.
(function () {
  if (window.lxnDcl) return;

  var DCL = 'dclv2.ref-labs.near';
  var WNEAR = 'wrap.near';
  var RPC = 'https://free.rpc.fastnear.com';
  var TGAS = '000000000000';
  var FEES = [100, 400, 2000, 10000];                       // DCL_POOL_FEE_LIST
  var CONSTANT_D = 1.0001, POINTLEFTRANGE = -800000, POINTRIGHTRANGE = 800000;
  var ORDER_STORAGE = '10000000000000000000000';            // 0.01 NEAR held per resting order (measured)
  var STORAGE_TOPUP = '100000000000000000000000';           // 0.1 NEAR: ten more orders
  var GAS_ORDER = 180, GAS_CANCEL = 180, GAS_REG = 30;      // TGas, as the SDK sends them
  // THE LUMOSCORE FEE ON A LIMIT ORDER (RAZA 2026-11-01: "If its feasible on Near, then we should charge 0.2%
  // fees" -- Stellar's are free only because a fee could not be attached there). 0.2% of what the order sells,
  // 0.1% at the 250,000-LUMOS tier (window.__lxFeeRate, browser/feerate.js), in the sold token, ON TOP of the
  // order: an order sells and buys exactly what was typed. Taken when the order is PLACED, as an ft_transfer to
  // the fee account in the same transaction as the ft_transfer_call -- the swap's own shape (browser/nearswap.js)
  // -- so it is paid whether or not the order later fills or is cancelled; DCL offers no way to take it on fill.
  var GAS_FEE = 30;
  function feeBps() { return window.__lxFeeRate === 0.001 ? 10 : 20; }
  function feeAccount() { try { return window.lxnSwap.feeAccount(); } catch (e) { return 'fees-lumoscore.near'; } }

  // ---- reads: one queue, at most two in flight, so a page never bursts the free RPC -------------------
  var Q = [], active = 0;
  function pump() {
    while (active < 2 && Q.length) { active++; (Q.shift())(function () { active--; pump(); }); }
  }
  function rpc(params, attempt) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 15000);
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'lxd', method: 'query', params: params }),
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
      return new Promise(function (r) { setTimeout(r, 900 + 1200 * (attempt || 0)); })
        .then(function () { return rpc(params, (attempt || 0) + 1); });
    });
  }
  function queued(params) {
    return new Promise(function (res, rej) {
      Q.push(function (done) { rpc(params).then(function (v) { done(); res(v); }, function (e) { done(); rej(e); }); });
      pump();
    });
  }
  function callView(contract, method, args) {
    return queued({
      request_type: 'call_function', finality: 'final', account_id: contract,
      method_name: method, args_base64: btoa(JSON.stringify(args || {}))
    }).then(function (r) {
      var bytes = new Uint8Array((r && r.result) || []), txt = '';
      try { txt = new TextDecoder().decode(bytes); } catch (e) { for (var i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]); }
      return txt ? JSON.parse(txt) : null;
    });
  }
  function viewAccount(id) { return queued({ request_type: 'view_account', finality: 'final', account_id: id }); }

  // ---- integer strings ---------------------------------------------------------------------------
  function big(s) { return BigInt(String(s == null || s === '' ? '0' : s)); }
  function toUnits(str, dec) {
    var s = String(str == null ? '' : str).trim().replace(/,/g, '');
    if (!/^[0-9]*\.?[0-9]*$/.test(s) || !/[0-9]/.test(s)) return null;
    var p = s.split('.'), whole = p[0] || '0', frac = p[1] || '';
    if (frac.length > dec) frac = frac.slice(0, dec);
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
  // A positive float as a plain decimal string (no exponent), for toUnits.
  function plain(n, sig) {
    if (!(n > 0) || !isFinite(n)) return '';
    var s = Number(n).toPrecision(sig || 15);
    if (s.indexOf('e') < 0) return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
    var m = s.split('e'), exp = +m[1], dig = m[0].replace('.', '').replace('-', ''), pt = m[0].indexOf('.');
    var intLen = (pt < 0 ? m[0].length : pt) + exp;
    if (intLen <= 0) { var z = ''; for (var i = 0; i < -intLen; i++) z += '0'; return ('0.' + z + dig).replace(/0+$/, ''); }
    while (dig.length < intLen) dig += '0';
    var out = dig.slice(0, intLen) + (dig.length > intLen ? '.' + dig.slice(intLen) : '');
    return out.indexOf('.') >= 0 ? out.replace(/0+$/, '').replace(/\.$/, '') : out;
  }

  // ---- the SDK's price <-> point math, verbatim in behaviour ----------------------------------------
  function feeToPointDelta(fee) {
    switch (+fee) { case 100: return 1; case 400: return 8; case 2000: return 40; case 10000: return 200; }
    throw new Error('Unknown DCL fee tier ' + fee);
  }
  function getPointByPrice(pointDelta, price, decimalRate, noNeedSlot) {
    var point = Math.log(+price * decimalRate) / Math.log(CONSTANT_D);
    var point_int = Math.round(point);
    var point_int_slot = point_int;
    if (!noNeedSlot) point_int_slot = Math.floor(point_int / pointDelta) * pointDelta;
    if (point_int_slot < POINTLEFTRANGE) return POINTLEFTRANGE;
    if (point_int_slot > POINTRIGHTRANGE) return 800000;
    return point_int_slot;
  }
  // tokenA is SOLD, amountA of it for amountB of tokenB (human decimal strings).
  function priceToPoint(decA, decB, amountA, amountB, fee) {
    if (FEES.indexOf(+fee) < 0) throw new Error('Unknown DCL fee tier ' + fee);
    var price = Number(amountB) / Number(amountA);
    var decimalRate = Math.pow(10, decB) / Math.pow(10, decA);
    return getPointByPrice(feeToPointDelta(fee), price, decimalRate);
  }
  // Price of tokenA in tokenB (human units) at a point expressed in A->B terms.
  function pointToPrice(decA, decB, point) {
    return Math.pow(CONSTANT_D, point) * Math.pow(10, decA) / Math.pow(10, decB);
  }

  // ---- pools ---------------------------------------------------------------------------------------
  function poolIdFor(a, b, fee) { return [a, b].sort().join('|') + '|' + fee; }
  function splitPool(id) { var p = String(id).split('|'); return { x: p[0], y: p[1], fee: +p[2] }; }

  // The token's DCL pool against wNEAR, or null when there is none. Every fee tier is asked; the one
  // with the most AMM liquidity wins, then (all empty) the one whose resting orders are worth the most
  // NEAR at its own price -- RHEA's four wNEAR pools hold orders and no liquidity at all.
  // A definite answer (pool or none) is kept for the page session; a failed read is NOT an answer and
  // rejects, and is asked again next time.
  var POOL = {};
  function poolFor(token) {
    if (!token || token === 'near' || token === WNEAR) return Promise.resolve(null);
    if (POOL[token]) return POOL[token];
    var p = Promise.all(FEES.map(function (f) {
      return callView(DCL, 'get_pool', { pool_id: poolIdFor(token, WNEAR, f) });
    })).then(function (rs) {
      var best = null, bestK = null;
      rs.forEach(function (r) {
        if (!r || r.state !== 'Running') return;
        var nx = r.token_x === WNEAR, p = Math.pow(CONSTANT_D, +r.current_point);   // raw y per raw x
        var ox = Number(r.total_order_x || 0), oy = Number(r.total_order_y || 0);
        var k = [big(r.liquidity), nx ? (ox + oy / p) : (oy + ox * p)];
        if (!best || k[0] > bestK[0] || (k[0] === bestK[0] && k[1] > bestK[1])) { best = r; bestK = k; }
      });
      return best ? describe(best, token) : null;
    });
    POOL[token] = p;
    p.catch(function () { if (POOL[token] === p) delete POOL[token]; });
    return p;
  }
  function describe(r, token) {
    var tokIsX = r.token_x === token;
    return {
      id: r.pool_id, x: r.token_x, y: r.token_y, fee: +r.fee, pd: +r.point_delta || feeToPointDelta(r.fee),
      token: token, tokIsX: tokIsX, cur: +r.current_point, L: String(r.liquidity), Lx: String(r.liquidity_x || '0'), raw: r
    };
  }

  // Price of the TOKEN in NEAR (human) at a pool point (x/y space).
  function tokenPriceAt(pool, decT, point) {
    var pxy = pointToPrice(pool.tokIsX ? decT : 24, pool.tokIsX ? 24 : decT, point);   // x in y
    return pool.tokIsX ? pxy : 1 / pxy;
  }

  // ---- placing --------------------------------------------------------------------------------------
  // The order the user typed, in the SDK's terms: point (the msg's), the snapped price it rests at, and
  // what is sold. side 'buy' sells NEAR (as wNEAR) for the token; 'sell' sells the token for wNEAR.
  // priceStr is NEAR per token, amountStr is the token amount; both human decimal strings.
  function plan(pool, decT, side, priceStr, amountStr) {
    var P = Number(priceStr), A = Number(amountStr);
    if (!(P > 0) || !(A > 0)) return null;
    var amtRaw = toUnits(amountStr, decT), pxRaw = toUnits(priceStr, 24);
    if (!amtRaw || amtRaw === '0' || !pxRaw || pxRaw === '0') return null;
    var nearRaw = (big(amtRaw) * big(pxRaw) / (BigInt(10) ** BigInt(decT))).toString();   // amount x price
    var sell, buy, sellRaw, point;
    if (side === 'sell') {
      sell = pool.token; buy = WNEAR; sellRaw = amtRaw;
      point = priceToPoint(decT, 24, amountStr, plain(A * P), pool.fee);
    } else {
      sell = WNEAR; buy = pool.token; sellRaw = nearRaw;
      point = priceToPoint(24, decT, plain(A * P), amountStr, pool.fee);
    }
    var msgPoint = splitPool(pool.id).x === sell ? point : -point;
    if (msgPoint === 0) msgPoint = 0;                                  // never "-0" in the JSON
    if (big(sellRaw) <= BigInt(0)) return null;
    var bps = feeBps(), feeRaw = (big(sellRaw) * BigInt(bps) / BigInt(10000)).toString();
    return {
      pool: pool.id, side: side, sell: sell, buy: buy, sellRaw: sellRaw, tokenRaw: amtRaw, nearRaw: nearRaw,
      feeBps: bps, feeRaw: feeRaw, spendRaw: (big(sellRaw) + big(feeRaw)).toString(),       // what leaves the wallet
      point: msgPoint, typed: P, rests: tokenPriceAt(pool, decT, msgPoint), delta: pool.pd
    };
  }
  function msgFor(o) {
    return JSON.stringify({ LimitOrderWithSwap: { pool_id: o.pool, buy_token: o.buy, point: o.point, client_id: '', referral_id: '' } });
  }

  function storageOf(contract, me) { return callView(contract, 'storage_balance_of', { account_id: me }); }
  function storageMin(contract) {
    return callView(contract, 'storage_balance_bounds', {}).then(function (b) {
      var m = b && b.min != null ? String(b.min) : '';
      if (!/^[0-9]+$/.test(m)) throw new Error('A contract did not say what registering costs.');
      return m;
    });
  }
  // What the account must pay before the order can rest: DCL registration (or a top-up) and buy-token
  // registration. Resolves { dcl: null|'register'|'topup', dclDeposit, needBuyReg, buyRegDeposit,
  // needWrapReg, wrapRegDeposit, storage (total NEAR raw) }.
  function prereqs(me, o) {
    // The fee account must hold a balance on the sold token, as for a swap; a token it is not registered on
    // cannot be sold through an order yet (the same answer the swap gives).
    var feeOk = window.lxnSwap && window.lxnSwap.feeReady ? window.lxnSwap.feeReady(o.sell) : Promise.resolve(true);
    return feeOk.then(function (ok) {
      if (ok === false) throw new Error('Orders selling this token are not enabled yet.');
      if (ok !== true) throw new Error('Could not check the fee setup — try again.');
    }).then(function () { return Promise.all([
      storageOf(DCL, me),
      storageOf(o.buy, me),
      o.sell === WNEAR ? storageOf(WNEAR, me) : Promise.resolve(true)
    ]).then(function (r) {
      var dcl = null;
      if (!r[0]) dcl = 'register';
      else if (big(r[0].available) < big(ORDER_STORAGE)) dcl = 'topup';
      var needBuy = !r[1], needWrap = !r[2];
      return Promise.all([
        dcl === 'register' ? storageMin(DCL) : Promise.resolve(dcl === 'topup' ? STORAGE_TOPUP : '0'),
        needBuy ? storageMin(o.buy) : Promise.resolve('0'),
        needWrap ? storageMin(WNEAR) : Promise.resolve('0')
      ]).then(function (m) {
        return {
          dcl: dcl, dclDeposit: m[0], needBuyReg: needBuy, buyRegDeposit: m[1], needWrapReg: needWrap, wrapRegDeposit: m[2],
          storage: (big(m[0]) + big(m[1]) + big(m[2])).toString()
        };
      });
    }); });
  }
  // Is this account registered on the DCL contract? true / false, or rejects when it could not ask.
  function registered(me) { return storageOf(DCL, me).then(function (s) { return !!s; }); }

  function fc(method, args, gasT, deposit) {
    return { type: 'FunctionCall', params: { methodName: method, args: args, gas: String(gasT) + TGAS, deposit: String(deposit) } };
  }
  // The transactions, in the SDK's order: buy-token registration, DCL storage, then the order.
  function buildPlace(me, o, pre) {
    var txs = [];
    if (pre.needBuyReg) txs.push({ signerId: me, receiverId: o.buy, actions: [fc('storage_deposit', { account_id: me, registration_only: true }, GAS_REG, pre.buyRegDeposit)] });
    if (pre.dcl === 'register') txs.push({ signerId: me, receiverId: DCL, actions: [fc('storage_deposit', { account_id: me, registration_only: true }, GAS_REG, pre.dclDeposit)] });
    else if (pre.dcl === 'topup') txs.push({ signerId: me, receiverId: DCL, actions: [fc('storage_deposit', { account_id: me }, GAS_REG, pre.dclDeposit)] });
    // Wrapping NEAR is its own transaction, before the order -- the same change as the swap (browser/nearswap.js):
    // HOT pre-checks each transaction against balances as they stand before it, and refused a single
    // transaction that wrapped and then spent the wNEAR it had just made.
    if (o.sell === WNEAR) {
      var wrap = [];
      if (pre.needWrapReg) wrap.push(fc('storage_deposit', { account_id: me, registration_only: true }, 10, pre.wrapRegDeposit));
      wrap.push(fc('near_deposit', {}, 10, o.spendRaw));                // the order and its fee
      txs.push({ signerId: me, receiverId: WNEAR, actions: wrap });
    }
    txs.push({ signerId: me, receiverId: o.sell, actions: [
      fc('ft_transfer', { receiver_id: feeAccount(), amount: o.feeRaw, memo: 'LumosCore limit order fee ' + (o.feeBps / 100) + '%' }, GAS_FEE, '1'),
      fc('ft_transfer_call', { receiver_id: DCL, amount: o.sellRaw, msg: msgFor(o) }, GAS_ORDER, '1')] });
    return txs;
  }

  // ---- orders ---------------------------------------------------------------------------------------
  function activeOrders(me) { return callView(DCL, 'list_active_orders', { account_id: me }).then(function (r) { return r || []; }); }
  function getOrder(id) { return callView(DCL, 'get_order', { order_id: id }); }
  // Cancel (anything still resting) or collect (fully filled, proceeds unclaimed): ONE cancel_order each,
  // its amount read fresh from get_order right before, as the SDK does. Registration on both tokens goes
  // first, so nothing is parked in the contract. Resolves { txs, kinds }.
  function buildCancel(me, ids) {
    return Promise.all(ids.map(getOrder)).then(function (os) {
      var toks = {};
      os.forEach(function (o, i) {
        if (!o) throw new Error('Order ' + ids[i] + ' is no longer open.');
        toks[o.sell_token] = 1; toks[o.buy_token] = 1;
      });
      var list = Object.keys(toks);
      return Promise.all(list.map(function (t) { return storageOf(t, me); })).then(function (regs) {
        var need = list.filter(function (t, i) { return !regs[i]; });
        return Promise.all(need.map(storageMin)).then(function (mins) {
          var txs = need.map(function (t, i) {
            return { signerId: me, receiverId: t, actions: [fc('storage_deposit', { account_id: me, registration_only: true }, GAS_REG, mins[i])] };
          });
          var kinds = [];
          os.forEach(function (o) {
            var collect = big(o.remain_amount) <= BigInt(0);
            kinds.push(collect ? 'collect' : 'cancel');
            txs.push({ signerId: me, receiverId: DCL, actions: [fc('cancel_order', { order_id: o.order_id, amount: collect ? '0' : String(o.remain_amount) }, GAS_CANCEL, '0')] });
          });
          return { txs: txs, kinds: kinds, orders: os };
        });
      });
    });
  }

  // ---- signing (a person approves every transaction in their own wallet) ----------------------------
  function sign(txs) {
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      if (txs.length === 1) {
        if (typeof w.signAndSendTransaction !== 'function') throw new Error('This wallet cannot sign transactions here.');
        return w.signAndSendTransaction(txs[0]).then(function (r) { return [r]; });
      }
      if (typeof w.signAndSendTransactions !== 'function') throw new Error('This wallet cannot sign several transactions at once.');
      return w.signAndSendTransactions({ signerId: txs[0].signerId, transactions: txs.map(function (t) {
        return { receiverId: t.receiverId, actions: t.actions };
      }) });
    }).catch(function (e) {
      // Tagged, so every order screen can tell the WALLET's answer from its own pre-signing checks.
      var err = (e instanceof Error) ? e : new Error(String((e && e.message) || e || ''));
      err.lxnWallet = true;
      err.lxnMulti = txs.length > 1;
      throw err;
    });
  }

  // WHAT A WALLET ERROR MEANT, SAID IN ITS OWN WORDS (2026-10-30). Every order screen read "not approved" into
  // any error containing "cancel" or "closed" -- the same guess that told RAZA a swap he had approved was not
  // (HOT's "User rejected the request" was its own refusal: too little NEAR kept for gas). A single transaction
  // the wallet refused sent nothing; a batch may have sent its setup steps first, so it says to check.
  function walletErr(e, verb) {
    var m = String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 180);
    try { console.warn('[LumosCore order] wallet error:', e); } catch (x) {}
    if (e && e.lxnMulti) return 'The wallet stopped: "' + (m || 'no reason given') + '". A setup step may already have gone through — check your wallet activity before trying again.';
    return 'Nothing was ' + verb + '. The wallet said: "' + (m || 'no reason given') + '".';
  }
  // The order transaction's outcome (the last one): ft_transfer_call returns what DCL USED.
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

  // ---- the book ---------------------------------------------------------------------------------------
  // get_marketdepth gives the AMM's liquidity ranges and the resting orders either side of the price in
  // one call. Everything is mapped into q-space, q = point for a token that is token_x and -point for one
  // that is token_y, so the TOKEN's price in NEAR always rises with q:
  //   token for sale (asks) at q > q_now:  per point  L * s^-q  raw token, s = sqrt(1.0001)
  //   NEAR bidding    (bids) at q < q_now:  per point  L * s^q   raw NEAR
  //   at q_now the pool's liquidity is split: liquidity_x sits on the x side, the rest on the y side.
  // Rows are buckets of W points (one point_delta, at least 10 points), priced at the bucket's far edge
  // (the worst price inside it); amounts are the token, depth the running total in NEAR.
  var S = Math.sqrt(CONSTANT_D);
  function sumNeg(L, a, b) {                       // sum_{q=a..b} L s^-q
    if (b < a) return 0;
    return L * Math.pow(S, -a) * (1 - Math.pow(S, -(b - a + 1))) / (1 - 1 / S);
  }
  function sumPos(L, a, b) {                       // sum_{q=a..b} L s^q
    if (b < a) return 0;
    return L * Math.pow(S, a) * (Math.pow(S, b - a + 1) - 1) / (S - 1);
  }
  function bookFrom(pool, decT, md, opts) {
    opts = opts || {};
    var dir = pool.tokIsX ? 1 : -1, maxRows = opts.rows || 16, depthN = opts.depth || 40;
    var W = Math.max(pool.pd, Math.ceil(10 / pool.pd) * pool.pd);
    var c = +md.current_point, qc = dir * c;
    var L = Number(md.amount_l || 0), Lx = Number(md.amount_l_x || 0);
    var ranges = [], above = 0, below = 0, farAbove = Infinity, farBelow = -Infinity;
    Object.keys(md.liquidities || {}).forEach(function (k) {
      var r = md.liquidities[k], l = +r.left_point, rt = +r.right_point, Lr = Number(r.amount_l);
      if (!(Lr > 0) || rt <= l) return;
      var lo = dir > 0 ? l : -(rt - 1), hi = dir > 0 ? rt - 1 : -l;
      ranges.push({ lo: lo, hi: hi, L: Lr });
      if (lo >= qc) above++; else if (hi < qc) below++; else { above++; below++; }
    });
    var orders = [], oa = 0, ob = 0;
    Object.keys(md.orders || {}).forEach(function (k) {
      var o = md.orders[k], q = dir * (+o.point);
      var tok = Number(pool.tokIsX ? o.amount_x : o.amount_y), nr = Number(pool.tokIsX ? o.amount_y : o.amount_x);
      if (tok > 0) { orders.push({ q: q, tok: tok }); oa++; }
      if (nr > 0) { orders.push({ q: q, near: nr }); ob++; }
    });
    // A side that came back with as many entries as asked for may continue past what we were told:
    // stop bucketing at the far edge of what was returned rather than imply the book ends there.
    if (above >= depthN) { farAbove = -Infinity; ranges.forEach(function (r) { if (r.hi > farAbove) farAbove = r.hi; }); }
    if (below >= depthN) { farBelow = Infinity; ranges.forEach(function (r) { if (r.lo < farBelow) farBelow = r.lo; }); }
    if (oa >= depthN) { var mo = -Infinity; orders.forEach(function (o) { if (o.tok && o.q > mo) mo = o.q; }); farAbove = Math.min(farAbove, mo); }
    if (ob >= depthN) { var mb = Infinity; orders.forEach(function (o) { if (o.near && o.q < mb) mb = o.q; }); farBelow = Math.max(farBelow, mb); }

    var tenT = Math.pow(10, decT), tenN = 1e24;
    function px(q) { return Math.pow(CONSTANT_D, q) * tenT / tenN; }            // NEAR per token (human)
    // current point's split, in token / NEAR raw
    var curTok = pool.tokIsX ? Lx / Math.pow(S, c) : (L - Lx) * Math.pow(S, c);
    var curNear = pool.tokIsX ? (L - Lx) * Math.pow(S, c) : Lx / Math.pow(S, c);

    var asks = [], bids = [], runA = 0, runB = 0, k;
    var ordersAsk = orders.filter(function (o) { return o.tok; }), ordersBid = orders.filter(function (o) { return o.near; });
    var lastOrderAsk = ordersAsk.reduce(function (m, o) { return Math.max(m, o.q); }, -Infinity);
    var lastOrderBid = ordersBid.reduce(function (m, o) { return Math.min(m, o.q); }, Infinity);
    var liqTop = ranges.reduce(function (m, r) { return Math.max(m, r.hi); }, -Infinity);
    var liqBot = ranges.reduce(function (m, r) { return Math.min(m, r.lo); }, Infinity);
    var topQ = Math.min(farAbove, Math.max(liqTop, lastOrderAsk));
    var botQ = Math.max(farBelow, Math.min(liqBot, lastOrderBid));
    for (k = 0; asks.length < maxRows && k < 4000; k++) {
      var a = qc + k * W + 1, b = qc + (k + 1) * W;
      if (k > 0 && a > topQ) break;
      b = Math.min(b, topQ);
      var tok = k === 0 ? curTok : 0;
      ranges.forEach(function (r) { tok += sumNeg(r.L, Math.max(a, r.lo), Math.min(b, r.hi)); });
      ordersAsk.forEach(function (o) { if ((o.q >= a && o.q <= b) || (k === 0 && o.q <= qc)) tok += o.tok; });
      if (!(tok > 0)) continue;
      var t = tok / tenT, p = px(b);
      runA += t * p;
      asks.push({ px: p, amt: t, sum: runA, q: b });
    }
    for (k = 0; bids.length < maxRows && k < 4000; k++) {
      var hb = qc - k * W - 1, lb = qc - (k + 1) * W;
      if (k > 0 && hb < botQ) break;
      lb = Math.max(lb, botQ);
      var nr = k === 0 ? curNear : 0;
      ranges.forEach(function (r) { nr += sumPos(r.L, Math.max(lb, r.lo), Math.min(hb, r.hi)); });
      ordersBid.forEach(function (o) { if ((o.q >= lb && o.q <= hb) || (k === 0 && o.q >= qc)) nr += o.near; });
      if (!(nr > 0)) continue;
      var n = nr / tenN, p2 = px(lb);
      runB += n;
      bids.push({ px: p2, amt: n / p2, sum: runB, q: lb });
    }
    // Inside prices for the spread: the first point either side that holds anything.
    var bestAsk = asks.length ? px(curTok > 0 ? qc : qc + 1) : null, bestBid = bids.length ? px(curNear > 0 ? qc : qc - 1) : null;
    if (asks.length && !(L > 0)) { var mo2 = Infinity; ordersAsk.forEach(function (o) { if (o.q < mo2) mo2 = o.q; }); bestAsk = isFinite(mo2) ? px(mo2) : bestAsk; }
    if (bids.length && !(L > 0)) { var mb2 = -Infinity; ordersBid.forEach(function (o) { if (o.q > mb2) mb2 = o.q; }); bestBid = isFinite(mb2) ? px(mb2) : bestBid; }
    return { asks: asks, bids: bids, bestAsk: bestAsk, bestBid: bestBid, W: W, qc: qc, price: px(qc), pool: pool.id };
  }
  function book(pool, decT, opts) {
    var depth = (opts && opts.depth) || 40;
    return callView(DCL, 'get_marketdepth', { pool_id: pool.id, depth: depth }).then(function (md) {
      if (!md) throw new Error('No market depth for ' + pool.id);
      pool.cur = +md.current_point;
      var b = bookFrom(pool, decT, md, { depth: depth, rows: (opts && opts.rows) || 16 });
      b.md = md;
      return b;
    });
  }

  window.lxnDcl = {
    DCL: DCL, WNEAR: WNEAR, FEES: FEES, ORDER_STORAGE: ORDER_STORAGE, STORAGE_TOPUP: STORAGE_TOPUP,
    feeToPointDelta: feeToPointDelta, getPointByPrice: getPointByPrice, priceToPoint: priceToPoint, pointToPrice: pointToPrice,
    poolIdFor: poolIdFor, splitPool: splitPool, poolFor: poolFor, tokenPriceAt: tokenPriceAt,
    plan: plan, msgFor: msgFor, prereqs: prereqs, registered: registered, buildPlace: buildPlace,
    activeOrders: activeOrders, getOrder: getOrder, buildCancel: buildCancel,
    sign: sign, walletErr: walletErr, verdict: verdict, book: book, bookFrom: bookFrom,
    callView: callView, viewAccount: viewAccount, storageOf: storageOf, storageMin: storageMin,
    toUnits: toUnits, fromUnits: fromUnits, toNum: toNum, big: big, plain: plain
  };
})();
