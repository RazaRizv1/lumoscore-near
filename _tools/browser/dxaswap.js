// Trade-Asset -> Swap: the design's panel, wired to Rhea Finance through window.lxnSwap (browser/nearswap.js).
// Structurally a port of the XRPL fork's _tools/browser/dxaswap.js: same panel, same selectors (desktop
// .dxa-* and the phone's .mdxa-*, which lx-mobtrade aliases), same review step, same "trusted click
// validates, the untrusted click from Confirm submits" contract with the inherited lx-feemodal.
//
// THE PAIR is <this token> vs native NEAR: Buy pays NEAR, Sell pays the token. Quotes are Rhea's own
// get_return along the best route (direct, or two hops through wNEAR / USDC), for the input LESS the 0.2%
// fee, which is what Rhea will actually receive.
//
// THE BUTTON stays exactly as it shipped -- disabled, "Swaps on NEAR are coming soon" -- for any pay token
// the fee account is not registered on (lxnSwap.feeReady), because the fee transfer would fail and take
// the swap with it. The figures are real either way.
//
// NO FLASH: the head stylesheet (lx-neardexasset-css) hides the swap pane's button and summary values
// until html.lxn-swap-ready, which is added only once this layer has painted them (or after 4s, so a
// failure can never hide the button for good).
(function () {
  if (window.__lxnDxaSwap) return;
  window.__lxnDxaSwap = 1;

  var SOON = 'Swaps on NEAR are coming soon';
  var S = function () { return window.lxnSwap; };
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function asset() { return window.__lxnAssetRef || null; }
  function me() { try { return (window.lxn && window.lxn.account && window.lxn.account()) || ''; } catch (e) { return ''; } }
  function ready() { document.documentElement.classList.add('lxn-swap-ready'); }
  setTimeout(ready, 4000);

  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    if (n > 0 && n < 1e-6) return n.toPrecision(3);
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 6 : d });
  }
  function plainAmt(raw, dec) {                     // exact, trimmed to 6 decimals for an input box
    var s = S().fromUnits(raw, dec), p = s.split('.');
    return p[1] ? (p[0] + '.' + p[1].slice(0, 6)).replace(/\.?0+$/, '') : s;
  }

  function pane() { return $('.dxa-pane-swap') || $('.mdxa-pane-swap'); }
  function fields(p) { return $$('[class*="dxa-trade-field"]', p); }
  function input(f) { return f ? $('input', f) : null; }
  function cta(p) { return $('[class*="dxa-trade-cta"]', p); }
  function phone(p) { return /mdxa-/.test((p && p.className) || ''); }
  function side(p) { return $('[class*="dxa-side-btn"].sell.active', p) ? 'sell' : 'buy'; }
  function mark(node, text) {
    if (!node) return;
    try { node.removeAttribute('data-logo'); node.setAttribute('data-logoed', '1'); } catch (e) {}
    if (node.textContent !== text) node.textContent = text;
    node.classList.add('lxp');
  }
  function frowMono(f) { var row = f && $('[class*="dxa-trade-frow"]', f); return row && $('.mono:not(.lx-payusd)', row); }
  function sumRow(p, label, value, tone) {
    $$('[class*="dxa-tsum"]', p).forEach(function (r) {
      if (r.classList.contains('lx-feerow')) return;              // lx-feemodal owns its row
      var k = r.children;
      if (k.length < 2 || (k[0].textContent || '').trim().toLowerCase() !== label) return;
      var v = k[k.length - 1];
      mark(v, value);
      if (tone != null) { v.classList.remove('up', 'down'); v.style.color = tone; }
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
  function toast(text) {
    try { if (typeof window.lxToast === 'function') { window.lxToast(text); return; } } catch (e) {}
  }

  // ---- state --------------------------------------------------------------------------------------
  var bal = { key: '', raw: {} };      // raw spendable balances of the connected account, by token id
  var q = null, seq = 0, busy = false, tmr = null;

  function sides(p) {
    var a = asset();
    return side(p) === 'sell' ? { pay: a.id, get: 'near' } : { pay: 'near', get: a.id };
  }
  function meta(id) { return S().meta(id) || { code: id, dec: null }; }
  function payAmountRaw(p) {
    var i = input(fields(p)[0]), m = meta(sides(p).pay);
    if (!i || m.dec == null) return null;
    var r = S().toUnits(i.value, m.dec);
    return (r && r !== '0') ? r : null;
  }
  function usdOf(id, amount) {
    var d = window.__lxnAssetData;
    if (!d || !(amount > 0)) return 0;
    if (id === 'near') return d.nearUsd > 0 ? amount * d.nearUsd : 0;
    return d.usd > 0 ? amount * d.usd : 0;
  }
  function usdTxt(p, v) {
    var s = phone(p) ? '' : ' USD';
    if (!(v > 0)) return '≈ $0.00' + s;
    return '≈ $' + (v >= 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(4)) + s;
  }
  function payUsd(p, v) {
    var row = fields(p)[0] && $('[class*="dxa-trade-frow"]', fields(p)[0]);
    if (!row) return;
    var sp = $('.lx-payusd', row);
    if (!sp) {
      sp = document.createElement('span');
      sp.className = 'mono lxp lx-payusd';
      sp.setAttribute('data-logoed', '1');
      var balEl = $('.mono:not(.lx-payusd)', row);
      if (balEl) row.insertBefore(sp, balEl); else row.appendChild(sp);
    }
    var t = v > 0 ? usdTxt(p, v) : '';
    if (sp.textContent !== t) sp.textContent = t;
  }

  // ---- the button ---------------------------------------------------------------------------------
  var FEE = {};                         // pay token id -> true / false / null (could not ask)
  function setCta(p) {
    var b = cta(p);
    if (!b) return;
    var s = sides(p), state = FEE[s.pay];
    var wnear = asset() && asset().id === S().WNEAR;               // NEAR <-> wNEAR is wrapping, not a swap
    var on = state === true && !wnear;
    var label = on ? 'Swap' : SOON;
    // lx-gate saved the design's label before this ran and restores data-lxorig on connect.
    b.setAttribute('data-lxorig', label);
    b.setAttribute('data-lxdis', on ? '0' : '1');
    if (b.getAttribute('data-lxgate') === '1') return;              // "Connect wallet" belongs to lx-gate
    if (busy) return;
    if (b.textContent !== label) b.textContent = label;
    b.disabled = !on;
    if (on) { b.removeAttribute('disabled'); b.removeAttribute('aria-disabled'); b.style.opacity = ''; b.style.cursor = ''; }
    else { b.setAttribute('aria-disabled', 'true'); b.style.opacity = '.55'; b.style.cursor = 'not-allowed'; }
    if (on && !(q && q.ok)) p.setAttribute('data-lxunfill', '1'); else p.removeAttribute('data-lxunfill');
  }
  function checkFee(p) {
    var id = sides(p).pay;
    if (FEE[id] === true || FEE[id] === false) { setCta(p); return Promise.resolve(); }
    return S().feeReady(id).then(function (v) { FEE[id] = v; setCta(p); });
  }

  // ---- painting -----------------------------------------------------------------------------------
  function paintStatic(p) {
    var f = fields(p), s = sides(p), pm = meta(s.pay);
    var pre = phone(p) ? 'Bal: ' : 'Balance: ';
    var raw = bal.raw[s.pay];
    mark(frowMono(f[0]), me() ? (pre + (raw == null || pm.dec == null ? '—' : fmt(S().toNum(raw, pm.dec), 6) + ' ' + pm.code)) : (pre + '—'));
    sumRow(p, 'slippage tolerance', (S().SLIP_BPS / 100).toFixed(1) + '%');
    sumRow(p, 'network fee', S().NET_FEE_EST);
    var recv = input(f[1]);
    if (recv) recv.removeAttribute('readonly');
    // Stellar/XRPL parity: the button reads "Swap", never the design's order wording.
    setCta(p);
  }
  function clearQuote(p) {
    q = null;
    seq++;
    var f = fields(p), recv = input(f[1]), s = sides(p), d = window.__lxnAssetData;
    if (recv && document.activeElement !== recv) recv.value = '';
    mark(frowMono(f[1]), usdTxt(p, 0));
    if (d && d.price > 0) {
      var r = s.pay === 'near' ? 1 / d.price : d.price;
      sumRow(p, 'rate', '1 ' + meta(s.pay).code + ' = ' + fmt(r, 6) + ' ' + meta(s.get).code);
    } else sumRow(p, 'rate', '—');
    sumRow(p, 'price impact', '—', '');
    sumRow(p, 'min received', '—');
    payUsd(p, 0);
    setCta(p);
  }
  function applyQuote(p, qq) {
    var f = fields(p), s = sides(p), pm = meta(s.pay), gm = meta(s.get);
    q = qq; q.ok = 1; q.side = side(p);
    var out = S().toNum(qq.out, gm.dec), amt = S().toNum(qq.amount, pm.dec);
    var recv = input(f[1]);
    if (recv && document.activeElement !== recv) recv.value = plainAmt(qq.out, gm.dec);
    mark(frowMono(f[1]), usdTxt(p, usdOf(s.get, out)));
    sumRow(p, 'rate', '1 ' + pm.code + ' = ' + fmt(out / amt, 6) + ' ' + gm.code);
    // Stellar's sign convention: a buy moves the token's price up (+, green), a sell down (-, red).
    var buy = s.pay === 'near', imp = qq.impact, txt = '—', tone = '';
    if (imp != null) {
      txt = imp < 0.01 ? '<0.01%' : ((buy ? '+' : '-') + (imp < 100 ? imp.toFixed(2) : Math.round(imp)) + '%');
      tone = (imp < 0.01 || buy) ? 'var(--green,#22c55e)' : 'var(--red,#ff5b5b)';
    }
    sumRow(p, 'price impact', txt, tone);
    sumRow(p, 'min received', fmt(S().toNum(qq.min, gm.dec), 6) + ' ' + gm.code);
    payUsd(p, usdOf(s.pay, amt));
    setCta(p);
  }

  function requote() {
    var p = pane();
    if (!p || !asset() || !S()) return;
    paintStatic(p);
    var raw = payAmountRaw(p);
    if (!raw) { clearQuote(p); say(p, ''); return; }
    var s = sides(p), my = ++seq;
    q = null;
    setCta(p);
    var have = bal.raw[s.pay];
    if (me() && have != null && S().big(raw) > S().big(have)) {
      say(p, 'You only have ' + fmt(S().toNum(have, meta(s.pay).dec), 6) + ' ' + meta(s.pay).code + '.');
    } else say(p, '');
    S().quote(s.pay, s.get, raw).then(function (qq) {
      if (my !== seq) return;
      applyQuote(p, qq);
    }, function (e) {
      if (my !== seq) return;
      clearQuote(p);
      say(p, (e && e.message) || 'Could not get a quote right now.');
    });
  }

  function loadBal(p) {
    var who = me(), a = asset();
    if (!who || !a) return Promise.resolve();
    var key = who + '|' + a.id;
    if (bal.key !== key) bal = { key: key, raw: {} };
    return Promise.all([S().balance(who, 'near'), S().balance(who, a.id)]).then(function (r) {
      bal.raw.near = r[0]; bal.raw[a.id] = r[1];
      paintStatic(p);
    }, function () {});
  }

  // ---- signing ------------------------------------------------------------------------------------
  function validate(p) {
    if (!asset()) return 'This page has no token.';
    var raw = payAmountRaw(p);
    if (!raw) return 'Enter an amount.';
    var s = sides(p);
    if (FEE[s.pay] !== true) return SOON + '.';
    if (!q || !q.ok || q.amount !== raw || q.side !== side(p)) return 'Getting a quote — try again in a moment.';
    if (!me()) return 'Connect a NEAR wallet first.';
    var have = bal.raw[s.pay];
    if (have == null) return 'Reading your balance — try again in a moment.';
    var room = S().maxSpend(s.pay, have);
    if (S().big(raw) > S().big(room)) {
      return s.pay === 'near'
        ? ('Not enough NEAR — keep 0.05 NEAR for gas. Up to ' + fmt(S().toNum(room, 24), 6) + ' NEAR can be swapped.')
        : ('You only have ' + fmt(S().toNum(have, meta(s.pay).dec), 6) + ' ' + meta(s.pay).code + '.');
    }
    return '';
  }

  function doSwap(p) {
    if (busy) return;
    var msg = validate(p);
    if (msg) { say(p, msg); return; }
    var b = cta(p), who = me(), shown = q, s = sides(p);
    busy = true;
    say(p, '');
    if (b) b.textContent = 'Checking the route…';
    function stop(text) { busy = false; setCta(p); if (text) say(p, text); }
    // The quote on screen may be seconds old: ask again, and refuse if the price has moved past the floor
    // the user was shown.
    S().quote(shown.from, shown.to, shown.amount).then(function (fresh) {
      if (S().big(fresh.out) < S().big(shown.min)) {
        var e = new Error('The price moved past your 0.5% slippage. Nothing was signed — check the new quote.');
        e.requote = 1; throw e;
      }
      return S().build(who, fresh).then(function (bt) {
        var have = S().big(bal.raw.near || '0');
        if (fresh.from === 'near' && S().big(fresh.amount) + S().big(bt.storage) > have) {
          throw new Error('Not enough NEAR for this swap and the storage it needs.');
        }
        if (fresh.from !== 'near' && S().big(bt.storage) > have) throw new Error('Not enough NEAR for the token registration this swap needs.');
        if (b) b.textContent = bt.steps > 1 ? 'Approve 2 transactions in your wallet…' : 'Confirm in wallet…';
        window.__lxnLastSwap = { quote: fresh, txs: bt.txs };
        return S().sign(bt).then(function (res) { return { res: res, q: fresh }; });
      });
    }).then(function (x) {
      var v = S().verdict(x.res), gm = meta(x.q.to), pm = meta(x.q.from);
      if (v.ok === false) {
        stop(v.why === 'refunded'
          ? 'Rhea did not fill the swap (the price moved). Your ' + pm.code + ' came back; the 0.2% platform fee was kept.'
          : 'The swap failed on chain. Check your wallet activity.');
        return;
      }
      stop('');
      toast(side(p) === 'buy' ? ('Bought ' + fmt(S().toNum(x.q.out, gm.dec), 6) + ' ' + gm.code)
        : ('Sold ' + fmt(S().toNum(x.q.amount, pm.dec), 6) + ' ' + pm.code));
      var i = input(fields(p)[0]);
      if (i) i.value = '';
      clearQuote(p);
      loadBal(p);
    }).catch(function (e) {
      var m = (e && e.message) || '';
      stop(/reject|denied|cancel|closed/i.test(m) ? 'The swap was not approved, so nothing was swapped.' : (m || 'The swap could not be completed.'));
      if (e && e.requote) setTimeout(requote, 50);
    });
  }

  // ---- wiring -------------------------------------------------------------------------------------
  function wire() {
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var p = t.closest('.dxa-pane-swap, .mdxa-pane-swap');
      if (!p || !booted) return;

      var b = t.closest('[class*="dxa-trade-cta"]');
      if (b) {
        if (b.getAttribute('data-lxgate') === '1') return;          // lx-gate opens the wallet picker
        if (b.disabled) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        if (e.isTrusted && document.getElementById('lx-feemodal')) {
          var msg = validate(p);
          if (msg) { e.preventDefault(); e.stopImmediatePropagation(); say(p, msg); }
          return;                                                    // valid: lx-feemodal's review opens
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        doSwap(p);
        return;
      }
      var qb = t.closest('.dxa-trade-quick button, .mdxa-trade-quick button');
      if (qb) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var s = sides(p), have = bal.raw[s.pay], m = meta(s.pay);
        if (have == null || m.dec == null) return;
        var room = S().big(S().maxSpend(s.pay, have));
        var pct = /max/i.test(qb.textContent) ? 100 : parseInt(qb.textContent, 10);
        if (!(pct > 0)) return;
        var raw = (room * BigInt(pct) / BigInt(100)).toString();
        var i = input(fields(p)[0]);
        if (i) i.value = S().fromUnits(raw, m.dec);
        requote();
        return;
      }
      if (t.closest('.dxa-trade-flip, .mdxa-trade-flip')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var other = $('[class*="dxa-side-btn"]:not(.active)', p);
        if (other) other.click();
        return;
      }
      if (t.closest('[class*="dxa-side-btn"]')) {
        setTimeout(function () {
          var i2 = input(fields(p)[0]); if (i2) i2.value = '';
          say(p, ''); clearQuote(p); paintStatic(p); checkFee(p);
        }, 30);
      }
    }, true);

    // Typing is claimed at the pane, so the design's own handler cannot write a mock amount after ours.
    window.addEventListener('input', function (e) {
      var t = e.target;
      var p = t && t.closest && t.closest('.dxa-pane-swap, .mdxa-pane-swap');
      if (!p || t.tagName !== 'INPUT' || !booted) return;
      e.stopImmediatePropagation();
      var v = String(t.value).replace(/[^0-9.]/g, ''), dot = v.indexOf('.');
      if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
      if (v !== t.value) t.value = v;
      var ff = fields(p), payI = input(ff[0]), recvI = input(ff[1]);
      // Typing in "You receive" fills "You pay" at the current rate; the real quote then runs on that.
      if (t === recvI && payI) {
        var want = Number(v), s = sides(p), d = window.__lxnAssetData, rt = 0;
        if (q && q.ok && q.side === side(p)) rt = S().toNum(q.out, meta(s.get).dec) / S().toNum(q.amount, meta(s.pay).dec);
        else if (d && d.price > 0) rt = s.pay === 'near' ? 1 / d.price : d.price;
        payI.value = (want > 0 && rt > 0) ? String(+((want / rt).toFixed(6))) : '';
      }
      clearTimeout(tmr);
      tmr = setTimeout(requote, 300);
    }, true);
  }

  var booted = false;
  function boot() {
    var p = pane(), a = asset();
    if (!p || !S()) return false;
    if (!('__lxnAssetData' in window)) return false;               // dexasset.js has not finished yet
    if (!a) { ready(); return true; }
    var d = window.__lxnAssetData;
    if (d && d.decimals != null) S().remember(a.id, d.symbol || a.code, d.decimals, d.logo || '');
    var go = function () {
      booted = true;
      var i = input(fields(p)[0]);
      if (i && !p.__lxnCleared) { i.value = ''; p.__lxnCleared = 1; }
      paintStatic(p);
      clearQuote(p);
      checkFee(p).then(ready, ready);
      loadBal(p);
      // the other side's pay token, so flipping does not wait on the network
      S().feeReady(sides(p).pay === 'near' ? a.id : 'near').then(function (v) {
        FEE[sides(p).pay === 'near' ? a.id : 'near'] = v;
      });
      // lx-feemodal can rebuild its row after this runs; keep claiming it.
      if (!p.__lxnFeeObs && window.MutationObserver) {
        p.__lxnFeeObs = new MutationObserver(function () {
          $$('.lx-feerow .mono:not(.lxp), .lx-feerow .lx-feerate:not(.lxp)', p).forEach(function (m) { m.classList.add('lxp'); });
        });
        p.__lxnFeeObs.observe(p, { childList: true, subtree: true });
      }
    };
    if (S().meta(a.id)) go();
    else S().tokenInfo(a.id).then(go, function () { ready(); });
    return true;
  }

  wire();
  window.__lxnDxaSwapState = function () { return { quote: q, bal: bal, fee: FEE, booted: booted }; };
  var n = 0;
  (function wait() {
    if (boot()) return;
    if (++n < 80) setTimeout(wait, 150); else ready();
  })();
})();
