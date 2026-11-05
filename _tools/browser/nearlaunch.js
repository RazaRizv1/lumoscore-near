// NEAR Launchpad: the form rules, the cost panel, the review paint and the confirm paint.
// Ported from the XRPL fork's browser/launchpad.js; the signing half is browser/nearmint.js, injected in
// the same block by _nearlaunchpad.js. Shared state and helpers hang off window.__lxnLaunch.
//
// WHAT A NEAR LAUNCH IS (contracts/factory/src/lib.rs, read before writing this):
//   1. create_token on the LumosCore factory (FACTORY below) creates <prefix>.lumoscore.near, deploys the
//      fixed-supply token with NO access keys and mints the whole supply to the caller, in one receipt.
//      The attached deposit is storage + max(min_fee, the USD create fee in NEAR); everything above
//      storage goes to the fee account on success, and the WHOLE deposit is refunded on failure. So the
//      $5 create fee rides inside this one deposit: there is no separate fee transaction.
//   2. A new Rhea (v2.ref-finance.near) simple pool [token, wrap.near], owned by nobody but holding the
//      launcher's liquidity, seeded with $10 of NEAR plus the share of supply the slider leaves for the
//      pool. browser/nearmint.js builds and signs those transactions.
//
// THE PREFIX. The design has no field for it, so it is the ticker lowercased: $SOLAR launches as
// solar.lumoscore.near. The factory's symbol rule (2-12 of A-Z 0-9, starting with a letter) makes every
// valid ticker a valid prefix, so one rule covers both; the factory's RESERVED list is mirrored below.
//
// UNTIL THE FACTORY EXISTS the launch button stays "Launching on NEAR is coming soon": get_config on the
// factory account is asked on every review page, and a missing account, a missing contract or
// paused: true all keep it disabled. lumoscore.near does not exist on 2026-10-21, so this is what ships.
//
// Plain prose in comments: injected verbatim, never through a template literal, and no closing script tag.
(function () {
  if (window.__lxnLaunch) return;
  var L = window.__lxnLaunch = {};

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // ---- constants -------------------------------------------------------------------------------------
  var FACTORY = 'lumoscore.near';
  var REF = 'v2.ref-finance.near';
  var WNEAR = 'wrap.near';
  var RPC = 'https://free.rpc.fastnear.com';
  var DECIMALS = 18;
  var POOL_FEE_BPS = 30;                       // 0.3%: Rhea's most common simple-pool fee, see nearmint.js
  var SOON = 'Launching on NEAR is coming soon';
  var DRAFT = 'lumos.launch.draft';
  var RESULT = 'lumos.launch.result';

  // THE PRICES. Written as a literal on one line because _nearlaunchpad.js parses this exact line to write
  // the mint-cost FAQ and its FAQPage structured data, so the copy cannot quote a price the page does
  // not charge. Its TEST PRICING guard shouts on every build if these are not { create: 5, liq: 5 }.
  // liq is the NEAR side of the starting pool: $5 (RAZA 2026-11-04: "its $5 in near and $5 in token itself for
  // liquidity"). The token side is the launcher's share of the new supply, worth $5 at the opening price by
  // construction (the pool's price IS NEAR deposited / tokens deposited), so the pool opens holding $10.
  var USD_REAL = { create: 5, liq: 5 };
  var USD = { create: 5, liq: 5 };
  var TEST_PRICING = USD.create !== USD_REAL.create || USD.liq !== USD_REAL.liq;
  // A FLAT $25, AS ON STELLAR AND XRPL (RAZA 2026-11-04: "Yes, flat $25"): $5 creation + $10 liquidity + $10
  // for the pool and network. NEAR's own storage for the token and pool costs less than $10 (about $6.70 at
  // $4.31/NEAR), and the difference rides in the creation deposit, which the factory forwards to the fee
  // account above storage exactly as it does the $5. If storage alone ever costs more than $10 (NEAR above
  // roughly $5.75), nothing is added and the real, higher figure is charged and shown -- never less than cost.
  var USD_POOL = 10;
  // The LIQUIDITY LINE is $10 too (RAZA 2026-11-04: "the launcher still pays $25", "anything extra will be used
  // as revenue"): $5 of it is the NEAR that goes into the pool (USD.liq), the other $5 joins the creation
  // deposit and reaches the fee account with the rest of the revenue.
  var USD_LIQ_LINE = 10;

  // ---- storage, measured rather than guessed (2026-10-21) ---------------------------------------------
  // NEAR charges 1e19 yocto (0.00001 NEAR) per byte of storage.
  var BYTE = BigInt('10000000000000000000');
  // Factory: storage = (token wasm + name + symbol + icon + 2000) bytes (Factory::storage_bytes). The wasm
  // size comes from get_config.token_wasm_bytes when the factory answers; this is the locally built
  // contracts/token wasm, used only to estimate the panel while it does not.
  var WASM_BYTES_EST = 164456;
  var EXTRA_BYTES = 2000;
  // Rhea, from v2.ref-finance.near v1.9.20 views and real mainnet launches (nspear.near, pool 8978):
  //   storage_balance_bounds.min      1020000000000000000000   = 102 bytes, an account with no tokens
  //   get_user_storage_state          usage 398 bytes with two tokens = 102 + 2 x 148
  //   add_simple_pool attached 0.05   refunded 0.04509: the pool record cost 0.00491; the excess comes back
  //   add_liquidity attached 0.01     refunded 0.00924: the LP share record cost 0.00076
  //   a new account's storage_deposit 0.01 (registration_only false) covers 102 + 2 x 148 bytes with room
  var REF_ACCOUNT_NEW = '10000000000000000000000';      // 0.01 NEAR
  var REF_BASE_BYTES = 102, REF_TOKEN_BYTES = 148;
  var REF_POOL_DEPOSIT = '50000000000000000000000';     // 0.05 NEAR, excess refunded by Rhea
  var REF_LIQ_DEPOSIT = '10000000000000000000000';      // 0.01 NEAR, excess refunded by Rhea
  // THE LIQUIDITY LOCK (RAZA 2026-11-03: "Yes, lock it" -- as Stellar locks the pool's account). The launcher's
  // pool shares go to the all-zeros implicit account: NEAR's de facto burn address, which exists, holds burned
  // NEAR and has NO access keys and no contract (checked 2026-11-03), so nobody -- not the launcher, not
  // LumosCore -- can ever sign for it, and shares there can never be withdrawn. Registering it for the pool's
  // shares (mft_register) costs Rhea's share record, ~0.00076 NEAR; 0.01 is attached and the rest refunded.
  var LOCK_ACCOUNT = '0000000000000000000000000000000000000000000000000000000000000000';
  var LOCK_REG_DEPOSIT = '10000000000000000000000';     // 0.01 NEAR, excess refunded by Rhea
  // NEP-145 registration on a near-contract-standards token (ours, and wrap.near): 125 bytes = 0.00125.
  // Read live from storage_balance_bounds before signing; this figure only prices the panel.
  var FT_REG_EST = '1250000000000000000000';

  // The factory's RESERVED list, copied from contracts/factory/src/lib.rs. The contract refuses these
  // anyway; mirroring it here turns a failed transaction into a form error.
  var RESERVED = ['lumos', 'lumoscore', 'lumoscorefees', 'fees', 'fee', 'admin', 'owner', 'factory', 'launch',
    'launchpad', 'app', 'api', 'www', 'docs', 'near', 'wnear', 'wrap', 'usdc', 'usdt', 'usd', 'dai',
    'eth', 'weth', 'btc', 'wbtc', 'official', 'team', 'support', 'treasury', 'rewards', 'swap',
    'bridge', 'pool', 'pools', 'staking'];

  function isLocal() { try { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch (e) { return false; } }
  // A capture test may point the launch at a stubbed factory. Honoured on a local host only, so a
  // production page can never be steered by it (the swap's __lxnFeeAccountForTest rule).
  function factory() {
    try {
      var t = window.__lxnFactoryForTest;
      if (typeof t === 'string' && t && isLocal()) return t;
    } catch (e) {}
    return FACTORY;
  }

  // ---- NEAR RPC (fastnear rate-limits bursts: transient errors are retried, spaced) --------------------
  function view(params, attempt) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 15000);
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'lxl', method: 'query', params: params }),
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
        throw e;
      }
      if (j && j.result && j.result.error) { var e2 = new Error(String(j.result.error)); e2.code = 'CALL'; throw e2; }
      return j.result;
    }).catch(function (e) {
      if (!(e && e.transient) || (attempt || 0) >= 3) throw e;
      return new Promise(function (r) { setTimeout(r, 700 + 900 * (attempt || 0)); })
        .then(function () { return view(params, (attempt || 0) + 1); });
    });
  }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function callView(contract, method, args) {
    return view({
      request_type: 'call_function', finality: 'final', account_id: contract,
      method_name: method, args_base64: b64(JSON.stringify(args || {}))
    }).then(function (r) {
      var bytes = new Uint8Array((r && r.result) || []), txt = '';
      try { txt = new TextDecoder().decode(bytes); } catch (e) { for (var i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]); }
      return txt ? JSON.parse(txt) : null;
    });
  }
  // { exists: true, acct } or { exists: false }. Anything else THROWS: "could not ask" must never read as
  // "does not exist", or a name check that timed out would wave a taken name through.
  function viewAccount(id) {
    return view({ request_type: 'view_account', finality: 'final', account_id: id }).then(function (a) {
      return { exists: true, acct: a };
    }, function (e) {
      if (e && e.code === 'UNKNOWN_ACCOUNT') return { exists: false };
      throw e;
    });
  }

  // ---- the factory: present and accepting launches? ----------------------------------------------------
  var _cfg = {};
  // fresh: ask again rather than reuse this page's answer (the launch and the gate do; the panel does not).
  function config(fresh) {
    var f = factory();
    if (_cfg[f] && !fresh) return _cfg[f];
    var p = callView(f, 'get_config', {}).then(function (c) {
      if (!c || typeof c !== 'object' || !/^[0-9]+$/.test(String(c.min_fee))) throw new Error('The NEAR token factory did not answer.');
      return c;
    });
    _cfg[f] = p;
    p.catch(function () { if (_cfg[f] === p) delete _cfg[f]; });     // a failure is not an answer
    return p;
  }

  // ---- integer money -------------------------------------------------------------------------------------
  function big(s) { return BigInt(String(s == null ? '0' : s)); }
  var YOCTO = BigInt('1000000000000000000000000');
  // NEAR -> yocto at micro-NEAR precision, which is far finer than any price on this page.
  function nearToYocto(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return '0';
    return (BigInt(Math.round(v * 1e6)) * BigInt('1000000000000000000')).toString();
  }
  function yoctoToNear(y) { return Number(big(y) / BigInt('1000000000000000000')) / 1e6; }
  function maxBig(a, b) { return big(a) > big(b) ? String(a) : String(b); }
  function utf8Len(s) { try { return new TextEncoder().encode(String(s || '')).length; } catch (e) { return String(s || '').length; } }

  // ---- the rate ------------------------------------------------------------------------------------------
  var RATE_KEY = 'lumos.near.usd';
  function rateLive() {
    return fetch('/lxapi/nearmarket').then(function (r) { return r.json(); }).then(function (p) {
      if (!(p && p.ok && p.usd > 0)) throw new Error('Could not price the launch in NEAR right now.');
      try { localStorage.setItem(RATE_KEY, JSON.stringify({ v: p.usd, at: Date.now() })); } catch (e) {}
      return p.usd;
    });
  }
  // A rate from the last six hours prices the PANEL only (the launch itself always asks again).
  function rateCached() {
    try {
      var c = JSON.parse(localStorage.getItem(RATE_KEY) || 'null');
      if (c && c.v > 0 && Date.now() - c.at < 6 * 3600 * 1000) return c.v;
    } catch (e) {}
    return null;
  }

  // ---- the token arguments, from a draft ----------------------------------------------------------------
  function prefixOf(ticker) { return String(ticker || '').trim().toLowerCase(); }
  function tokenIdOf(ticker) { return prefixOf(ticker) + '.' + factory(); }
  function supplyRaw(supply) {
    var s = String(Math.round(Number(supply) || 0));
    var z = ''; for (var i = 0; i < DECIMALS; i++) z += '0';
    return (BigInt(s) * BigInt('1' + z)).toString();
  }
  function argsOf(d) {
    var a = {
      prefix: prefixOf(d.ticker), name: String(d.name || '').trim(),
      symbol: String(d.ticker || '').trim().toUpperCase(), decimals: DECIMALS,
      total_supply: supplyRaw(d.supply)
    };
    if (d.icon) a.icon = d.icon;
    return a;
  }
  function poolRawOf(d) {
    var share = Math.round(Number(d.share) || 0);
    return (big(supplyRaw(d.supply)) * BigInt(100 - share) / BigInt(100)).toString();
  }

  // ---- THE COST, one function for the panel and the launch -----------------------------------------------
  // ex: { cfg, storage (yocto, authoritative from storage_cost_of), refAcct: 'new'|yocto shortfall,
  //       wrapReg: yocto|0, tokenReg: yocto }. Missing pieces fall back to the measured estimates above,
  //       always on the side of what leaves the wallet, never under it.
  function costPlan(d, rate, ex) {
    ex = ex || {};
    var cfg = ex.cfg || null;
    var a = argsOf(d);
    var storage = ex.storage;
    if (storage == null) {
      var bytes = (cfg && cfg.token_wasm_bytes ? Number(cfg.token_wasm_bytes) : WASM_BYTES_EST)
        + utf8Len(a.name) + a.symbol.length + (a.icon ? a.icon.length : 0) + EXTRA_BYTES;
      storage = (BigInt(bytes) * BYTE).toString();
    }
    var usdFee = nearToYocto(USD.create / rate);
    var extra = Number(d.extra) > 0 ? Number(d.extra) : 0;
    var liq = nearToYocto(USD.liq / rate + extra);
    var refAcct = ex.refAcct == null ? REF_ACCOUNT_NEW : String(ex.refAcct);
    var wrapReg = ex.wrapReg == null ? FT_REG_EST : String(ex.wrapReg);
    var tokenReg = ex.tokenReg == null ? FT_REG_EST : String(ex.tokenReg);
    var rhea = (big(refAcct) + big(REF_POOL_DEPOSIT) + big(REF_LIQ_DEPOSIT) + big(LOCK_REG_DEPOSIT) + big(tokenReg) + big(wrapReg)).toString();
    var network = (big(storage) + big(rhea)).toString();
    // The flat $25 (USD_POOL above): what the pool-and-network line falls short of $10 is added to the fee.
    var poolFloor = big(nearToYocto(USD_POOL / rate));
    var topUp = poolFloor > big(network) ? (poolFloor - big(network)) : BigInt(0);
    // ...and what the liquidity line charges above the NEAR the pool receives (USD_LIQ_LINE above).
    var liqRev = big(nearToYocto(Math.max(0, USD_LIQ_LINE - USD.liq) / rate));
    var fee = (big(usdFee) + topUp + liqRev).toString();
    if (cfg) fee = maxBig(fee, cfg.min_fee);
    var createDeposit = (big(storage) + big(fee)).toString();
    var total = (big(fee) + big(liq) + big(network)).toString();
    return {
      args: a, tokenId: tokenIdOf(d.ticker), storage: storage, fee: fee, createDeposit: createDeposit,
      liq: liq, poolRaw: poolRawOf(d), refAcct: refAcct, wrapReg: wrapReg, tokenReg: tokenReg,
      rhea: rhea, network: network, total: total, rate: rate,
      // What the cost panel shows on its three lines: $5 creation, $10 liquidity, $10 pool & network.
      showCreate: (big(fee) - topUp - liqRev).toString(), showLiq: (big(liq) + liqRev).toString(),
      showPool: (big(network) + topUp).toString()
    };
  }

  // ---- cost panel ------------------------------------------------------------------------------------------
  var COST_ID = { create: 'costCreation', liq: 'costLiquidity', pool: 'costNetwork', total: 'costTotal' };
  var COST_LABEL = { create: 'token creation', liq: 'initial liquidity', pool: 'liq. pool & network', total: 'total cost' };
  function costCell(key) {
    var byId = document.getElementById(COST_ID[key]);
    if (byId) return byId;
    var rows = $$('.cost-row, .cost-total');
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('.k'), v = rows[i].querySelector('.v');
      if (!k || !v) continue;
      // The form's labels carry a "?" info badge inside .k, so the comparison is on the label's own text.
      var t = '';
      for (var n = k.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue;
      if (t.trim().toLowerCase() === COST_LABEL[key]) return v;
    }
    return null;
  }
  function liftCosts() { try { document.documentElement.classList.add('lxn-costready'); } catch (e) {} }
  function fmtNear(y) {
    var v = yoctoToNear(y);
    return (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' NEAR';
  }
  function fmtUsd(u) { return '≈ $' + (Math.abs(u - Math.round(u)) < 0.005 ? Math.round(u).toLocaleString('en-US') : u.toFixed(2)); }
  // Written only when wrong: the design repaints these cells on every slider move, and a MutationObserver
  // re-entering its own writes would loop (the XRPL launchpad hung exactly that way once).
  function setCost(key, y, rate) {
    var el = costCell(key);
    if (!el) return;
    var want = fmtNear(y), usdSpan = el.querySelector('.usd');
    var wantUsd = fmtUsd(yoctoToNear(y) * rate);
    var have = (el.textContent || '').replace(usdSpan ? (usdSpan.textContent || '') : '', '').trim();
    if (have === want && (!usdSpan || (usdSpan.textContent || '').trim() === wantUsd)) return;
    if (usdSpan) usdSpan.textContent = wantUsd;
    el.textContent = want + ' ';
    if (usdSpan) el.appendChild(usdSpan);
  }

  var panel = { rate: null, ex: {} };
  function currentDraft() {
    if ($('#tokenTicker')) return readForm();
    return readDraft() || {};
  }
  function paintCosts() {
    if (!(panel.rate > 0)) return;
    var p = costPlan(currentDraft(), panel.rate, panel.ex);
    setCost('create', p.showCreate, panel.rate);
    setCost('liq', p.showLiq, panel.rate);
    setCost('pool', p.showPool, panel.rate);
    setCost('total', p.total, panel.rate);
    L.lastPlan = p;
    // SHOWN ONLY ONCE THE FACTORY HAS ANSWERED (or refused): lifting on the price alone shows the estimate and
    // then repaints it with the factory's own fee a moment later. costTimeout() still lifts at 8 s regardless.
    if (panel.cfgDone) liftCosts();
  }
  function watchCosts() {
    var first = costCell('create');
    var row = first && first.closest ? first.closest('.cost-row') : null;
    var host = row && row.parentElement;
    if (!host || !window.MutationObserver || host.__lxnWatched) return;
    host.__lxnWatched = 1;
    new MutationObserver(paintCosts).observe(host, { childList: true, characterData: true, subtree: true });
  }
  // A hard stop so a failed price cannot hold the panel hidden forever: blank first, then reveal. The
  // design's mock ("173.50 NEAR ≈ $25") must never be the thing that shows.
  function costTimeout() {
    setTimeout(function () {
      if (document.documentElement.classList.contains('lxn-costready')) return;
      // A price that arrived means real figures are written (only the factory is late): show those. No price:
      // nothing real was written, so blank the mock.
      if (!(panel.rate > 0)) ['create', 'liq', 'pool', 'total'].forEach(function (k) { var c = costCell(k); if (c) c.textContent = '—'; });
      liftCosts();
    }, 8000);
  }
  function startCosts() {
    if (!costCell('create')) { liftCosts(); return; }
    costTimeout();
    var use = function (v) { panel.rate = v; paintCosts(); watchCosts(); };
    rateLive().then(use, function () { var c = rateCached(); if (c > 0) use(c); });
    // The factory's own figures (min_fee, the real wasm size) replace the estimate when it answers.
    config().then(function (c) { panel.ex.cfg = c; panel.cfgDone = true; paintCosts(); },
      function () { panel.cfgDone = true; paintCosts(); });
    // The connected account's Rhea and wrap.near registrations, so a returning Rhea user is not quoted
    // the 0.01 NEAR account deposit they already paid.
    var me = account();
    if (me) {
      accountState(me).then(function (st) { panel.ex.refAcct = st.refAcct; panel.ex.wrapReg = st.wrapReg; paintCosts(); }, function () {});
    }
  }

  // What the connected account still needs on Rhea and wrap.near. refAcct is the yocto to attach to a
  // Rhea storage_deposit (0 = none), computed from get_user_storage_state as usage + 148 bytes for each
  // of the two pool tokens not already in the account, minus what is deposited.
  function accountState(me, tokenId) {
    return callView(REF, 'storage_balance_of', { account_id: me }).then(function (sb) {
      if (!sb) return { refRegistered: false, refAcct: REF_ACCOUNT_NEW };
      return Promise.all([
        callView(REF, 'get_user_storage_state', { account_id: me }),
        callView(REF, 'get_deposits', { account_id: me })
      ]).then(function (r) {
        var st = r[0] || {}, deps = r[1] || {};
        var fresh = [tokenId || '__new__', WNEAR].filter(function (t) { return !(t in deps); }).length;
        var need = big(st.usage || '0') + BigInt(fresh * REF_TOKEN_BYTES) * BYTE;
        var have = big(st.deposit || sb.total || '0');
        return { refRegistered: true, refAcct: need > have ? (need - have).toString() : '0', deposits: deps };
      });
    }).then(function (o) {
      return callView(WNEAR, 'storage_balance_of', { account_id: me }).then(function (w) {
        o.wrapRegistered = !!w;
        o.wrapReg = w ? '0' : FT_REG_EST;
        return o;
      });
    });
  }

  // ---- icon: always a real <img>, kept under the factory's 16 KB data-URL limit ------------------------
  var ICON_PX = 128, ICON_MAX = 16384;
  var PREVIEW_PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgdmlld0JveD0iMCAwIDk2IDk2Ij48cmVjdCB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHJ4PSIyMiIgZmlsbD0iI2VjZWVmMyIvPjxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2FhYjFiZCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjI3IiB5PSIzMSIgd2lkdGg9IjQyIiBoZWlnaHQ9IjM0IiByeD0iNSIvPjxjaXJjbGUgY3g9IjM5IiBjeT0iNDMiIHI9IjQiLz48cGF0aCBkPSJNMzAgNTlsMTEtMTEgOSA4IDctNiA5IDkiLz48L2c+PC9zdmc+";
  // The icon is stored ON CHAIN, in the token's metadata, and the factory refuses more than 16384
  // characters or anything but PNG/JPEG/WebP. A 128px PNG of a photo is often 30 KB, so this tries the
  // smallest encodings in turn until one fits, rather than letting the launch fail at the contract.
  function encodeIcon(img) {
    var sizes = [128, 96, 64], tries = [];
    sizes.forEach(function (px) {
      tries.push([px, 'image/png', null]);
      [0.9, 0.8, 0.7, 0.6].forEach(function (q) { tries.push([px, 'image/webp', q]); });
      [0.85, 0.7, 0.55].forEach(function (q) { tries.push([px, 'image/jpeg', q]); });
    });
    for (var i = 0; i < tries.length; i++) {
      var px = tries[i][0], type = tries[i][1], q = tries[i][2];
      var c = document.createElement('canvas');
      c.width = px; c.height = px;
      var g = c.getContext('2d');
      if (type === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, px, px); }
      var s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, px, px);
      var url = q == null ? c.toDataURL(type) : c.toDataURL(type, q);
      // A browser that cannot encode WebP hands back PNG; only accept what was asked for.
      if (url.indexOf('data:' + type + ';base64,') !== 0) continue;
      if (url.length <= ICON_MAX) return url;
    }
    return null;
  }
  function readIcon(file, cb) {
    if (!file || !/^image\//.test(file.type || '')) { cb(null, 'Choose a PNG, JPG or GIF image.'); return; }
    var fr = new FileReader();
    fr.onerror = function () { cb(null, 'That image could not be read.'); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null, 'That image could not be read.'); };
      img.onload = function () {
        var url = null;
        try { url = encodeIcon(img); } catch (e) { url = null; }
        cb(url, url ? null : 'That image is too detailed to store on chain — try a simpler logo.');
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function paintIcon(host, dataUrl) {
    if (!host) return;
    host.innerHTML = '';
    host.removeAttribute('data-logo');
    host.classList.remove('lx-natico');
    var img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
    if (dataUrl) {
      host.classList.remove('empty');
      host.style.background = '';
      img.src = dataUrl;
    } else {
      host.classList.add('empty');
      host.style.background = '';
      img.src = PREVIEW_PLACEHOLDER;
      img.setAttribute('data-lxlp', '1');
    }
    host.appendChild(img);
  }
  var iconData = null;
  function wireIcon() {
    var input = $('#iconFileInput'), host = $('#previewIcon');
    if (!input) return;
    try { var d0 = readDraft(); if (d0 && d0.chain === 'near' && d0.icon) iconData = d0.icon; } catch (e) {}
    var repaint = function () { paintIcon(host, iconData); };
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      readIcon(f, function (url, why) {
        iconData = url;
        repaint();
        showErrors(why ? [why] : [], $('.summary-cta'));
      });
    });
    ['#tokenTicker', '#tokenName'].forEach(function (sel) { var f = $(sel); if (f) f.addEventListener('input', repaint); });
    repaint();
  }

  // ---- the form --------------------------------------------------------------------------------------------
  function byPlaceholder(re) {
    var f = $$('input').filter(function (i) { return i.type === 'text' && re.test(i.placeholder || ''); })[0];
    return f ? String(f.value || '').trim() : '';
  }
  function readForm() {
    var num = function (s) { return Number(String(s == null ? '' : s).replace(/[, ]/g, '')); };
    var shareEl = $('#shareNum');
    return {
      telegram: byPlaceholder(/t\.me/i),
      twitter: byPlaceholder(/x\.com|twitter/i),
      website: byPlaceholder(/yourproject\.com|https?:\/\//i),
      name: String(($('#tokenName') || {}).value || '').trim(),
      ticker: String(($('#tokenTicker') || {}).value || '').trim().toUpperCase(),
      desc: ($('#desc') || {}).value || '',
      supply: num(($('#supply') || {}).value),
      share: shareEl ? num(shareEl.value) : 10,
      extra: num(($('#extraLiquidity') || {}).value) || 0,
      icon: iconData || null
    };
  }
  function tickerProblem(t) {
    if (!t) return 'Enter a ticker.';
    // Stellar's rule and words (RAZA 2026-11-03: "2-6 uppercase letters"), a subset of the factory's 2-12.
    if (!/^[A-Z]{2,6}$/.test(t)) return 'Ticker: 2-6 uppercase letters.';
    if (RESERVED.indexOf(t.toLowerCase()) >= 0) return '$' + t + ' is reserved on LumosCore — choose another ticker.';
    return null;
  }
  function validate(d) {
    var errs = [];
    var name = String(d.name || '');
    if (!name.trim()) errs.push('Enter a token name.');
    else if (utf8Len(name.trim()) > 48) errs.push('Token name is longer than 48 characters.');
    else if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) errs.push('Token name contains a control character.');
    var tp = tickerProblem(d.ticker);
    if (tp) errs.push(tp);
    if (!(d.supply > 0) || Math.round(d.supply) !== d.supply) errs.push('Enter a whole-number total supply greater than zero.');
    else if (d.supply > 1e10) errs.push('Total supply cannot exceed 10,000,000,000.');
    if (!(d.share >= 0 && d.share <= 30) || Math.round(d.share) !== d.share) errs.push('Your share must be a whole number from 0 to 30% — the rest goes to the liquidity pool.');
    if (!(d.extra >= 0) || !isFinite(d.extra)) errs.push('Extra liquidity must be a NEAR amount of zero or more.');
    if (d.icon && (d.icon.length > ICON_MAX || !/^data:image\/(png|jpeg|webp);base64,/.test(d.icon))) errs.push('The icon could not be prepared for NEAR — upload it again.');
    return { ok: !errs.length, errs: errs };
  }
  function readDraft() { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) { return null; } }
  function saveDraft(d) {
    d.chain = 'near'; d.ledger = 'near';
    try { localStorage.setItem(DRAFT, JSON.stringify(d)); }
    catch (e) {
      try { var lean = {}; for (var k in d) lean[k] = d[k]; lean.icon = null; localStorage.setItem(DRAFT, JSON.stringify(lean)); } catch (e2) {}
    }
  }
  function showErrors(errs, near) {
    var box = $('#lxnLaunchErrors');
    if (!box) {
      if (!errs.length) return;
      box = document.createElement('div');
      box.id = 'lxnLaunchErrors';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin:10px 0;padding:10px 12px;border-radius:10px;font-size:13px;'
        + 'line-height:1.5;color:#e5484d;background:rgba(229,72,77,.09);border:1px solid rgba(229,72,77,.28)';
      var anchor = near && near.parentElement ? near.parentElement : document.body;
      anchor.insertBefore(box, near || null);
    }
    box.textContent = errs.join(' ');
    box.style.display = errs.length ? '' : 'none';
  }

  // Is <prefix>.lumoscore.near free? true / false / null (could not ask). Cached per prefix for the page;
  // a failure is not cached.
  var TAKEN = {};
  function nameFree(ticker) {
    var id = tokenIdOf(ticker);
    if (TAKEN[id] === true || TAKEN[id] === false) return Promise.resolve(TAKEN[id]);
    return viewAccount(id).then(function (r) { TAKEN[id] = !r.exists; return TAKEN[id]; }, function () { return null; });
  }
  function takenMsg(t) { return '$' + t + ' is already taken on NEAR (' + tokenIdOf(t) + ' exists) — choose another ticker.'; }

  function account() {
    try { return (window.lxn && window.lxn.account && window.lxn.account()) || ''; } catch (e) { return ''; }
  }

  function wireForm() {
    var tick = $('#tokenTicker');
    // The design's 6-character cap stands: the ticker is Stellar's 2-6 uppercase letters (RAZA 2026-11-03).
    var btn = $('.summary-cta');
    var timer = null;
    if (tick) tick.addEventListener('input', function () {
      clearTimeout(timer);
      var t = String(tick.value || '').trim().toUpperCase();
      timer = setTimeout(function () {
        var tp = tickerProblem(t);
        if (tp) { if (t.length >= 2) showErrors([tp], btn); return; }
        nameFree(t).then(function (free) {
          if (String(tick.value || '').trim().toUpperCase() !== t) return;
          showErrors(free === false ? [takenMsg(t)] : [], btn);
        });
      }, 450);
    });
    // WINDOW capture, so this runs before the button's inline onclick (which navigates). A listener on
    // the button itself cannot stop an inline handler on the same element.
    window.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.summary-cta') : null;
      if (!b) return;
      if (b.__lxnPass) { b.__lxnPass = 0; return; }
      ev.preventDefault(); ev.stopImmediatePropagation();
      var d = readForm();
      var v = validate(d);
      if (!v.ok) { showErrors(v.errs, b); return; }
      saveDraft(d);
      // The review step is one url for every chain, chosen by the lx_chain cookie a NEAR connection sets,
      // so without a NEAR session "Next" would open ANOTHER chain's review of this draft.
      if (!account()) {
        showErrors(['Connect a NEAR wallet to continue — your details are saved.'], b);
        try { if (window.lxwOpenWallet) window.lxwOpenWallet('near'); } catch (e) {}
        return;
      }
      nameFree(d.ticker).then(function (free) {
        if (free === false) { showErrors([takenMsg(d.ticker)], b); return; }
        showErrors([], b);
        // The same cookie nearconnect.js writes on connect. Re-stated here because a NEAR session in
        // localStorage can outlive it, and the review url would then serve another chain's page.
        try { document.cookie = 'lx_chain=near; path=/; max-age=31536000; SameSite=Lax'; } catch (e) {}
        b.__lxnPass = 1;
        b.click();
      });
    }, true);
  }
  // TOTAL SUPPLY READS WITH COMMAS AS IT IS TYPED (RAZA 2026-11-05: "Fix thousand-separator comma formatting
  // in Total Supply input"), Stellar's behaviour: whole tokens, grouped, held at the 10,000,000,000 maximum, and
  // input fired again so the design's preview reads the final value. The commas live only in the field:
  // readForm() strips them, so the draft, the validation and total_supply all carry a plain number. The caret
  // keeps its place by counting the digits to its left, since the commas before it move on every keystroke.
  var SUPPLY_MAX = '10000000000';
  var groupingSupply = false;
  function groupDigits(digits) {
    var out = '', n = digits.length;
    for (var i = 0; i < n; i++) {
      if (i && (n - i) % 3 === 0) out += ',';
      out += digits.charAt(i);
    }
    return out;
  }
  function groupSupply(el) {
    if (groupingSupply) return;
    var was = String(el.value || '');
    var at = el.selectionStart;
    var left = was.slice(0, at == null ? was.length : at).replace(/[^0-9]/g, '').length;
    // Only what stands before a decimal point counts: a pasted "1,000.50" is 1,000, never 100,050.
    var digits = was.split('.')[0].replace(/[^0-9]/g, '').replace(/^0+(?=[0-9])/, '');
    if (digits.length > SUPPLY_MAX.length || (digits.length === SUPPLY_MAX.length && digits > SUPPLY_MAX)) digits = SUPPLY_MAX;
    var shown = groupDigits(digits);
    if (shown === was) return;
    groupingSupply = true;
    el.value = shown;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    groupingSupply = false;
    var pos = 0, seen = 0;
    while (seen < left && pos < shown.length) { if (shown.charAt(pos) !== ',') seen++; pos++; }
    try { if (document.activeElement === el) el.setSelectionRange(pos, pos); } catch (e) {}
  }
  function wireNumericFields() {
    ['#supply', '#shareNum', '#extraLiquidity'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      if (sel === '#supply') {
        el.addEventListener('input', function () { groupSupply(el); });
        el.addEventListener('keydown', function (e) { if ('-+eE.'.indexOf(e.key) >= 0 && e.key.length === 1) e.preventDefault(); });
        el.setAttribute('inputmode', 'numeric');
        return;
      }
      var allow = sel === '#extraLiquidity' ? /[^0-9.]/g : /[^0-9,]/g;
      el.addEventListener('input', function () {
        var before = el.value, cleaned = before.replace(allow, '');
        if (cleaned === before) return;
        el.value = cleaned;
      });
      el.setAttribute('inputmode', sel === '#extraLiquidity' ? 'decimal' : 'numeric');
    });
  }
  function initShareSlider() {
    try {
      var n = document.getElementById('shareNum');
      if (!n || !document.getElementById('sliderThumb')) return;
      n.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}
  }
  // Coming back from review with Edit: the form shows what was entered, not blank fields.
  function restoreForm() {
    var d = readDraft();
    if (!d || d.chain !== 'near') return;
    var put = function (sel, v) { var el = $(sel); if (el && v != null && v !== '' && !el.value) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); } };
    put('#tokenName', d.name); put('#tokenTicker', d.ticker); put('#desc', d.desc);
    if (d.supply) put('#supply', Math.round(d.supply).toLocaleString('en-US'));
    var sh = $('#shareNum'); if (sh && d.share != null) { sh.value = String(d.share); }
    if (d.extra > 0) put('#extraLiquidity', d.extra);
  }

  // ---- review ------------------------------------------------------------------------------------------------
  function num(v) { return (v == null || !isFinite(v)) ? null : Number(v); }
  function group(v) { return v == null ? '—' : Math.round(v).toLocaleString('en-US'); }
  function compact(v) {
    if (v == null) return '—';
    var a = Math.abs(v);
    var f = function (x, s) {
      var t = x.toFixed(x < 10 ? 2 : (x < 100 ? 1 : 0));
      if (t.indexOf('.') >= 0) t = t.replace(/0+$/, '').replace(/\.$/, '');
      return t + s;
    };
    if (a >= 1e9) return f(v / 1e9, 'B');
    if (a >= 1e6) return f(v / 1e6, 'M');
    if (a >= 1e3) return f(v / 1e3, 'K');
    return String(Math.round(v));
  }
  function rowLabel(v) { return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  // Rows matched by LABEL; mobile labels some differently ("Liquidity Pool"), so each key lists its forms.
  function setRow(labels, text, whole) {
    var rows = $$('.detail-row');
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('.k'), v = rows[i].querySelector('.v');
      if (!k || !v || labels.indexOf(rowLabel(k.textContent)) < 0) continue;
      if (whole) { v.textContent = text; v.classList.toggle('empty', /^Not provided|^None/.test(text)); return true; }
      // A value split across the design's own spans -- "10%" in .mono-val beside "(100,000,000 APT)" in a
      // softer span, or "1,000,000,000" beside a soft unit span -- keeps both spans and their styles.
      // `text` is then an array of parts, one per span (a leading text node counts as the first part).
      if (Array.isArray(text)) {
        var spans = [].slice.call(v.children).filter(function (c) { return c.tagName === 'SPAN'; });
        var lead = null;
        for (var n = v.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) { lead = n; break; }
        if (lead && spans.length >= 1) { lead.nodeValue = text[0] + ' '; spans[0].textContent = text[1]; }
        else if (spans.length >= 2) { spans[0].textContent = text[0]; spans[1].textContent = text[1]; }
        else v.textContent = text.join(' ');
        v.classList.remove('empty');
        return true;
      }
      var inner = v.querySelector('a, .pill');
      if (inner) {
        var svg = inner.querySelector('svg');
        inner.textContent = text;
        if (svg) inner.insertBefore(svg, inner.firstChild);
        if (inner.tagName === 'A') {
          if (/^Not provided$/.test(text)) inner.removeAttribute('href');
          else inner.setAttribute('href', /^https?:/i.test(text) ? text : ('https://' + text));
        }
      } else {
        v.textContent = text;
      }
      v.classList.toggle('empty', text === 'Not provided' || text === '—');
      return true;
    }
    return false;
  }
  function paintReview() {
    var d = readDraft();
    if (!d) return false;
    var supply = num(d.supply), share = num(d.share);
    var lpShare = share == null ? null : 100 - share;
    var yours = (supply != null && share != null) ? supply * share / 100 : null;
    var pool = (supply != null && lpShare != null) ? supply * lpShare / 100 : null;
    var ticker = String(d.ticker || '').toUpperCase();
    var mobile = !!$('.bottom-bar');
    var amt = function (v) { return mobile ? compact(v) : group(v); };

    var heroIcon = $('.hero-icon');
    if (heroIcon) {
      heroIcon.classList.remove('lx-natico');
      heroIcon.removeAttribute('data-logo');
      heroIcon.innerHTML = '';
      if (d.icon) {
        heroIcon.style.background = 'none';
        var img = document.createElement('img');
        img.src = d.icon; img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
        heroIcon.appendChild(img);
      } else {
        heroIcon.appendChild(initialsSvg(ticker, 52));
      }
    }
    var nm = $('.hero-name'); if (nm) nm.textContent = d.name || '—';
    var tk = $('.hero-ticker'); if (tk) tk.textContent = '$' + ticker;
    var desc = $('.hero-desc'); if (desc) desc.textContent = d.desc || '';

    setRow(['token name'], d.name || '—');
    setRow(['ticker'], '$' + ticker);
    setRow(['description'], d.desc || 'Not provided');
    setRow(['icon'], d.icon ? 'Uploaded' : 'Not provided', true);
    setRow(['total supply'], [group(supply), ticker]);
    setRow(['your share'], share == null ? '—' : [share + '%', '(' + amt(yours) + ' ' + ticker + ')']);
    setRow(['liquidity pool share', 'liquidity pool'], lpShare == null ? '—' : [lpShare + '%', '(' + amt(pool) + ' ' + ticker + ')']);
    var extra = num(d.extra);
    setRow(['extra near', 'extra apt'], (extra && extra > 0)
      ? ((extra % 1 === 0 ? extra.toLocaleString('en-US') : String(extra)) + ' NEAR added to the pool')
      : (mobile ? 'None — using default liquidity' : 'None — using default liquidity only'));
    setRow(['telegram'], d.telegram || 'Not provided');
    setRow(['x / twitter'], d.twitter || 'Not provided');
    setRow(['website'], d.website || 'Not provided');
    return true;
  }
  function initialsSvg(ticker, px) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('width', String(px)); svg.setAttribute('height', String(px));
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '32'); t.setAttribute('y', '34');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-size', '22'); t.setAttribute('font-weight', '800'); t.setAttribute('fill', '#fff');
    t.textContent = String(ticker || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    svg.appendChild(t);
    return svg;
  }

  // Who is paying: the design's mock ("Paying from 0x03ce…e9b9 / Balance 842.16") replaced with the NEAR
  // session's account and its spendable balance (amount less the storage it must keep).
  function spendable(me) {
    return view({ request_type: 'view_account', finality: 'final', account_id: me }).then(function (a) {
      var amt = big(a.amount), locked = big(a.locked || '0');
      var storage = big(a.storage_usage || 0) * BYTE;
      var keep = storage > locked ? storage - locked : BigInt(0);
      return (amt > keep ? amt - keep : BigInt(0)).toString();
    });
  }
  function shortAcct(a) { a = String(a || ''); return a.length <= 22 ? a : a.slice(0, 8) + '…' + a.slice(-6); }
  function paintWallet() {
    var panelEl = $('.wallet-info');
    if (!panelEl) return;
    var me = account();
    var addrEl = panelEl.querySelector('.addr'), avEl = panelEl.querySelector('.av'), balEl = panelEl.querySelector('.balance .val');
    if (!me) {
      if (addrEl) addrEl.textContent = 'Not connected';
      if (avEl) avEl.textContent = '—';
      if (balEl) balEl.textContent = '—';
      return;
    }
    if (addrEl) addrEl.textContent = shortAcct(me);
    if (avEl) avEl.textContent = me.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
    if (balEl) balEl.textContent = '…';
    spendable(me).then(function (y) {
      if (balEl) balEl.textContent = yoctoToNear(y).toFixed(2) + ' NEAR';
    }, function () { if (balEl) balEl.textContent = '—'; });
  }

  // ---- confirm ------------------------------------------------------------------------------------------------
  function readResult() {
    try {
      var r = JSON.parse(localStorage.getItem(RESULT) || 'null');
      return (r && r.chain === 'near' && r.token) ? r : null;
    } catch (e) { return null; }
  }
  function writeResult(r) {
    r.chain = 'near';
    try { localStorage.setItem(RESULT, JSON.stringify(r)); } catch (e) {
      try { var lean = {}; for (var k in r) lean[k] = r[k]; lean.icon = null; localStorage.setItem(RESULT, JSON.stringify(lean)); } catch (e2) {}
    }
  }
  function shortHash(h) { return h ? (h.slice(0, 7) + '…' + h.slice(-6)) : '—'; }
  function hhmmss(t) { if (!t) return '—'; var d = new Date(t); var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
  function stamp(t, mobile) {
    if (!t) return '—';
    var d = new Date(t), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    return mobile ? (M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' · ' + hm + ' UTC')
      : (M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() + ' · ' + hm + ':' + p(d.getUTCSeconds()) + ' UTC');
  }
  // Text only, keeping any trailing icon (the copy glyph, the arrow) the design put inside the element.
  function setText(el, text) {
    if (!el) return;
    var kids = [].slice.call(el.childNodes).filter(function (n) { return n.nodeType === 1; });
    el.textContent = text;
    kids.forEach(function (k) { if (k.tagName && k.tagName.toLowerCase() === 'svg') el.appendChild(k); });
  }
  function confirmReady() { try { document.documentElement.classList.add('lxn-lpconf'); } catch (e) {} }

  function paintConfirm() {
    var res = readResult();
    // No NEAR result means nobody just launched anything on NEAR, and the headline says "Launched
    // Successfully!". Back to the step that makes one (the XRPL launchpad's rule). A result written by
    // another chain's launchpad is not this page's: the key is shared across the combined site.
    if (!res) { try { location.replace('/launchpad/near'); } catch (e) {} return; }
    var mobile = !$('.crumb-row');
    var tick = String(res.ticker || '').toUpperCase();
    var supply = Number(res.supply) || 0, share = Number(res.share) || 0;
    var poolTok = supply * (100 - share) / 100, yours = supply * share / 100;
    var liqNear = res.liqYocto ? yoctoToNear(res.liqYocto) : 0;
    var done = res.stage === 'done' && res.poolId != null;
    var trade = '/trade/near/' + encodeURIComponent(res.token);
    var amt = function (v) { return mobile ? compact(v) : group(v); };

    var hp = $('.success-hero p');
    if (hp && !done) hp.textContent = 'Your token is live on NEAR. Its pool is not set up yet — finish it from the review step.';

    var icon = $('.result-icon');
    if (icon) {
      icon.classList.remove('lx-natico'); icon.removeAttribute('data-logo'); icon.innerHTML = '';
      if (res.icon) {
        icon.style.background = 'none';
        var im = document.createElement('img'); im.src = res.icon; im.alt = '';
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
        icon.appendChild(im);
      } else icon.appendChild(initialsSvg(tick, 44));
    }
    setText($('.result-name'), res.name || '—');
    setText($('.result-ticker'), '$' + tick);
    // Minting does not earn a verified tick (the launch FAQ says so), so the design's badge would be false.
    $$('.verified-badge').forEach(function (b) { b.style.display = 'none'; });
    // The design's "Issuer 0x…" is the token CONTRACT on NEAR.
    $$('.result-meta .item').forEach(function (it) {
      var lab = it.querySelector('span');
      if (lab && /^\s*issuer\s*$/i.test(lab.textContent || '')) lab.textContent = 'Contract';
    });
    $$('.result-meta .addr').forEach(function (a) { setText(a, res.token); a.setAttribute('data-copy', res.token); });

    var stats = $$('.result-stats .stat');
    if (stats[0]) { setText(stats[0].querySelector('.val'), amt(supply)); setText(stats[0].querySelector('.sub'), tick); }
    if (stats[1]) { setText(stats[1].querySelector('.val'), amt(yours)); setText(stats[1].querySelector('.sub'), share + (mobile ? '% supply' : '% of supply')); }
    if (stats[2]) {
      setText(stats[2].querySelector('.val'), done ? amt(poolTok) : '—');
      setText(stats[2].querySelector('.sub'), done ? ('in ' + tick + ' / NEAR pool') : 'pool not set up yet');
    }
    $$('.result-cta').forEach(function (a) {
      a.setAttribute('href', trade);
      var sp = a.querySelector('span');
      if (sp) setText(sp, 'View Your Token ($' + tick + ') Token Page');
    });

    // The phone's sticky "Go to $APT Token Page" is a bare button: its label and its destination both.
    $$('.primary-cta').forEach(function (b) {
      for (var n = b.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && /Token Page/.test(n.nodeValue)) n.nodeValue = ' Go to $' + tick + ' Token Page ';
      }
      if (!b.__lxnGo) {
        b.__lxnGo = 1;
        b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); location.href = trade; }, true);
      }
    });
    var link = $('.timeline-head .tx-link');
    if (link) {
      if (res.hashes && res.hashes.create) link.setAttribute('href', 'https://nearblocks.io/txns/' + encodeURIComponent(res.hashes.create));
      else link.setAttribute('href', 'https://nearblocks.io/address/' + encodeURIComponent(res.token));
      link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener nofollow');
    }
    var steps = $$('.timeline .tl-step');
    var at = res.at || {};
    var tl = function (i, ttl, time, desc) {
      var s = steps[i]; if (!s) return;
      var t = s.querySelector('.ttl'), tm = t && t.querySelector('.time'), ds = s.querySelector('.desc');
      if (t) { t.textContent = ttl; if (tm) { tm.textContent = time; t.appendChild(tm); } }
      if (ds && desc != null) { ds.textContent = ''; desc.forEach(function (p) { if (typeof p === 'string') ds.appendChild(document.createTextNode(p)); else { var m = document.createElement('span'); m.className = 'mono-mini'; m.textContent = p.mono; ds.appendChild(m); } }); }
    };
    tl(0, 'Transaction signed', hhmmss(at.create), [(mobile ? 'Approved with wallet ' : 'Approved with NEAR wallet '), { mono: shortAcct(res.owner || '') }]);
    tl(1, mobile ? 'Token created' : 'Token created on NEAR', hhmmss(at.create),
      ['Token ', { mono: res.token }, mobile ? ' created, no access keys' : (' created with no access keys, so the supply is fixed. Supply: ' + compact(supply) + ' ' + tick + '.')]);
    if (done) {
      tl(2, mobile ? 'Pool created' : 'Liquidity pool created', hhmmss(at.liquidity || at.pool),
        [tick + ' / NEAR pool #' + res.poolId + ' seeded with ' + compact(poolTok) + ' ' + tick + ' · ' + liqNear.toFixed(2) + ' NEAR']);
      tl(3, 'Listed on DEX', hhmmss(at.liquidity || at.pool), [mobile ? 'Now discoverable and tradeable' : 'Your token is now discoverable and tradeable.']);
    } else {
      tl(2, mobile ? 'Pool not set up' : 'Liquidity pool not set up yet', '—', ['Return to the review step and press Retry pool step.']);
      tl(3, 'Not on the DEX yet', '—', ['It becomes tradeable once its pool exists.']);
    }

    var rows = $$('.tx-card .tx-row');
    rows.forEach(function (r) {
      var k = r.querySelector('.k'), v = r.querySelector('.v');
      if (!k || !v) return;
      var key = rowLabel(k.textContent);
      if (key === 'transaction hash' || key === 'tx hash') {
        var h = (res.hashes && res.hashes.create) || '';
        setText(v, shortHash(h)); if (h) v.setAttribute('data-copy', h); else v.removeAttribute('data-copy');
      } else if (key === 'asset code') { k.textContent = 'Symbol'; setText(v, tick); }
      else if (key === 'asset issuer' || key === 'issuer') { k.textContent = mobile ? 'Contract' : 'Token contract'; setText(v, res.token); v.setAttribute('data-copy', res.token); }
      else if (key === 'total paid') {
        var paid = res.paidYocto || '0';
        var usd = res.rate > 0 ? yoctoToNear(paid) * res.rate : null;
        v.textContent = fmtNear(paid) + ' ';
        if (!mobile && usd != null) { var u = document.createElement('span'); u.style.cssText = 'color:var(--text-soft);font-weight:500;'; u.textContent = fmtUsd(usd); v.appendChild(u); }
      } else if (key === 'block') { v.textContent = res.block ? Number(res.block).toLocaleString('en-US') : '—'; }
      else if (key === 'timestamp' || key === 'time') { v.textContent = stamp(at.create, mobile); }
    });
    $$('.action-btn').forEach(function (a) {
      var t = rowLabel((a.querySelector('.ttl') || {}).textContent);
      if (t === 'view token page') a.setAttribute('href', trade);
    });
    // The block height of the creation transaction, asked once if it was not recorded.
    if (!res.block && res.blockHash) {
      fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'lxb', method: 'block', params: { block_id: res.blockHash } }) })
        .then(function (r) { return r.json(); }).then(function (j) {
          var h = j && j.result && j.result.header && j.result.header.height;
          if (!h) return;
          res.block = h; writeResult(res);
          rows.forEach(function (r) { var k = r.querySelector('.k'), v = r.querySelector('.v'); if (k && v && rowLabel(k.textContent) === 'block') v.textContent = Number(h).toLocaleString('en-US'); });
        }).catch(function () {});
    }
    confirmReady();
  }

  // ---- boot ------------------------------------------------------------------------------------------------------
  function load() {
    if ($('.result-name')) { paintConfirm(); return; }
    var isForm = !!$('#tokenTicker');
    if (!isForm && !$('.cost-row')) return;
    if (!isForm) {
      var d = readDraft();
      if (!d || d.chain !== 'near' || !d.name || !d.ticker) { try { location.replace('/launchpad/near'); } catch (e) {} return; }
      paintReview();
      paintWallet();
      try { document.documentElement.classList.add('lxn-lprev'); } catch (e) {}
    } else {
      restoreForm();
      wireForm(); wireIcon(); wireNumericFields();
      ['#tokenName', '#tokenTicker', '#supply', '#shareNum', '#extraLiquidity'].forEach(function (s) {
        var el = $(s); if (el) el.addEventListener('input', function () { setTimeout(paintCosts, 0); });
      });
      document.addEventListener('click', function () { setTimeout(paintCosts, 30); }, true);
    }
    if (TEST_PRICING && window.console && console.warn) {
      console.warn('LumosCore NEAR launchpad is running TEST PRICING ($' + USD.create + ' / $' + USD.liq
        + '), not the real $' + USD_REAL.create + ' / $' + USD_REAL.liq + '.');
    }
    startCosts();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { load(); initShareSlider(); });
  } else { load(); initShareSlider(); }

  // Shared with browser/nearmint.js, and inspectable from the console and the capture tests.
  L.FACTORY = FACTORY; L.REF = REF; L.WNEAR = WNEAR; L.RPC = RPC; L.SOON = SOON; L.USD = USD;
  L.POOL_FEE_BPS = POOL_FEE_BPS; L.DECIMALS = DECIMALS; L.BYTE = BYTE; L.RESERVED = RESERVED;
  L.REF_POOL_DEPOSIT = REF_POOL_DEPOSIT; L.REF_LIQ_DEPOSIT = REF_LIQ_DEPOSIT; L.LOCK_ACCOUNT = LOCK_ACCOUNT; L.LOCK_REG_DEPOSIT = LOCK_REG_DEPOSIT; L.REF_ACCOUNT_NEW = REF_ACCOUNT_NEW;
  L.factory = factory; L.view = view; L.callView = callView; L.viewAccount = viewAccount; L.config = config;
  L.big = big; L.nearToYocto = nearToYocto; L.yoctoToNear = yoctoToNear; L.fmtNear = fmtNear; L.fmtUsd = fmtUsd;
  L.rateLive = rateLive; L.argsOf = argsOf; L.tokenIdOf = tokenIdOf; L.costPlan = costPlan; L.accountState = accountState;
  L.readDraft = readDraft; L.readResult = readResult; L.writeResult = writeResult; L.validate = validate;
  L.tickerProblem = tickerProblem; L.nameFree = nameFree; L.spendable = spendable; L.account = account;
  L.paintCosts = paintCosts; L.paintReview = paintReview; L.paintConfirm = paintConfirm; L.panel = panel;
  L.shortAcct = shortAcct; L.isLocal = isLocal;
})();
