// The wallet's Swap dialog (#modalSwap) on NEAR, driven by window.lxnSwap (browser/nearswap.js) -- the same
// quoting, routing, fee and transaction building the Trade-Asset swap pane uses, so the money arithmetic
// exists once. Until this file the dialog was send.js's disabled "Swaps on NEAR are coming soon" placeholder;
// send.js now leaves it alone when window.__lxnSwapModal is set.
//
// ONE STEP, as Stellar's and XRPL's wallet Swap became on 2026-10-24 (RAZA): type an amount, the details
// fill in beside it, one press of the design's "Confirm Swap" opens the wallet. There is no Review/Back
// stage -- the wallet's own approval screen is the confirmation, as on the Trade-Asset pane.
//
// STELLAR'S POPUP (RAZA 2026-11-07, tickets 294 and 297), on the Wallet and on the LUMOS page alike. The From and To
// fields and the flip arrow are the design's; the rest is what _swapcalc.js builds around them there:
//   * .lx-swap-pick under each amount (the design's inline .asset-pick is hidden), so the amount has its row.
//   * MAX in the From label -- Stellar's .lx-wsmax.
//   * .lx-swapd, hidden at rest and filled once a quote is in: Rate, Slippage tolerance, Swap fee, Network fee,
//     Minimum received, the fee note. Nothing else; the design's rate line and Route box stay hidden for good. Stellar
//     leaves Price impact out of this panel on purpose. Only a reading of 5% or more is said here, in the status line:
//     pool 9001 is small enough for one swap to move it a long way, and Minimum received alone does not say why.
//   * the button reads "Confirm Swap" whatever the state; what stops it goes in .lx-swap-err, above the panel, and a
//     state that needs no explaining (nothing typed, still quoting) is simply a disabled button.
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
    return {
      from: f[0], to: f[1],
      inIn: f[0] && $('input', f[0]), outIn: f[1] && $('input', f[1]),
      fromPick: f[0] && $('.lx-swap-pick', f[0]), toPick: f[1] && $('.lx-swap-pick', f[1]),
      fromMeta: f[0] && $('.field-label .meta', f[0]), toMeta: f[1] && $('.field-label .meta', f[1]),
      panel: $('.lx-swapd', m), err: $('.lx-swap-err', m),
      go: $('.modal-foot .btn-primary', m)
    };
  }
  var from = null, to = null;                 // { id, code, dec, logo }
  var bal = {};                               // id -> raw spendable balance (before MAX's NEAR keep)
  // id -> 1 when the last read FAILED. Kept apart from bal so "still reading" (bal null, no failure) and
  // "could not read" (bal null, failed) are two states the button and the label can each say; cleared as
  // each attempt starts, so an old failure never outlives a retry. Every open retries.
  var balFail = {};
  var feeOk = {};                             // id -> true / false / null (unknown)
  var q = null, seq = 0, busy = false, timer = 0;

  function asset(id, code, dec, logo) { return { id: id, code: code, dec: +dec, logo: logo || '' }; }
  var NEAR = asset('near', 'NEAR', 24, NEAR_LOGO);

  // ---- the stacked layout -------------------------------------------------------------------------------------
  // One sheet for both pages. Stellar's rules are repeated under #modalSwap because the LUMOS page ships neither
  // .lx-asset-pick nor .lx-ap-ico's base rules. In the head of the dialog's life, before it can first open.
  function css() {
    if (document.getElementById('lxn-swapmodal-css')) return;
    var st = document.createElement('style');
    st.id = 'lxn-swapmodal-css';
    st.textContent = '#modalSwap .field-label{display:flex;align-items:center;gap:8px}'
      + '#modalSwap .field-label .meta{order:2;margin-left:auto}#modalSwap .field-label .lx-wsmax{order:3}'
      + '#modalSwap .field-amt .asset-pick{display:none}'
      + '#modalSwap .field-amt input{padding-right:14px!important}'
      + '#modalSwap .lx-swap-pick{display:inline-flex;align-items:center;gap:7px;margin-top:6px;padding:5px 9px;'
      + 'background:var(--surface,var(--bg,#12141b));border:1px solid var(--border,rgba(255,255,255,.14));border-radius:12px;'
      + 'cursor:pointer;color:var(--text,#fff);font-weight:700;font-size:14px;white-space:nowrap}'
      + '#modalSwap .lx-swap-pick:hover{border-color:var(--accent-soft,rgba(234,106,44,.45))}'
      + '#modalSwap .lx-ap-ico{width:28px;height:28px;border-radius:50%;flex:0 0 auto;overflow:hidden;position:relative;'
      + 'background-color:transparent;background-image:var(--lxlogo,none);background-size:cover;background-position:center;background-repeat:no-repeat}'
      + '#modalSwap .lx-ap-ico:not([data-l=""])::after{content:attr(data-l);position:absolute;inset:0;display:flex;align-items:center;'
      + 'justify-content:center;border-radius:50%;background:#3a3a46;color:#fff;font-weight:800;font-size:13px;pointer-events:none}'
      + '#modalSwap .swap-pair .field{padding:9px 14px}'
      + '#modalSwap .lx-swapd{margin-top:8px!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- one-time set-up of the design's dialog ---------------------------------------------------------
  function prepare(m) {
    if (m.__lxsm) return;
    m.__lxsm = 1;
    css();
    var P = parts(m), pair = $('.swap-pair', m);
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
    // The design's rate line and Route box, found by what they say, as Stellar's layer finds them.
    $$('.modal-body > div', m).forEach(function (d) {
      if (d !== pair && /Route|Network fee|Price impact|Slippage/.test(d.textContent || '')) d.style.display = 'none';
    });
    [P.from, P.to].forEach(function (f) {
      var fp = f && $('.asset-pick', f);
      if (!fp || $('.lx-swap-pick', f)) return;
      fp.style.display = 'none';
      var ap = document.createElement('button');
      ap.type = 'button';
      ap.className = 'lx-asset-pick lx-swap-pick';
      ap.setAttribute('data-lx-noswap', '');
      ap.innerHTML = '<span class="lx-ap-ico" data-logoed="1"></span><span class="lx-ap-code" data-logoed="1"></span>'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      fp.parentNode.insertBefore(ap, fp.nextSibling);
    });
    if (pair && !$('.lx-swapd', m)) {
      var ee = document.createElement('div');
      ee.className = 'lx-swap-err';
      ee.style.display = 'none';
      var pp = document.createElement('div');
      pp.className = 'lx-swapd';
      pp.style.display = 'none';
      pp.innerHTML = '<div class="r"><span>Rate</span><strong data-k="rate">—</strong></div>'
        + '<div class="r"><span>Slippage tolerance</span><strong data-k="slip">—</strong></div>'
        + '<div class="r"><span data-k="feelbl">Swap fee</span><strong data-k="fee">—</strong></div>'
        + '<div class="r"><span>Network fee</span><strong data-k="net">—</strong></div>'
        + '<div class="r rtot"><span>Minimum received</span><strong data-k="min">—</strong></div>'
        + '<div class="lx-feenote" data-k="feenote"></div>';
      pair.parentNode.insertBefore(pp, pair.nextSibling);
      pair.parentNode.insertBefore(ee, pp);
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
  // .lx-ap-ico paints from --lxlogo and draws its letter in ::after; a child <img> is hidden by the shared sheet.
  function setPick(btn, a) {
    if (!btn || !a) return;
    var ico = $('.lx-ap-ico', btn), u = String(a.logo || '').split(String.fromCharCode(10)).join('');
    if (u.indexOf('"') >= 0) u = '';
    if (u.indexOf('data:image/svg+xml,') === 0) u = u.split('#').join('%23');
    if (ico) {
      if (u) ico.style.setProperty('--lxlogo', 'url("' + u + '")');
      else ico.style.removeProperty('--lxlogo');
      ico.setAttribute('data-l', u ? '' : a.code.charAt(0).toUpperCase());
    }
    plain($('.lx-ap-code', btn), a.code);
  }
  function room(id) { return bal[id] == null ? null : S().swapRoom(id, bal[id]); }   // 0.2 NEAR kept for a swap's gas
  function paintBalance(P) {
    if (!P.fromMeta || !from) return;
    var r = room(from.id);
    plain(P.fromMeta, r != null ? 'Balance: ' + show(r, from.dec) + ' ' + from.code
      : (balFail[from.id] ? 'Balance: unavailable' : 'Balance: —'));
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
  function cell(P, k, text) { var e = P.panel && $('[data-k="' + k + '"]', P.panel); if (e) plain(e, text); }
  // Stellar's two fee notes, word for word. The flame is its own glyph.
  var FLAME = '<span class="lx-fee-ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-4 0-7-2.7-7-6.5 0-2.3 1.2-4 2.4-5.4.3.9 1 1.6 1.9 1.6 1.4 0 1.7-1 1.6-3.5-.1-2.4 1-4.6 3.1-6.2-.4 2 .3 3.2 1.6 4.6C19 9.6 19 11.8 19 16.5c0 3.8-3 6.5-7 6.5z"></path></svg></span>';
  function feeNote(bps) {
    return bps <= 10
      ? '<div class="lx-fee-banner holder">' + FLAME + '<span class="txt"><b>0.1% trading fees</b> — 50% discount active</span></div>'
      : '<div class="lx-fee-banner nudge">' + FLAME + '<span class="txt"><b>50% off trading fees</b> — hold 250,000 <a class="lx-fee-buy" href="/lumos/near" data-lxc="" data-logoed="1"><svg width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"></svg>LUMOS</a></span></div>';
  }
  // Empty until a quote is in. While one is on its way the last figures stand, so typing does not make the panel blink;
  // the button is disabled meanwhile, so nothing can be pressed on them.
  function paintQuote(P) {
    if (!q && amountRaw(P)) return;
    if (!q || !q.ok) {
      if (P.outIn) P.outIn.value = '';
      if (P.panel) P.panel.style.display = 'none';
      return;
    }
    var bps = S().FEE_BPS;
    if (P.outIn) P.outIn.value = down(q.out, to.dec);
    // The rate the pools give, on the amount that is actually swapped (after the fee).
    var rt = S().toNum(q.out, to.dec) / S().toNum(q.net, from.dec);
    cell(P, 'rate', '1 ' + from.code + ' ≈ ' + (rt > 0 && isFinite(rt) ? +rt.toPrecision(6) : '—') + ' ' + to.code);
    cell(P, 'slip', (S().SLIP_BPS / 100) + '%');
    cell(P, 'feelbl', 'Swap fee (' + (bps / 100) + '%)');
    cell(P, 'fee', show(q.fee, from.dec) + ' ' + from.code);
    cell(P, 'net', S().NET_FEE_EST);
    cell(P, 'min', show(q.min, to.dec) + ' ' + to.code);
    var note = P.panel && $('[data-k="feenote"]', P.panel);
    if (note) note.innerHTML = feeNote(bps);
    if (P.panel) P.panel.style.display = '';
    if (q.impact != null && q.impact >= 5) say('This swap moves the pool price by ' + fmtImpact(q.impact) + '.', 'muted');
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
  // An answer of '.' is a state with nothing to explain: the button is disabled and that is all.
  function blocker(P) {
    if (!me()) return 'Connect a NEAR wallet to swap.';
    if (!from || !to) return '.';
    if (feeOk[from.id] === false) return from.code + ' cannot be swapped here yet: the platform fee account is not registered on it.';
    var r = room(from.id);
    if (r == null && balFail[from.id]) return 'Your ' + from.code + ' balance could not be read from the NEAR network. Close and reopen Swap to try again.';
    var raw = amountRaw(P);
    if (!raw || r == null) return '.';
    if (S().big(raw) > S().big(r)) return 'Not enough ' + from.code + '.';
    if (!q) return '.';
    if (!q.ok) return (q.why || 'No route') + '.';
    if (q.amount !== raw || q.from !== from.id || q.to !== to.id) return '.';
    return '';
  }
  function setCta(P) {
    if (busy) return;
    var why = blocker(P), text = why === '.' ? '' : why;
    label(P, GO, !why);
    if (P.err) { P.err.textContent = text; P.err.style.display = text ? '' : 'none'; }
  }

  // ---- data ---------------------------------------------------------------------------------------------
  function loadBal(id) {
    var who = me();
    if (!who || !id) return Promise.resolve();
    balFail[id] = 0;
    // A failed re-read drops the earlier figure: showing it beside "could not be read" contradicts itself, and
    // a balance that could not be confirmed is not one to offer MAX on.
    return S().balance(who, id).then(function (raw) { bal[id] = String(raw); }, function () { bal[id] = null; balFail[id] = 1; });
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
      q = { ok: false, amount: raw, from: f.id, to: t.id, why: (e && e.noroute) ? 'No route on NEAR' : 'No quote right now' };
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
    var old = $('.lxw-astmenu');
    if (old) { var same = old.__side === side; old.parentNode.removeChild(old); if (same) return; }
    (side === 'from' ? heldList() : curatedList()).then(function (list) {
      var other = side === 'from' ? to : from;
      list = list.filter(function (a) { return !other || a.id !== other.id; });
      if (!list.length) return;
      var menu = document.createElement('div');
      menu.className = 'lxw-astmenu';
      menu.__side = side;
      // Fixed, on body: the picker now sits low in the dialog, where .modal-body's own scroll would clip an absolute menu.
      menu.style.cssText = 'position:fixed;z-index:100000;min-width:210px;'
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
      document.body.appendChild(menu);
      var br = btn.getBoundingClientRect(), mh = menu.offsetHeight || 260, vh = window.innerHeight || 800;
      menu.style.left = Math.round(Math.max(8, br.left)) + 'px';
      menu.style.top = Math.round(br.bottom + 6 + mh > vh - 8 ? Math.max(8, br.top - mh - 6) : br.bottom + 6) + 'px';
      // Bound after this click: it is still propagating (send.js's note).
      setTimeout(function () {
        function away(e) {
          if (menu.contains(e.target) || btn.contains(e.target)) return;
          if (menu.parentNode) menu.parentNode.removeChild(menu);
          document.removeEventListener('click', away, true);
        }
        document.addEventListener('click', away, true);
      }, 0);
    });
  }
  function changed(fromChanged) {
    var m = modal();
    if (!m) return;
    var P = parts(m);
    say('');
    if (P.panel) P.panel.style.display = 'none';       // another pair's figures do not stand while this one is asked
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
    // A page can name its own default To: the LUMOS page opens on LUMOS (browser/nearlumospage.js), as Stellar's does.
    var dt = window.__lxnSwapTo;
    if (!to) to = dt ? asset(dt.id, dt.code, dt.dec, dt.logo) : asset(S().USDC, 'USDC', 6, '');
    var u = S().meta(S().USDC);
    if (u && to.id === u.id && !to.logo) to = asset(u.id, u.code, u.dec, u.logo);
    if (P.inIn) P.inIn.value = '';
    q = null; seq++; busy = false;
    var menu = $('.lxw-astmenu');
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

  // ---- opened from a My Assets row ------------------------------------------------------------------------
  // RAZA 2026-11-07: Trade on a holding opens this dialog over the wallet, on that token, as Stellar's does (its
  // __lxSwapFrom). wallet.js's Swap item has always called this name; nothing defined it, so every press fell through
  // to the Trade page. The row's token goes on the pay side against NEAR, and NEAR itself against the default USDC.
  // The class is what the design's own openers set, and watchOpen's reset() runs after it and paints the pair. False
  // sends the caller to the Trade page: a token with no decimals cannot be priced here.
  window.__lxnOpenSwap = function (o) {
    var m = modal(), id = (o && o.issuer) || '';
    if (!m || !S()) return false;
    var a = NEAR;
    if (id) {
      var h = (((window.__lxnData || {}).held) || []).filter(function (t) { return t.id === id; })[0];
      if (!h || h.dec == null) return false;
      S().remember(h.id, h.display, h.dec, h.logo);
      a = asset(h.id, h.display, h.dec, h.logo);
    }
    from = a;
    to = (a.id === 'near' || a.id === S().WNEAR) ? null : NEAR;
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    return true;
  };

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
    if (why) { if (why !== '.') say(why, 'bad'); return; }
    var who = me(), shown = q, f = from, t = to;
    busy = true;
    say('');
    label(P, 'Checking the route…', false);
    window.__lxnLastSwap = null;
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
        label(P, 'Confirm in wallet…', false);
        window.__lxnLastSwap = { quote: fresh, txs: bt.txs };
        return S().sign(bt).then(function (res) { return { res: res, q: fresh }; });
      });
    }).then(function (x) {
      var v = S().verdict(x.res);
      if (v.ok === false) {
        stop(v.why === 'refunded'
          ? (S().ROUTED
            ? 'The pool did not fill the swap (the price moved). All of your ' + f.code + ' came back, the platform fee included.'
            : 'The pool did not fill the swap (the price moved). Your ' + f.code + ' came back; the ' + (S().FEE_BPS / 100) + '% platform fee was kept.')
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
      // After signing, the engine asks the chain what the wallet's error left behind (browser/nearswap.js).
      var signed = !!window.__lxnLastSwap && !(e && e.requote);
      (signed ? S().afterError(e) : Promise.resolve(msg || 'The swap could not be completed.')).then(function (tx) { stop(tx); });
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
    var pk = t.closest('.lx-swap-pick');
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
