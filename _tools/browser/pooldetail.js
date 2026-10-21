// NEAR pool detail page (/pools/near/id/<Rhea pool id>). PORTED FROM the XRPL fork's
// _tools/browser/pooldetail.js (2026-10-21). The design-handling parts are taken from that file verbatim
// -- the stat cells found by their labels, the phone's "Pool Price" block, the empty-chart note, the
// gates lifted on success AND on failure (liftPage / releaseGates), the mock position cleared before any
// read, both position panels (desktop .mp-* and phone .mpm-*), the deposit card's asset rows -- and their
// dated notes describe the XRP Ledger build where they name it.
//
// WHAT IS NEAR'S: one call, /lxapi/nearpools?id=<pool id> -- the pool's tokens and reserves (Rhea's
// indexer), its fee and kind, liquidity priced from Rhea's own price list, 24h volume and trades
// (DexScreener), fees = volume x fee and APR = fees x 365 / liquidity. All in NEAR, with NEAR's USD price
// in the same response, so every dollar figure is that rate times that figure.
//
// WHAT HAS NO NEAR SOURCE YET, and shows the design's empty state instead of its Aptos mock:
//   Pool Activity chart   no per-pool liquidity history; the plot stays behind the design's own gate
//                         (never lx-chartready) with a one-line note.
//   Pool Transactions     no per-pool activity feed; one empty row / note.
//   Participants          Rhea publishes no LP-holder list; the stat cell shows APR instead.
//   My Position           not read (see browser/mypositions.js); "Connect a wallet" or an em dash.
//   Deposit / Withdraw    no NEAR liquidity signing yet: the form is cleared and disabled with the design's
//                         own lx-dwoff state and a "coming soon" label, written to data-lxorig/data-lxdis
//                         so lx-gate cannot restore an enabled Stellar "Add Liquidity" on connect.
(function () {
  if (window.__lxnPoolDetail) return;
  window.__lxnPoolDetail = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function num(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    // Exact zero, spelled as one. Falling through to toPrecision(4) rendered a real "no fees were
    // collected" as "0.000 XRP", which reads like a truncated number rather than a plain nothing.
    if (v === 0) return '0';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 2 : dp });
    // SUBSCRIPT ZEROS, NOT EXPONENTS (RAZA 2026-09-17: "please change the price to subscript notation instead of 3.092e-7").
    // toPrecision hands back e-notation below 1e-6, which on a price line reads like a broken number rather than a small
    // one. Same form the Trade-Asset page uses: 0.0₆3092.
    if (v < 1e-4) return subZero(v);
    return v.toPrecision(4);
  }

  // 0.0₆3092 — the count of leading zeros written as a subscript, as lumoscore.com prints small prices.
  function subZero(v) {
    var ex = v.toExponential(3).split('e');
    var zeros = -parseInt(ex[1], 10) - 1;
    var m = ex[0].replace('.', '').replace(/0+$/, '');
    if (m.length < 2) m += '0';
    if (!(zeros > 0)) return v.toPrecision(4);
    var SUB = '₀₁₂₃₄₅₆₇₈₉';
    return '0.0' + String(zeros).split('').map(function (ch) { return SUB.charAt(+ch); }).join('') + m;
  }

  function short(a) { return a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  // A token's mark: its own metadata logo (data:/https), NEAR's for wNEAR, the initial when neither
  // loads. Painted as an <img>, which is the one child the logo healer leaves alone.
  var NEAR_LOGO = '/assets/networks/near.png';
  function tokImg(host, s) {
    if (!host || !s) return;
    try {
      host.removeAttribute('data-logo');
      host.removeAttribute('style');
      host.setAttribute('data-logoed', '1');
      host.setAttribute('data-lxfixed', '1');
    } catch (e) {}
    host.textContent = '';
    function initial() { host.textContent = String(s.name || '?').charAt(0).toUpperCase(); }
    if (!/^(data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]|https:\/\/|\/assets\/)/i.test(s.logo || '')) { initial(); return; }
    var im = document.createElement('img');
    im.className = 'lx-tokimg';
    im.alt = '';
    im.src = s.logo;
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
    im.onerror = function () { im.remove(); initial(); };
    host.appendChild(im);
  }
  // NEAR's USD price, set from the same response as the pool. Null until then; a null rate prints no
  // dollar line rather than a converted guess.
  var USD = null;
  function usdShort(v) {
    if (!(v > 0)) return '';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(2);
  }
  // "6.479M SHX" with the unit in the design's own smaller `.lx-unit` span, as Stellar writes it.
  function unitVal(v, text, unit) {
    if (!v) return;
    v.textContent = text + (unit ? ' ' : '');
    if (unit) { var u = el('span', 'lx-unit', unit); u.setAttribute('data-logoed', '1'); v.appendChild(u); }
  }
  function statCell(match) {
    var cells = $$('.ph-stat');
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.l');
      if (l && l.textContent.trim().toLowerCase().indexOf(match) >= 0) return cells[i];
    }
    return null;
  }

  // /pools/near/id/<id> -- the route the Pools table links to. The phone file and a direct visit to the
  // page file can carry it as ?pool= or ?id= instead.
  function fromUrl() {
    try {
      var sp = new URLSearchParams(window.location.search);
      var q = sp.get('pool') || sp.get('id');
      if (q && /^\d{1,9}$/.test(q)) return q;
    } catch (e) {}
    var m = window.location.pathname.match(/\/pools\/near\/id\/(\d{1,9})\/?$/);
    return m ? m[1] : null;
  }

  // The phone has no `.ph-price` wrapper — the figure sits in a block whose heading reads "Pool
  // Price". Found by that heading rather than by a class, because the class is `.value`, which is
  // far too common to select on directly.
  function priceBlock(which) {
    var sel = which === 'value' ? '.value' : '.sub, .s';
    var labels = $$('div, span, h3, h4');
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || '').trim();
      if (t.length > 40 || !/^pool price/i.test(t)) continue;
      // Climb from the label until an ancestor actually holds the figure. `closest('div')` was
      // wrong: on a label that is itself a div it returns that same element, which contains only
      // the words "Pool Price" — so the lookup found nothing and the mock stood.
      for (var n = labels[i]; n && n !== document.body; n = n.parentElement) {
        var found = n.querySelector(sel);
        if (found) return found;
      }
    }
    return null;
  }

  function setStat(match, value, sub) {
    var cells = $$('.ph-stat');
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.l');
      if (!l || l.textContent.trim().toLowerCase().indexOf(match) < 0) continue;
      var v = cells[i].querySelector('.v');
      if (v) v.textContent = value;
      var s = cells[i].querySelector('.s');
      if (s) s.textContent = sub == null ? '' : sub;
      return true;
    }
    return false;
  }

  // Emptied BEFORE the request goes out, never only on success. The mock is already on screen, so
  // "leave it alone if the fetch fails" leaves the invented year of history exactly where it was —
  // the failure path has to remove it, not decline to replace it.
  // SAY WHY THE CHART IS EMPTY.
  //
  // loadChart returns without drawing when the pair has fewer than two points — correct, half a
  // chart is worse than none — but clearChart has already blanked the paths and set every label to
  // an em dash, so the result was a blank rectangle with no explanation. On a big pair like
  // XRP/RLUSD the chart draws and nothing looks wrong; on a thin pool like XRP/Laugh there is no
  // history at all, and that is the page RAZA opened. An empty panel reads as broken.
  function chartNote(text) {
    var wrap = $('.chart-svg-wrap');
    if (!wrap) return;
    var n = wrap.querySelector('.lxx-chart-note');
    if (!text) { if (n) n.remove(); return; }
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    if (!n) {
      n = document.createElement('div');
      n.className = 'lxx-chart-note';
      n.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
        + 'justify-content:center;text-align:center;padding:0 18px;font-size:13.5px;opacity:.6;'
        + 'pointer-events:none';
      wrap.appendChild(n);
    }
    n.textContent = text;
    // NOT lx-chartready here (the XRPL build adds it). Nothing real is drawn on NEAR, so the design's
    // mock line, bars and axis labels stay behind its own gate and only this note shows.
  }

  function clearChart() {
    chartNote('');                                     // a stale note must not outlive a redraw
    var wrap = $('.chart-svg-wrap');
    var svg = wrap && wrap.querySelector('svg');
    if (!svg) return;
    [].forEach.call(svg.querySelectorAll('path'), function (p) { p.setAttribute('d', ''); });
    [].slice.call(svg.querySelectorAll('.lx-chvol')).forEach(function (r) { r.parentNode.removeChild(r); });
    var hh = document.getElementById('tvlChart') || wrap;
    if (hh) hh.__lxnHov = null;
    var dot = svg.querySelector('circle');
    if (dot) dot.setAttribute('r', '0');
    [].forEach.call(svg.querySelectorAll('text'), function (t) { t.textContent = '—'; });
  }

  // The chart's own controls (range, line/bar, TVL/volume) are claimed at window capture and do
  // nothing: the design's handlers would redraw its mock series, and there is no NEAR history to switch
  // between. The note stays as the one honest statement.
  if (!window.__lxnChartModes) {
    window.__lxnChartModes = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || !$('.pool-header')) return;
      if (!t.closest('.tf-mini button, .chart-type button, .chart-mode-menu button, .chart-mode-select')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  // ---- Pool Transactions: the empty state ------------------------------------------------------------
  // Desktop is table.tx (non-.lx-txrow rows are hidden by the inherited sheet); the phone is a list of
  // .tx-item divs in its Transactions tab with NO gate, so the eight mock Aptos items are removed here.
  function emptyTx(msg) {
    var card = $('.tx-card'), body = card && card.querySelector('table.tx tbody');
    if (body) {
      body.innerHTML = '';
      var tr = document.createElement('tr');
      tr.className = 'lx-txrow';
      var td = el('td', null, msg);
      td.colSpan = 6;
      td.style.cssText = 'padding:22px 12px;text-align:center;opacity:.7';
      tr.appendChild(td);
      body.appendChild(tr);
      var foot = card.querySelector('.tx-foot');
      if (foot) {
        if (foot.firstElementChild) foot.firstElementChild.textContent = 'Showing 0 transactions';
        [].forEach.call(foot.querySelectorAll('.controls button'), function (b) { b.disabled = true; });
      }
    }
    var items = $$('.tx-item');
    var box = items.length ? items[0].parentNode : (($('.tx-filter-m') || {}).parentNode || null);
    items.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    if (box && !box.querySelector('.lxn-txnote')) {
      var d = el('div', 'lxn-txnote', msg);
      d.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
      box.appendChild(d);
    }
  }
  if (!window.__lxnTxFilters) {
    window.__lxnTxFilters = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.tx-filter button, .tx-filter-m button');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      [].forEach.call(b.parentNode.querySelectorAll('button'), function (x) { x.classList.toggle('active', x === b); });
    }, true);
  }

  // ---- Participants: the empty state ------------------------------------------------------------------
  // The pill (desktop .side-head, phone .card-head) and the desktop foot. The foot is hidden by the
  // inherited sheet until .lx-partfoot vouches for its figures; it says nothing is listed.
  function emptyParticipants(msg) {
    participants(msg);
    $$('.count-pill').forEach(function (pl) {
      var card = pl.closest('.side-card, .card');
      if (card && (card.querySelector('#partList') || card.querySelector('#participantsList'))) pl.textContent = '—';
    });
    var foot = $('.part-foot');
    if (foot) {
      foot.classList.add('lx-partfoot');
      if (foot.firstElementChild) foot.firstElementChild.textContent = 'Viewing 0 of 0';
      [].forEach.call(foot.querySelectorAll('.nav button'), function (b) { b.disabled = true; });
    }
  }

  var KIND = { SIMPLE_POOL: 'Classic pool', STABLE_SWAP: 'Stable pool', RATED_SWAP: 'Rated stable pool', DEGEN_SWAP: 'Degen pool' };
  function pct(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v > 0 && v < 0.01) return '<0.01%';
    return v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + '%';
  }
  function feeText(f) { return f == null || !isFinite(f) ? '—' : (+f).toLocaleString('en-US', { maximumFractionDigits: 3 }) + '%'; }

  function paint(id, row) {
    var T = (row.tokens || []).map(function (t) {
      return { name: String(t.s || '?'), i: t.i, logo: t.logo || (t.i === 'wrap.near' ? NEAR_LOGO : ''), amount: t.v };
    });
    if (T.length < 2) { fail('This pool has no readable reserves.', 'Could not load this pool'); return; }
    var a = T[0], b = T[1];
    var pair = T.map(function (t) { return t.name; }).join(' / ');

    $$('.ph-icons').forEach(function (icons) {
      tokImg(icons.querySelector('.pa'), a);
      tokImg(icons.querySelector('.pb'), b);
    });
    // Every token named, each a link to its Trade page. A stable pool holds three or four; the design's
    // two discs show the first two, the name lists them all.
    $$('.ph-name').forEach(function (nameEl) {
      nameEl.textContent = '';
      nameEl.setAttribute('data-lxpair', pair);
      T.forEach(function (s, k) {
        if (k) nameEl.appendChild(el('span', 'lx-phsep', ' / '));
        var lk = el('a', 'lx-phlink', s.name);
        lk.href = '/trade/near/' + encodeURIComponent(s.i);
        nameEl.appendChild(lk);
      });
    });
    try { document.title = pair + ' liquidity pool on NEAR | LumosCore'; } catch (e) {}
    $$('.crumb a[data-lxback]').forEach(function (bk) { bk.setAttribute('href', '/pools/near'); });

    // The pool's identity line: its Rhea id (what the copy button copies), its kind and its fee.
    var idSpan = $('.ph-id span');
    if (idSpan) idSpan.textContent = 'Pool ID: ' + id + ' · ' + (KIND[row.kind] || 'Pool') + ' · ' + feeText(row.fee) + ' fee';
    var copyBtn = $('.ph-id button[data-copy]');
    if (copyBtn) {
      copyBtn.setAttribute('data-copy', id);
      copyBtn.setAttribute('data-copy-label', 'Pool ID');
    }
    // The explorer button opens the pool's DexScreener page -- the one public page per Rhea pool this
    // build already reads (it is where the 24h volume comes from). A pool DexScreener does not carry has
    // no such page, so the button is disabled rather than pointed at a guess.
    var exp = $('.ph-id button[data-tooltip="View on Explorer"]') || $('.ph-id button:not([data-copy])');
    if (exp && exp.parentNode) {
      if (row.vol != null) {
        var ea = document.createElement('a');
        ea.href = 'https://dexscreener.com/near/refv1-' + encodeURIComponent(id);
        ea.target = '_blank';
        ea.rel = 'noopener nofollow';
        ea.title = 'View on DexScreener';
        ea.setAttribute('aria-label', 'View pool on DexScreener');
        ea.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;color:inherit;text-decoration:none';
        while (exp.firstChild) ea.appendChild(exp.firstChild);
        exp.parentNode.replaceChild(ea, exp);
      } else {
        exp.disabled = true;
        exp.title = 'No explorer page for this pool';
        exp.style.opacity = '.4';
        exp.style.cursor = 'default';
      }
    }

    // POOL PRICE: the reserve ratio, which IS the price only in a classic (constant-product) pool.
    // Quoted in wNEAR where one side is wNEAR, as the rest of the site denominates; otherwise the second
    // token per the first. A stable / rated / degen pool prices on its own curve, not the ratio, so no
    // figure is stated there rather than a wrong one.
    var price = null, quote = null, base = null;
    if (row.kind === 'SIMPLE_POOL' && T.length === 2) {
      var nearSide = a.i === 'wrap.near' ? a : (b.i === 'wrap.near' ? b : null);
      quote = nearSide || b; base = nearSide ? (nearSide === a ? b : a) : a;
      if (base.amount > 0 && quote.amount != null) price = quote.amount / base.amount;
    }
    var pv = $('.ph-price .v') || $('.ph-price .value');
    if (!pv) pv = priceBlock('value');
    if (pv) pv.textContent = price != null ? (num(price, 6) + ' ' + quote.name) : '—';
    // The phone's sub-line is .ph-price-row .vs, which neither the desktop selectors nor priceBlock('sub')
    // reach -- found on the phone check, where the price stood with no 'per USDC' under it.
    var ps = $('.ph-price .s') || $('.ph-price .sub') || $('.ph-price-row .vs');
    if (!ps) ps = priceBlock('sub');
    if (ps) ps.textContent = price != null ? (' per ' + base.name) : '';

    // LIQUIDITY: every reserve, the first as the headline and the rest beneath it in the same weight
    // (Stellar's two-sided cell), then the pool's dollar value from the endpoint's own liquidity figure.
    var liq = statCell('liquidity');
    if (liq && liq.querySelector('.v')) {
      unitVal(liq.querySelector('.v'), num(a.amount, 2), a.name);
      var ls = liq.querySelector('.s');
      if (ls) {
        ls.textContent = '';
        T.slice(1).forEach(function (t) {
          var big2 = el('span');
          big2.style.cssText = 'font-size:clamp(15px,1.35vw,18px);font-weight:800;letter-spacing:-.2px;color:var(--text);display:block';
          big2.appendChild(document.createTextNode(num(t.amount, 2) + ' '));
          var u2 = el('span', null, t.name);
          u2.setAttribute('data-logoed', '1');
          u2.style.cssText = 'font-size:.7em;font-weight:700;opacity:.6;margin-left:3px;letter-spacing:0';
          big2.appendChild(u2);
          ls.appendChild(big2);
        });
        var usdLine = el('span', null, (USD && row.liq != null) ? (usdShort(row.liq * USD) + ' · ' + num(row.liq, 0) + ' NEAR') : '');
        usdLine.style.cssText = 'font-size:11.5px;color:var(--text-muted);display:block;margin-top:2px';
        ls.appendChild(usdLine);
      }
    }

    // 24h VOLUME and FEES, in NEAR with the dollar line beneath, as Stellar's two cells read. Null means
    // DexScreener does not carry this pool: an em dash and why, never a zero.
    [['vol', row.vol], ['fees', row.fees]].forEach(function (x) {
      var cell = statCell(x[0]);
      if (!cell) return;
      var s = cell.querySelector('.s');
      if (x[1] == null || !isFinite(x[1])) {
        var v0 = cell.querySelector('.v');
        if (v0) v0.textContent = '—';
        if (s) s.textContent = 'no 24h data';           // short: the four cells share one row and .s is nowrap
        return;
      }
      unitVal(cell.querySelector('.v'), num(x[1], 2), 'NEAR');
      if (s) s.textContent = (USD && x[1] > 0) ? ('≈ ' + usdShort(x[1] * USD)) : '';
    });

    // THE FOURTH STAT IS APR, as the Pools table's sixth column: Rhea publishes no LP-holder count, and
    // APR is the figure this pool does have. The cell's label is relabelled; nothing is added.
    var ap = $('.ph-stat.lx-partstat') || statCell('participant');
    if (ap) {
      var lab = ap.querySelector('.l');
      if (lab) lab.textContent = 'APR';
      var av = ap.querySelector('.v');
      if (av) av.textContent = pct(row.apr);
      var as = ap.querySelector('.s');
      if (as) as.textContent = row.apr != null ? 'from 24h fees' : 'no 24h data';
    }

    window.__lxnPool = { id: id, a: a, b: b, tokens: T, fee: row.fee, kind: row.kind };
    paintDwStatic();
    paintPositionIdentity();
    holdDw();
    chartNote('Pool history is not available on NEAR yet.');
    emptyTx('Pool transactions are not available on NEAR yet.');
    emptyParticipants('Liquidity providers are not listed on NEAR yet.');
    liftPage();
  }

  // THE POSITION PANEL'S TWO ASSETS, WHATEVER THE CONNECTION. The design ships LUMOS and APT marks and
  // names there (RAZA 2026-09-15: "why's it showing APTOS logo"), and only a connected wallet's position
  // ever repainted the names — never the marks.
  function paintPositionIdentity() {
    var p = window.__lxnPool;
    if (!p) return;
    $$('.my-position .mp-asset, .my-position-m .mpm-asset').forEach(function (row, i) {
      var s = (i % 2 === 0) ? p.a : p.b;
      tokImg(row.querySelector('.mp-asset-ico, .mpm-asset-ico'), s);
      var nm = row.querySelector('.mp-asset-name, .mpm-asset-name');
      if (nm) { nm.setAttribute('data-logoed', '1'); nm.textContent = s.name; }
      var amtEl = row.querySelector('.mp-asset-amt, .mpm-asset-amt');
      if (amtEl) amtEl.textContent = '—';            // not read on NEAR yet
    });
    bothPos('fee-val').forEach(function (v) { v.textContent = '—'; });
  }

  // THE WHOLE PAGE WAS INVISIBLE, and every DOM check said it was fine.
  //
  // The inherited lx-amm stylesheet gates the page on a class its own layer used to set:
  //     html:not(.lx-ammready) .pool-header, html:not(.lx-ammready) .pool-layout { visibility: hidden }
  // so the header, the stats, the chart, the deposit card — 948px of correct, real, freshly painted
  // content — sat at visibility:hidden. Reading .ph-name returned "XRP / RLUSD", every stat read
  // correctly, and the page was blank. I had already called this page "working" on the strength of
  // exactly those reads; only a screenshot showed the truth.
  //
  // Called from paint(), NOT from loadPosition(): the position load returns early when no wallet is
  // connected, so lifting there left the page permanently blank for anyone signed out — which is
  // most visitors, and the one case least likely to be noticed while testing signed in.
  function liftPage() {
    try {
      document.documentElement.classList.add('lx-ammready');   // header + layout
      document.documentElement.classList.add('lx-detpr');      // names, stats, price, my-position
    } catch (e) {}
  }

  // The NEAR session as lx-nearconnect states it: an account only when lumos.chain is near, so a Stellar
  // G... address left in storage by another build never reads as connected here.
  function addr() {
    try { if (window.lxn && window.lxn.account) return window.lxn.account() || ''; } catch (e) {}
    try { return localStorage.getItem('lumos.chain') === 'near' ? (localStorage.getItem('lumos.address') || '') : ''; } catch (e) { return ''; }
  }

  // The figure beside a "You receive" asset: the row's last child that is not the asset label itself.
  function recvOut(row) {
    var kids = [].filter.call(row.children, function (c) { return !(c.classList && c.classList.contains('asset')); });
    return kids.length ? kids[kids.length - 1] : null;
  }

  // Everything on this card that the design baked with Aptos values and does not depend on a balance.
  function paintDwStatic() {
    var p = window.__lxnPool;
    if (!p) return;

    // THE ASSET ROWS WERE HIDDEN, NOT MISSING (RAZA 2026-09-15: "Logos are missing"). The inherited sheet
    // hides `.dw-field .row .asset:not([data-lxpair])` until a data layer vouches for it; Stellar's sets
    // data-lxpair and puts the token's own image in `.ico`. Both are done here.
    var fields = $$('#dwDeposit .dw-field');
    [p.a, p.b].forEach(function (s, i) {
      var f = fields[i];
      if (!f) return;
      var asset = f.querySelector('.asset');
      if (asset) {
        asset.setAttribute('data-lxpair', '1');
        tokImg(asset.querySelector('.ico'), s);
        var wrote = false;
        [].forEach.call(asset.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) { nd.nodeValue = ' ' + s.name + ' '; wrote = true; }
        });
        if (!wrote) asset.appendChild(document.createTextNode(' ' + s.name + ' '));
      }
    });

    var wf = $('#dwWithdraw .dw-field .asset');
    if (wf) {
      wf.setAttribute('data-lxpair', '1');
      tokImg(wf.querySelector('.ico'), p.b.i === 'wrap.near' ? p.a : p.b);
      [].forEach.call(wf.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = p.tokens.map(function (t) { return t.name; }).join(' / ');
      });
    }
    // The two "You receive" rows on the withdraw side name the pool's assets.
    var recv = $$('#dwWithdraw .dw-field')[1];
    if (recv) {
      var rows = recv.querySelectorAll('.row');
      [p.a, p.b].forEach(function (s, i) {
        if (!rows[i]) return;
        var as = rows[i].querySelector('.asset');
        if (!as) return;
        as.setAttribute('data-lxpair', '1');
        tokImg(as.querySelector('.ico'), s);
        [].forEach.call(as.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = s.name;
        });
        // The amount beside it shipped as the design's "620.30" / "1,860.90" (RAZA 2026-09-15: "I dont have any
        // liquidity in this pool … i think its a placeholder"). Nothing comes back until an LP amount is typed.
        var lpIn = dwInputs().lp, out = recvOut(rows[i]);
        if (out && !(lpIn && parseFloat(String(lpIn.value).replace(/,/g, '')) > 0)) out.textContent = '0';
      });
    }

    // The fee-tier row is the design's own and NEAR's pools each carry one, so it is filled rather than
    // hidden; share-after and network fee have nothing to compute from until the form can be used.
    setSummary('trading fee', feeText(p.fee));
    setSummary('pool share', '—');
    setSummary('network fee', '—');
  }

  function setSummary(match, value) {
    $$('.dw-summary .r').forEach(function (r) {
      var k = r.querySelector('span');
      if (!k || (k.textContent || '').toLowerCase().indexOf(match) < 0) return;
      var v = r.querySelector('strong');
      if (v) v.textContent = value;
    });
  }

  function dwInputs() {
    return {
      a: $('#dwDeposit .dw-field:nth-of-type(1) input') || $$('#dwDeposit input')[0],
      b: $$('#dwDeposit input')[1],
      lp: $('#dwWithdraw input')
    };
  }

  // ---- Deposit / Withdraw: the design's disabled state ------------------------------------------------
  // Balances are not read and nothing can be signed yet, so: the baked "Balance: 25,420.18" / "Your LP:
  // 1,240.55" become em dashes (and the design's lx-dwready gate is lifted on them), the inputs, MAX and
  // percentage buttons are inert, and the CTA takes the design's own .lx-dwoff state with a label saying
  // why. The Deposit/Withdraw tabs still switch, as the design's card does, so both halves can be seen.
  var DW_LABEL = { deposit: 'Adding liquidity on NEAR is coming soon', withdraw: 'Removing liquidity on NEAR is coming soon' };
  function dwMode() {
    var t = $('.dw-tabs button.active');
    return (t && t.getAttribute('data-dw')) === 'withdraw' ? 'withdraw' : 'deposit';
  }
  function holdDw() {
    $$('#dwDeposit .balance').forEach(function (b) { b.textContent = 'Balance: —'; });
    $$('#dwWithdraw .balance').forEach(function (b) { b.textContent = 'Your LP: —'; });
    try { document.documentElement.classList.add('lx-dwready'); } catch (e) {}
    $$('#dwDeposit input, #dwWithdraw input').forEach(function (i) {
      i.value = '';
      i.disabled = true;
      i.setAttribute('aria-disabled', 'true');
    });
    $$('#dwDeposit .max-btn, #dwWithdraw .dw-pct-b').forEach(function (b) {
      b.style.pointerEvents = 'none';
      b.style.opacity = '.45';
      b.setAttribute('aria-disabled', 'true');
      if (b.tagName === 'BUTTON') b.disabled = true;
    });
    $$('.dw-cta').forEach(function (b) {
      var t = DW_LABEL[dwMode()];
      // lx-gate swaps this button to "Connect wallet" while no wallet is connected and, on connect,
      // RESTORES what it saved in data-lxorig / data-lxdis. Writing both means the restore lands on this
      // disabled label rather than the design's enabled "Add Liquidity".
      b.setAttribute('data-lxorig', t);
      b.setAttribute('data-lxdis', '1');
      // While lx-gate shows "Connect wallet" the button is the gate's and must stay pressable: .lx-dwoff
      // is pointer-events:none, which made it a dead control on the first check (2026-10-21). Connecting
      // reloads the page, and this runs again with the wallet present.
      if ((b.textContent || '').trim() === 'Connect wallet') { b.classList.remove('lx-dwoff'); return; }
      b.classList.add('lx-dwoff');
      b.setAttribute('aria-disabled', 'true');
      b.disabled = true;
      b.title = t;
      var wrote = false;
      [].forEach.call(b.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) { nd.nodeValue = ' ' + t + ' '; wrote = true; }
      });
      if (!wrote) b.appendChild(document.createTextNode(' ' + t + ' '));
    });
  }
  function wireDwTabs() {
    if (window.__lxnDwTabs) return;
    window.__lxnDwTabs = 1;
    $$('.dw-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.dw-tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
        var w = b.getAttribute('data-dw') === 'withdraw';
        var d = $('#dwDeposit'), wd = $('#dwWithdraw');
        if (d) d.style.display = w ? 'none' : '';
        if (wd) wd.style.display = w ? '' : 'none';
        holdDw();
      });
    });
  }

  // THE DESIGN'S POSITION IS A FABRICATED ONE, AND IT WAS SHOWING TO SIGNED-OUT VISITORS.
  //
  // The panel ships baked values: "Position Value $1,247.50" in `.mp-amount` and
  // "▲ $32.18 (2.65%) · all time" in `.mp-pnl`. Two separate holes let them through:
  //
  //   1. loadPosition() returns early when there is no wallet, so on a signed-out page NOTHING ran
  //      and the whole invented position stayed on screen — a $1,247.50 holding shown to someone
  //      who is not even connected.
  //   2. paintMyPosition() overwrites `.mp-amount` but never touched `.mp-pnl`, so even connected
  //      with no position the page read "No position" beside "▲ $32.18 (2.65%) · all time" — which
  //      is how RAZA found it.
  //
  // Cleared UNCONDITIONALLY and BEFORE any wallet check or fetch, which is the only ordering that
  // closes both: the mock must not survive a missing wallet, a failed request, or an early return.
  // The same reason the pool chart is cleared before its fetch rather than on success.
  // THE PHONE HAS ITS OWN POSITION PANEL, with its own class family, and it kept the whole mock.
  //
  // Desktop is `.my-position` / `.mp-*`; the phone is `.my-position-m` / `.mpm-*`. Every selector
  // here named only the first, so at 375px the panel still read:
  //     Position Value 0.18%  $1,247.50  ▲ $32.18 (2.65%) · all time
  //     LUMOS 874,521   APT 623.40   Earned fees +$8.92   LP tokens 23,415.82
  // on a pool where nothing is held, with another chain's asset in it.
  //
  // NOTE THIS IS NOT THE PREFIX RELATIONSHIP dexasset.js could exploit: "mpm-amount" does not
  // contain "mp-amount", so `[class*="mp-amount"]` would miss it entirely. Each family has to be
  // named, which is precisely why one of them was forgotten.
  function bothPos(desktopSuffix, phoneSuffix) {
    return $$('.my-position .mp-' + desktopSuffix + ', .my-position-m .mpm-' + (phoneSuffix || desktopSuffix));
  }

  function clearMockPosition() {
    var connected = addr();
    bothPos('amount').forEach(function (a) {
      // Connected, the position is simply not read yet on NEAR -- "No position" would be a claim.
      a.textContent = connected ? '—' : 'Connect a wallet';
    });

    // Replaced wholesale: the "· all time" is a bare text node beside the span, so blanking only
    // the span would leave the page reading "— · all time".
    bothPos('pnl').forEach(function (p) { p.textContent = '—'; });
    // The phone puts the delta straight into .pnl-up/.pnl-down with no .mpm-pnl wrapper.
    $$('.my-position-m .pnl-up, .my-position-m .pnl-down').forEach(function (p) { p.textContent = '—'; });

    $$('.position-share-pill, .my-position-m .mpm-share').forEach(function (s) { s.textContent = '—'; });

    // Amounts, fees and the asset tickers. The tickers matter as much as the numbers: leaving them
    // is how "APT" ends up labelling a row on an XRP Ledger pool.
    $$('.my-position-m .mpm-asset-amt, .my-position-m .mpm-fee-val').forEach(function (v) {
      v.textContent = '—';
    });
    $$('.my-position-m .mpm-asset-name').forEach(function (n) { n.textContent = '—'; });
    // THE DESKTOP CARD WAS MISSING FROM THIS LIST, and only the phone's tickers were being cleared — so a pool that failed to
    // load still showed "APT" against a position on an XRP Ledger pool. Found on the failure page 2026-09-16.
    $$('.mp-asset-amt, .mp-fee-val').forEach(function (v) { v.textContent = '—'; });
    $$('.mp-asset-name').forEach(function (n) { n.setAttribute('data-logoed', '1'); n.textContent = '—'; });
  }

  // The participant list was 25 invented rows. Who holds an LP token is not something a public node
  // will enumerate, so the honest answer is the count and a note -- not 25 plausible addresses.
  function participants(text) {
    ['#partList', '#participantsList'].forEach(function (sel) {
      var host = $(sel);
      if (!host) return;
      host.innerHTML = '';
      var d = el('div', 'acc-empty lx-partrow', text);
      d.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
      host.appendChild(d);
    });
  }

  // THE LOADING STATE SHOWS DASHES, NOT ANOTHER CHAIN'S NUMBERS.
  //
  // releaseGates() is called FIRST in load(), deliberately — a page that waits behind its own
  // fade-in gate reads as broken, and that was fixed once already. But lifting the gate before the
  // ledger answers reveals whatever the design shipped underneath, and what it ships is Aptos sample
  // data: "0.000713 APT" as the price, "3,420,180 APT" liquidity, "8,420 APT" volume, "42.10 APT"
  // fees. RAZA on 2026-09-29: "There's a flash bug on XRPL - pools page, when refreshed it shows APT".
  //
  // So the trade was a blank page for a page confidently showing the wrong chain's figures, which is
  // worse. The stats are blanked at the same moment the name becomes "Reading the XRP Ledger…", so
  // the two agree: the page says it is reading, and shows nothing it has not read.
  function clearMockStats() {
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = '—';
    var ps = $('.ph-price .s');
    if (ps) ps.textContent = '';
    setStat('liquidity', '—', '');
    setStat('vol', '—', '');
    setStat('fees', '—', '');
    setStat('participant', '—', '');
    clearChart();
  }

  // `headline` is what the page CLAIMS, and it is separate from `msg` because the two were saying
  // different things at once. The header read "Pool not found" — an assertion that the pool does not
  // exist — while the card right under it read "Could not read the pool", which was the truth. A read
  // that failed must not report the thing missing; only the ledger answering actNotFound may do that.
  function fail(msg, headline) {
    // THE MESSAGE HAS TO BE VISIBLE (RAZA 2026-09-16: "[still happening. What the hell. FIX IT ALREADY] Sometimes Pools-pool
    // page is taking forever to load. But when i refresh, it loads up"). THIS IS THE CAUSE: liftPage() — which lifts the
    // design's `html:not(.lx-ammready) .pool-header{visibility:hidden}` gate — was only ever called from paint(), the success
    // path. One dropped read from the public node therefore left the ENTIRE page blank with no error on it, and a refresh
    // (a second, luckier read) "fixed" it. The gate is now lifted on the way out as well, so a failure says so.
    liftPage();
    releaseGates();
    var name = $('.ph-name');
    if (name) name.textContent = headline || 'Could not load this pool';
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = '—';
    var ps = $('.ph-price .s');
    if (ps) ps.textContent = msg;
    setStat('liquidity', '—', '');
    setStat('vol', '—', '');
    setStat('fees', '—', '');
    setStat('participant', '—', '');
    emptyParticipants(msg);
    emptyTx('No transactions to show.');
    holdDw();
    // The design ships this page filled with another chain's sample data, and the success path is what normally overwrites
    // it. Without this, a pool that could not be read showed "3.19M APT" across the chart and a table of invented trades
    // under the words "Pool not found". Cleared HERE as well as in load(): the design paints its own card after that early
    // pass, so "LUMOS / APT" came back while the ledger read was still in flight.
    clearChart();
    clearMockPosition();
    var txBody = $('.tx-card') && $('.tx-card').querySelector('table.tx tbody');
    if (txBody) {
      txBody.innerHTML = '';
      var tr = document.createElement('tr');
      tr.className = 'lx-txrow';
      var td = el('td', null, 'No transactions to show.');
      td.colSpan = 6;
      td.style.cssText = 'padding:22px 12px;text-align:center;opacity:.7';
      tr.appendChild(td);
      txBody.appendChild(tr);
    }
  }

  // The design's fade-in gate holds these at opacity 0 until something marks them done; nothing else ever does on this page.
  function releaseGates() {
    liftPage();                                          // the html-level gate, lifted whatever else happens
    [].forEach.call(document.querySelectorAll('.pool-layout, .pool-header, [data-lcmu]'), function (n) {
      n.setAttribute('data-lcm-done', '1'); n.classList.add('lcm-on'); n.classList.add('lcmu-in');
      n.style.setProperty('opacity', '1', 'important');
    });
  }

  function load() {
    // Cleared before the gates come off, and the gates come off first whatever happens next -- see the
    // XRPL notes on clearMockStats and releaseGates above.
    clearMockStats();
    releaseGates();
    if (!$('.pool-header')) {
      var n = (load.tries = (load.tries || 0) + 1);
      if (/\/pools\/near\/id\//.test(window.location.pathname) && n < 120) setTimeout(load, n < 40 ? 250 : 1000);
      return;
    }

    var id = fromUrl();
    if (!id) { fail('No pool in this address.', 'Pool not found'); return; }

    var name = $('.ph-name');
    if (name) name.textContent = 'Reading the pool…';
    clearMockStats();
    clearMockPosition();
    wireDwTabs();
    holdDw();
    releaseGates();

    // A RENDER FAULT IS NOT A MISSING POOL (the XRPL lesson of 2026-10-08): the error handler is the
    // second argument of then(), so it sees only a failed read; a throw while painting a pool that was
    // read fine is logged and parked on window, and whatever drew stays.
    function renderFailed(e) {
      try { window.__lxPoolRenderError = { message: String(e && e.message || e), stack: String(e && e.stack || '') }; } catch (_) {}
      if (window.console && window.console.error) window.console.error('[lx near pooldetail] the pool read fine; drawing it threw', e);
    }
    fetch('/lxapi/nearpools?id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // HTTP 200 with {ok:false} is the endpoint saying its sources are down: "could not read", never
        // "not found". Only an answered, empty list means this pool is not one LumosCore lists.
        if (!d || !d.ok) { fail('Could not read the pool. Reload in a moment.', 'Could not load this pool'); return; }
        var row = (d.rows || [])[0];
        if (!row || String(row.id) !== String(id)) {
          fail('LumosCore lists Rhea pools whose tokens are all curated; this one is not among them.', 'Pool not listed');
          return;
        }
        USD = (+d.usd > 0) ? +d.usd : null;
        try { paint(id, row); } catch (e) { renderFailed(e); }
      }, function () {
        fail('Could not read the pool. Reload in a moment.', 'Could not load this pool');
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxnPoolDetailReload = load;
})();
