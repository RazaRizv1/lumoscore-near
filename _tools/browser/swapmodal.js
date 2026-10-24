// The wallet's Swap dialog (#modalSwap) on NEAR, driven by window.lxnSwap (browser/nearswap.js) -- the same
// quoting, routing, fee and transaction building the Trade-Asset swap pane uses, so the money arithmetic
// exists once. Until this file the dialog was send.js's disabled "Swaps on NEAR are coming soon" placeholder;
// send.js now leaves it alone when window.__lxnSwapModal is set.
//
// ONE STEP, as Stellar's and XRPL's wallet Swap became on 2026-10-24 (RAZA): type an amount, the details
// fill in beside it, one press of the design's "Confirm Swap" opens the wallet. There is no Review/Back
// stage -- the wallet's own approval screen is the confirmation, as on the Trade-Asset pane.
//
// THE DESIGN'S MARKUP ONLY. The From and To fields, the two .asset-pick buttons, the flip arrow, the rate
// line and the details box (Route / Price impact / Network fee) are the design's; this file writes into
// them. Three things are added, each copied from what the design or Stellar already draws:
//   * MAX in the From label -- Stellar's .lx-wsmax (its CSS ships in lx-swapcalc-css, kept on this page).
//   * "Platform fee" and "Minimum received" rows -- clones of the design's own details rows. A swap that
//     takes a fee must say so before the press; Stellar's panel carries the same two figures.
//   * the token menus and the status line -- send.js's .lxw-astmenu / .lxw-say pattern.
//
// CLEARED ON OPEN (RAZA 2026-10-24: "if the swap box is filled and the popup is closed, and then opened
// again, the details are not refreshed"). On open, not close: the design closes this dialog through the x,
// the backdrop and Escape, routes this file does not own.
//
// AMOUNTS: integer strings in raw units end to end. Every balance shown, MAX and every "you only have" are
// floored from the raw units with one function, so none of them can name more than is held.
(function () {
  if (window.__lxnSwapModal) return;
  window.__lxnSwapModal = 1;

  var S = function () { return window.lxnSwap; };
  var NEAR_LOGO = '/assets/networks/near.png';
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function me() { try { return (window.lxn && window.lxn.account && window.lxn.account()) || ''; } catch (e) { return ''; } }
  function plain(el, text) {
    if (!el) return;
    try { el.removeAttribute('data-logo'); el.setAttribute('data-logoed', '1'); } catch (e) {}
    if (el.textContent !== text) el.textContent = text;
  }

  // ---- numbers -------------------------------------------------------------------------------------
  function trunc(s, dp) {
    var i = s.indexOf('.');
    return i < 0 ? s : s.slice(0, i + 1 + dp).replace(/\.?0+$/, '');
  }
  function commas(s) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); }
  // Floored, never rounded: a balance, MAX or minimum shown here can never exceed the raw figure.
  function down(raw, dec, dp) { return trunc(S().fromUnits(raw, dec), dp == null ? 6 : dp); }
  function show(raw, dec, dp) {
    var s = down(raw, dec, dp);
    // A dust amount that floors to 0 at 6 places still exists: say so rather than print a bare 0.
    if (s === '0' && S().big(raw) > BigInt(0)) return '< 0.000001';
    return commas(s);
  }

  // ---- the dialog ----------------------------------------------------------------------------------
  function modal() { return $('#modalSwap'); }
  function parts(m) {
    var f = $$('.swap-pair .field', m);
    var box = $('.modal-body > div[style]', m);
    return {
      from: f[0], to: f[1],
      inIn: f[0] && $('input', f[0]), outIn: f[1] && $('input', f[1]),
      fromPick: f[0] && $('.asset-pick', f[0]), toPick: f[1] && $('.asset-pick', f[1]),
      fromMeta: f[0] && $('.field-label .meta', f[0]), toMeta: f[1] && $('.field-label .meta', f[1]),
      rate: $('.swap-rate span strong', m), rateSpan: $('.swap-rate span', m),
      box: box, rows: box ? $$(':scope > div', box) : [],
      go: $('.modal-foot .btn-primary', m)
    };
  }
  // The details rows by label, so a clone added below never shifts which row is which.
  function row(P, label) {
    for (var i = 0; i < P.rows.length; i++) {
      var sp = $('span', P.rows[i]);
      if (sp && sp.textContent.trim().toLowerCase() === label) return $('strong', P.rows[i]);
    }
    return null;
  }

  var from = null, to = null;                 // { id, code, dec, logo }
  var bal = {};                               // id -> raw spendable balance (before MAX's NEAR keep)
  var feeOk = {};                             // id -> true / false / null (unknown)
  var q = null, seq = 0, busy = false, timer = 0;

  function asset(id, code, dec, logo) { return { id: id, code: code, dec: +dec, logo: logo || '' }; }
  var NEAR = asset('near', 'NEAR', 24, NEAR_LOGO);

  // ---- one-time set-up of the design's dialog ---------------------------------------------------------
  function prepare(m) {
    if (m.__lxsm) return;
    m.__lxsm = 1;
    var P = parts(m);
    if (P.outIn) { P.outIn.readOnly = true; P.outIn.tabIndex = -1; }
    if (P.inIn) { P.inIn.disabled = false; P.inIn.setAttribute('inputmode', 'decimal'); P.inIn.autocomplete = 'off'; }
    // MAX: Stellar's button, in the From label, before the balance.
    var lab = P.from && $('.field-label', P.from);
    if (lab && !$('.lx-wsmax', lab)) {
      var mx = document.createElement('button');
      mx.type = 'button';
      mx.className = 'lx-wsmax';
      mx.textContent = 'MAX';
      lab.insertBefore(mx, P.fromMeta || null);
    }
    // Two rows cloned from the design's own, before the last one (Network fee), wearing the first row's
    // spacing so the box keeps its rhythm.
    if (P.box && P.rows.length >= 2 && !$('[data-lxsm-row]', P.box)) {
      var last = P.rows[P.rows.length - 1], gap = P.rows[0].getAttribute('style') || '';
      [['fee', 'Platform fee'], ['min', 'Minimum received']].forEach(function (d) {
        var r = last.cloneNode(true);
        r.setAttribute('style', gap);
        r.setAttribute('data-lxsm-row', d[0]);
        plain($('span', r), d[1]);
        var st = $('strong', r);
        st.setAttribute('style', 'color:var(--text);font-family:\'JetBrains Mono\',monospace');
        plain(st, '—');
        P.box.insertBefore(r, last);
      });
    }
    if (P.go) P.go.setAttribute('data-lxsm-go', '1');
  }

  // ---- painting --------------------------------------------------------------------------------------
  function icon(host, a) {
    if (!host) return;
    host.textContent = '';
    host.setAttribute('data-logoed', '1');
    host.style.overflow = 'hidden';
    host.style.padding = '0';
    if (!a.logo) { host.style.background = ''; plain(host, a.code.charAt(0).toUpperCase()); return; }
    host.style.background = 'transparent';
    var im = document.createElement('img');
    im.alt = '';
    im.src = a.logo;
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
    im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); plain(host, a.code.charAt(0).toUpperCase()); };
    host.appendChild(im);
  }
  function setPick(btn, a) {
    if (!btn || !a) return;
    icon($('.a-ico', btn), a);
    // The ticker is the button's bare text node; the icon span and the chevron stay the design's.
    var done = false;
    [].forEach.call(btn.childNodes, function (nd) {
      if (nd.nodeType === 3 && nd.nodeValue.trim()) { if (!done) { nd.nodeValue = ' ' + a.code + ' '; done = true; } else nd.nodeValue = ' '; }
    });
  }
  function room(id) { return bal[id] == null ? null : S().maxSpend(id, bal[id]); }
  function paintBalance(P) {
    if (!P.fromMeta || !from) return;
    var r = room(from.id);
    plain(P.fromMeta, r == null ? 'Balance: —' : 'Balance: ' + show(r, from.dec) + ' ' + from.code);
    plain(P.toMeta, 'Estimated');
  }
  function paintPair(P) {
    setPick(P.fromPick, from);
    setPick(P.toPick, to);
    paintBalance(P);
  }
  function fmtImpact(v) {
    if (v == null || !isFinite(v)) return '—';
    return v < 0.01 ? '< 0.01%' : (v < 100 ? v.toFixed(2) : Math.round(v)) + '%';
  }
  function paintQuote(P) {
    var r = row(P, 'route'), im = row(P, 'price impact'), nf = row(P, 'network fee');
    var fe = P.box && $('[data-lxsm-row="fee"] strong', P.box), mn = P.box && $('[data-lxsm-row="min"] strong', P.box);
    var bps = S().FEE_BPS;
    if (nf) plain(nf, S().NET_FEE_EST);
    if (!q || !q.ok) {
      if (P.outIn) P.outIn.value = '';
      plain(P.rate, '—');
      if (r) plain(r, from && to ? from.code + ' → ' + to.code : '—');
      if (im) { plain(im, '—'); im.style.color = 'var(--text)'; }
      if (fe) plain(fe, (bps / 100) + '%');
      if (mn) plain(mn, '—');
      return;
    }
    if (P.outIn) P.outIn.value = down(q.out, to.dec);
    // The rate the pools give, on the amount that is actually swapped (after the fee).
    var rt = S().toNum(q.out, to.dec) / S().toNum(q.net, from.dec);
    plain(P.rate, (rt > 0 && isFinite(rt) ? +rt.toPrecision(6) : '—') + ' ' + to.code);
    if (P.rateSpan && P.rateSpan.firstChild && P.rateSpan.firstChild.nodeType === 3) P.rateSpan.firstChild.nodeValue = '1 ' + from.code + ' ≈ ';
    if (r) plain(r, from.code + ' → ' + to.code + (q.hops && q.hops.length > 1 ? ' (via ' + hopCode(q.hops[0].tout) + ')' : ' (Direct)'));
    if (im) {
      plain(im, fmtImpact(q.impact));
      im.style.color = q.impact == null ? 'var(--text)' : (q.impact < 1 ? 'var(--green)' : (q.impact < 5 ? '#f5a524' : '#e5484d'));
    }
    if (fe) plain(fe, show(q.fee, from.dec) + ' ' + from.code + ' (' + (bps / 100) + '%)');
    if (mn) plain(mn, show(q.min, to.dec) + ' ' + to.code);
  }
  function hopCode(id) {
    if (id === S().WNEAR) return 'NEAR';
    var m = S().meta(id);
    return (m && m.code) || 'USDC';
  }

  // ---- status line and the button ------------------------------------------------------------------------
  function say(text, tone) {
    var m = modal();
    if (!m) return;
    var box = $('.lxw-say', m);
    if (!box) {
      var body = $('.modal-body', m);
      if (!body) return;
      box = document.createElement('div');
      box.className = 'lxw-say';
      box.style.cssText = 'margin-top:12px;font-size:13px;line-height:1.5;font-weight:600';
      body.appendChild(box);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }
  var GO = 'Confirm Swap';
  function label(P, text, on) {
    var b = P.go;
    if (!b) return;
    var tn = null;
    [].forEach.call(b.childNodes, function (nd) { if (!tn && nd.nodeType === 3 && nd.nodeValue.trim()) tn = nd; });
    if (!tn) { tn = document.createTextNode(''); b.insertBefore(tn, b.firstChild); }
    if (tn.nodeValue.trim() !== text) tn.nodeValue = ' ' + text + ' ';
    b.disabled = !on;
    b.setAttribute('aria-disabled', on ? 'false' : 'true');
    b.style.opacity = on ? '' : '.55';
    b.style.cursor = on ? '' : 'not-allowed';
  }
  function amountRaw(P) {
    if (!P.inIn || !from) return null;
    var raw = S().toUnits(P.inIn.value, from.dec);
    return raw && S().big(raw) > BigInt(0) ? raw : null;
  }
  // Why the button cannot be pressed, or '' when it can. Every money check the press makes again.
  function blocker(P) {
    if (!me()) return 'Connect a NEAR wallet';
    if (!from || !to) return 'Choose two tokens';
    var raw = amountRaw(P);
    if (!raw) return 'Enter an amount';
    if (feeOk[from.id] === false) return 'Swaps from ' + from.code + ' are not open yet';
    var r = room(from.id);
    if (r == null) return 'Reading your balance…';
    if (S().big(raw) > S().big(r)) return 'Not enough ' + from.code;
    if (!q) return 'Getting a quote…';
    if (!q.ok) return q.why || 'No route';
    if (q.amount !== raw || q.from !== from.id || q.to !== to.id) return 'Getting a quote…';
    return '';
  }
  function setCta(P) {
    if (busy) return;
    var why = blocker(P);
    label(P, why || GO, !why);
  }

  // ---- data ---------------------------------------------------------------------------------------------
  function loadBal(id) {
    var who = me();
    if (!who || !id) return Promise.resolve();
    return S().balance(who, id).then(function (raw) { bal[id] = String(raw); }, function () {});
  }
  function checkFee(id) {
    if (feeOk[id] != null) return Promise.resolve();
    return S().feeReady(id).then(function (ok) { feeOk[id] = ok; }, function () { feeOk[id] = null; });
  }
  function refreshFrom() {
    var m = modal(), f = from;
    if (!m || !f) return;
    Promise.all([loadBal(f.id), checkFee(f.id)]).then(function () {
      if (from !== f) return;
      var P = parts(m);
      paintBalance(P);
      if (feeOk[f.id] === false) say(f.code + ' cannot be swapped here yet: the platform fee account is not registered on it.', 'muted');
      setCta(P);
    });
  }
  function requote() {
    clearTimeout(timer);
    timer = setTimeout(doQuote, 350);
  }
  function doQuote() {
    var m = modal();
    if (!m) return;
    var P = parts(m), raw = amountRaw(P), my = ++seq;
    q = null;
    if (!raw || !from || !to) { paintQuote(P); setCta(P); return; }
    paintQuote(P);
    setCta(P);
    var f = from, t = to;
    S().quote(f.id, t.id, raw).then(function (x) {
      if (my !== seq) return;
      x.ok = true;
      q = x;
    }, function (e) {
      if (my !== seq) return;
      q = { ok: false, amount: raw, from: f.id, to: t.id, why: (e && e.noroute) ? 'No route on Rhea' : 'No quote right now' };
    }).then(function () {
      if (my !== seq) return;
      paintQuote(P);
      setCta(P);
    });
  }

  // ---- token menus ------------------------------------------------------------------------------------
  // From: what this account holds (wallet.js publishes it). To: NEAR and the curated list (/lxapi/nearmarket,
  // the promise prices.js shares), so a swap can only land in a token the platform lists.
  function heldList() {
    var d = window.__lxnData, out = [NEAR];
    ((d && d.held) || []).forEach(function (t) {
      if (t.dec == null || !t.id || !(t.balance > 0)) return;
      S().remember(t.id, t.display, t.dec, t.logo);
      out.push(asset(t.id, t.display, t.dec, t.logo));
    });
    return Promise.resolve(out);
  }
  function curatedList() {
    var p = window.__lxnMarketP;
    if (!p) {
      p = fetch('/lxapi/nearmarket').then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.ok && d.rows) ? d : null; }, function () { return null; });
      window.__lxnMarketP = p;
    }
    return p.then(function (d) {
      var out = [NEAR];
      ((d && d.rows) || []).forEach(function (r) {
        if (!r || !r.i || r.dc == null || r.i === S().WNEAR) return;
        S().remember(r.i, r.n, r.dc, r.logo);
        out.push(asset(r.i, r.n || r.i, r.dc, r.logo));
      });
      return out;
    });
  }
  function openMenu(btn, side) {
    var m = modal();
    if (!m || busy) return;
    var old = $('.lxw-astmenu', m);
    if (old) { var same = old.__side === side; old.parentNode.removeChild(old); if (same) return; }
    (side === 'from' ? heldList() : curatedList()).then(function (list) {
      var other = side === 'from' ? to : from;
      list = list.filter(function (a) { return !other || a.id !== other.id; });
      if (!list.length) return;
      var menu = document.createElement('div');
      menu.className = 'lxw-astmenu';
      menu.__side = side;
      menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:210px;'
        + 'max-height:260px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
        + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
      list.forEach(function (a) {
        var r = document.createElement('button');
        r.type = 'button';
        r.className = 'lxw-astrow';
        r.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
          + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
        var ic = document.createElement('span');
        ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
          + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
        icon(ic, a);
        var nm = document.createElement('span');
        nm.style.cssText = 'flex:1;font-weight:700';
        plain(nm, a.code);
        r.appendChild(ic); r.appendChild(nm);
        r.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          if (menu.parentNode) menu.parentNode.removeChild(menu);
          if (side === 'from') from = a; else to = a;
          changed(side === 'from');
        });
        menu.appendChild(r);
      });
      var host = btn.parentNode;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(menu);
      // Bound on the next frame: the click that opened the menu is still propagating (send.js's note).
      requestAnimationFrame(function () {
        function away(e) {
          if (menu.contains(e.target) || btn.contains(e.target)) return;
          if (menu.parentNode) menu.parentNode.removeChild(menu);
          document.removeEventListener('click', away, true);
        }
        document.addEventListener('click', away, true);
      });
    });
  }
  function changed(fromChanged) {
    var m = modal();
    if (!m) return;
    var P = parts(m);
    say('');
    paintPair(P);
    if (fromChanged) refreshFrom();
    doQuote();
  }

  // ---- open: start clean -------------------------------------------------------------------------------
  function reset() {
    var m = modal();
    if (!m) return;
    prepare(m);
    var P = parts(m);
    if (!from) from = NEAR;
    if (!to) to = asset(S().USDC, 'USDC', 6, '');
    var u = S().meta(S().USDC);
    if (u && to.id === u.id && !to.logo) to = asset(u.id, u.code, u.dec, u.logo);
    if (P.inIn) P.inIn.value = '';
    q = null; seq++; busy = false;
    var menu = $('.lxw-astmenu', m);
    if (menu) menu.parentNode.removeChild(menu);
    say('');
    paintPair(P);
    paintQuote(P);
    setCta(P);
    // The curated list carries USDC's logo; once it is in, repaint the default pair with it.
    curatedList().then(function () {
      var t = S().meta(to.id);
      if (t && !to.logo && t.logo) { to = asset(t.id, t.code, t.dec, t.logo); setPick(parts(m).toPick, to); }
    });
    refreshFrom();
  }

  // ---- the press ----------------------------------------------------------------------------------------
  // send.js's toast (same element, classes and stylesheet id), with the green mark.
  function toast(text) {
    if (!document.getElementById('lx-toastbad-css')) {
      var st = document.createElement('style');
      st.id = 'lx-toastbad-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}'
        + '.lx-ctoast.bad .ci{background:#e5484d}';
      (document.head || document.documentElement).appendChild(st);
    }
    var stack = $('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast';
    var ic = document.createElement('span'); ic.className = 'ci'; ic.textContent = '✓';
    var tx = document.createElement('span'); tx.textContent = text;
    t.appendChild(ic); t.appendChild(tx);
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function doSwap() {
    var m = modal();
    if (!m || busy) return;
    var P = parts(m), why = blocker(P);
    if (why) { say(why + '.', 'bad'); return; }
    var who = me(), shown = q, f = from, t = to;
    busy = true;
    say('');
    label(P, 'Checking the route…', false);
    function stop(text, tone) { busy = false; setCta(P); if (text) say(text, tone || 'bad'); }
    // The quote on screen may be seconds old: ask again, and refuse if the price moved past the floor shown.
    S().quote(shown.from, shown.to, shown.amount).then(function (fresh) {
      if (S().big(fresh.out) < S().big(shown.min)) {
        var e = new Error('The price moved past your 0.5% slippage. Nothing was signed — check the new quote.');
        e.requote = 1; throw e;
      }
      return Promise.all([S().build(who, fresh), S().balance(who, 'near')]).then(function (r) {
        var bt = r[0], have = S().big(r[1]);
        if (fresh.from === 'near' && S().big(fresh.amount) + S().big(bt.storage) > have) {
          throw new Error('Not enough NEAR for this swap and the storage it needs.');
        }
        if (fresh.from !== 'near' && S().big(bt.storage) > have) throw new Error('Not enough NEAR for the token registration this swap needs.');
        label(P, bt.steps > 1 ? 'Approve ' + bt.steps + ' transactions in your wallet…' : 'Confirm in wallet…', false);
        window.__lxnLastSwap = { quote: fresh, txs: bt.txs };
        return S().sign(bt).then(function (res) { return { res: res, q: fresh }; });
      });
    }).then(function (x) {
      var v = S().verdict(x.res);
      if (v.ok === false) {
        stop(v.why === 'refunded'
          ? (S().ROUTED
            ? 'Rhea did not fill the swap (the price moved). All of your ' + f.code + ' came back, the platform fee included.'
            : 'Rhea did not fill the swap (the price moved). Your ' + f.code + ' came back; the ' + (S().FEE_BPS / 100) + '% platform fee was kept.')
          : 'The swap failed on chain. Check your wallet activity.');
        return;
      }
      stop('');
      toast('Swapped ' + show(x.q.amount, f.dec) + ' ' + f.code + ' for ' + show(x.q.out, t.dec) + ' ' + t.code);
      if (P.inIn) P.inIn.value = '';
      q = null;
      paintQuote(P);
      bal[f.id] = null; bal[t.id] = null;
      refreshFrom();
    }).catch(function (e) {
      var msg = (e && e.message) || '';
      stop(/reject|denied|cancel|closed/i.test(msg) ? 'The swap was not approved, so nothing was swapped.' : (msg || 'The swap could not be completed.'));
      if (e && e.requote) setTimeout(doQuote, 50);
    });
  }

  // ---- wiring (window capture: the design's own handlers on these buttons never see our clicks) ----------
  window.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var m = t.closest('#modalSwap');
    if (!m || !S()) return;
    prepare(m);
    var P = parts(m);
    if (t.closest('.lx-wsmax')) {
      e.preventDefault(); e.stopImmediatePropagation();
      var r = from && room(from.id);
      if (r != null && P.inIn) { P.inIn.value = down(r, from.dec); say(''); doQuote(); }
      return;
    }
    var pk = t.closest('.asset-pick');
    if (pk) { e.preventDefault(); e.stopImmediatePropagation(); openMenu(pk, pk === P.toPick ? 'to' : 'from'); return; }
    if (t.closest('.swap-arrow')) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (busy || !from || !to) return;
      var a = from; from = to; to = a;
      if (P.inIn) P.inIn.value = '';
      changed(true);
      return;
    }
    if (t.closest('[data-lxsm-go]')) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!P.go.disabled) doSwap();
    }
  }, true);
  window.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#modalSwap')) return;
    var P = parts(modal());
    if (t !== P.inIn) return;
    // Digits and one point only, as the Trade-Asset pane accepts.
    var v = t.value.replace(/,/g, '').replace(/[^0-9.]/g, ''), i = v.indexOf('.');
    if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
    if (from && i >= 0 && v.length - i - 1 > from.dec) v = v.slice(0, i + 1 + from.dec);
    if (t.value !== v) t.value = v;
    say('');
    q = null;
    setCta(P);
    requote();
  }, true);

  // The dialog is build-time markup: prepare it as soon as the engine is there, so the design's APT mock is
  // never what opens even before the first click.
  // Opening is watched on the dialog itself: the design adds .open, and its Swap buttons are wired by its
  // own script (data-modal-wired, no data-open-modal on this page), so the class is the one signal every
  // way in shares.
  function watchOpen(m) {
    var was = m.classList.contains('open');
    new MutationObserver(function () {
      var now = m.classList.contains('open');
      if (now && !was) reset();
      was = now;
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  }
  (function boot(n) {
    if (S() && modal()) { reset(); watchOpen(modal()); return; }
    if (n < 80) setTimeout(function () { boot(n + 1); }, 100);
  })(0);
})();
