// The LUMOS token page on NEAR (/lumos/near), LUMOS's OWN page now that it is minted (lumos.lumoscore.near, 2026-11-04).
//
// RAZA 2026-11-07, tickets 270-273: the page still drew Stellar's LUMOS: Stellar's price, Horizon's holders, a Stellar
// pill, "fixed supply on Stellar" and a Swap popup with an XLM fee. Stellar's lx-ltdata is stripped here and this file
// does its job on NEAR's data, in the same markup and the same .lxlt gates (lx-lt-css), so the page stays Stellar's
// design. _nearlumospage.js fixes the static copy and blanks the design's mock figures; this file writes the figures.
//
// WHERE EACH FIGURE COMES FROM:
//   price, 24h change, 24h volume, supply, market cap   /lxapi/neartoken, the Trade page's own call, so the two pages
//       agree. Circulating IS the supply here: every chain after Stellar issues 1B from day one (lx-ltdata's circSupply).
//       A change or volume it has no figure for comes from the indexer's records below, the only record of pool 9001.
//   holders    /lxapi/nearholders. Its list is every holder while shorter than 100, so the count is exact.
//   pools      /lxapi/nearpools?q=<contract>&full=1 (classic) + the order-book contract read from the chain: LUMOS's
//              order-book pool holds the Market Reserve and no pool list carries it.
//   chart      the indexer: its hourly price snapshots and pool 9001's swaps, then flat to now: a flat line is correct
//              when nobody traded. NEAR's dollar rate for a tick comes from the same answer, or CoinGecko past 7 days;
//              a tick with no rate is left out rather than priced at today's rate.
//
// SWAP: browser/nearswap.js + swapmodal.js, the wallet dialog's engine, sit in this same script block, so the Swap
// button here signs a real ref-finance swap (fee + ft_transfer_call). window.__lxnSwapTo makes LUMOS the default To.
// The popup rests clean, as Stellar's does; its details appear once an amount is typed, as Stellar's do.
//
// "Could not read" is never zero: a figure with no answer is a dash, and a failed read is retried, never kept.
(function () {
  if (window.__lxnLumosPage) return; window.__lxnLumosPage = 1;
  var LUMOS = '__NEAR_LUMOS__', POOL = '__NEAR_LUMOS_POOL__';
  var DEC = 18, IDX = 'https://near-pool-indexer.usa282.workers.dev';
  var DCL = 'dclv2.ref-labs.near', DCL_FEES = [100, 400, 2000, 10000], WNEAR = 'wrap.near';
  var NEAR_LOGO = '/assets/networks/near.png', LOGO = '/assets/tokens/lumos.png';
  var HOME = 'lumoscore.com', EXPLORER = 'https://nearblocks.io/token/' + LUMOS;
  // The default To of the Swap popup. Read by swapmodal.js, which runs right after this file.
  window.__lxnSwapTo = { id: LUMOS, code: 'LUMOS', dec: DEC, logo: LOGO };
  // Not community holders, as Stellar's page leaves out LumosDAO's wallets: the treasury, the fee account, and the
  // two exchange contracts, whose balances are the pools and the order book. They still count in the holder figure.
  var EXCLUDE = { 'treasury.lumoscore.near': 1, 'fees-lumoscore.near': 1, 'dclv2.ref-labs.near': 1, 'v2.ref-finance.near': 1 };
  // RAZA 2026-11-07, ticket 270: "Ecosystem LP Rewards ... the following 10 verified assets ... ranking order". The list
  // only: no reward contract runs on NEAR, so nothing here says a payout exists. Tickers are this list's, by request.
  var ECO = [
    ['USDC', '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'],
    ['USDt', 'usdt.tether-token.near'],
    ['QTC', 'qtc.omft.near'],
    ['ZEC', 'zec.omft.near'],
    ['BATMAN', 'batman-4.nearlytrade.near'],
    ['RHEA', 'token.rhealab.near'],
    ['NEARLY', 'nearly-993927.nearlytrade.near'],
    ['HOOT', 'hoot-8ecf65.launchpad.justhoot.near'],
    ['rNEAR', 'lst.rhealab.near'],
    ['USDT.e', 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near']
  ];
  // RAZA 2026-11-07, ticket 293: Stellar's popover, NEAR's fact. ft_total_supply reads 1B with no locked 9B, so Stellar's
  // own sentence would be false here. Shown only while the contract's figure is that 1B.
  var SUPPLY_NOTE = '1B LUMOS is the fixed supply on NEAR.';
  var TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';

  var T = null, tFail = false;                  // /lxapi/neartoken's answer
  var H = null, hFail = false;                  // /lxapi/nearholders' answer
  var PC = null, pFail = false;                 // classic pools; null until read
  var OB = null, oFail = false;                 // the order-book contract's pools, as it answered; null until read
  var TK = null;                                // the indexer's ticks, oldest first: { t, v (usd), vol (usd), tr }
  var NEAR_H = {}, CG = null;                   // hour -> NEAR usd; CoinGecko's [t, usd], oldest first
  var rawPx = null, rawPool = null;             // the indexer's two answers, kept to rebuild TK once CG lands
  // From when pool 9001's record is whole (RAZA 2026-11-12, ticket 369: the tooltip's Volume and Trades, as Stellar's).
  // Replaying every row the indexer holds, from the pool's first deposit, must land exactly on today's reserves: then no
  // swap is missing from the record and a bucket with none really had none. Until that is proven (or if it ever fails)
  // a bucket shows those rows only when the record has a swap in it, as before.
  var WHOLE_FROM = Infinity;

  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function setText(el, t) { if (el && t != null && el.textContent !== t) el.textContent = t; }
  function setMoney(el, s) { if (!el) return; setText(el, s); el.setAttribute('data-orig', s); el.setAttribute('data-usd', s); }
  function short(a) { a = String(a || ''); return a.length > 24 ? a.slice(0, 8) + '…' + a.slice(-6) : a; }
  function num(n) { return Math.round(+n || 0).toLocaleString('en-US'); }
  function usd(x) { x = +x || 0; if (x >= 1) return '$' + x.toFixed(2); if (x >= 0.01) return '$' + x.toFixed(4); if (x > 0) return '$' + x.toFixed(8); return '$0'; }
  // The rung is picked on the ROUNDED value, so 999,960 reads $1.00M and never $1000.0K.
  function abbr(n) {
    var a = Math.abs(n = +n || 0);
    if (a >= 999.5e6) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 999950) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return null;
  }
  function abbrNum(n) { return abbr(n) || String(Math.round(+n || 0)); }
  function abbrUsd(n) { var s = abbr(n); return s ? '$' + s : ((+n || 0) >= 1 ? '$' + (+n).toFixed(2) : usd(n)); }
  function amt(x) { x = +x || 0; return x >= 1 ? x.toFixed(4) : (x > 0 ? String(+x.toPrecision(4)) : '0'); }
  function units(raw, dec) { var n = Number(raw); return n > 0 ? n / Math.pow(10, dec) : 0; }
  function logoed(el) { el.setAttribute('data-logoed', '1'); return el; }

  function price() {
    if (!T) return 0;
    return T.usd > 0 ? +T.usd : ((T.price > 0 && T.nearUsd > 0) ? T.price * T.nearUsd : 0);
  }
  function supply() { return T && T.supply > 0 ? +T.supply : null; }
  // 24h change: the token answer's, else the records'. Null while the records do not reach back 24 hours.
  function change() {
    if (T && T.d24 != null && isFinite(+T.d24)) return +T.d24;
    var p = price(); if (!TK || !(p > 0)) return null;
    var edge = Date.now() - 864e5, at = null;
    for (var i = 0; i < TK.length && TK[i].t <= edge; i++) at = TK[i];
    return at && at.v > 0 ? (p - at.v) / at.v * 100 : null;
  }
  // 24h volume in USD. A token answer of nothing is not "no trades" while the pool's own record can be read.
  function volume() {
    var u = T && T.nearUsd > 0 ? +T.nearUsd : 0;
    if (T && T.v24 > 0 && u) return T.v24 * u;
    if (TK) {
      var edge = Date.now() - 864e5, s = 0;
      TK.forEach(function (k) { if (k.t >= edge) s += k.vol; });
      return s;
    }
    return (T && T.v24 != null && u) ? T.v24 * u : null;
  }
  // The 24h change in volume, from pool 9001's own record, in NEAR. Null unless that record really reaches back 48 hours
  // and the earlier day traded: no previous figure, no percentage (RAZA 2026-11-07, ticket 293: "+159.0% past 24h").
  function volChange() {
    if (!rawPool) return null;
    var rows = rawPool.rows || [], now = Date.now(), a = now - 864e5, b = now - 1728e5, reach = +rawPool.from || 0;
    if (rows.length >= 500) reach = rows.reduce(function (m, r) { return Math.min(m, r.t); }, now);
    if (!(reach > 0) || reach > b) return null;
    var cur = 0, prev = 0;
    rows.forEach(function (r) {
      if (r.kind !== 'swap' || r.t < b) return;
      var near = r.ta === WNEAR ? units(r.aa, 24) : (r.tb === WNEAR ? units(r.ab, 24) : 0);
      if (r.t >= a) cur += near; else prev += near;
    });
    if (!(prev > 0) || (T && T.v24 > 0 && !(cur > 0))) return null;
    return (cur - prev) / prev * 100;
  }
  function holderCount() { return H && H.count != null ? +H.count : null; }
  function poolList() {
    var out = (PC || []).concat((OB || []).map(bookRow).filter(Boolean));
    return out.sort(function (a, b) { return (b.tvl || 0) - (a.tvl || 0); });
  }
  function poolsKnown() { return PC != null && OB != null; }

  // ---- the hero -----------------------------------------------------------------------------------------------
  function hero() {
    var hp = q('.hero-price-block') || q('.hero-price'), p = price();
    if (hp && p > 0) {
      setText(q('.price', hp), usd(p));
      if (T.price > 0) setText(q('.price-native', hp) || q('.sub-volume', hp), '≈ ' + amt(T.price) + ' NEAR');
      var ch = q('.change', hp), c = change();
      if (ch) {
        if (c != null) { setText(ch, (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(1) + '% (24h)'); ch.classList.toggle('down', c < 0); }
        else setText(ch, '');
      }
      hp.classList.add('lxlt');
    } else if (hp && tFail) {
      setText(q('.price', hp), '—');
      setText(q('.price-native', hp), '');
      setText(q('.change', hp), '');
      hp.classList.add('lxlt');
    }
    // The "≈ x NEAR" and the 24h badge on one right-aligned row, as Stellar's.
    if (hp && !q('.lx-pricemeta', hp)) {
      var nat = q('.price-native', hp), chg = q('.change', hp);
      if (nat && chg && nat.parentNode === hp && chg.parentNode === hp) {
        var meta = document.createElement('div'); meta.className = 'lx-pricemeta';
        hp.insertBefore(meta, nat); meta.appendChild(nat); meta.appendChild(chg);
      }
    }
  }
  // Once: the marks and links the markup does not carry.
  function heroOnce() {
    var ic = q('.lumos-icon');
    if (ic && ic.getAttribute('data-lxlogo') !== '1') {
      ic.setAttribute('data-lxlogo', '1');
      var brand = q('.nx-brand .logo-mark'), bg = brand ? getComputedStyle(brand).backgroundImage : '';
      if (!bg || bg === 'none') bg = 'url(' + LOGO + ')';
      ic.style.setProperty('background-image', bg, 'important');
      ic.style.setProperty('background-color', 'transparent', 'important');
      ic.style.setProperty('background-size', 'contain', 'important');
      ic.style.setProperty('background-repeat', 'no-repeat', 'important');
      ic.style.setProperty('background-position', 'center', 'important');
      ic.style.setProperty('box-shadow', 'none', 'important');
      ic.style.setProperty('filter', 'drop-shadow(0 6px 14px rgba(234,106,44,.28))', 'important');
    }
    var bi = q('.lumos-big-icon');
    if (bi && bi.getAttribute('data-lxlogo') !== '1') {
      bi.setAttribute('data-lxlogo', '1'); bi.setAttribute('data-lxc', 'LUMOS'); bi.textContent = '';
      bi.style.setProperty('background', 'url("/assets/favicon.png") center/cover no-repeat', 'important');
      bi.style.setProperty('border-radius', '50%', 'important');
    }
    var h1 = q('h1:not(.lx-lp-h)');
    if (h1 && !q('.lx-vtick', h1)) {
      var tk = document.createElement('span');
      tk.className = 'lx-vtick'; tk.title = 'Verified token'; tk.innerHTML = TICK;
      h1.appendChild(tk);
    }
    qa('.addr-row').forEach(function (row) {
      row.classList.add('lxlt');
      if (!q('.lx-lt-dom', row)) {
        var a = document.createElement('a');
        a.className = 'lx-lt-dom'; a.target = '_blank'; a.rel = 'noopener'; a.href = 'https://' + HOME;
        a.innerHTML = GLOBE + '<span></span>';
        q('span', a).textContent = HOME;
        row.appendChild(a);
      }
      // One confirmation: a clone sheds the design's own copy handler, and the phone has no toast of its own.
      qa('[data-copy]', row).forEach(function (b) {
        if (b.__lxcp) return;
        var c = b.cloneNode(true); c.__lxcp = 1;
        b.parentNode.replaceChild(c, b);
        c.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          function ok() { toast('Contract address copied'); c.classList.add('lx-copied'); setTimeout(function () { c.classList.remove('lx-copied'); }, 1400); }
          function old() {
            try {
              var ta = document.createElement('textarea'); ta.value = LUMOS; ta.setAttribute('readonly', '');
              ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
              document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, LUMOS.length);
              document.execCommand('copy'); document.body.removeChild(ta); ok();
            } catch (e) {}
          }
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(LUMOS).then(ok, old); else old();
        });
      });
    });
  }
  function toast(msg) {
    try { if (typeof window.showToast === 'function') { window.showToast(msg); return; } } catch (e) {}
    var st = q('.toast-stack');
    if (!st) { st = document.createElement('div'); st.className = 'toast-stack'; document.body.appendChild(st); }
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    st.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
  }

  // ---- the four cards and the overview ------------------------------------------------------------------------
  function stats() {
    var p = price(), sup = supply(), hc = holderCount(), v = volume();
    // THE CHART HEADER, FROM THE SAME FIGURES AS THE CARDS (bug N7, 2026-11-19): it stayed "— … MC —" for good.
    if (p > 0) {
      var _cp = q('#ctPriceAptos'), _pt = usd(p); if (_cp && _cp.textContent !== _pt) _cp.textContent = _pt;
      var _cm = q('#ctMcAptos'), _mt = sup ? 'MC ' + abbrUsd(p * sup) : 'MC —'; if (_cm && _cm.textContent !== _mt) _cm.textContent = _mt;
    }
    qa('.lh-stats .cstat').forEach(function (card) {
      var t = (card.textContent || '').toUpperCase(), val = q('.val', card), sub = q('.sub', card) || q('.small-sub', card);
      var money = q('.lc-money', card) || val, done = false;
      if (t.indexOf('MARKET CAP') >= 0) {
        if (p > 0 && sup) { setMoney(money, abbrUsd(p * sup)); capSub(sub, 'on ' + abbrNum(sup) + ' circulating', Math.round(sup) === 1e9); done = true; }
        else if (tFail) { setMoney(money, '—'); setText(sub, ''); done = true; }
      } else if (t.indexOf('HOLDERS') >= 0) {
        if (hc != null) { setText(val, num(hc)); setText(sub, 'holding a balance'); if (sub) sub.classList.add('up'); done = true; }
        else if (hFail || H) { setText(val, '—'); setText(sub, ''); done = true; }
      } else if (t.indexOf('POOLS') >= 0) {
        if (poolsKnown()) {
          setText(val, String(activeCount()));
          if (!sub) { sub = document.createElement('div'); sub.className = 'sub'; card.appendChild(sub); }
          setText(sub, 'LUMOS pairs'); done = true;
        }
        else if (pFail || oFail) { setText(val, '—'); setText(sub, ''); done = true; }
      } else if (t.indexOf('VOLUME') >= 0) {
        if (v != null) {
          var vc = volChange();
          setMoney(money, abbrUsd(v));
          setText(sub, vc != null ? (vc >= 0 ? '+' : '−') + Math.abs(vc).toFixed(1) + '% past 24h' : 'LUMOS/NEAR market');
          if (sub) { sub.classList.toggle('up', vc != null && vc >= 0); sub.classList.toggle('down', vc != null && vc < 0); }
          done = true;
        }
        else if (tFail) { setMoney(money, '—'); setText(sub, ''); done = true; }
      }
      if (done) card.classList.add('lxlt');
    });
  }
  // The figure and the circled i, Stellar's two spans: its stylesheet draws the popover from data-tip on hover.
  function capSub(sub, text, note) {
    if (!sub) return;
    var n = q('.lx-supnum', sub);
    if (!n) { sub.textContent = ''; n = document.createElement('span'); n.className = 'lx-supnum'; sub.appendChild(n); }
    setText(n, text);
    var i = q('.lx-supinfo', sub);
    if (note && !i) { i = logoed(document.createElement('span')); i.className = 'lx-supinfo'; i.setAttribute('data-tip', SUPPLY_NOTE); i.textContent = 'i'; sub.appendChild(i); }
    else if (!note && i) sub.removeChild(i);
  }
  function activeCount() { return poolList().filter(function (x) { return x.live; }).length; }
  function overview() {
    var p = price(), sup = supply(), hc = holderCount(), v = volume(), c = change();
    qa('.lt-cmp-row').forEach(function (r) {
      var l = ((q('.lt-cmp-l', r) || {}).textContent || '').trim().toLowerCase(), el = q('.lt-cmp-v', r);
      if (!el) return;
      var s = null;
      if (l.indexOf('price') === 0) { if (p > 0) s = usd(p) + (c != null ? '  ' + (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(1) + '%' : ''); else if (tFail) s = '—'; }
      else if (l.indexOf('24h volume') >= 0) { if (v != null) s = abbrUsd(v) + ' · LUMOS/NEAR market'; else if (tFail) s = '—'; }
      else if (l.indexOf('circulating') >= 0) { if (sup) s = num(sup) + ' LUMOS'; else if (tFail) s = '—'; }
      else if (l.indexOf('holders') >= 0) { if (hc != null) s = num(hc); else if (hFail || H) s = '—'; }
      else if (l.indexOf('active pools') >= 0) { if (poolsKnown()) s = String(activeCount()); else if (pFail || oFail) s = '—'; }
      if (s != null) { setText(el, s); r.classList.add('lxlt'); }
    });
    if (poolsKnown()) qa('.lt-cmp-foot button,.lt-cmp-foot a').forEach(function (b) {
      setText(b, 'View all ' + poolList().length + ' pools →');
      var f = b.closest ? b.closest('.lt-cmp-foot') : null; if (f) f.classList.add('lxlt');
    });
  }
  function tabs() {
    var hc = holderCount();
    qa('.lt-tab').forEach(function (t) {
      var n = (t.textContent || '').trim();
      if (n === 'Pools' && poolsKnown()) t.setAttribute('data-count', '(' + poolList().length + ')');
      else if (n === 'Holders' && hc != null) t.setAttribute('data-count', '(' + num(hc) + ')');
    });
  }

  // ---- pools ----------------------------------------------------------------------------------------------------
  function poolHref(id, syms) {
    var slug = syms.map(function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); })
      .filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '');
    return '/pools/near/' + (slug || 'pool') + '/' + encodeURIComponent(id);
  }
  function symOf(t) { return t.i === WNEAR ? 'NEAR' : String(t.s || '?'); }
  function classic(j) {
    var u = j.usd > 0 ? +j.usd : 0, out = [];
    (j.rows || []).forEach(function (r) {
      var ts = (r && r.tokens) || [];
      if (!ts.some(function (t) { return t.i === LUMOS; })) return;       // q is a search: only pools holding this contract
      var others = ts.filter(function (t) { return t.i !== LUMOS; });
      var syms = ts.map(symOf);
      out.push({ id: String(r.id), name: 'LUMOS / ' + others.map(symOf).join(' / '), other: others[0] || null,
        tvl: (r.liq != null && u) ? r.liq * u : null, vol: (r.vol != null && u) ? r.vol * u : null,
        live: !ts.some(function (t) { return t.v === 0; }), href: poolHref(r.id, syms), label: 'View pool' });
    });
    return out;
  }
  // A pool of the order-book contract, or null. "Live" holds liquidity or resting orders; x/y are its two tokens.
  function bookRow(r) {
    if (!r || r.state !== 'Running') return null;
    var big = function (v) { try { return BigInt(String(v || '0')); } catch (e) { return BigInt(0); } };
    var lx = r.token_x === LUMOS;
    var tot = function (a, b) { return big(a) + big(b); };
    var x = tot(r.total_x, r.total_order_x), y = tot(r.total_y, r.total_order_y);
    var n = units((lx ? x : y).toString(), DEC), near = units((lx ? y : x).toString(), 24);
    var u = T && T.nearUsd > 0 ? +T.nearUsd : 0, p = price();
    return { id: String(r.pool_id), name: 'LUMOS / NEAR', book: 1, other: { i: WNEAR, s: 'NEAR' },
      tvl: (p > 0 && u) ? n * p + near * u : null, vol: null,
      live: big(r.liquidity) > BigInt(0) || big(r.total_order_x) > BigInt(0) || big(r.total_order_y) > BigInt(0),
      href: '/trade/near/' + LUMOS, label: 'Trade' };
  }
  function pairIcons(row, p) {
    var a = q('.pair-icons .a', row), b = q('.pair-icons .b', row); var box = q('.pair-icons', row); if (box) box.setAttribute('data-paired', '1');
    if (a) {
      logoed(a); a.setAttribute('data-lxc', 'LUMOS'); a.textContent = '';
      var brand = q('.nx-brand .logo-mark'), bg = brand ? getComputedStyle(brand).backgroundImage : '';
      a.style.background = (bg && bg !== 'none' ? bg : 'url(' + LOGO + ')') + ' center/contain no-repeat';
    }
    if (b) {
      logoed(b); b.setAttribute('data-lxc', 'NEAR'); b.textContent = '';
      b.style.background = 'transparent'; b.style.overflow = 'hidden'; b.style.left = '';
      var o = p.other, src = o && o.i === WNEAR ? NEAR_LOGO : ((o && o.logo) || (o && o.i ? IDX + '/icon?v=2&t=' + encodeURIComponent(o.i) : ''));
      if (src) {
        var im = document.createElement('img'); im.alt = ''; im.src = src;
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); };
        b.appendChild(im);
      }
    }
  }
  function nameOfRow(row, p) {
    var nm = q('.pair-name', row);
    if (!nm) return;
    nm.textContent = p.name;
    if (p.book) { var s = document.createElement('span'); s.className = 'lxn-book'; s.textContent = 'Order book'; nm.appendChild(s); }
  }
  function btnText(btn, text) {
    if (!btn) return;
    for (var i = 0; i < btn.childNodes.length; i++) if (btn.childNodes[i].nodeType === 3 && btn.childNodes[i].nodeValue.trim()) { btn.childNodes[i].nodeValue = text + ' '; return; }
  }
  function money(el, v) { if (!el) return; var s = v == null ? '—' : abbrUsd(v); el.textContent = s; el.setAttribute('data-orig', s); el.setAttribute('data-usd', v == null ? '' : String(v)); }
  var built = '';
  function poolsTable() {
    if (!poolsKnown() && !pFail && !oFail) return;
    var list = poolList(), sig = JSON.stringify(list.map(function (p) { return [p.id, p.tvl, p.vol]; }));
    var pb = q('#poolsBody'), ls = q('.pool-list');
    var host = pb || ls;
    if (!host) return;
    host.classList.add('lxlt');
    if (sig === built) return;
    var tpl = host.__lxtpl || host.querySelector(pb ? 'tr' : 'a.pool-item');
    if (!tpl) return;
    host.__lxtpl = tpl;
    built = sig;
    var frag = document.createDocumentFragment();
    list.forEach(function (p) {
      var row = tpl.cloneNode(true);
      row.setAttribute('data-lxbuilt', '1');
      nameOfRow(row, p);
      pairIcons(row, p);
      var cells = pb ? qa('.num', row) : qa('.stats-row .v', row);
      money(cells[0], p.tvl); money(cells[1], p.vol);
      var link = pb ? q('a', row) : row;
      if (link) link.setAttribute('href', p.href);
      btnText(q('.trade-btn', row), p.label);
      frag.appendChild(row);
    });
    host.innerHTML = '';
    host.appendChild(frag);
    if (pb) {
      var tbl = pb.closest('table');
      if (tbl && tbl.parentNode && !tbl.parentNode.classList.contains('lx-poolscroll')) {
        var wrap = document.createElement('div'); wrap.className = 'lx-poolscroll';
        tbl.parentNode.insertBefore(wrap, tbl); wrap.appendChild(tbl);
      }
    }
  }

  // ---- holders ----------------------------------------------------------------------------------------------------
  var MEDAL = [{ a: '#ffe487', b: '#e3a81a', s: '#b9860f', t: '#6d4a00' }, { a: '#ffffff', b: '#b6bcc6', s: '#8b93a0', t: '#4c5661' }, { a: '#f3c79a', b: '#c07a3c', s: '#97592a', t: '#5f3616' }];
  function medal(i) {
    var c = MEDAL[i], id = 'lxmed' + i;
    return '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><defs><radialGradient id="' + id + '" cx="36%" cy="28%" r="78%"><stop offset="0%" stop-color="' + c.a + '"></stop><stop offset="100%" stop-color="' + c.b + '"></stop></radialGradient></defs>'
      + '<circle cx="20" cy="21" r="15.5" fill="url(#' + id + ')" stroke="' + c.s + '" stroke-width="2"></circle><circle cx="20" cy="21" r="12.3" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1"></circle>'
      + '<path d="M12 3 L16 12 L12 11 L8 12 Z" fill="' + c.s + '"></path><path d="M28 3 L32 12 L28 11 L24 12 Z" fill="' + c.s + '"></path>'
      + '<text x="20" y="26.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="800" fill="' + c.t + '">' + (i + 1) + '</text></svg>';
  }
  var hBuilt = '';
  function holders() {
    if (!H) return;
    var list = (H.holders || []).map(function (h) { return { a: String(h.a), bal: units(h.raw, DEC) }; });
    var hc = holderCount(), whole = list.length < 100, low = list.length ? list[list.length - 1].bal : 0;
    // The list holds the 100 largest, so a bucket is known only when it cannot reach past the list's end.
    var b = [0, 0, 0, null];
    list.forEach(function (h) { if (h.bal >= 5e6) b[0]++; else if (h.bal >= 1e6) b[1]++; else if (h.bal >= 25e4) b[2]++; });
    if (hc != null && (whole || low < 25e4)) b[3] = Math.max(0, hc - b[0] - b[1] - b[2]);
    if (!whole) { if (low >= 25e4) b[2] = null; if (low >= 1e6) b[1] = null; if (low >= 5e6) b[0] = null; }
    var mx = Math.max(b[0] || 0, b[1] || 0, b[2] || 0, b[3] || 0) || 1;
    qa('.wsize-row').forEach(function (r, i) {
      if (i > 3) return;
      setText(q('.wsize-count', r), b[i] == null ? '—' : num(b[i]));
      var f = q('.fill', r); if (f) f.style.width = (b[i] ? Math.max(1, Math.round(b[i] / mx * 100)) : 0) + '%';
    });
    qa('.h-head').forEach(function (hd) {
      var t = q('h3', hd), m = q('.meta', hd);
      if (t && m && (t.textContent || '').indexOf('breakdown') >= 0) setText(m, hc != null ? num(hc) + ' total' : '');
    });
    var rows = qa('.holder-row'), tpl = window.__lxnHolderTpl || rows[0];
    if (!tpl) return;
    window.__lxnHolderTpl = tpl;
    var top = list.filter(function (h) { return !EXCLUDE[h.a]; }).slice(0, 5), p = price(), sup = supply();
    var sig = JSON.stringify(top) + '|' + p + '|' + sup;
    if (sig === hBuilt) return;
    hBuilt = sig;
    var parent = tpl.parentNode || window.__lxnHolderBox;
    if (!parent) return;
    window.__lxnHolderBox = parent;
    var before = q('.h-foot', parent);
    rows.forEach(function (r) { if (r.parentNode) r.parentNode.removeChild(r); });
    var msg = q('.lxn-noholders', parent); if (msg) msg.parentNode.removeChild(msg);
    if (!top.length) {
      var n = document.createElement('div'); n.className = 'lxn-noholders'; n.textContent = 'No community holders yet.';
      parent.insertBefore(n, before); return;
    }
    top.forEach(function (h, i) {
      var c = tpl.cloneNode(true), rk = q('.rk', c), av = q('.av', c), ad = q('.addr', c), ch = q('.chain', c), v = q('.holdings .v', c), m = q('.holdings .pct', c);
      if (rk) { if (i < 3) { rk.className = 'rk medal'; rk.innerHTML = medal(i); } else { rk.className = 'rk'; rk.textContent = String(i + 1); } }
      if (av) { logoed(av); av.textContent = h.a.charAt(0).toUpperCase(); }
      if (ad) { ad.textContent = short(h.a); ad.title = h.a; }
      if (ch) { var pc = sup ? h.bal / sup * 100 : null; ch.textContent = pc == null ? '—' : (pc >= 0.01 ? pc.toFixed(2) : '<0.01') + '% of supply'; }
      // DUST (RAZA 2026-11-18, "what about Near?"): lumos01.near holds ~0.0000003 LUMOS -- a real holder, but it read
      // "0 LUMOS" beside "$0.00000000". Below 0.01 both say so instead.
      if (v) v.textContent = (h.bal > 0 && h.bal < 0.01 ? '<0.01' : abbrNum(h.bal)) + ' LUMOS';
      if (m) { var u = p > 0 ? h.bal * p : null; m.classList.add('lc-money'); money(m, u); if (u != null && u > 0 && u < 0.01) { m.textContent = '<$0.01'; m.setAttribute('data-orig', '<$0.01'); } }
      c.style.cursor = 'pointer'; c.title = 'View on NearBlocks'; c.setAttribute('data-lxbuilt', '1');
      c.addEventListener('click', function () { window.open('https://nearblocks.io/address/' + encodeURIComponent(h.a), '_blank', 'noopener'); });
      parent.insertBefore(c, before);
    });
  }

  // ---- static sections --------------------------------------------------------------------------------------------
  // Cross-Chain Reserve folded into Airdrops, 70M / 7%, as Stellar's.
  function allocation() {
    qa('.alloc-row').forEach(function (r) { if (/Cross-Chain Reserve/i.test((q('.name', r) || {}).textContent || '') && r.parentNode) r.parentNode.removeChild(r); });
    qa('.alloc-seg').forEach(function (s) {
      var st = s.getAttribute('style') || '';
      if (st.indexOf('--alloc-5)') >= 0 && s.parentNode) s.parentNode.removeChild(s);
      else if (st.indexOf('--alloc-7)') >= 0) { s.style.width = '7%'; if (s.getAttribute('data-tooltip')) s.setAttribute('data-tooltip', 'Airdrops — 70M (7%)'); }
    });
    qa('.alloc-row').forEach(function (r) {
      if (/Airdrops/i.test((q('.name', r) || {}).textContent || '')) { setText(q('.amount', r), '70M'); setText(q('.pct', r), '7%'); r.style.gridColumn = 'auto'; r.style.maxWidth = 'none'; }
    });
    qa('.alloc-legend').forEach(function (l) { l.classList.add('lxlt'); });
  }
  // "What you can do with LUMOS" above "Supply distribution", as Stellar's. The head and its grid move together.
  function orderSections() {
    var uh = null, sh = null;
    qa('h1,h2,h3,h4').forEach(function (e) {
      var t = e.textContent || '';
      if (!uh && /what you can do with lumos/i.test(t)) uh = e;
      if (!sh && /supply distribution/i.test(t)) sh = e;
    });
    if (!uh || !sh) return;
    var ub = null, sb = null, par = null;
    for (var a = uh; a && !par; a = a.parentElement) for (var b = sh; b; b = b.parentElement) {
      if (a.parentElement && a.parentElement === b.parentElement && a !== b) { par = a.parentElement; ub = a; sb = b; break; }
    }
    if (!par) return;
    var grid = q('.utility-grid', par) || q('.util-grid', par);
    if (grid && grid.parentNode !== par) grid = null;
    if ((ub.compareDocumentPosition(sb) & Node.DOCUMENT_POSITION_FOLLOWING) && (!grid || ub.nextElementSibling === grid)) return;
    par.insertBefore(ub, sb);
    if (grid) par.insertBefore(grid, sb);
  }
  // Tickets 270 and 292: Stellar has no ranked list. Its Ecosystem LP Rewards section is this utility card, so the list
  // lives inside it, under the card's own heading and copy, above "View partner pools". The rows are the ticket's.
  function ecoList() {
    if (q('#lxnEco')) return;
    var card = q('.util-card.eco');
    if (!card) return;
    var list = document.createElement('div'); list.id = 'lxnEco'; list.className = 'lxn-eco-list';
    ECO.forEach(function (e, i) {
      var a = document.createElement('a'); a.className = 'lxn-eco-row'; a.href = '/trade/near/' + encodeURIComponent(e[1]);
      var rk = logoed(document.createElement('span')); rk.className = 'lxn-eco-rk'; rk.textContent = '#' + (i + 1);
      var ic = logoed(document.createElement('span')); ic.className = 'lxn-eco-ic'; ic.setAttribute('data-lxc', e[0]); ic.setAttribute('data-lxeco', e[1]);
      var tx = document.createElement('span'); tx.className = 'lxn-eco-tx';
      var tk = logoed(document.createElement('span')); tk.className = 'lxn-eco-tk';
      var nm = logoed(document.createElement('span')); nm.textContent = e[0];
      var vt = document.createElement('span'); vt.className = 'lx-vtick'; vt.title = 'Verified token'; vt.innerHTML = TICK;
      tk.appendChild(nm); tk.appendChild(vt);
      var id = logoed(document.createElement('span')); id.className = 'lxn-eco-id'; id.textContent = short(e[1]); id.title = e[1];
      tx.appendChild(tk); tx.appendChild(id);
      a.appendChild(rk); a.appendChild(ic); a.appendChild(tx);
      list.appendChild(a);
    });
    card.insertBefore(list, q('.u-link', card));
    // The curated list's logo, else the indexer's; a logo that will not load leaves the row's ticker to say it.
    var C = window.lxnCore;
    (C && C.market ? C.market() : Promise.resolve(null)).then(function (d) {
      var by = {};
      ((d && d.rows) || []).forEach(function (r) { if (r && r.i) by[r.i] = r.logo; });
      qa('.lxn-eco-ic', list).forEach(function (ic) {
        var id = ic.getAttribute('data-lxeco'), im = document.createElement('img');
        im.alt = ''; im.src = by[id] || (IDX + '/icon?v=2&t=' + encodeURIComponent(id));
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); };
        ic.appendChild(im);
      });
    });
  }

  // ---- the chart --------------------------------------------------------------------------------------------------
  var TF = { '1H': [3e5, 36e5], '24H': [9e5, 864e5], '7D': [36e5, 6048e5], '30D': [216e5, 2592e6], '1Y': [864e5, 31536e6], 'All': [864e5, 15768e7] };
  var chartTF = '7D', chartGen = 0, chartWired = false, _busy = null;
  function chartBusy(on) {
    var pc = q('#priceChart'); if (pc) pc.classList.toggle('lx-ch-busy', !!on);
    clearTimeout(_busy);
    if (on) _busy = setTimeout(function () { var p = q('#priceChart'); if (p) p.classList.remove('lx-ch-busy'); }, 20000);
  }
  function chartMsg(t) {
    var pc = q('#priceChart'); if (!pc) return;
    var m = q('.lx-chmsg', pc);
    if (!t) { if (m) m.parentNode.removeChild(m); return; }
    if (!m) { m = document.createElement('div'); m.className = 'lx-chmsg'; pc.appendChild(m); }
    setText(m, t);
  }
  function axisLbl(t) {
    var d = new Date(t), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (chartTF === '1H' || chartTF === '24H') return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00';
    if (chartTF === '1Y' || chartTF === 'All') return mo[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
    return mo[d.getMonth()] + ' ' + d.getDate();
  }
  function fullDate(t) {
    var d = new Date(t), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var hm = (chartTF === '1H' || chartTF === '24H') ? ', ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() : '';
    return mo[d.getMonth()] + ' ' + d.getDate() + hm;
  }
  // NEAR's dollar rate at a moment, or null: the indexer's hourly record, then CoinGecko's.
  function rate(t) {
    var h = Math.floor(t / 36e5), r = NEAR_H[h] || NEAR_H[h + 1] || NEAR_H[h - 1];
    if (r) return r;
    if (!CG || !CG.length) return null;
    var best = null, gap = 864e5;
    for (var i = 0; i < CG.length; i++) { var g = Math.abs(CG[i][0] - t); if (g <= gap) { gap = g; best = CG[i][1]; } }
    return best;
  }
  function buildTicks(px, pool) {
    var out = [];
    ((px && px.near) || []).forEach(function (x) { NEAR_H[x[0]] = +x[1]; });
    ((px && px.tok && px.tok[LUMOS]) || []).forEach(function (x) { if (+x[1] > 0) out.push({ t: x[0] * 36e5, v: +x[1], vol: 0, tr: 0 }); });
    var rows = ((pool && pool.rows) || []).slice().sort(function (a, b) { return a.t - b.t; }), born = false;
    rows.forEach(function (r) {
      if (r.kind === 'add' && !born) {
        var a = 0, b = 0;
        ((r.extra && r.extra.tokens) || []).forEach(function (x) { if (x.t === LUMOS) a = units(x.a, DEC); if (x.t === WNEAR) b = units(x.a, 24); });
        var ra = rate(r.t);
        if (a > 0 && b > 0) { born = true; if (ra) out.push({ t: r.t, v: b / a * ra, vol: 0, tr: 0 }); }
        return;
      }
      if (r.kind !== 'swap') return;
      var buy = r.tb === LUMOS && r.ta === WNEAR, sell = r.ta === LUMOS && r.tb === WNEAR;
      if (!buy && !sell) return;
      var n = units(buy ? r.ab : r.aa, DEC), near = units(buy ? r.aa : r.ab, 24), u = rate(r.t);
      if (n > 0 && near > 0 && u) out.push({ t: r.t, v: near / n * u, vol: near * u, tr: 1 });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  // Even steps across the range, each the last price of its step, so the line's width is time.
  function seriesFor(tf) {
    if (!TK || !TK.length) return [];
    var cfg = TF[tf] || TF['7D'], now = Date.now(), start = Math.max(now - cfg[1], TK[0].t), res = Math.max(cfg[0], Math.ceil((now - start) / 240));
    var i = 0, cur = TK[0].v, pts = [];
    while (i < TK.length && TK[i].t < start) cur = TK[i++].v;
    for (var b = start; b < now; b += res) {
      var vol = 0, tr = 0;
      while (i < TK.length && TK[i].t < b + res) { cur = TK[i].v; vol += TK[i].vol; tr += TK[i].tr; i++; }
      pts.push({ t: b, v: cur, vol: vol, tr: tr, whole: b >= WHOLE_FROM });
    }
    pts.push({ t: now, v: price() > 0 ? price() : cur, vol: 0, tr: 0 });
    return pts;
  }
  function drawChart(pts) {
    var pc = q('#priceChart'); if (!pc) return;
    chartBusy(false);
    var svg = q('svg', pc);
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block';
      pc.appendChild(svg);
    }
    var W = 1000, HH = 320, PAD = 26, n = pts.length;
    var sorted = pts.map(function (p) { return p.v; }).sort(function (a, b) { return a - b; });
    var lo = sorted[Math.floor(n * 0.05)] || sorted[0], hi = sorted[Math.ceil(n * 0.95) - 1] || sorted[n - 1];
    var cl = pts.map(function (p) { return Math.max(lo, Math.min(hi, p.v)); });
    var mn = Math.min.apply(null, cl), mx = Math.max.apply(null, cl);
    if (mx === mn) { mx = mx * 2 || 1; mn = 0; }                         // nobody traded: a level line, mid-chart
    var co = cl.map(function (v, i) { return [(i / (n - 1)) * W, HH - PAD - ((v - mn) / (mx - mn)) * (HH - 2 * PAD)]; });
    var ln = 'M' + co.map(function (c) { return c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' L');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + HH);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = '<defs><linearGradient id="gradAptos" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ea6a2c" stop-opacity="0.20"></stop><stop offset="100%" stop-color="#ea6a2c" stop-opacity="0"></stop></linearGradient></defs>'
      + '<path class="lx-carea" fill="url(#gradAptos)" d="' + ln + ' L ' + W + ' ' + HH + ' L 0 ' + HH + ' Z"></path>'
      + '<path class="lx-cline" fill="none" stroke="#ea6a2c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="' + ln + '"></path>';
    var dr = q('.lx-cdates', pc);
    if (!dr) { dr = document.createElement('div'); dr.className = 'lx-cdates'; pc.appendChild(dr); }
    dr.textContent = '';
    for (var k = 0; k < 5; k++) { var s = document.createElement('span'); s.textContent = k === 4 ? 'Today' : axisLbl(pts[Math.round(k / 4 * (n - 1))].t); dr.appendChild(s); }
    pc.classList.add('lxlt');
    chartMsg('');
    pc.__lxpts = pts; pc.__lxco = co;
    hover(pc);
  }
  function hover(pc) {
    ['lx-chtip', 'lx-chdot', 'lx-chvl'].forEach(function (c) { if (!q('.' + c, pc)) { var d = document.createElement('div'); d.className = c; pc.appendChild(d); } });
    if (pc.__lxHoverWired) return;
    pc.__lxHoverWired = 1;
    function move(e) {
      var pts = pc.__lxpts, co = pc.__lxco, svg = q('svg', pc), tip = q('.lx-chtip', pc), dot = q('.lx-chdot', pc), vl = q('.lx-chvl', pc);
      if (!pts || !co || !svg || !tip || !dot || !vl) return;
      var r = svg.getBoundingClientRect(), pr = pc.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, e.clientX - r.left));
      var i = Math.max(0, Math.min(pts.length - 1, Math.round(x / r.width * (pts.length - 1)))), p = pts[i], ox = r.left - pr.left, oy = r.top - pr.top;
      var sx = ox + co[i][0] / 1000 * r.width, sy = oy + co[i][1] / 320 * r.height;
      dot.style.left = sx + 'px'; dot.style.top = sy + 'px'; dot.style.opacity = 1;
      vl.style.left = sx + 'px'; vl.style.top = oy + 'px'; vl.style.height = r.height + 'px'; vl.style.opacity = 1;
      tip.textContent = '';
      var add = function (host, cls, text) { var d = document.createElement('div'); d.className = cls; d.textContent = text; host.appendChild(d); };
      add(tip, 'd', fullDate(p.t)); add(tip, 'l', 'Price'); add(tip, 'p', usd(p.v));
      // Only what the pool's record shows: order-book fills are not in it, so no row is not "none".
      if (p.tr > 0 || p.whole) {
        var a = document.createElement('div'); a.className = 'lxrow'; add(a, 'l', 'Volume'); add(a, 'p', p.tr > 0 ? (p.vol >= 0.01 ? abbrUsd(p.vol) : '<$0.01') : '$0'); tip.appendChild(a);
        var b = document.createElement('div'); b.className = 'lxrow'; add(b, 'l', 'Trades'); add(b, 'p', p.tr.toLocaleString('en-US')); tip.appendChild(b);
      }
      tip.style.opacity = 1;
      var tw = tip.offsetWidth, th = tip.offsetHeight, tx = sx + 14;
      if (tx + tw > pr.width) tx = sx - tw - 14;
      tip.style.left = Math.max(2, tx) + 'px'; tip.style.top = Math.max(2, sy - th - 12) + 'px';
    }
    function leave() { ['lx-chtip', 'lx-chdot', 'lx-chvl'].forEach(function (c) { var el = q('.' + c, pc); if (el) el.style.opacity = 0; }); }
    pc.addEventListener('mousemove', move);
    pc.addEventListener('mouseleave', leave);
    pc.addEventListener('touchmove', function (ev) { var t = ev.touches && ev.touches[0]; if (t) move({ clientX: t.clientX }); }, { passive: true });
    pc.addEventListener('touchstart', function (ev) { var t = ev.touches && ev.touches[0]; if (t) move({ clientX: t.clientX }); }, { passive: true });
  }
  function showChart() {
    var gen = ++chartGen;
    // After the design's own timeframe handler, which redraws its mock into the same box.
    setTimeout(function () {
      if (gen !== chartGen) return;
      var pts = seriesFor(chartTF);
      if (pts.length >= 2) drawChart(pts);
      else { chartBusy(false); chartMsg(TK ? 'No price history yet.' : 'Price history is unavailable right now. Tap a timeframe to try again.'); }
    }, 40);
  }
  function loadHistory(n) {
    n = n || 0;
    Promise.all([
      fetch(IDX + '/prices?ids=' + encodeURIComponent(LUMOS)).then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) throw new Error('down'); return j; }).catch(function () { return null; }),
      fetch(IDX + '/pool?id=' + POOL + '&limit=500').then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) throw new Error('down'); return j; }).catch(function () { return null; })
    ]).then(function (r) {
      if (!r[0]) {                                                       // no snapshots, no NEAR rates: nothing to price with
        if (n < 2) { setTimeout(function () { loadHistory(n + 1); }, [1500, 4000][n]); return; }
        TK = null; showChart(); return;
      }
      rawPx = r[0]; rawPool = r[1];
      TK = buildTicks(rawPx, rawPool);
      paint();
      showChart();
      proveWhole(rawPool);
    });
  }
  function proveWhole(pool) {
    var rows = ((pool && pool.rows) || []).slice().sort(function (a, b) { return a.t - b.t; });
    var C = window.lxnCore;
    if (!rows.length || rows.length >= 500 || rows[0].kind !== 'add' || !C) return;
    C.callView('v2.ref-finance.near', 'get_pool', { pool_id: +POOL }).then(function (live) {
      var ids = (live && live.token_account_ids) || [], R = {}, bad = false;
      ids.forEach(function (t) { R[t] = 0; });
      rows.forEach(function (r) {
        if (bad) return;
        if (r.kind === 'swap') {
          if (R[r.ta] == null || R[r.tb] == null) { bad = true; return; }
          R[r.ta] += Number(r.aa); R[r.tb] -= Number(r.ab);
        } else {
          var tk = (r.extra && r.extra.tokens) || [];
          if (!tk.length) { bad = true; return; }
          tk.forEach(function (x) { if (R[x.t] == null) bad = true; else R[x.t] += (r.kind === 'add' ? 1 : -1) * Number(x.a); });
        }
      });
      if (bad) return;
      var ok = ids.every(function (t, i) {
        var want = Number(live.amounts[i]), got = R[t];
        return want > 0 && Math.abs(got - want) <= want * 1e-9;
      });
      if (!ok) return;
      WHOLE_FROM = rows[0].t;
      showChart();
    }, function () {});
  }
  // Ticks older than the indexer's rates need NEAR's history. Asked only for a range that reaches them.
  function loadOlder() {
    if (CG) return Promise.resolve();
    return fetch('https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=365')
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { CG = (j.prices || []).filter(function (x) { return x && x[1] > 0; }); TK = buildTicks(rawPx, rawPool); })
      .catch(function () {});
  }
  function wireChart() {
    if (chartWired) return;
    var btns = qa('button').filter(function (b) { return /^(1H|24H|7D|30D|1Y|All)$/.test((b.textContent || '').trim()); });
    if (btns.length < 3) return;
    chartWired = true;
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        chartTF = (b.textContent || '').trim();
        chartMsg(''); chartBusy(true);
        if (!TK) { loadHistory(2); return; }
        if (TF[chartTF][1] > 6048e5) loadOlder().then(showChart); else showChart();
      });
    });
  }

  // ---- the Swap popup -------------------------------------------------------------------------------------------
  // swapmodal.js paints it; here only what this page differs in. At rest the rate and details are hidden (lx-nearlumospage
  // -css), as Stellar's; .lxn-amt shows them once From has an amount, because a swap that takes a fee must say so
  // before the press. The dialog's pay-side menu lists wallet.js's holdings, which this page reads itself.
  function wireSwap() {
    var m = q('#modalSwap');
    if (!m || m.__lxnw) return;
    m.__lxnw = 1;
    function sync() {
      var inp = q('.swap-pair .field input', m);
      m.classList.toggle('lxn-amt', !!(inp && +inp.value > 0));
    }
    new MutationObserver(function () {
      sync();
      if (!m.classList.contains('open') || window.__lxnData || m.__lxnHeld) return;
      var who = ''; try { who = (window.lxn && window.lxn.account && window.lxn.account()) || ''; } catch (e) {}
      var C = window.lxnCore;
      if (!who || !C || !C.readHoldings) return;
      m.__lxnHeld = 1;
      C.readHoldings(who).then(function (d) { window.__lxnData = d; }, function () { m.__lxnHeld = 0; });
    }).observe(m, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('input', sync, true);
  }

  // ---- data ---------------------------------------------------------------------------------------------------
  function ask(path, n) {
    // A retry carries its attempt, so a browser-cached failure cannot answer it again.
    return fetch(path + (n ? '&r=' + n : '')).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { if (!j || !j.ok) throw new Error('down'); return j; });
  }
  function retry(fn, n, fail) {
    if (n < 2) setTimeout(function () { fn(n + 1); }, [1500, 4000][n]); else fail();
  }
  function loadToken(n) {
    n = n || 0;
    ask('/lxapi/neartoken?i=' + encodeURIComponent(LUMOS), n).then(function (j) { T = j; tFail = false; paint(); if (TK) showChart(); },
      function () { retry(loadToken, n, function () { tFail = true; paint(); }); });
  }
  function loadHolders(n) {
    n = n || 0;
    ask('/lxapi/nearholders?i=' + encodeURIComponent(LUMOS), n).then(function (j) { H = j; paint(); },
      function () { retry(loadHolders, n, function () { hFail = true; paint(); }); });
  }
  function loadPools(n) {
    n = n || 0;
    ask('/lxapi/nearpools?q=' + encodeURIComponent(LUMOS) + '&full=1', n).then(function (j) { PC = classic(j); pFail = false; paint(); },
      function () { retry(loadPools, n, function () { pFail = true; paint(); }); });
  }
  function loadBook(n) {
    n = n || 0;
    var C = window.lxnCore;
    if (!C || !C.callView) { oFail = true; paint(); return; }
    var ids = [LUMOS, WNEAR].sort().join('|');
    Promise.all(DCL_FEES.map(function (f) { return C.callView(DCL, 'get_pool', { pool_id: ids + '|' + f }); })).then(function (rs) {
      OB = rs; oFail = false; paint();
    }, function () { retry(loadBook, n, function () { oFail = true; paint(); }); });
  }

  // ---- painting -----------------------------------------------------------------------------------------------
  var obs = null, sched = false;
  function watch() { try { if (obs) obs.observe(q('main') || q('.container') || document.body, { childList: true, subtree: true }); } catch (e) {} }
  function paint() {
    if (obs) obs.disconnect();
    [heroOnce, hero, stats, overview, tabs, poolsTable, holders, allocation].forEach(function (f) { try { f(); } catch (e) {} });
    watch();
  }
  function run() {
    try { orderSections(); } catch (e) {}
    try { ecoList(); } catch (e) {}
    wireChart(); wireSwap();
    try { window.lxnSwap.remember(LUMOS, 'LUMOS', DEC, LOGO); } catch (e) {}
    paint();
    chartBusy(true);
    loadToken(); loadHolders(); loadPools(); loadBook(); loadHistory();
    // A gate that never lifts is also a bug: what has no answer by now reads as a dash.
    setTimeout(function () {
      qa('.hero-price-block,.hero-price,.cstat,.lt-cmp-row,.lt-cmp-foot,#poolsBody,.pool-list').forEach(function (e) { e.classList.add('lxlt'); });
      qa('.lt-cmp-foot button,.lt-cmp-foot a').forEach(function (b) { if (!poolsKnown()) setText(b, 'View all pools →'); });
    }, 6000);
    try {
      obs = new MutationObserver(function () { if (sched) return; sched = true; setTimeout(function () { sched = false; paint(); }, 200); });
      watch();
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
