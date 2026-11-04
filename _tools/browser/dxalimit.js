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
  function side(p) { return $('[class*="dxa-side-btn"].sell.active', p) ? 'sell' : 'buy'; }

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
  // lx-feemodal owns the row and rewrites its .lx-feehint (hidden in this pane by the head stylesheet);
  // the figure that is true for a limit order goes beside it, in an element lx-feemodal never touches.
  function feeRow(p) {
    var row = $('.lx-feerow', p);
    if (!row) return;
    var v = $('.lxn-limfee', row);
    if (!v) {
      v = document.createElement('span');
      v.className = 'mono lxp lxn-limfee';
      v.setAttribute('data-logoed', '1');
      row.appendChild(v);
    }
    // Stellar's row: "Trading fee  0.2%" (RAZA 2026-11-01). NEAR limit orders now carry the fee (neardcl.js).
    var t = window.__lxFeeRate === 0.001 ? '0.1%' : '0.2%';
    if (v.textContent !== t) v.textContent = t;
    v.style.color = 'var(--green,#22c55e)';                           // Stellar prints the fee in green
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
    // Stellar's order is "Avail: x NEAR  MAX  ≈ $y USD": MAX comes back (a balance arriving, a side switch)
    // after the dollar figure already exists, so it goes in front of it rather than at the end.
    row.insertBefore(b, $('.lx-ltusd', row));
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
    var pre = 'Avail: ', text = pre + '—', canMax = false;          // signed out: "Avail: —", as Stellar
    if (who && pool) {
      var id = s === 'sell' ? a.id : 'near', raw = acct.bal[id];
      if (raw == null || (s === 'sell' && dec == null)) text = pre + '—';
      else {
        // Floored from the raw units, like MAX: a rounded figure here would name, as available, more than is held.
        var have = s === 'sell' ? fmtDown(raw, dec) : fmtDown(SW() ? SW().swapRoom('near', raw) : raw, 24);
        text = pre + have + ' ' + (s === 'sell' ? code() : 'NEAR');
        canMax = have !== '0';
      }
    }
    mark(frowMono(spendF), text);
    if (frowMono(spendF)) frowMono(spendF).setAttribute('data-lxbal', '1');
    maxButton(spendF, canMax);
    // Ghost text in every empty field (RAZA 2026-11-03), never a value: the fields still start blank.
    f.forEach(function (x) { var i = input(x); if (i && i.placeholder !== '0.00') i.placeholder = '0.00'; });
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
    if (!el) { el = document.createElement('span'); el.className = 'lx-ltusd'; el.setAttribute('data-logoed', '1'); row.appendChild(el); }
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
  function orderCtx(p) {
    if (phone(p)) return;
    var bk = window.__lxnBook;
    var host = $('.lx-oc', p);
    if (!bk || !pool || (!(bk.asks || []).length && !(bk.bids || []).length)) { if (host) host.style.display = 'none'; return; }
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
    var ref = s === 'buy' ? ba : bb;
    var away = (pr > 0 && ref) ? ((pr - ref) / ref * 100) : null;
    var awayTxt = away == null ? '—' : (Math.abs(away) < 0.01 ? ('at the ' + (s === 'buy' ? 'ask' : 'bid'))
      : (Math.abs(away).toFixed(2) + '% ' + (away < 0 ? 'below ' : 'above ') + (s === 'buy' ? 'the ask' : 'the bid')));
    var fills = !!(pr > 0 && ref) && (s === 'buy' ? pr >= ba : pr <= bb);
    var six = function (v) { return v ? String(+(+v).toPrecision(6)) : '—'; };
    var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
    var lab, val, cls;
    if (!(pr > 0)) { lab = 'Ahead of you'; val = '—'; cls = ''; }
    else if (fills) {
      // How much of THIS order the book can absorb at or better than the typed price (amounts are in the token).
      lab = 'Execution';
      var have = 0, src = s === 'buy' ? asks : bids;
      for (var k = 0; k < src.length; k++) {
        var kp = +src[k].px;
        if (s === 'buy' ? kp > pr : kp < pr) break;
        have += +src[k].amt || 0;
      }
      var pf = want > 0 ? Math.max(0, Math.min(100, have / want * 100)) : 100;
      if (pf >= 99.5) { val = 'fills now'; cls = 'lx-oc-ok'; }
      else { val = (pf < 0.5 ? '<1%' : Math.round(pf) + '%') + ' fills now | ' + Math.max(0, 100 - Math.round(pf)) + '% open order'; cls = 'lx-oc-hi'; }
    } else {
      // The liquidity already at this price or better on the order's own side of the book.
      lab = 'Ahead of you';
      var q0 = 0, nlev = 0, list = s === 'buy' ? bids : asks;
      for (var i = 0; i < list.length; i++) {
        var lp = +list[i].px;
        if (s === 'buy' ? lp < pr : lp > pr) break;
        q0 += +list[i].amt || 0; nlev++;
      }
      cls = nlev ? 'lx-oc-hi' : 'lx-oc-ok';
      val = nlev ? (fmt(q0, q0 >= 1000 ? 0 : 2) + ' ' + c + ' · ' + nlev + (nlev === 1 ? ' price level' : ' price levels')) : 'nothing — first in line';
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

  function fillMax(p) {
    var f = fields(p), ai = input(f[1]), a = asset();
    if (!ai || !a) return;
    var price = num(input(f[0]) && input(f[0]).value), out = '';
    // MAX must never round above what is held. Neither plainIn nor a Number can promise that: a
    // Number keeps ~16 significant digits of an 18-24 decimal balance (and may round it up), and
    // plainIn's 12 significant digits drop the 6th decimal of any balance from a million up --
    // 1,234,567.999999 filled as 1,234,568. So sell truncates the exact raw string, and buy, which
    // has to divide by a price anyway, floors to 6 places and is printed without re-rounding.
    // The fee comes on top of the order, so MAX leaves room for it: amount x (1 + fee) fits the balance.
    var bps = window.__lxFeeRate === 0.001 ? 10 : 20;
    if (side(p) === 'sell') {
      if (acct.bal[a.id] != null && dec != null) out = trunc6(D().fromUnits((D().big(acct.bal[a.id]) * BigInt(10000) / BigInt(10000 + bps)).toString(), dec));
    }
    else if (price > 0 && acct.bal.near != null && SW()) {
      // Leave room for the DCL storage a first order adds.
      var room = D().big(SW().swapRoom('near', acct.bal.near));
      if (acct.reg === false) room -= D().big('500000000000000000000000');
      room = room * BigInt(10000) / BigInt(10000 + bps);
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
    if (!pi || p.__lxnPxTyped || String(pi.value || '').trim() || !pool) return;
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
    D().buildCreate(who, cp).then(function (txs) {
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
      var keep = D().big(SW().SWAP_KEEP);                            // 0.2 NEAR for gas, as a swap keeps
      // What leaves the wallet is the order plus its fee (neardcl plan().spendRaw).
      var needNear = D().big(pre.storage) + (o.sell === D().WNEAR ? D().big(o.spendRaw) : BigInt(0));
      if (o.sell !== D().WNEAR && D().big(o.spendRaw) > D().big(r[2])) {
        throw new Error('You only have ' + fmtDown(r[2], dec) + ' ' + code() + ' — the order and its ' + (o.feeBps / 100) + '% fee need ' + fmtDown(o.spendRaw, dec) + '.');
      }
      if (needNear + keep > nearBal) {
        throw new Error(o.sell === D().WNEAR
          ? 'Not enough NEAR for this order' + (D().big(pre.storage) > BigInt(0) ? ' and the storage it needs' : '') + ' — keep 0.2 NEAR for gas.'
          : 'Not enough NEAR for the storage this order needs.');
      }
      var txs = D().buildPlace(who, o, pre);
      window.__lxnLastLimit = { plan: o, pre: pre, txs: txs };
      if (b) b.textContent = 'Confirm in wallet…';
      return D().sign(txs);
    }).then(function (res) {
      var v = D().verdict(res);
      if (v.ok === false) {
        stop(v.why === 'refunded' ? 'The order book did not accept the order, so your tokens came back (the fee had already been paid).' : 'The order failed on chain. Check your wallet activity.');
        return;
      }
      stop('');
      var ai = input(fields(p)[1]);
      if (ai) ai.value = '';
      recalc(p);
      toast((o.side === 'sell' ? 'Sell' : 'Buy') + ' order placed — ' + fmt(D().toNum(o.tokenRaw, dec), 6) + ' ' + code() + ' at ' + fmt(o.rests, 8) + ' NEAR');
      load();
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
