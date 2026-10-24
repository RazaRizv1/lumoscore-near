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

  var NOPOOL = 'Limit orders need a Rhea DCL pool for this pair';
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
  function sig(n) { return (n > 0 && isFinite(n)) ? String(+Number(n).toPrecision(6)) : ''; }
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
    var t = 'Free';
    if (pool && me() && acct.reg === false) t = phone(p) ? 'Free · 0.5 NEAR storage' : 'Free · 0.5 NEAR one-time storage';
    if (v.textContent !== t) v.textContent = t;
  }

  // ---- the button ---------------------------------------------------------------------------------
  function setCta(p) {
    var b = cta(p);
    if (!b) return;
    var on = !!pool, label;
    if (pool === undefined && !poolErr) label = 'Checking for a Rhea DCL pool…';
    else if (poolErr) label = 'Could not reach Rhea — reload to try again';
    else if (!pool) label = NOPOOL;
    else label = side(p) === 'sell' ? 'Place Sell Order' : 'Place Buy Order';
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
    if (otherF && otherF !== spendF) { mark(frowMono(otherF), ''); maxButton(otherF, false); }
    var pre = phone(p) ? 'Avail: ' : 'Available: ', text = '', canMax = false;
    if (who && pool) {
      var id = s === 'sell' ? a.id : 'near', raw = acct.bal[id];
      if (raw == null || (s === 'sell' && dec == null)) text = pre + '—';
      else {
        var n = s === 'sell' ? D().toNum(raw, dec) : D().toNum(SW() ? SW().maxSpend('near', raw) : raw, 24);
        text = pre + fmt(n, 6) + ' ' + (s === 'sell' ? code() : 'NEAR');
        canMax = n > 0;
      }
    }
    mark(frowMono(spendF), text);
    maxButton(spendF, canMax);
    var tot = input(f[2]);
    if (tot && !phone(p) && tot.hasAttribute('readonly')) tot.removeAttribute('readonly');
    feeRow(p);
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
    sumRow(p, 'filled when', txt);
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
    if (side(p) === 'sell') { if (acct.bal[a.id] != null && dec != null) out = trunc6(D().fromUnits(acct.bal[a.id], dec)); }
    else if (price > 0 && acct.bal.near != null && SW()) {
      // Leave room for the DCL storage a first order adds.
      var room = D().big(SW().maxSpend('near', acct.bal.near));
      if (acct.reg === false) room -= D().big('500000000000000000000000');
      var amt = room > BigInt(0) ? D().toNum(room.toString(), 24) / price : 0;
      if (amt > 0) out = trunc6((Math.floor(amt * 1e6) / 1e6).toFixed(6));
    }
    ai.value = (out && +out > 0) ? out : '';
    recalc(p);
  }
  function trunc6(s) {
    var i = s.indexOf('.');
    return i < 0 ? s : s.slice(0, i + 7).replace(/\.?0+$/, '');
  }

  // Once per side, the page's live price -- the design ships "4.18", another chain's price typed in for you.
  function prefill(p) {
    var pin = input(fields(p)[0]);
    if (!pin) return;
    var d = window.__lxnAssetData, px = d && Number(d.price), s = side(p);
    if (p.__lxnPrefilled === s) return;
    if (px > 0 && isFinite(px)) { pin.value = sig(px); p.__lxnPrefilled = s; }
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
    if (!pool) return pool === null ? NOPOOL + '.' : 'Still checking Rhea — try again in a moment.';
    var f = fields(p);
    if (!(num(input(f[0]) && input(f[0]).value) > 0)) return 'Enter a limit price.';
    if (!(num(input(f[1]) && input(f[1]).value) > 0)) return 'Enter an amount.';
    if (!o) return 'That order is too small to place.';
    if (!me()) return 'Connect a NEAR wallet first.';
    return '';
  }

  function place(p) {
    if (busy) return;
    var o = current(p), msg = validate(p, o);
    if (msg) { say(p, msg); return; }
    var b = cta(p), who = me(), a = asset(), label = b ? b.textContent : '';
    busy = true;
    say(p, '');
    if (b) b.textContent = 'Checking your account…';
    function stop(text) { busy = false; if (b) b.textContent = label; setCta(p); if (text) say(p, text); }
    Promise.all([D().prereqs(who, o), SW().balance(who, 'near'), o.sell === D().WNEAR ? null : SW().balance(who, o.sell)]).then(function (r) {
      var pre = r[0], nearBal = D().big(r[1]);
      var keep = D().big('50000000000000000000000');               // 0.05 NEAR for gas, as the swap keeps
      var needNear = D().big(pre.storage) + (o.sell === D().WNEAR ? D().big(o.sellRaw) : BigInt(0));
      if (o.sell !== D().WNEAR && D().big(o.sellRaw) > D().big(r[2])) {
        throw new Error('You only have ' + fmt(D().toNum(r[2], dec), 6) + ' ' + code() + '.');
      }
      if (needNear + keep > nearBal) {
        throw new Error(o.sell === D().WNEAR
          ? 'Not enough NEAR for this order' + (D().big(pre.storage) > BigInt(0) ? ' and the storage it needs' : '') + ' — keep 0.05 NEAR for gas.'
          : 'Not enough NEAR for the storage this order needs.');
      }
      var txs = D().buildPlace(who, o, pre);
      window.__lxnLastLimit = { plan: o, pre: pre, txs: txs };
      if (b) b.textContent = txs.length > 1 ? ('Approve ' + txs.length + ' transactions in your wallet…') : 'Confirm in wallet…';
      return D().sign(txs);
    }).then(function (res) {
      var v = D().verdict(res);
      if (v.ok === false) {
        stop(v.why === 'refunded' ? 'Rhea did not accept the order, so your tokens came back.' : 'The order failed on chain. Check your wallet activity.');
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
      stop(/reject|denied|cancel|closed/i.test(m) ? 'The order was not approved, so nothing was placed.' : (m || 'The order could not be placed.'));
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
        setTimeout(function () {
          p.__lxnPrefilled = null;
          var ai = input(fields(p)[1]); if (ai) ai.value = '';
          say(p, ''); prefill(p); paint();
        }, 30);
        return;
      }
      var b = t.closest('[class*="dxa-trade-cta"]');
      if (!b) return;
      if (b.getAttribute('data-lxgate') === '1') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b.disabled) return;
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
    prefill(p);
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
