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

  // The chart's own controls (range, line/bar, price/volume) now drive the real series: wireChartControls
  // below. The blocker that used to swallow them here (when there was no NEAR history) is gone -- it ran first
  // and would have stopped the real handler too.

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
  // The filters are wired with the swaps list (wireTx below).

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

  // ==== THE POOL'S LIVE HALF (RAZA 2026-10-30: "nothing on pools-pool page is being shown") ===============
  //
  // Phase 1 left five parts of this page as empty states. They are filled now, each from the one source that
  // has it, all asked by the page (GeckoTerminal refuses Cloudflare, as on the token page):
  //   24h stats     DexScreener (the endpoint) where it lists the pool, else GeckoTerminal's pool record --
  //                 which also says when a pool genuinely had no trades, so a dead pool reads 0, not "—".
  //   Pool Activity GeckoTerminal OHLCV for this pool: the price of one side in the other, with volume under
  //                 it, per range. NOT the pool's TVL over time, which nothing publishes for NEAR pools, so the
  //                 design's "Pool TVL" choice is relabelled "Price" rather than drawn from a guess.
  //   Transactions  GeckoTerminal's latest trades on this pool -- SWAPS. Deposits and withdrawals have no NEAR
  //                 source (Rhea's indexer stopped in Dec 2024), and their filters say so.
  //   My Position   Rhea itself: get_pool_shares and the pool's shares_total_supply, read when a wallet is set.
  //   Balances      each token's ft_balance_of (NEAR's own balance for the wNEAR side, which a deposit wraps).
  // XRPL's drawing code is reused as it stands there (same design, same SVG); only the series differ.
  var GT = 'https://api.geckoterminal.com/api/v2/networks/near/pools/';
  var NSVG = 'http://www.w3.org/2000/svg';
  var RPC = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
  function gtId(id) { return 'refv1-' + id; }
  function gtGet(path, key, ttl) {
    try {
      var c = JSON.parse(localStorage.getItem(key) || 'null');
      if (c && c.v && Date.now() - c.ts < ttl) return Promise.resolve(c.v);
    } catch (e) {}
    return fetch(GT + path).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v: j })); } catch (e) {} return j; });
  }
  // A view call on NEAR, each RPC in turn.
  function nview(account, method, args) {
    var body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final',
      account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args || {})) } });
    var go = function (k) {
      return fetch(RPC[k], { method: 'POST', headers: { 'content-type': 'application/json' }, body: body })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.result || !j.result.result) throw new Error(method);
          return JSON.parse(String.fromCharCode.apply(null, j.result.result));
        })
        .catch(function (e) { if (k + 1 < RPC.length) return go(k + 1); throw e; });
    };
    return go(0);
  }
  function nativeBal(me) {
    var body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: me } });
    return fetch(RPC[0], { method: 'POST', headers: { 'content-type': 'application/json' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var a = j && j.result; if (!a) throw new Error('view_account');
        var amt = BigInt(a.amount), stor = BigInt(a.storage_usage || 0) * BigInt('10000000000000000000'), lk = BigInt(a.locked || '0');
        var keep = stor > lk ? stor - lk : BigInt(0);
        return amt > keep ? (amt - keep).toString() : '0';
      });
  }
  function scaled(raw, dec) {
    var s = String(raw || '0').replace(/^0+(?=\d)/, '');
    if (!dec) return Number(s);
    var neg = s.length <= dec ? ('0'.repeat(dec - s.length + 1) + s) : s;
    return Number(neg.slice(0, neg.length - dec) + '.' + neg.slice(neg.length - dec));
  }
  var DEC = {};
  function decOf(id) {
    if (DEC[id] != null) return Promise.resolve(DEC[id]);
    return nview(id, 'ft_metadata', {}).then(function (m) { DEC[id] = +m.decimals; return DEC[id]; });
  }

  // ---- 24h stats from GeckoTerminal, where the endpoint has none -----------------------------------------
  function gtStats(id, row) {
    if (row.vol != null) return;
    gtGet(gtId(id), 'lumos.nearGtPool.v1.' + id, 120000).then(function (j) {
      var a = j && j.data && j.data.attributes;
      if (!a || !USD) return;
      var volUsd = +((a.volume_usd || {}).h24 || 0);
      var vol = volUsd / USD;
      var feeFrac = (+row.fee || 0) / 100;
      var fees = vol * feeFrac;
      var liqUsd = +a.reserve_in_usd || (row.liq != null ? row.liq * USD : 0);
      var apr = liqUsd > 0 ? (fees * USD * 365 / liqUsd) * 100 : null;
      [['vol', vol], ['fees', fees]].forEach(function (x) {
        var cell = statCell(x[0]);
        if (!cell) return;
        unitVal(cell.querySelector('.v'), num(x[1], 2), 'NEAR');
        var s = cell.querySelector('.s');
        if (s) s.textContent = x[1] > 0 ? ('≈ ' + usdShort(x[1] * USD)) : 'no trades in 24h';
      });
      var ap = $('.ph-stat.lx-partstat') || statCell('apr') || statCell('participant');
      if (ap) {
        var av = ap.querySelector('.v');
        if (av) av.textContent = apr != null ? pct(apr) : '—';
        var as = ap.querySelector('.s');
        if (as) as.textContent = apr != null ? 'from 24h fees' : '';
      }
    }, function () {});
  }

  // ---- Pool Activity --------------------------------------------------------------------------------------
  function axisNum(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.0001) return v.toFixed(5);
    return v.toPrecision(3);
  }
  function tipWhen(ms, spanMs) {
    var d = new Date(ms), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var two = function (v) { return (v < 10 ? '0' : '') + v; };
    return mo[d.getMonth()] + ' ' + d.getDate() + (spanMs < 8 * 86400000 ? ', ' + two(d.getHours()) + ':' + two(d.getMinutes()) : (', ' + d.getFullYear()));
  }
  function wirePoolHover(host) {
    if (host.__lxnHovWired) return;
    host.__lxnHovWired = 1;
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    function mk(css) {
      var d = document.createElement('div');
      d.className = 'lx-chov';
      d.setAttribute('data-logoed', '1');
      d.style.cssText = 'position:absolute;pointer-events:none;opacity:0;transition:opacity .08s linear;' + css;
      host.appendChild(d);
      return d;
    }
    var vline = mk('top:0;bottom:0;width:1px;background:rgba(180,180,200,.55);z-index:4');
    var dot = mk('width:11px;height:11px;border-radius:50%;border:2px solid var(--surface);background:var(--accent,#ea6a2c);transform:translate(-50%,-50%);z-index:6');
    var box = mk("background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:7px 10px;font-size:14px;font-family:'Hanken Grotesk',system-ui,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.22);min-width:140px;z-index:8;color:var(--text)");
    function hide() { vline.style.opacity = '0'; dot.style.opacity = '0'; box.style.opacity = '0'; }
    function line(text, css) { var e = el('div', null, text); e.setAttribute('data-logoed', '1'); e.style.cssText = css; return e; }
    function row(label, value) {
      var w = document.createElement('div');
      w.appendChild(line(label, 'color:var(--text-soft,#8a8fa3);font-size:11px;font-weight:600'));
      w.appendChild(line(value, 'color:var(--text);font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:1px'));
      return w;
    }
    function at(cx, cy) {
      var S = host.__lxnHov, svg = host.querySelector('svg');
      if (!S || !svg || !S.pts || S.pts.length < 2) return hide();
      var hr = host.getBoundingClientRect();
      if (cx < hr.left || cx > hr.right || cy < hr.top || cy > hr.bottom) return hide();
      var m = null;
      try { m = svg.getScreenCTM(); } catch (e) {}
      if (!m) return hide();
      var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      var vx = pt.matrixTransform(m.inverse()).x;
      var n = S.pts.length, k = Math.max(0, Math.min(n - 1, Math.round(vx / S.PW * (n - 1))));
      var p = S.pts[k];
      var sp = svg.createSVGPoint();
      sp.x = (k / (n - 1)) * S.PW;
      sp.y = S.BOT - ((p[1] - S.mn) / S.rg) * (S.BOT - S.TOP);
      var scr = sp.matrixTransform(m), lx = scr.x - hr.left, ly = scr.y - hr.top;
      vline.style.left = lx + 'px'; vline.style.opacity = '1';
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = '1';
      box.textContent = '';
      box.appendChild(line(tipWhen(p[0], S.span), 'color:var(--text-soft,#8a8fa3);font-size:11px;font-weight:600;margin-bottom:4px'));
      if (S.metric === 'vol') box.appendChild(row('Volume', S.volUsd ? usdShort(p[1] * S.volUsd) : (axisNum(p[1]) + ' ' + S.unit)));
      else box.appendChild(row('Price of ' + S.base, num(p[1], 6) + ' ' + S.unit));
      if (S.metric !== 'vol' && +p[5] > 0) {
        var r2 = row('Volume', S.volUsd ? usdShort(+p[5] * S.volUsd) : (axisNum(+p[5]) + ' ' + S.unit));
        r2.style.marginTop = '8px'; box.appendChild(r2);
      }
      box.style.opacity = '1';
      var bw = box.offsetWidth || 160, bh = box.offsetHeight || 74;
      var bx = lx + 14; if (bx + bw > hr.width) bx = lx - bw - 14; if (bx < 4) bx = 4;
      var by = ly - 24; if (by + bh > hr.height) by = hr.height - bh - 4; if (by < 4) by = 4;
      box.style.left = bx + 'px'; box.style.top = by + 'px';
    }
    host.addEventListener('mousemove', function (e) { at(e.clientX, e.clientY); });
    host.addEventListener('mouseleave', hide);
    var t0 = null;
    host.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      t0 = { x: t.clientX, y: t.clientY }; at(t.clientX, t.clientY);
    }, { passive: true });
    host.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      if (t0 && Math.abs(t.clientX - t0.x) > Math.abs(t.clientY - t0.y)) e.preventDefault();
      at(t.clientX, t.clientY);
    }, { passive: false });
  }
  // The design's own geometry, read off its labels (see the XRPL file for why it is not assumed).
  function drawChart(pts, meta) {
    var wrap = $('.chart-svg-wrap');
    var svg = wrap && wrap.querySelector('svg');
    if (!svg || !pts || pts.length < 2) return;
    chartNote('');
    [].slice.call(svg.querySelectorAll('rect:not(.lx-ch)')).forEach(function (n) { n.parentNode.removeChild(n); });
    [].slice.call(svg.querySelectorAll('.lx-chcandle, .lx-chvol')).forEach(function (n) { n.parentNode.removeChild(n); });
    var vb = (svg.getAttribute('viewBox') || '0 0 400 220').split(/[\s,]+/).map(Number);
    var W = vb[2] || 400, H = vb[3] || 220;
    var allText = [].slice.call(svg.querySelectorAll('text'));
    var footY = Math.max.apply(null, allText.map(function (t) { return parseFloat(t.getAttribute('y')) || 0; }));
    var yLab = allText.filter(function (t) { return (parseFloat(t.getAttribute('y')) || 0) < footY; });
    if (!yLab.length) yLab = allText.slice(0, Math.max(1, allText.length - 5));
    var labX = Math.min.apply(null, yLab.map(function (t) { return parseFloat(t.getAttribute('x')) || W; }));
    var labYs = yLab.map(function (t) { return parseFloat(t.getAttribute('y')) || 0; }).sort(function (a, b) { return a - b; });
    var RIGHT = Math.max(0, W - labX) + 12;
    var TOP = labYs.length ? labYs[0] : 10;
    var BOT = labYs.length ? labYs[labYs.length - 1] : (H - 24);
    var PW = W - RIGHT;
    var vals = pts.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var rg = (mx - mn) || Math.abs(mx) || 1;
    var d = '', i;
    for (i = 0; i < pts.length; i++) {
      var x = (i / (pts.length - 1)) * PW;
      var y = BOT - ((vals[i] - mn) / rg) * (BOT - TOP);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var paths = svg.querySelectorAll('path');
    var area = paths[0], ln = paths[1] || paths[0];
    if (area) area.setAttribute('d', d + ' L' + PW + ' ' + H + ' L0 ' + H + ' Z');
    if (ln && ln !== area) ln.setAttribute('d', d);
    var dot = svg.querySelector('circle');
    if (dot) {
      dot.setAttribute('r', dot.getAttribute('r') === '0' ? '4' : (dot.getAttribute('r') || '4'));
      dot.setAttribute('cx', String(PW));
      dot.setAttribute('cy', (BOT - ((vals[vals.length - 1] - mn) / rg) * (BOT - TOP)).toFixed(1));
    }
    var vmax = 0;
    pts.forEach(function (p) { var v = +p[5] || 0; if (v > vmax) vmax = v; });
    if (vmax > 0 && meta.metric !== 'vol') {
      var VH = (BOT - TOP) * 0.24, bwid = Math.max(1, Math.min(10, PW / pts.length * 0.6)), vroot = Math.sqrt(vmax);
      var firstPath = svg.querySelector('path');
      pts.forEach(function (p, k) {
        var v = +p[5] || 0;
        if (!(v > 0)) return;
        var bh = Math.max(2, (Math.sqrt(v) / vroot) * VH), bx = (k / (pts.length - 1)) * PW;
        var r = document.createElementNS(NSVG, 'rect');
        r.setAttribute('class', 'lx-ch lx-chvol');
        r.setAttribute('x', (bx - bwid / 2).toFixed(1)); r.setAttribute('y', (BOT - bh).toFixed(1));
        r.setAttribute('width', bwid.toFixed(1)); r.setAttribute('height', bh.toFixed(1)); r.setAttribute('rx', '1');
        r.setAttribute('fill', '#8b7bf0'); r.setAttribute('fill-opacity', '0.45');
        svg.insertBefore(r, firstPath);
      });
    }
    var host = document.getElementById('tvlChart') || wrap;
    host.__lxnHov = { pts: pts, PW: PW, TOP: TOP, BOT: BOT, mn: mn, rg: rg, unit: meta.unit, base: meta.base,
      metric: meta.metric, volUsd: meta.volUsd, span: pts[pts.length - 1][0] - pts[0][0] };
    wirePoolHover(host);
    yLab.slice().sort(function (p, q) { return (parseFloat(p.getAttribute('y')) || 0) - (parseFloat(q.getAttribute('y')) || 0); })
      .forEach(function (t, k, arr) { t.textContent = axisNum(mn + rg * (1 - k / Math.max(1, arr.length - 1))); });
    var span = pts[pts.length - 1][0] - pts[0][0];
    allText.filter(function (t) { return yLab.indexOf(t) < 0; })
      .sort(function (p, q) { return (parseFloat(p.getAttribute('x')) || 0) - (parseFloat(q.getAttribute('x')) || 0); })
      .forEach(function (t, k, arr) {
        var dt = new Date(pts[Math.round((k / Math.max(1, arr.length - 1)) * (pts.length - 1))][0]);
        var two = function (v) { return (v < 10 ? '0' : '') + v; };
        var mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        t.textContent = span < 2 * 86400000 ? (two(dt.getHours()) + ':00')
          : (span < 90 * 86400000 ? (mo[dt.getMonth()] + ' ' + dt.getDate()) : (mo[dt.getMonth()] + " '" + String(dt.getFullYear()).slice(2)));
      });
    try { document.documentElement.classList.add('lx-chartready'); } catch (e) {}
  }
  function chartBars(kind) {
    var host = document.getElementById('tvlChart') || $('.chart-svg-wrap');
    var svg = host && host.querySelector('svg'), S = host && host.__lxnHov;
    if (!svg || !S || !S.pts || S.pts.length < 2) return;
    [].forEach.call(svg.querySelectorAll('path'), function (p) { p.setAttribute('d', ''); });
    var dot = svg.querySelector('circle');
    if (dot) dot.setAttribute('r', '0');
    var n = S.pts.length, w = Math.max(1.5, Math.min(14, S.PW / n * 0.62));
    var Y = function (val) { return S.BOT - ((val - S.mn) / S.rg) * (S.BOT - S.TOP); };
    S.pts.forEach(function (p, k) {
      var x = (k / (n - 1)) * S.PW, y1, y2, col;
      if (kind === 'vol') { y1 = Y(p[1]); y2 = S.BOT; col = '#8b7bf0'; }
      else {
        var o = (p[4] > 0) ? p[4] : (k ? S.pts[k - 1][1] : p[1]);
        y1 = Math.min(Y(o), Y(p[1])); y2 = Math.max(Y(o), Y(p[1]));
        col = p[1] >= o ? '#22c55e' : '#ff5b5b';
      }
      var r = document.createElementNS(NSVG, 'rect');
      r.setAttribute('class', 'lx-ch lx-chcandle');
      r.setAttribute('x', (x - w / 2).toFixed(1)); r.setAttribute('y', y1.toFixed(1));
      r.setAttribute('width', w.toFixed(1)); r.setAttribute('height', Math.max(1.5, y2 - y1).toFixed(1));
      r.setAttribute('rx', '1'); r.setAttribute('fill', col);
      svg.appendChild(r);
    });
  }
  var CH = { range: '1M', type: 'line', metric: 'price', pts: null, gen: 0 };
  var CH_R = {
    '1D': { tf: 'minute', agg: 15, limit: 96, ttl: 300000 }, '1W': { tf: 'hour', agg: 1, limit: 168, ttl: 900000 },
    '1M': { tf: 'hour', agg: 4, limit: 180, ttl: 1800000 }, '3M': { tf: 'day', agg: 1, limit: 90, ttl: 3600000 },
    '1Y': { tf: 'day', agg: 1, limit: 365, ttl: 3600000 }, 'ALL': { tf: 'day', agg: 1, limit: 1000, ttl: 3600000 }
  };
  function chartSides() {
    var p = window.__lxnPool;
    if (!p) return null;
    var nearSide = p.a.i === 'wrap.near' ? p.a : (p.b.i === 'wrap.near' ? p.b : null);
    var quote = nearSide || p.b, base = nearSide ? (nearSide === p.a ? p.b : p.a) : p.a;
    return { base: base, quote: quote, unit: quote.i === 'wrap.near' ? 'NEAR' : quote.name };
  }
  function renderChart() {
    var s = chartSides(), v = CH.pts;
    if (!s || !v) return;
    var volUsd = s.quote.i === 'wrap.near' ? USD : null;
    if (CH.metric === 'vol') {
      drawChart(v.map(function (q) { return [q[0], +q[5] || 0, 0, 0, 0, 0]; }), { unit: s.unit, base: s.base.name, metric: 'vol', volUsd: volUsd });
      chartBars('vol');
    } else {
      drawChart(v, { unit: s.unit, base: s.base.name, metric: 'price', volUsd: volUsd });
      if (CH.type === 'bar') chartBars('candle');
    }
  }
  function loadPoolChart(range) {
    var p = window.__lxnPool, s = chartSides();
    if (!p || !s || !$('.chart-svg-wrap')) return;
    if (range) CH.range = range;
    $$('.tf-mini button').forEach(function (b) { b.classList.toggle('active', (b.textContent || '').trim().toUpperCase() === CH.range); });
    var R = CH_R[CH.range] || CH_R['1M'], gen = ++CH.gen, at = 0;
    var go = function () {
      gtGet(gtId(p.id) + '/ohlcv/' + R.tf + '?aggregate=' + R.agg + '&limit=' + R.limit + '&currency=token&token=' + encodeURIComponent(s.base.i),
        'lumos.nearGtPoolOhlc.v1.' + p.id + '.' + CH.range + '.' + s.base.i, R.ttl)
        .then(function (j) {
          if (gen !== CH.gen) return;
          var seen = {}, list = ((j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [])
            .filter(function (c) { if (!c || !(c[4] > 0) || seen[c[0]]) return false; seen[c[0]] = 1; return true; })
            .map(function (c) { return [c[0] * 1000, +c[4], +c[2], +c[3], +c[1], +c[5]]; })
            .sort(function (x, y) { return x[0] - y[0]; });
          if (list.length < 2) { CH.pts = null; clearChart(); chartNote('No trades in this pool over this range.'); return; }
          CH.pts = list;
          renderChart();
        })
        .catch(function () {
          if (gen !== CH.gen) return;
          if (at < 3) { at++; chartNote('The price feed is busy — retrying…'); setTimeout(go, [3000, 15000, 30000][at - 1]); return; }
          chartNote('Could not load this pool’s history. Reload to try again.');
        });
    };
    go();
  }
  // The design's controls, driven for real: ranges, Line / Bar, and Price / Volume ("Pool TVL" relabelled).
  function wireChartControls() {
    if (window.__lxnPoolChartWired) return;
    window.__lxnPoolChartWired = 1;
    $$('.chart-mode-menu button[data-metric]').forEach(function (b) {
      if (b.getAttribute('data-metric') !== 'vol') { b.textContent = 'Price'; b.setAttribute('data-logoed', '1'); }
    });
    var sel = $('.chart-mode-select');
    if (sel) [].forEach.call(sel.childNodes, function (nd) { if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' Price '; });
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || !$('.pool-header')) return;
      var rb = t.closest('.tf-mini button'), tb = t.closest('.chart-type button'), mb = t.closest('.chart-mode-menu button[data-metric]');
      if (!rb && !tb && !mb) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (rb) { var l = (rb.textContent || '').trim().toUpperCase(); if (CH_R[l]) loadPoolChart(l); return; }
      if (tb) {
        var btns = [].slice.call(tb.parentNode.querySelectorAll('button'));
        btns.forEach(function (b) { b.classList.toggle('active', b === tb); });
        CH.type = btns.indexOf(tb) === 0 ? 'line' : 'bar';
      }
      if (mb) {
        CH.metric = mb.getAttribute('data-metric') === 'vol' ? 'vol' : 'price';
        [].forEach.call(mb.parentNode.querySelectorAll('button'), function (b) { b.classList.toggle('active', b === mb); });
        var s2 = $('.chart-mode-select');
        if (s2) [].forEach.call(s2.childNodes, function (nd) { if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + (CH.metric === 'vol' ? 'Volume' : 'Price') + ' '; });
        mb.parentNode.classList.remove('open');
        if (mb.parentNode.style.display === 'block') mb.parentNode.style.display = 'none';
      }
      renderChart();
    }, true);
  }

  // ---- Pool Transactions: swaps -----------------------------------------------------------------------------
  var TX = { rows: null, err: false, filter: 'all', page: 1, ext: '' };
  var TX_PER = 15, ACCT_RE = /^[a-z0-9._-]{2,64}$/;
  function txAmt(v) { return v >= 1000 ? num(v, 2) : num(v, 6); }
  function loadTx() {
    var p = window.__lxnPool;
    if (!p) return;
    var at = 0;
    var go = function () {
      gtGet(gtId(p.id) + '/trades', 'lumos.nearGtPoolTr.v1.' + p.id, 60000).then(function (j) {
        TX.rows = ((j && j.data) || []).map(function (x) {
          var a = x && x.attributes;
          if (!a) return null;
          var amtOf = function (tok) {
            if (a.from_token_address === tok.i) return +a.from_token_amount;
            if (a.to_token_address === tok.i) return +a.to_token_amount;
            return 0;
          };
          var who = String(a.tx_from_address || '');
          return { kind: 'swap', a: amtOf(p.a), b: amtOf(p.b), who: ACCT_RE.test(who) ? who : '',
            t: Date.parse(a.block_timestamp || '') || 0, hash: /^[A-Za-z0-9]{20,64}$/.test(a.tx_hash || '') ? a.tx_hash : '',
            from: a.from_token_address === p.a.i ? p.a.name : p.b.name, to: a.to_token_address === p.a.i ? p.a.name : p.b.name,
            fromAmt: +a.from_token_amount, toAmt: +a.to_token_amount };
        }).filter(Boolean);
        TX.err = false;
        renderTx();
      }, function () {
        if (at < 3) { at++; setTimeout(go, [3000, 15000, 30000][at - 1]); return; }
        TX.err = true; renderTx();
      });
    };
    go();
  }
  function txNote() {
    if (TX.filter === 'deposit' || TX.filter === 'withdraw') {
      return 'Deposits and withdrawals are not published for NEAR pools — Rhea’s activity index stopped in December 2024. Only swaps are listed.';
    }
    if (TX.err) return 'Recent swaps could not be loaded right now. Reload to try again.';
    if (!TX.rows) return 'Reading this pool’s recent swaps…';
    return 'No swaps in this pool recently.';
  }
  function renderTx() {
    var p = window.__lxnPool;
    if (!p) return;
    var list = (TX.rows || []).filter(function () { return TX.filter === 'all' || TX.filter === 'swap'; });
    var pages = Math.max(1, Math.ceil(list.length / TX_PER));
    if (TX.page > pages) TX.page = pages;
    var from = (TX.page - 1) * TX_PER, slice = list.slice(from, from + TX_PER);
    var card = $('.tx-card'), body = card && card.querySelector('table.tx tbody');
    if (body) {
      body.innerHTML = '';
      if (!slice.length) {
        var tr0 = document.createElement('tr');
        tr0.className = 'lx-txrow';
        var td0 = el('td', null, txNote());
        td0.colSpan = 6;
        td0.style.cssText = 'padding:22px 12px;text-align:center;opacity:.7';
        tr0.appendChild(td0);
        body.appendChild(tr0);
      }
      slice.forEach(function (r) {
        var tr = document.createElement('tr');
        tr.className = 'lx-txrow';
        var c1 = document.createElement('td');
        c1.appendChild(el('span', 'type-pill swap', 'Swap'));
        tr.appendChild(c1);
        [[r.a, p.a.name], [r.b, p.b.name]].forEach(function (x) {
          var td = document.createElement('td');
          var s = el('span', 'num', x[0] > 0 ? (txAmt(x[0]) + ' ' + x[1]) : '—');
          s.setAttribute('data-logoed', '1');
          td.appendChild(s);
          tr.appendChild(td);
        });
        var cw = document.createElement('td');
        if (r.who) {
          var wl = el('a', 'wallet-cell', short(r.who));
          wl.href = '/account/near/' + encodeURIComponent(r.who);
          wl.title = r.who;
          wl.style.cssText = 'color:inherit;text-decoration:none';
          cw.appendChild(wl);
        } else cw.textContent = '—';
        tr.appendChild(cw);
        tr.appendChild(el('td', 'time-cell', r.t ? tipWhen(r.t, 0) : '—'));
        var cl = document.createElement('td');
        if (r.hash) {
          var a = el('a', 'ext-link');
          a.href = 'https://nearblocks.io/txns/' + r.hash;
          a.target = '_blank'; a.rel = 'noopener nofollow';
          a.setAttribute('aria-label', 'View this transaction on NearBlocks');
          a.innerHTML = TX.ext;
          cl.appendChild(a);
        }
        tr.appendChild(cl);
        body.appendChild(tr);
      });
      var foot = card.querySelector('.tx-foot');
      if (foot) {
        if (foot.firstElementChild) foot.firstElementChild.textContent = list.length
          ? ('Showing ' + (from + 1) + '–' + (from + slice.length) + ' of ' + list.length + ' recent swaps') : 'Showing 0 transactions';
        var nb = foot.querySelectorAll('.controls button');
        if (nb[0]) nb[0].disabled = TX.page <= 1;
        if (nb[1]) nb[1].disabled = TX.page >= pages;
      }
    }
    // The phone: the design's own .tx-item shape, the latest 20.
    var box = ($('.tx-filter-m') || {}).parentNode;
    if (box) {
      $$('.tx-item, .lxn-txnote', box).forEach(function (n) { n.parentNode.removeChild(n); });
      var mlist = list.slice(0, 20);
      if (!mlist.length) {
        var d0 = el('div', 'lxn-txnote', txNote());
        d0.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
        box.appendChild(d0);
      }
      mlist.forEach(function (r) {
        var it = el('div', 'tx-item');
        it.setAttribute('data-logoed', '1');
        it.innerHTML = '<div class="tx-icon swap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></div>';
        var info = el('div', 'tx-info');
        info.appendChild(el('div', 'tx-type swap', 'Swap'));
        info.appendChild(el('div', 'tx-amounts', txAmt(r.fromAmt) + ' ' + r.from + ' → ' + txAmt(r.toAmt) + ' ' + r.to));
        info.appendChild(el('div', 'tx-meta', short(r.who) || '—'));
        it.appendChild(info);
        it.appendChild(el('div', 'tx-time', r.t ? tipWhen(r.t, 0) : '—'));
        box.appendChild(it);
      });
    }
  }
  function wireTx() {
    var card = $('.tx-card');
    if (window.__lxnPoolTxWired) return;
    window.__lxnPoolTxWired = 1;
    var svg = card && card.querySelector('.ext-link svg');
    TX.ext = svg ? svg.outerHTML : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.tx-filter button, .tx-filter-m button, .tx-card .tx-foot .controls button');
      if (!b || !$('.pool-header')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b.closest('.controls')) {
        var bs = [].slice.call(b.parentNode.querySelectorAll('button'));
        TX.page += bs.indexOf(b) === 0 ? -1 : 1;
        if (TX.page < 1) TX.page = 1;
      } else {
        [].forEach.call(b.parentNode.querySelectorAll('button'), function (x) { x.classList.toggle('active', x === b); });
        var l = (b.textContent || '').trim().toLowerCase();
        TX.filter = /swap/.test(l) ? 'swap' : (/deposit/.test(l) ? 'deposit' : (/withdraw/.test(l) ? 'withdraw' : 'all'));
        TX.page = 1;
      }
      renderTx();
    }, true);
  }

  // ---- My Position and the deposit card's balances -----------------------------------------------------
  function loadMine() {
    var p = window.__lxnPool, me = addr();
    if (!p || !me) return;
    Promise.all([
      nview('v2.ref-finance.near', 'get_pool_shares', { pool_id: +p.id, account_id: me }),
      nview('v2.ref-finance.near', 'get_pool', { pool_id: +p.id }),
      Promise.all(p.tokens.map(function (t) { return decOf(t.i); }))
    ]).then(function (r) {
      var mine = String(r[0] || '0'), pool = r[1] || {}, decs = r[2];
      var supply = String(pool.shares_total_supply || '0');
      var share = (supply !== '0') ? Number(BigInt(mine) * BigInt(1000000000) / BigInt(supply)) / 1e9 : 0;
      p.myShares = mine; p.supply = supply; p.decs = decs;
      p.reserves = (pool.amounts || []).map(function (x, k) { return scaled(x, decs[k]); });
      var amts = bothPos('asset-amt');
      [0, 1].forEach(function (k) { if (amts[k]) amts[k].textContent = share > 0 ? num(p.reserves[k] * share, 6) : '0'; });
      bothPos('asset-name').forEach(function (n, i) { n.textContent = (i % 2 === 0) ? p.a.name : p.b.name; });
      paintPositionIdentity();
      var fees = bothPos('fee-val');
      if (fees[0]) fees[0].textContent = '—';                         // Rhea keeps no per-LP fee record
      if (fees[1]) fees[1].textContent = share > 0 ? num(scaled(mine, 24), 6) : '0';
      $$('.position-share-pill, .my-position-m .mpm-share').forEach(function (pill) {
        pill.textContent = share > 0 ? ((share * 100) < 0.0001 ? '<0.0001%' : (share * 100).toFixed(4) + '%') : '0%';
      });
      var value = null;
      if (share > 0 && USD && window.__lxnPoolRow && window.__lxnPoolRow.liq != null) value = window.__lxnPoolRow.liq * USD * share;
      bothPos('amount').forEach(function (amt) { amt.textContent = share > 0 ? (value != null ? usdShort(value) : num(scaled(mine, 24), 4) + ' LP') : 'No position'; });
      $$('#dwWithdraw .balance').forEach(function (b) { b.textContent = 'Your LP: ' + (share > 0 ? num(scaled(mine, 24), 6) : '0'); });
    }, function () {});
    // Balances: the wNEAR side shows NEAR, which a deposit wraps.
    p.tokens.slice(0, 2).forEach(function (t, k) {
      var q = t.i === 'wrap.near'
        ? nativeBal(me).then(function (raw) { return scaled(raw, 24); })
        : Promise.all([nview(t.i, 'ft_balance_of', { account_id: me }), decOf(t.i)]).then(function (x) { return scaled(x[0], x[1]); });
      q.then(function (v) {
        p['bal' + k] = v;
        var b = $$('#dwDeposit .balance')[k];
        if (b) b.textContent = 'Balance: ' + num(v, 6) + (t.i === 'wrap.near' ? ' NEAR' : '');
      }, function () {});
    });
  }

  function live(id, row) {
    window.__lxnPoolRow = row;
    gtStats(id, row);
    wireChartControls();
    loadPoolChart();
    wireTx();
    renderTx();
    loadTx();
    loadMine();
  }

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
    live(id, row);
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
    // Balances already read stay on screen when the tabs switch (loadMine fills them).
    var P = window.__lxnPool || {};
    $$('#dwDeposit .balance').forEach(function (b, k) {
      var v = P['bal' + k], t = P.tokens && P.tokens[k];
      b.textContent = 'Balance: ' + (v != null ? num(v, 6) + (t && t.i === 'wrap.near' ? ' NEAR' : '') : '—');
    });
    $$('#dwWithdraw .balance').forEach(function (b) {
      b.textContent = 'Your LP: ' + (P.myShares != null ? (P.myShares !== '0' ? num(Number(P.myShares) / 1e24, 6) : '0') : '—');
    });
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
