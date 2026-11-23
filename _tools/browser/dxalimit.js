// Trade-Asset -> Limit: the design's Limit pane, wired to Rhea Finance's DCL contract through window.lxnDcl
// (browser/neardcl.js). Structurally a port of the XRPL fork's _tools/browser/limit.js: the same pane, the
// same fields (Limit price in NEAR, Amount in the token, Total in NEAR), the same "Filled when" row, the same
// window-capture click that places the order without a review popup -- the wallet's own approval screen is
// the confirmation (RAZA's no-new-popups rule; lx-feemodal's review would quote a 0.2% fee this order does
// not charge).
//
// SCOPE (RAZA-approved 2026-10-21): limit orders are FREE -- no LumosCore fee. Only a token with a Rhea DCL
// pool against wNEAR can take one; on any other token the design's own button stays disabled and says why.
// The one-time DCL storage deposit (0.5 NEAR) shows in the pane's existing fee row, whose 0.2% figure is
// hidden here because it describes a charge a limit order does not make.
//
// THE PAIR is <this token> vs NEAR. Buy pays NEAR (wrapped in the same transaction), Sell pays the token and
// receives wNEAR. Rhea rests the order at the pool's nearest tick at or below the price typed for a sell,
// at or above it for a buy (the SDK's flooring); "Filled when" shows that tick, not the typed figure.
//
// NO FLASH: the head stylesheet (lx-neardexasset-css) hides the limit button until html.lxn-limit-ready,
// added once this layer has decided its state (or after 4s, so a failure cannot hide it for good).
(function () {
  if (window.__lxnDxaLimit) return;
  window.__lxnDxaLimit = 1;

  var NOPOOL = 'Limit orders need a NEAR order-book pool for this pair';
  var D = function () { return window.lxnDcl; };
  var SW = function () { return window.lxnSwap; };
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function asset() { return window.__lxnAssetRef || null; }
  function me() { try { return (window.lxn && window.lxn.account && window.lxn.account()) || ''; } catch (e) { return ''; } }
  function ready() { document.documentElement.classList.add('lxn-limit-ready'); }
  setTimeout(ready, 4000);

  function pane() { return $('.dxa-pane-limit') || $('.mdxa-pane-limit'); }
  function phone(p) { return /mdxa-/.test((p && p.className) || ''); }
  function fields(p) { return $$('[class*="dxa-trade-field"]', p); }
  function input(f) { return f ? $('input', f) : null; }
  function cta(p) { return $('[class*="dxa-trade-cta"]', p); }
  // The side just clicked wins until the design's own handler has moved .active (RAZA 2026-11-04: Sell LUMOS read
  // "Balance: 1.15545 NEAR" on the swap pane, whose pattern this shares). A real click runs the repaint microtask straight after this layer's capture listener,
  // BEFORE the design's handler, so .active still named the old side and the NEAR balance was painted under Sell.
  function side(p) { return p.__lxnSideNext || ($('[class*="dxa-side-btn"].sell.active', p) ? 'sell' : 'buy'); }
  function claimSide(p, btn) {
    // classList, not a /s/ regex: the build injects this file through a template literal, which drops the
    // backslash -- the regex shipped as /(^|s)sell(s|$)/ and every click read as Buy.
    p.__lxnSideNext = btn.classList.contains('sell') ? 'sell' : 'buy';
    setTimeout(function () { p.__lxnSideNext = null; }, 0);
  }

  // The leading number and nothing after it (XRPL limit.js): a mis-aimed paste stops at the first stray
  // character instead of being turned into a different, plausible price.
  function numOnly(v) {
    v = String(v == null ? '' : v).split(',').join('.');
    var out = '', dot = false;
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i);
      if (c >= '0' && c <= '9') { out += c; continue; }
      if (c === '.' && !dot) { dot = true; out += c; continue; }
      if (out === '' && (c === ' ' || c === '\t')) continue;
      break;
    }
    return out;
  }
  function num(v) { var s = numOnly(v); return (s === '' || s === '.') ? NaN : Number(s); }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    if (n > 0 && n < 1e-6) return Number(n).toPrecision(3);
    var a = Math.abs(n), dp = d != null ? d : (a >= 1000 ? 2 : a >= 1 ? 4 : 7);
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: dp });
  }
  function plainIn(n) { return D().plain(+Number(n).toPrecision(12)) || ''; }

  function mark(node, text) {
    if (!node) return;
    try { node.removeAttribute('data-logo'); node.setAttribute('data-logoed', '1'); } catch (e) {}
    if (node.textContent !== text) node.textContent = text;
    node.classList.add('lxp');
  }
  function frowMono(f) { var row = f && $('[class*="dxa-trade-frow"]', f); return row && $('.mono', row); }
  function sumRow(p, label, value) {
    $$('[class*="dxa-tsum"]', p).forEach(function (r) {
      if (r.classList.contains('lx-feerow')) return;
      var k = r.children;
      if (k.length < 2 || (k[0].textContent || '').trim().toLowerCase() !== label) return;
      mark(k[k.length - 1], value);
    });
  }
  function say(p, text) {
    var b = cta(p);
    if (!b || !b.parentNode) return;
    var n = $('.lxda-swaperr', p);
    if (!n) {
      if (!text) return;
      n = document.createElement('div');
      n.className = 'lxda-swaperr';                               // Stellar's own note, above the button
      n.setAttribute('role', 'status');
      b.parentNode.insertBefore(n, b);
    }
    n.textContent = text || '';
    n.style.display = text ? '' : 'none';
  }
  // A plain note above the button, in the pane's own soft text -- not the red .lxda-swaperr, which is for errors.
  function info(p, text) {
    var b = cta(p);
    if (!b || !b.parentNode) return;
    var n = $('.lxlim-info', p);
    if (!n) {
      if (!text) return;
      n = document.createElement('div');
      n.className = 'lxlim-info';
      n.setAttribute('data-logoed', '1');
      n.style.cssText = 'margin:0 0 10px;font:400 12.5px/1.5 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft,#8a8fa3)';
      b.parentNode.insertBefore(n, b);
    }
    if (n.textContent !== (text || '')) n.textContent = text || '';
    n.style.display = text ? '' : 'none';
  }
  function toast(text) { try { if (typeof window.lxToast === 'function') window.lxToast(text); } catch (e) {} }

  // ---- state --------------------------------------------------------------------------------------
  var pool, poolErr = false, dec = null, busy = false;
  var acct = { key: '', bal: {}, reg: null };            // raw spendable balances, DCL registration

  function code() { var d = window.__lxnAssetData, a = asset(); return (d && d.symbol) || (a && a.code) || ''; }

  // ---- the fee row --------------------------------------------------------------------------------
  // NONE: NEAR limit orders are free, as Stellar's (RAZA 2026-11-04; neardcl.js LIMIT_FEE_BPS). Like Stellar's Limit
  // pane, this one says nothing about fees -- the inherited lx-feemodal no longer builds a row here, and anything a
  // stale container still carries is removed rather than left claiming a fee.
  function feeRow(p) {
    $$('.lx-feerow, .lx-feebanner-wrap, .lx-feetier, .lxn-limfee', p).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
  }

  // ---- the button ---------------------------------------------------------------------------------
  // A TOKEN WITH NO ORDER-BOOK POOL CAN BE GIVEN ONE (RAZA 2026-11-04, LUMOS: "Also fix limit and orderbook tabs"
  // -> "yes"). Only when the page has a price for it: the pool opens at that price (neardcl.js planCreate), so a
  // token without one keeps NOPOOL rather than inviting a guessed opening price.
  function createPlan() {
    var d = window.__lxnAssetData, a = asset();
    if (pool !== null || poolErr || !a || dec == null || !(d && d.price > 0)) return null;
    try { return D().planCreate(a.id, dec, +d.price); } catch (e) { return null; }
  }
  function setCta(p) {
    var b = cta(p);
    if (!b) return;
    var cp = createPlan();
    var on = !!pool || !!cp, label;
    if (pool === undefined && !poolErr) label = 'Checking for an order-book pool…';
    else if (poolErr) label = 'Could not reach the order book — reload to try again';
    else if (cp) label = 'Create order-book pool';
    else if (!pool) label = NOPOOL;
    else label = 'Place Limit Order';                               // Stellar's wording, either side
    info(p, cp ? code() + ' has no order-book pool yet. Creating one costs about 0.1 NEAR and opens it at '
      + fmt(cp.opensAt, 8) + ' NEAR, the current price.' : '');
    // lx-gate saved the design's label before this ran and restores data-lxorig on connect.
    b.setAttribute('data-lxorig', label);
    b.setAttribute('data-lxdis', on ? '0' : '1');
    if (b.getAttribute('data-lxgate') === '1') return;              // "Connect wallet" belongs to lx-gate
    if (busy) return;
    if (b.textContent !== label) b.textContent = label;
    b.disabled = !on;
    if (on) { b.removeAttribute('disabled'); b.removeAttribute('aria-disabled'); b.style.opacity = ''; b.style.cursor = ''; }
    else { b.setAttribute('aria-disabled', 'true'); b.style.opacity = '.55'; b.style.cursor = 'not-allowed'; }
  }

  // ---- painting -----------------------------------------------------------------------------------
  function maxButton(f, on) {
    var row = f && $('[class*="dxa-trade-frow"]', f);
    if (!row) return;
    var b = $('.lxlim-max', row);
    if (!on) { if (b && b.parentNode) b.parentNode.removeChild(b); return; }
    if (b) return;
    b = document.createElement('button');                         // Stellar's MAX; its CSS is inherited
    b.type = 'button';
    b.className = 'lxlim-max';
    b.textContent = 'MAX';
    // Stellar's order is "Avail: x NEAR  ≈ $y USD  MAX" (RAZA 2026-11-07: "Far-Right Placement"): MAX is the row's last
    // child, and the dollar figure, which can arrive after it, goes in front of it (totalUsd).
    row.appendChild(b);
  }
  function paint() {
    var p = pane(), a = asset();
    if (!p || !a) return;
    var f = fields(p);
    if (f.length < 2) return;
    var s = side(p), who = me();
    mark(frowMono(f[0]), '');                                     // Stellar parity: no "Market:" label
    var spendF = s === 'sell' ? f[1] : (f[2] || f[1]);
    var otherF = s === 'sell' ? f[2] : f[1];
    if (otherF && otherF !== spendF) { var om = frowMono(otherF); mark(om, ''); if (om) om.removeAttribute('data-lxbal'); maxButton(otherF, false); }
    // Stellar's "Avail:" on both layouts; data-lxbal is the hook its stylesheet right-aligns the figure by.
    // MAX stays beside the balance at zero too, as on Stellar (RAZA 2026-11-05: Sell QTC read "Avail: 0 QTC" with no
    // MAX, where lumoscore.com shows it); a press then says why there is nothing to fill.
    var pre = 'Avail: ', text = pre + '—', canMax = false;          // signed out: "Avail: —", as Stellar
    if (who && pool) {
      var id = s === 'sell' ? a.id : 'near', raw = acct.bal[id];
      if (raw == null || (s === 'sell' && dec == null)) text = pre + '—';
      else {
        // Floored from the raw units, like MAX: a rounded figure here would name, as available, more than is held.
        var have = s === 'sell' ? fmtDown(raw, dec) : fmtDown(SW() ? SW().swapRoom('near', raw) : raw, 24);
        text = pre + have + ' ' + (s === 'sell' ? code() : 'NEAR');
        canMax = true;
      }
    }
    mark(frowMono(spendF), text);
    if (frowMono(spendF)) frowMono(spendF).setAttribute('data-lxbal', '1');
    maxButton(spendF, canMax);
    // NO GHOST TEXT (RAZA 2026-11-05, reversing 2026-11-03's "0.00"): "rendering them empty". Stellar's three
    // inputs carry no placeholder at all, measured on lumoscore.com, so an empty field here is empty too.
    f.forEach(function (x) { var i = input(x); if (i && i.placeholder) i.placeholder = ''; });
    var tot = input(f[2]);
    if (tot && !phone(p) && tot.hasAttribute('readonly')) tot.removeAttribute('readonly');
    feeRow(p);
    prefillPrice(p);
    recalc(p);
    setCta(p);
  }

  // The order as typed, in the engine's terms (null when incomplete).
  function current(p) {
    var f = fields(p);
    var ps = numOnly(input(f[0]) && input(f[0]).value), as = numOnly(input(f[1]) && input(f[1]).value);
    if (!pool || dec == null || !(Number(ps) > 0) || !(Number(as) > 0)) return null;
    try { return D().plan(pool, dec, side(p), ps, as); } catch (e) { return null; }
  }

  function recalc(p) {
    var f = fields(p);
    if (f.length < 2) return;
    var price = num(input(f[0]) && input(f[0]).value), amount = num(input(f[1]) && input(f[1]).value);
    var tot = input(f[2]);
    if (tot && document.activeElement !== tot) {
      var v = (price > 0 && amount > 0) ? plainIn(price * amount) : '';
      if (tot.value !== v) tot.value = v;
    }
    var o = current(p), op = side(p) === 'sell' ? '≥' : '≤';
    var txt = '—';
    if (o) txt = phone(p) ? (op + ' ' + fmt(o.rests, 8) + ' NEAR') : (code() + '/NEAR ' + op + ' ' + fmt(o.rests, 8));
    // With a price and no amount yet, the condition as typed (RAZA 2026-11-03: "USDC/NEAR <= [Limit Price]" rather
    // than a dash); once there is an amount it becomes the pool tick the order really rests at, above.
    else if (price > 0) txt = phone(p) ? (op + ' ' + fmt(price, 8) + ' NEAR') : (code() + '/NEAR ' + op + ' ' + fmt(price, 8));
    sumRow(p, 'filled when', txt);
    totalUsd(p);
    orderCtx(p);
  }

  // THE TOTAL IN DOLLARS, at the end of the Total row, as Stellar prints it ("≈ $100.03 USD"). The Total is
  // always NEAR here, priced at the page's NEAR rate. Empty (and hidden by Stellar's :empty rule) until
  // there is a total.
  function totalUsd(p) {
    var f = fields(p), row = f[2] && $('[class*="dxa-trade-frow"]', f[2]);
    if (!row || phone(p)) return;
    var el = $('.lx-ltusd', row);
    if (!el) { el = document.createElement('span'); el.className = 'lx-ltusd'; el.setAttribute('data-logoed', '1'); row.insertBefore(el, $('.lxlim-max', row)); }
    var d = window.__lxnAssetData, tot = num(input(f[2]) && input(f[2]).value);
    var v = (tot > 0 && d && d.nearUsd > 0) ? tot * d.nearUsd : 0;
    var t = v > 0 ? ('≈ $' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD') : '';
    if (el.textContent !== t) el.textContent = t;
  }

  // ORDER CONTEXT, Stellar's block above the summary (RAZA 2026-10-29: "I need the order context and all the
  // stats mentioned below it"): best bid / ask, the spread, where the typed price sits against the side it
  // would have to cross, and what is ahead of it. Read from the same book the Orderbook tab paints
  // (window.__lxnBook, Rhea's DCL liquidity, repainted on 'lxn:book'). A DCL book is liquidity at price
  // POINTS rather than individual orders, so the queue is counted in price levels, not orders.
  //
  // SELL (RAZA 2026-11-05: "0.09% below the ask", and "Ahead of you" instead of "fills now"). Stellar's own rows on
  // Sell are its Buy rows: limitSide() there never sees the active tab, so lumoscore.com measures Sell against the ask
  // and fills the fourth row from the bids. What is copied here is what that screen shows: the ask, always, and always
  // "Ahead of you" on Sell, in Stellar's "7.8K USDC · 7 orders" shape. What is NOT copied is its "fills now" for a sell
  // priced ABOVE the ask, which would be false: that order waits, behind the asks at or under its price, and those are
  // what the row counts. A sell at or under the best bid counts the bids it meets, the same figure Stellar prints.
  function qty(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return a === 0 ? '0' : String(+n.toFixed(3));
  }
  function orderCtx(p) {
    if (phone(p)) return;
    var bk = window.__lxnBook;
    var host = $('.lx-oc', p);
    // The book, not a pool, is what this reads (RAZA 2026-11-06: "its not carrying this section like on Stellar"): a
    // token with no order-book pool still has its classic pool's curve (dexasset.js curveBook).
    if (!bk || (!(bk.asks || []).length && !(bk.bids || []).length)) { if (host) host.style.display = 'none'; return; }
    if (!host) {
      host = document.createElement('div');
      host.className = 'lx-oc';
      host.setAttribute('data-logoed', '1');
      var sum = $('[class*="dxa-trade-summary"]', p);
      if (sum && sum.parentNode) sum.parentNode.insertBefore(host, sum); else return;
    }
    host.style.display = '';
    var asks = bk.asks || [], bids = bk.bids || [], f = fields(p), s = side(p), c = code();
    var pr = num(input(f[0]) && input(f[0]).value);
    var want = num(input(f[1]) && input(f[1]).value);
    var bb = bids.length ? +bids[0].px : 0, ba = asks.length ? +asks[0].px : 0;
    var mid = (bb && ba) ? (bb + ba) / 2 : (bb || ba);
    var spread = (bb && ba && mid) ? ((ba - bb) / mid * 100) : null;
    var away = (pr > 0 && ba) ? ((pr - ba) / ba * 100) : null;
    var awayTxt = away == null ? '—' : (Math.abs(away) < 0.01 ? 'at the ask'
      : (Math.abs(away).toFixed(2) + '% ' + (away < 0 ? 'below ' : 'above ') + 'the ask'));
    var fills = !!(pr > 0 && ba) && s === 'buy' && pr >= ba;
    // Six figures, and a tiny price in the page's own 0.0₈2011 form rather than 2.00059e-9 (BLACKDRAGON, 2026-11-06).
    var six = function (v) {
      v = +v;
      if (!v) return '—';
      if (v >= 1e-5) return String(+v.toPrecision(6));
      var t = v.toFixed(30).split('.')[1], z = 0;
      while (t.charAt(z) === '0') z++;
      var sub = String(z).split('').map(function (c) { return '₀₁₂₃₄₅₆₇₈₉'.charAt(+c); }).join('');
      return '0.0' + sub + t.slice(z, z + 4).replace(/0+$/, '');
    };
    var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
    var lab, val, cls;
    if (!(pr > 0)) { lab = 'Ahead of you'; val = '—'; cls = ''; }
    else if (fills) {
      // How much of THIS order the book can absorb at or better than the typed price (amounts are in the token).
      lab = 'Execution';
      var have = 0;
      for (var k = 0; k < asks.length; k++) {
        var kp = +asks[k].px;
        if (kp > pr) break;
        have += +asks[k].amt || 0;
      }
      var pf = want > 0 ? Math.max(0, Math.min(100, have / want * 100)) : 100;
      if (pf >= 99.5) { val = 'fills now'; cls = 'lx-oc-ok'; }
      else { val = (pf < 0.5 ? '<1%' : Math.round(pf) + '%') + ' fills now | ' + Math.max(0, 100 - Math.round(pf)) + '% open order'; cls = 'lx-oc-hi'; }
    } else {
      // The liquidity already at this price or better on the order's own side of the book (a crossing sell: see above).
      lab = 'Ahead of you';
      var crosses = s === 'sell' && !!bb && pr <= bb;
      var q0 = 0, nlev = 0, list = (s === 'buy' || crosses) ? bids : asks;
      for (var i = 0; i < list.length; i++) {
        var lp = +list[i].px;
        if ((s === 'buy' || crosses) ? lp < pr : lp > pr) break;
        q0 += +list[i].amt || 0; nlev++;
      }
      cls = nlev ? 'lx-oc-hi' : 'lx-oc-ok';
      // Stellar's "over x · n+" when the whole of what was read is ahead: the book may run on past it.
      var more = nlev > 0 && nlev >= list.length;
      val = nlev ? ((more ? 'over ' : '') + qty(q0) + ' ' + c + ' · ' + nlev + (more ? '+ price levels' : (nlev === 1 ? ' price level' : ' price levels'))) : 'nothing — first in line';
    }
    host.innerHTML = '<div class="lx-oc-t">Order context</div>'
      + '<div class="lx-oc-r"><span>Best bid / ask (NEAR)</span><b>' + six(bb) + ' / ' + six(ba) + '</b></div>'
      + '<div class="lx-oc-r"><span>Spread</span><b>' + (spread == null ? '—' : spread.toFixed(2) + '%') + '</b></div>'
      + '<div class="lx-oc-r"><span>Your price</span><b class="' + (fills ? 'lx-oc-ok' : '') + '">' + esc(awayTxt) + '</b></div>'
      + '<div class="lx-oc-r"><span>' + lab + '</span><b class="' + cls + '">' + esc(val) + '</b></div>';
  }

  function fromTotal(p) {
    var f = fields(p);
    var price = num(input(f[0]) && input(f[0]).value), total = num(input(f[2]) && input(f[2]).value);
    var ai = input(f[1]);
    if (ai) ai.value = (price > 0 && total > 0) ? plainIn(total / price) : '';
    recalc(p);
  }

  // The gas an order's transactions set aside before they run: their attached gas at NEAR's floor price (10^8 yocto a unit),
  // three times over for the price the protocol may charge ahead, refunded unused. 3 x (30 + 20 + 180) TGas = 0.069 NEAR for
  // a first buy, against the 0.2 a NEAR swap keeps (nearswap.js SWAP_KEEP).
  var LIM_GAS_PRICE = '100000000', LIM_GAS_HOLD = 3, LIM_GAS_TYPICAL = 230;
  function limitGasKeep(txs) {
    var tg = 0;
    (txs || []).forEach(function (t) { (t.actions || []).forEach(function (x) { tg += Number(String((x.params && x.params.gas) || '0').slice(0, -12) || 0); }); });
    if (!(tg > 0)) tg = LIM_GAS_TYPICAL;
    return BigInt(Math.ceil(tg * LIM_GAS_HOLD)) * D().big(LIM_GAS_PRICE) * BigInt(1000000000000);
  }
  function fillMax(p) {
    var f = fields(p), ai = input(f[1]), a = asset();
    if (!ai || !a) return;
    var price = num(input(f[0]) && input(f[0]).value), out = '';
    // MAX must never round above what is held. Neither plainIn nor a Number can promise that: a
    // Number keeps ~16 significant digits of an 18-24 decimal balance (and may round it up), and
    // plainIn's 12 significant digits drop the 6th decimal of any balance from a million up --
    // 1,234,567.999999 filled as 1,234,568. So sell truncates the exact raw string, and buy, which
    // has to divide by a price anyway, floors to 6 places and is printed without re-rounding.
    // Nothing is held back for a fee: limit orders are free (RAZA 2026-11-04), so MAX is the whole balance.
    if (side(p) === 'sell') {
      if (acct.bal[a.id] != null && dec != null) out = trunc6(D().fromUnits(acct.bal[a.id], dec));
    }
    else if (price > 0 && acct.bal.near != null && SW()) {
      // Leave room for HOT's 0.2 NEAR floor (SWAP_KEEP; see place()) and the DCL storage a first order adds.
      var room = D().big(SW().swapRoom('near', acct.bal.near));
      if (acct.reg === false) room -= D().big('500000000000000000000000');
      var amt = room > BigInt(0) ? D().toNum(room.toString(), 24) / price : 0;
      if (amt > 0) out = trunc6((Math.floor(amt * 1e6) / 1e6).toFixed(6));
    }
    ai.value = (out && +out > 0) ? out : '';
    recalc(p);
    if (!(out && +out > 0)) say(p, maxWhy(p, price));
    else say(p, '');
  }
  // Why MAX had nothing to fill: a buy needs a price to divide by, and NEAR held back for gas (0.2) and,
  // before a first order, Rhea's one-time storage (0.5) can leave nothing to spend.
  function maxWhy(p, price) {
    if (side(p) === 'buy' && !(price > 0)) return 'Enter a limit price first — MAX divides your NEAR by it.';
    if (side(p) === 'sell') return 'You have no ' + code() + ' to sell.';
    if (acct.bal.near == null) return 'Reading your balance — try again in a moment.';
    return 'Nothing left to spend: NEAR keeps 0.2 for gas' + (acct.reg === false ? ', and your first order needs 0.5 NEAR of order-book storage (refundable)' : '') + '. You have ' + fmtDown(acct.bal.near, 24) + ' NEAR.';
  }
  function trunc6(s) {
    var i = s.indexOf('.');
    return i < 0 ? s : s.slice(0, i + 7).replace(/\.?0+$/, '');
  }
  // A balance for display, floored to 6 places with the same trunc6 MAX fills with, so the Available line,
  // the "You only have" message and the MAX figure can never disagree or overstate the balance.
  function fmtDown(raw, d) {
    var p = trunc6(D().fromUnits(raw, d)).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  // THE LIMIT PRICE STARTS AT THE MARKET PRICE (RAZA 2026-11-03, reversing 2026-10-29's blank price; Stellar
  // fills it too). Amount and Total stay empty. Only an EMPTY price is filled, and never one the user typed or
  // cleared: a price of theirs is theirs. Refilled on a Buy/Sell switch while they have not typed one.
  function prefillPrice(p) {
    var f = fields(p), pi = input(f[0]), d = window.__lxnAssetData;
    // Any token with a price, pool or not: Order Context reads this field, and it shows without an order-book pool too.
    if (!pi || p.__lxnPxTyped || String(pi.value || '').trim() || pool === undefined) return;
    var px = d && d.price > 0 ? +d.price : 0;
    if (!(px > 0)) return;
    pi.value = plainIn(+px.toPrecision(8));
    recalc(p);
  }

  // ---- the connected account ---------------------------------------------------------------------
  function load() {
    var who = me(), a = asset(), p = pane();
    if (!who || !a || !SW()) { paint(); return Promise.resolve(); }
    var key = who + '|' + a.id;
    if (acct.key !== key) acct = { key: key, bal: {}, reg: null };
    return Promise.all([
      SW().balance(who, 'near').catch(function () { return null; }),
      SW().balance(who, a.id).catch(function () { return null; }),
      pool ? D().registered(who).catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (r) {
      if (acct.key !== key) return;
      acct.bal.near = r[0]; acct.bal[a.id] = r[1]; acct.reg = r[2];
      if (p) paint();
    });
  }

  // ---- placing the order --------------------------------------------------------------------------
  function validate(p, o) {
    if (!pool) return pool === null ? NOPOOL + '.' : 'Still checking the order book — try again in a moment.';
    var f = fields(p);
    if (!(num(input(f[0]) && input(f[0]).value) > 0)) return 'Enter a limit price.';
    if (!(num(input(f[1]) && input(f[1]).value) > 0)) return 'Enter an amount.';
    if (!o) return 'That order is too small to place.';
    if (!me()) return 'Connect a NEAR wallet first.';
    return '';
  }

  // The pool, created in the connected wallet; then the pane asks the chain for it again and becomes a normal Limit pane.
  function createPool(p) {
    if (busy) return;
    var cp = createPlan(), who = me(), a = asset(), b = cta(p), label = b ? b.textContent : '';
    if (!cp) return;
    if (!who) { say(p, 'Connect a NEAR wallet first.'); return; }
    busy = true;
    if (b) { b.textContent = 'Checking…'; b.classList.add('lx-btnload'); }
    function stop(text) { busy = false; if (b) { b.textContent = label; b.classList.remove('lx-btnload'); } setCta(p); if (text) say(p, text); }
    // HOT will not sign anything that leaves under 0.2 NEAR (SWAP_KEEP) and says only "User rejected the request"
    // (RAZA 2026-11-04: the treasury held 0.164 NEAR; the registration landed, create_pool never did). So the
    // shortfall is named here, before the wallet opens, from the transactions actually about to be sent.
    D().buildCreate(who, cp).then(function (txs) {
      return SW().balance(who, 'near').then(function (have) {
        var need = D().big(SW().SWAP_KEEP);
        txs.forEach(function (t) { t.actions.forEach(function (x) { need += D().big(x.params.deposit); }); });
        if (D().big(have) < need) {
          throw new Error('Creating the pool needs ' + fmt(D().toNum(need.toString(), 24), 4) + ' NEAR in this wallet — '
            + fmt(D().toNum(D().big(cp.deposit).toString(), 24), 4) + ' for the pool, the rest kept for gas — and it has '
            + fmt(D().toNum(String(have), 24), 4) + ' NEAR.');
        }
        return txs;
      });
    }).then(function (txs) {
      window.__lxnLastCreate = { plan: cp, txs: txs };
      if (b) b.textContent = 'Confirm in wallet…';
      return D().sign(txs);
    }).then(function (res) {
      var last = res && res[res.length - 1], st = last && last.status;
      if (st && st.Failure) { stop('Creating the pool failed on chain. Check your wallet activity.'); return; }
      D().forget(a.id);
      pool = undefined;
      stop('');
      info(p, '');
      toast('Order-book pool created for ' + code() + ' at ' + fmt(cp.opensAt, 8) + ' NEAR');
      paint();
      return D().poolFor(a.id).then(function (pl) { pool = pl; paint(); load(); try { if (window.__lxnBookReload) window.__lxnBookReload(); } catch (e) {} });
    }).catch(function (e) {
      var m = (e && e.message) || '';
      stop(e && e.lxnWallet ? D().walletErr(e, 'created') : (m || 'The pool could not be created.'));
    });
  }

  function place(p) {
    if (busy) return;
    var o = current(p), msg = validate(p, o);
    if (msg) { say(p, msg); return; }
    var b = cta(p), who = me(), a = asset(), label = b ? b.textContent : '';
    busy = true;
    say(p, '');
    if (b) { b.textContent = 'Checking your account…'; b.classList.add('lx-btnload'); }
    function stop(text) { busy = false; if (b) { b.textContent = label; b.classList.remove('lx-btnload'); } setCta(p); if (text) say(p, text); }
    Promise.all([D().prereqs(who, o), SW().balance(who, 'near'), o.sell === D().WNEAR ? null : SW().balance(who, o.sell)]).then(function (r) {
      var pre = r[0], nearBal = D().big(r[1]);
      var txs = D().buildPlace(who, o, pre);
      // WHAT THE ORDER REALLY NEEDS IN NATIVE NEAR (RAZA 2026-11-13, iOS Buy: "I have enough Near but it still won't let me
      // place"). It held back SWAP_KEEP, 0.2: Rhea's and HOT's figure for a SWAP that spends NEAR. An order needs the gas
      // its own transactions attach, set aside ahead and refunded unused: limitGasKeep. Storage is the chain's answer
      // (prereqs): 0.5 only when storage_balance_of on the order book is null, 0.1 when its room is spent, else none. And
      // the figure is the spendable balance, which leaves out NEAR the account locks for its own storage -- a wallet can
      // show 5 NEAR where 1.8 can move (lumoscore.near: 338 KB of contract storage) -- so the refusal names both.
      // EXCEPT WHEN THE ORDER SPENDS NEAR: HOT refuses those itself with "Must have 0.2N or more left in wallet for gas
      // fee" (its words, recorded 2026-11-03), so a Buy keeps SWAP_KEEP exactly as a swap does. The smaller hold is for
      // a token sale, where NEAR only pays gas.
      var keep = o.sell === D().WNEAR ? D().big(SW().SWAP_KEEP) : limitGasKeep(txs);
      // What leaves the wallet is the order itself (neardcl plan().spendRaw; limit orders carry no fee).
      var needNear = D().big(pre.storage) + (o.sell === D().WNEAR ? D().big(o.spendRaw) : BigInt(0));
      // JUST THE VERDICT (RAZA 2026-11-05) for the token; for NEAR the parts, because "enough" is not visible from the Avail line.
      if (o.sell !== D().WNEAR && D().big(o.spendRaw) > D().big(r[2])) throw new Error('Not enough ' + code());
      if (needNear + keep > nearBal) {
        var parts = [];
        if (pre.dcl === 'register') parts.push(fmt(D().toNum(pre.dclDeposit, 24), 4) + ' first-time order-book storage');
        else if (pre.dcl === 'topup') parts.push(fmt(D().toNum(pre.dclDeposit, 24), 4) + ' order-book storage top-up');
        if (o.sell === D().WNEAR) parts.push(fmt(D().toNum(o.spendRaw, 24), 6) + ' for the order');
        parts.push(fmt(D().toNum(keep.toString(), 24), 4) + ' for gas');
        throw new Error('Not enough NEAR: this order needs ' + fmt(D().toNum((needNear + keep).toString(), 24), 4) + ' native NEAR ('
          + parts.join(', ') + '), and ' + fmt(D().toNum(String(r[1]), 24), 4) + ' NEAR can be spent from this account.');
      }
      window.__lxnLastLimit = { plan: o, pre: pre, txs: txs };
      if (b) b.textContent = 'Confirm in wallet…';
      return D().sign(txs);
    }).then(function (res) {
      var v = D().verdict(res);
      if (v.ok === false) {
        stop(v.why === 'refunded' ? 'The order book did not accept the order, so your tokens came back.' : 'The order failed on chain. Check your wallet activity.');
        return;
      }
      stop('');
      var ai = input(fields(p)[1]);
      if (ai) ai.value = '';
      recalc(p);
      toast((o.side === 'sell' ? 'Sell' : 'Buy') + ' order placed — ' + fmt(D().toNum(o.tokenRaw, dec), 6) + ' ' + code() + ' at ' + fmt(o.rests, 8) + ' NEAR');
      load();
      ooLoad();
      try { if (window.__lxnBookReload) window.__lxnBookReload(); } catch (e) {}
    }).catch(function (e) {
      var m = (e && e.message) || '';
      stop(e && e.lxnWallet ? D().walletErr(e, 'placed') : (m || 'The order could not be placed.'));
    });
  }

  // ---- wiring -------------------------------------------------------------------------------------
  var booted = false;
  function wire() {
    // WINDOW capture, so this runs ahead of the design's handlers and lx-feemodal's review. A click while
    // lx-gate shows "Connect wallet" is left alone: the gate opens the wallet picker.
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || !booted) return;
      var p = t.closest('.dxa-pane-limit, .mdxa-pane-limit');
      if (!p) return;
      if (t.closest('.lxlim-max')) { e.preventDefault(); e.stopImmediatePropagation(); fillMax(p); return; }
      if (t.closest('[class*="dxa-side-btn"]')) {
        claimSide(p, t.closest('[class*="dxa-side-btn"]'));
        Promise.resolve().then(function () {                       // before paint: no flash (see dxaswap.js)
          var ai = input(fields(p)[1]); if (ai) ai.value = '';
          var ti = input(fields(p)[2]); if (ti) ti.value = '';
          say(p, ''); paint();
        });
        return;
      }
      var b = t.closest('[class*="dxa-trade-cta"]');
      if (!b) return;
      if (b.getAttribute('data-lxgate') === '1') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b.disabled) return;
      if (!pool && createPlan()) { createPool(p); return; }
      place(p);
    }, true);
    // Typing is claimed at the pane, so the design's own handler cannot write its mock total after ours.
    window.addEventListener('input', function (e) {
      var t = e.target;
      var p = t && t.closest && t.closest('.dxa-pane-limit, .mdxa-pane-limit');
      if (!p || t.tagName !== 'INPUT' || !booted) return;
      e.stopImmediatePropagation();
      var clean = numOnly(t.value);
      if (clean !== t.value) t.value = clean;
      if (t === input(fields(p)[0])) p.__lxnPxTyped = 1;
      if (t === input(fields(p)[2])) fromTotal(p); else recalc(p);
      if (!busy) say(p, '');
    }, true);
  }

  // ---- YOUR OPEN ORDERS ON THIS ASSET, under the Limit form (RAZA's auditor 2026-11-23: "Limit order not viewable
  // or cancellable on the Trade page") ------------------------------------------------------------------------
  // Same panel, same look and the same rules as Stellar's (_dexassetdata.js renderOpenOffers): every limit pane on
  // the page (desktop .dxa-pane-limit, phone .mdxa-pane-limit), hidden when there is nothing to show, five rows and
  // then "Show all N", and Cancel goes straight to the wallet -- the wallet's own approval is the confirmation.
  // Rows are { id, sell, amt, px, ctr, note?, btn? } with amt in THIS asset and px in ctr per one of it.
  function ooCss() {
    if (document.getElementById('lx-oo-css')) return;
    var st = document.createElement('style'); st.id = 'lx-oo-css';
    st.textContent = '.lx-oo{margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(255,255,255,.1))}'
      + '.lx-oo-h{display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;margin-bottom:6px;color:var(--text,#e8e8ee)}'
      + '.lx-oo-n{font:600 11px/1 "JetBrains Mono",monospace;padding:3px 6px;border-radius:6px;background:var(--surface-2,rgba(255,255,255,.06));color:var(--text-muted,#8b90a0)}'
      + '.lx-oo-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--border,rgba(255,255,255,.06));font-size:12.5px}'
      + '.lx-oo-row:first-of-type{border-top:0}'
      + '.lx-oo-side{flex:0 0 auto;font-weight:700;font-size:11px;padding:2px 7px;border-radius:5px}'
      + '.lx-oo-side.lx-oo-b{color:var(--green,#22c55e);background:rgba(34,197,94,.12)}.lx-oo-side.lx-oo-s{color:var(--red,#ea3943);background:rgba(234,57,67,.12)}'
      + '.lx-oo-txt{flex:1 1 auto;min-width:0;font-family:"JetBrains Mono",monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#e8e8ee)}'
      + '.lx-oo-txt small{display:block;overflow:hidden;text-overflow:ellipsis;color:var(--text-muted,#8b90a0);font-size:11px}'
      + '.lx-oo-x{flex:0 0 auto;padding:5px 10px;border-radius:7px;border:1px solid var(--border,rgba(255,255,255,.14));background:transparent;color:var(--text,#e8e8ee);font:600 12px/1 inherit;cursor:pointer}'
      + '.lx-oo-more{margin-top:4px;padding:4px 0;border:0;background:none;color:var(--accent,#ea6a2c);font:600 12px/1 inherit;cursor:pointer}'
      + '.lx-oo-x:hover{border-color:var(--red,#ea3943);color:var(--red,#ea3943)}.lx-oo-x[disabled]{opacity:.6;cursor:default}';
    document.head.appendChild(st);
  }
  function ooEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ooNum(n) { if (!(n > 0)) return '0'; if (n >= 1000) return Math.round(n).toLocaleString('en-US'); if (n >= 1) return String(+n.toFixed(4)); return String(+n.toPrecision(6)); }
  // Prices under a millionth keep the site's subscript-zero form (0.0₉3102), never "3.1e-10".
  function ooPx(x) {
    if (!(x > 0)) return '–';
    if (x >= 1e-6) return String(+x.toPrecision(6));
    var z = Math.floor(-Math.log10(x)) - 1, d = String(Math.round(x * Math.pow(10, z + 5)));
    var sub = String(z).split('').map(function (c) { return '₀₁₂₃₄₅₆₇₈₉'.charAt(+c); }).join('');
    return '0.0' + sub + d.replace(/0+$/, '');
  }
  var OO_ROWS = [];
  function ooPaint(rows, code) {
    OO_ROWS = rows || [];
    ooCss();
    $$('[class*="dxa-pane-limit"]').forEach(function (p) {
      var box = $('.lx-oo', p);
      if (!OO_ROWS.length) { if (box) box.style.display = 'none'; return; }
      if (!box) {
        box = document.createElement('div'); box.className = 'lx-oo';
        var c = $('[class*="dxa-trade-cta"]', p);
        if (c && c.parentNode) c.parentNode.insertBefore(box, c.nextSibling); else p.appendChild(box);
      }
      box.style.display = '';
      box.innerHTML = '<div class="lx-oo-h">Your open orders <span class="lx-oo-n">' + OO_ROWS.length + '</span></div>'
        + OO_ROWS.map(function (o, i) {
          return '<div class="lx-oo-row"' + (i >= 5 && !box.__lxAll ? ' style="display:none"' : '') + '>'
            + '<span class="lx-oo-side ' + (o.sell ? 'lx-oo-s' : 'lx-oo-b') + '">' + (o.sell ? 'Sell' : 'Buy') + '</span>'
            + '<span class="lx-oo-txt">' + ooNum(o.amt) + ' ' + ooEsc(code) + ' <small>@ ' + ooPx(o.px) + ' ' + ooEsc(o.ctr) + (o.note ? ' · ' + ooEsc(o.note) : '') + '</small></span>'
            + '<button type="button" class="lx-oo-x" data-lxoo="' + ooEsc(o.id) + '" data-lxlbl="' + ooEsc(o.btn || 'Cancel') + '">' + ooEsc(o.btn || 'Cancel') + '</button></div>';
        }).join('')
        + (OO_ROWS.length > 5 && !box.__lxAll ? '<button type="button" class="lx-oo-more">Show all ' + OO_ROWS.length + '</button>' : '');
    });
    if (window.__lxOOwired) return;
    window.__lxOOwired = 1;
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var mo = t.closest('.lx-oo-more');
      if (mo) { e.preventDefault(); e.stopPropagation(); var bx = mo.closest('.lx-oo'); bx.__lxAll = 1; $$('.lx-oo-row', bx).forEach(function (r) { r.style.display = ''; }); mo.remove(); return; }
      var b = t.closest('.lx-oo-x[data-lxoo]');
      if (!b || b.disabled) return;
      e.preventDefault(); e.stopPropagation();
      var id = b.getAttribute('data-lxoo');
      b.disabled = true; b.textContent = 'Confirm in wallet…';
      ooCancel(id, function () { b.textContent = 'Cancelling…'; }).then(function () {
        try { if (typeof window.lxToast === 'function') window.lxToast('Order cancelled'); } catch (x) {}
        ooPaint(OO_ROWS.filter(function (o) { return String(o.id) !== String(id); }), ooCode());
        setTimeout(ooLoad, 4000);
      }).catch(function (err) {
        b.disabled = false; b.textContent = b.getAttribute('data-lxlbl') || 'Cancel';
        try { if (typeof window.lxToast === 'function') window.lxToast('Cancel failed — ' + ((err && err.message) || 'try again')); } catch (x) {}
      });
    }, true);
  }
  // NEAR: Rhea DCL orders from lxnDcl.activeOrders -- the wallet's Open orders source. A sell's sell_token is THIS
  // token. Price from the order's point and the pool's two decimals, as the wallet's shapeOrder does. Cancel is
  // lxnDcl.buildCancel + sign, the wallet's Cancel; a fully filled order is "collected" by the same call.
  function ooCode() { return code(); }
  function ooLoad() {
    var a = asset(), who = me(), Dl = D();
    if (!a || !who || !Dl || !SW()) { ooPaint([], ooCode()); return; }
    Dl.activeOrders(who).then(function (list) {
      list = (list || []).filter(function (o) { return o.sell_token === a.id || o.buy_token === a.id; });
      var ids = {};
      list.forEach(function (o) { String(o.pool_id).split('|').slice(0, 2).forEach(function (t) { ids[t] = 1; }); ids[o.sell_token] = 1; ids[o.buy_token] = 1; });
      var keys = Object.keys(ids);
      return Promise.all(keys.map(function (k) { return SW().tokenInfo(k).catch(function () { return null; }); })).then(function (ms) {
        var M = {}; keys.forEach(function (k, i) { M[k] = ms[i] || {}; });
        ooPaint(list.map(function (o) {
          var sell = o.sell_token === a.id, quo = sell ? o.buy_token : o.sell_token;
          var xy = String(o.pool_id).split('|'), px = 0;
          if (M[xy[0]].dec != null && M[xy[1]].dec != null) {
            var pxy = Math.pow(1.0001, +o.point) * Math.pow(10, M[xy[0]].dec - M[xy[1]].dec);
            px = xy[0] === a.id ? pxy : 1 / pxy;
          }
          // The ORDER's size, with how much has filled: lumos01.near's RHEA buy had 0.00000000006 NEAR left and 8.11 RHEA
          // bought -- shown from what remained it read "4.9e-9 RHEA". A finished order is Collect (cancel_order sends the
          // proceeds), as in the wallet.
          var ds = M[o.sell_token].dec, rem = ds != null ? Number(Dl.fromUnits(o.remain_amount, ds)) : 0;
          var orig = ds != null ? Number(Dl.fromUnits(o.original_amount, ds)) : 0, left = orig > 0 ? rem / orig : 1;
          var done = left < 0.001, pct = Math.round((1 - left) * 100);
          return { id: o.order_id, sell: sell, amt: sell ? orig : (px > 0 ? orig / px : 0), px: px, ctr: quo === 'wrap.near' ? 'NEAR' : (M[quo].code || quo),
            note: done ? 'filled' : (pct > 0 ? pct + '% filled' : ''), btn: done ? 'Collect' : 'Cancel' };
        }), ooCode());
      });
    }).catch(function () {});
  }
  function ooCancel(id, onSigned) {
    var who = me();
    if (!who) return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return D().buildCancel(who, [id]).then(function (b) { return D().sign(b.txs); }).then(function (res) {
      onSigned();
      var v = D().verdict ? D().verdict(res) : {};
      if (v && v.ok === false) throw new Error('The cancel failed on chain. Check your wallet activity.');
    });
  }

  function boot() {
    var p = pane(), a = asset();
    if (!p || !D() || !SW()) return false;
    if (!('__lxnAssetData' in window)) return false;               // dexasset.js has not finished yet
    if (!a) { pool = null; ready(); return true; }
    booted = true;
    var d = window.__lxnAssetData;
    dec = d && d.decimals != null ? +d.decimals : null;
    var decP = dec != null ? Promise.resolve(dec) : SW().tokenInfo(a.id).then(function (m) { dec = m.dec; return dec; });
    paint();
    Promise.all([D().poolFor(a.id), decP]).then(function (r) {
      pool = r[0];
      paint();
      ready();
      load();
    }, function () {
      poolErr = true;
      paint();
      ready();
    });
    load();
    ooLoad();
    // lx-mobtrade inserts the phone's Total field on its own cadence; repaint when the pane's direct
    // children change (childList only -- an observer reacting to its own text freezes the renderer).
    try { new MutationObserver(function () { paint(); }).observe(p, { childList: true }); } catch (e) {}
    // lx-feemodal may build its fee row after this; claim it again when the summary changes.
    var sum = $('[class*="dxa-trade-summary"]', p);
    try { if (sum) new MutationObserver(function () { feeRow(p); }).observe(sum, { childList: true }); } catch (e) {}
    try { if (window.lxn && window.lxn.onChange) window.lxn.onChange(function () { load(); }); } catch (e) {}
    window.addEventListener('storage', function (e) { if (e && /^lumos\./.test(e.key || '')) load(); });
    window.addEventListener('lxn:book', function () { orderCtx(p); });
    return true;
  }

  wire();
  window.__lxnDxaLimitState = function () { return { pool: pool, poolErr: poolErr, dec: dec, acct: acct, booted: booted }; };
  var n = 0;
  (function wait() {
    if (boot()) return;
    if (++n < 80) setTimeout(wait, 150); else ready();
  })();
})();
