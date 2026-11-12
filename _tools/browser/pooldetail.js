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
//   My Position           not read until a wallet is set; "Connect your wallet to see your position" or an em dash.
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

  // An exchange rate, four places as Stellar's header prints one ("5.9575 XLM"), so one rate never reads shorter
  // than its neighbour because of a trailing zero.
  function rateText(v) {
    if (v == null || !isFinite(v)) return '—';
    return v >= 1 && v < 1000 ? v.toFixed(4) : num(v, 2);
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

  // POOL URLS NAME THE PAIR (RAZA 2026-10-30: "The url for Pools-pool page on near needs to be fixed" -> "Use the
  // pair name"): /pools/near/stnear-wnear/3514. The symbols make it readable; the Rhea pool id stays as the last
  // segment because one pair can have several pools (classic, stable, different fees), so the name alone would
  // not say which. Symbols are chosen by whoever deployed the token, so only [a-z0-9] survive. Same function in
  // pools.js, search.js and pooldetail.js.
  function poolHref(id, syms) {
    var slug = (syms || []).map(function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); })
      .filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '');
    return '/pools/near/' + (slug || 'pool') + '/' + encodeURIComponent(id);
  }
  // /pools/near/<pair>/<id> -- the route the Pools table links to (/pools/near/id/<id>, the older form, still
  // resolves and is rewritten to the pair form once the tokens are known). The phone file and a direct visit to the
  // page file can carry it as ?pool= or ?id= instead.
  function fromUrl() {
    try {
      var sp = new URLSearchParams(window.location.search);
      var q = sp.get('pool') || sp.get('id');
      if (q && /^\d{1,9}$/.test(q)) return q;
    } catch (e) {}
    var m = window.location.pathname.match(/\/pools\/near\/[a-z0-9-]{1,60}\/(\d{1,9})\/?$/i);
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
    [].slice.call(svg.querySelectorAll('.lx-chvol, .lx-chcandle')).forEach(function (r) { r.parentNode.removeChild(r); });
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

  // ---- Participants -------------------------------------------------------------------------------------
  // THE LARGEST PROVIDERS, EVERY SHARE READ FROM THE CHAIN (RAZA 2026-10-30: "why arent liq pool participants
  // shown", then "Verify on-chain"). /lxapi/nearlps takes Rhea's LP and farm-staker lists as CANDIDATES only --
  // Rhea's per-pool list stopped updating on 2026-02-02 -- and reads each account's shares (held + staked in
  // Rhea's farm) against the pool's current total. Someone who joined since February and never staked cannot
  // be seen, so the panel says "largest known", not "all". Drawn in the design's .part-row shape (XRPL's port).
  var PART = { rows: [], page: 1, per: 20, at: 0 };
  if (!window.__lxnPoolAcctNav) {
    window.__lxnPoolAcctNav = 1;
    window.addEventListener('click', function (e) {
      var n = e.target && e.target.closest && e.target.closest('[data-lxacct]');
      if (!n || (e.target.closest && e.target.closest('a[href]'))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = '/account/near/' + encodeURIComponent(n.getAttribute('data-lxacct'));
    }, true);
  }
  function loadParticipants(id) {
    PART = { rows: [], page: 1, per: 20, at: 0 };
    // ALIGNMENT (RAZA 2026-10-30: "still not alligned with participants on its right"). The inherited CSS makes the
    // Participants card flex:1 so it fills the right column down to the Transactions card's bottom -- but a column
    // flex box still offers the grid its list's FULL content height, so 20 rows made the right column the taller one
    // and the Transactions card ended ~170px short. contain:size takes the list out of that measurement: the left
    // column sets the row height, the list fills what is left and scrolls (as Stellar's does), floored so it is
    // never a sliver beside a short history.
    var plist = $('#partList');
    if (plist) { plist.style.contain = 'size'; plist.style.minHeight = '320px'; }
    participants('Reading the liquidity providers…');
    fetch('/lxapi/nearlps?pool=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) { emptyParticipants('Could not read the liquidity providers — try again shortly.'); return; }
      PART.rows = d.providers || [];
      PART.at = d.at || 0;
      var counted0 = window.__lxnPoolRow && +window.__lxnPoolRow.lps;
      if (!PART.rows.length) {
        emptyParticipants(counted0 > 0 ? (counted0.toLocaleString('en-US') + (counted0 === 1 ? ' provider is' : ' providers are')
          + ' counted, but none could be listed and read just now.') : 'No liquidity providers found.');
        return;
      }
      renderParticipants();
    }).catch(function () { emptyParticipants('Could not read the liquidity providers — try again shortly.'); });
  }
  function renderParticipants() {
    ['#partList', '#participantsList'].forEach(function (sel) {
      var host = $(sel);
      if (!host) return;
      var from = (PART.page - 1) * PART.per, slice = PART.rows.slice(from, from + PART.per);
      host.innerHTML = '';
      slice.forEach(function (h) {
        var row = el('div', 'part-row lx-partrow');
        var av = el('div', 'part-avatar');
        if (window.lxIdent) { try { av.innerHTML = window.lxIdent(h.a, 26); } catch (e) {} }
        row.appendChild(av);
        row.appendChild(el('div', 'wallet', short(h.a)));
        var share = +h.pct || 0;
        // Stellar's row: the share stands at the right on its own, no bar.
        var sh = el('div', 'share', (share > 0 && share < 0.01 ? '<0.01' : share.toFixed(2)) + '%');
        sh.style.cssText = 'margin-left:auto;font-weight:800;color:var(--text)';
        row.appendChild(sh);
        row.title = h.a + (h.staked && h.staked !== '0' ? ' (includes shares staked in farms)' : '');
        row.setAttribute('data-lxacct', h.a);
        row.style.cursor = 'pointer';
        host.appendChild(row);
      });
      var card = host.closest('.side-card, .card');
      if (!card) return;
      var pill = card.querySelector('.count-pill');
      if (pill) pill.textContent = PART.rows.length.toLocaleString('en-US');
      var foot = card.querySelector('.part-foot');
      if (!foot) return;
      foot.classList.add('lx-partfoot');
      var info = foot.firstElementChild;
      // "largest known", and when the chain was read, on hover: the list is the largest accounts Rhea has
      // recorded, every share read from the chain (see /lxapi/nearlps).
      if (info) {
        // The card above counts the pool's providers (the indexer's lps); when that is more than could be listed and
        // read here, the list says so rather than standing as the whole (RAZA 2026-11-12, NEAR20 / wNEAR).
        var counted = window.__lxnPoolRow && +window.__lxnPoolRow.lps;
        info.textContent = 'Viewing ' + (from + 1) + '–' + (from + slice.length) + ' of ' + PART.rows.length + ' largest known'
          + (counted > PART.rows.length ? ' (' + counted.toLocaleString('en-US') + ' counted)' : '');
        info.title = 'Shares read from the chain' + (PART.at ? ' at ' + new Date(PART.at).toLocaleString() : '');
      }
      var navEl = foot.querySelector('.nav'), chip = navEl && navEl.querySelector('.lx-pppg');
      var pagesP = Math.max(1, Math.ceil(PART.rows.length / PART.per));
      if (navEl && !chip) {
        chip = el('span', 'lx-pppg');
        chip.setAttribute('data-logoed', '1');
        chip.style.cssText = 'margin:0 8px;color:var(--text-soft);font-size:13px;align-self:center';
        var nbs = navEl.querySelectorAll('button');
        navEl.insertBefore(chip, nbs[1] || null);
      }
      if (chip) chip.textContent = 'Page ' + PART.page + ' of ' + pagesP;
      var nb = foot.querySelectorAll('.nav button');
      if (nb[0] && !nb[0].__lxn) {
        nb[0].__lxn = 1;
        nb[0].addEventListener('click', function (e) {
          e.preventDefault(); e.stopImmediatePropagation();
          if (PART.page > 1) { PART.page--; renderParticipants(); }
        }, true);
      }
      if (nb[1] && !nb[1].__lxn) {
        nb[1].__lxn = 1;
        nb[1].addEventListener('click', function (e) {
          e.preventDefault(); e.stopImmediatePropagation();
          if (PART.page * PART.per < PART.rows.length) { PART.page++; renderParticipants(); }
        }, true);
      }
      if (nb[0]) nb[0].disabled = PART.page <= 1;
      if (nb[1]) nb[1].disabled = PART.page * PART.per >= PART.rows.length;
    });
  }

  // ==== THE POOL'S LIVE HALF (RAZA 2026-10-30: "nothing on pools-pool page is being shown") ===============
  //
  // Phase 1 left five parts of this page as empty states. They are filled now, each from the one source that
  // has it, all asked by the page (GeckoTerminal refuses Cloudflare, as on the token page):
  //   24h stats     DexScreener (the endpoint) where it lists the pool, else GeckoTerminal's pool record --
  //                 which also says when a pool genuinely had no trades, so a dead pool reads 0, not "—".
  //   Pool Activity The line is the pool's TVL (see the note on rheaDaily); the candles are GeckoTerminal OHLCV.
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
      [['vol', vol], ['fees', fees]].forEach(function (x) {
        var cell = statCell(x[0]);
        if (!cell) return;
        unitVal(cell.querySelector('.v'), (x[1] > 0 ? '≥ ' : '') + num(x[1], 2), 'NEAR');
        var s = cell.querySelector('.s');
        if (s) s.textContent = x[1] > 0 ? ('≈ ' + usdShort(x[1] * USD)) : 'no trades in 24h';
      });
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
  // Stellar's rule for a tight axis: the decimals follow the gridline step, so a stable pool moving between 1.0001
  // and 1.0003 does not print the same figure five times.
  function axisStep(v, step) {
    if (!(step > 0)) return axisNum(v);
    var a = Math.abs(v), sc = a >= 1e6 ? 1e6 : (a >= 1e3 ? 1e3 : 1);
    var dp = Math.ceil(-Math.log(step / sc) / Math.LN10) + 1;
    return (v / sc).toFixed(Math.max(sc > 1 ? 1 : 2, Math.min(12, dp))) + (sc === 1e6 ? 'M' : (sc === 1e3 ? 'K' : ''));
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
    // One line per figure: a candle has six of them, and the two-line row above would overflow the chart.
    function kv(label, value, gap) {
      var w = document.createElement('div');
      w.style.cssText = 'display:flex;justify-content:space-between;gap:16px;margin-top:' + (gap || 2) + 'px';
      w.appendChild(line(label, 'color:var(--text-soft,#8a8fa3);font-size:11px;font-weight:600'));
      w.appendChild(line(value, 'color:var(--text);font-size:13px;font-weight:800;font-variant-numeric:tabular-nums'));
      return w;
    }
    function at(cx, cy) {
      var S = host.__lxnHov, svg = host.querySelector('svg');
      if (!S || !svg || !S.pts || S.pts.length < (S.cand ? 1 : 2)) return hide();
      var hr = host.getBoundingClientRect();
      if (cx < hr.left || cx > hr.right || cy < hr.top || cy > hr.bottom) return hide();
      var m = null;
      try { m = svg.getScreenCTM(); } catch (e) {}
      if (!m) return hide();
      var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      var vx = pt.matrixTransform(m.inverse()).x;
      var n = S.pts.length, k = Math.max(0, Math.min(n - 1, S.cand ? Math.floor(vx / S.PW * n) : Math.round(vx / S.PW * (n - 1))));
      var p = S.pts[k];
      var sp = svg.createSVGPoint();
      sp.x = S.cand ? ((k + 0.5) / n) * S.PW : (k / (n - 1)) * S.PW;
      sp.y = S.BOT - ((p[1] - S.mn) / S.rg) * (S.BOT - S.TOP);
      var scr = sp.matrixTransform(m), lx = scr.x - hr.left, ly = scr.y - hr.top;
      vline.style.left = lx + 'px'; vline.style.opacity = '1';
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = S.cand ? '0' : '1';   // a bar is its own mark, as on Stellar
      box.textContent = '';
      box.appendChild(line(tipWhen(p[0], S.span), 'color:var(--text-soft,#8a8fa3);font-size:11px;font-weight:600;margin-bottom:4px'));
      if (S.cand) {
        var fig = function (v) { return S.metric === 'tvl' ? usdShort(v) : (rateText(v) + ' ' + S.unit); };
        [['Open', p[4]], ['High', p[2]], ['Low', p[3]], ['Close', p[1]]].forEach(function (c) { box.appendChild(kv(c[0], fig(c[1]))); });
        if (+p[6] > 0) box.appendChild(kv('TVL', usdShort(+p[6]), 7));
        if (+p[5] > 0) box.appendChild(kv('Volume', S.volUsd ? usdShort(+p[5] * S.volUsd) : (axisNum(+p[5]) + ' ' + S.unit), +p[6] > 0 ? 2 : 7));
      }
      else if (S.metric === 'tvl') box.appendChild(row('TVL', usdShort(p[1])));
      else if (S.metric === 'vol') box.appendChild(row('Volume', S.volUsd ? usdShort(p[1] * S.volUsd) : (axisNum(p[1]) + ' ' + S.unit)));
      else box.appendChild(row('Price of ' + S.base, num(p[1], 6) + ' ' + S.unit));
      if (!S.cand && S.metric !== 'vol' && +p[5] > 0) {
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
    var cand = !!meta.cand;                          // candles: each point owns a slot, so one point is a chart
    if (!svg || !pts || pts.length < (cand ? 1 : 2)) return;
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
    // Candles stop where the design's gridlines do (Stellar's 93.6%), clear of the axis labels the line runs under.
    var PW = cand ? Math.round(W * 0.936) : W - RIGHT;
    var vals = pts.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (cand) {
      // THE VOLUME BAND IS THE CHART'S OWN (RAZA 2026-11-05: "positioned strictly at the lower ~20% of the chart
      // height"). The axis is opened below the lowest wick so the candles stand above the bars, not on them, and
      // every label stays true because the scale itself moved.
      mx = Math.max.apply(null, pts.map(function (p) { return p[2]; }));
      mn = Math.min.apply(null, pts.map(function (p) { return p[3]; }));
      var gap = (mx - mn) || (Math.abs(mx) * 0.04) || 1;
      mx += gap * 0.06;
      mn = Math.max(0, mn - gap * 0.3);
    }
    var rg = (mx - mn) || Math.abs(mx) || 1;
    var d = '', i;
    for (i = 0; !cand && i < pts.length; i++) {
      var x = (i / (pts.length - 1)) * PW;
      var y = BOT - ((vals[i] - mn) / rg) * (BOT - TOP);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var paths = svg.querySelectorAll('path');
    var area = paths[0], ln = paths[1] || paths[0];
    if (area) area.setAttribute('d', cand ? '' : d + ' L' + PW + ' ' + H + ' L0 ' + H + ' Z');
    if (ln && ln !== area) ln.setAttribute('d', d);
    var dot = svg.querySelector('circle');
    if (dot && cand) dot.setAttribute('r', '0');
    else if (dot) {
      dot.setAttribute('r', dot.getAttribute('r') === '0' ? '4' : (dot.getAttribute('r') || '4'));
      dot.setAttribute('cx', String(PW));
      dot.setAttribute('cy', (BOT - ((vals[vals.length - 1] - mn) / rg) * (BOT - TOP)).toFixed(1));
    }
    var vmax = 0;
    pts.forEach(function (p) { var v = +p[5] || 0; if (v > vmax) vmax = v; });
    if (vmax > 0 && meta.metric !== 'vol') {
      var VH = (BOT - TOP) * (cand ? 0.2 : 0.24), vroot = Math.sqrt(vmax), nv = pts.length;
      var bwid = cand ? candleW(PW, nv) : Math.max(1, Math.min(10, PW / nv * 0.6));
      var firstPath = svg.querySelector('path');
      pts.forEach(function (p, k) {
        var v = +p[5] || 0;
        if (!(v > 0)) return;
        var bh = Math.max(2, (Math.sqrt(v) / vroot) * VH), bx = cand ? ((k + 0.5) / nv) * PW : (k / (nv - 1)) * PW;
        var r = document.createElementNS(NSVG, 'rect');
        r.setAttribute('class', 'lx-ch lx-chvol');
        r.setAttribute('x', (bx - bwid / 2).toFixed(1)); r.setAttribute('y', (BOT - bh).toFixed(1));
        r.setAttribute('width', bwid.toFixed(1)); r.setAttribute('height', bh.toFixed(1)); r.setAttribute('rx', '1');
        r.setAttribute('fill', '#8b7bf0'); r.setAttribute('fill-opacity', '0.45');
        svg.insertBefore(r, firstPath);
      });
    }
    var host = document.getElementById('tvlChart') || wrap;
    host.__lxnHov = { pts: pts, PW: PW, TOP: TOP, BOT: BOT, mn: mn, rg: rg, unit: meta.unit, base: meta.base, cand: cand,
      metric: meta.metric, volUsd: meta.volUsd, span: pts[pts.length - 1][0] - pts[0][0] };
    wirePoolHover(host);
    // THE AXIS READS IN THE POOL'S OWN UNIT (RAZA 2026-11-07: "e.g., "29.38M NEAR"", Stellar's "29.38M XLM"). Rhea's
    // series is in dollars, so TVL and volume are put in NEAR at today's rate, and stay in dollars while no rate is
    // known. Stellar's rule for the room: the labels grow left over the plot, so a chart under 450px wide, or a long
    // token name, prints the unit on the top gridline only.
    var axK = (meta.pre && USD > 0) ? USD : 1, axPre = axK === 1 ? (meta.pre || '') : '';
    var axSuf = axK !== 1 ? ' NEAR' : (cand && meta.unit ? ' ' + meta.unit : ''), axW = 0;
    try { axW = svg.getBoundingClientRect().width || 0; } catch (e) {}
    var oneU = (axW > 0 && axW < 450) || axSuf.length > 7;
    yLab.slice().sort(function (p, q) { return (parseFloat(p.getAttribute('y')) || 0) - (parseFloat(q.getAttribute('y')) || 0); })
      .forEach(function (t, k, arr) {
        var at = (mn + rg * (1 - k / Math.max(1, arr.length - 1))) / axK;
        t.textContent = axPre + (cand ? axisStep(at, rg / axK / Math.max(1, arr.length - 1)) : axisNum(at))
          + ((!oneU || k === 0) ? axSuf : '');
      });
    var span = pts[pts.length - 1][0] - pts[0][0];
    allText.filter(function (t) { return yLab.indexOf(t) < 0; })
      .sort(function (p, q) { return (parseFloat(p.getAttribute('x')) || 0) - (parseFloat(q.getAttribute('x')) || 0); })
      .forEach(function (t, k, arr) {
        if (pts.length < 2 && k !== Math.floor(arr.length / 2)) { t.textContent = ''; return; }   // one candle, one date
        var dt = new Date(pts[Math.round((k / Math.max(1, arr.length - 1)) * (pts.length - 1))][0]);
        var two = function (v) { return (v < 10 ? '0' : '') + v; };
        var mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        t.textContent = span < 2 * 86400000 ? (two(dt.getHours()) + ':00')
          : (span < 90 * 86400000 ? (mo[dt.getMonth()] + ' ' + dt.getDate()) : (mo[dt.getMonth()] + " '" + String(dt.getFullYear()).slice(2)));
      });
    try { document.documentElement.classList.add('lx-chartready'); } catch (e) {}
  }
  // A candle and the volume bar under it share one width and one centre.
  function candleW(pw, n) { return Math.max(1.5, Math.min(40, pw / n * 0.62)); }
  function chartBars(kind) {
    var host = document.getElementById('tvlChart') || $('.chart-svg-wrap');
    var svg = host && host.querySelector('svg'), S = host && host.__lxnHov;
    if (!svg || !S || !S.pts || S.pts.length < (S.cand ? 1 : 2)) return;
    [].forEach.call(svg.querySelectorAll('path'), function (p) { p.setAttribute('d', ''); });
    var dot = svg.querySelector('circle');
    if (dot) dot.setAttribute('r', '0');
    var n = S.pts.length, w = S.cand ? candleW(S.PW, n) : Math.max(1.5, Math.min(14, S.PW / n * 0.62));
    var Y = function (val) { return S.BOT - ((val - S.mn) / S.rg) * (S.BOT - S.TOP); };
    S.pts.forEach(function (p, k) {
      var x = S.cand ? ((k + 0.5) / n) * S.PW : (k / (n - 1)) * S.PW, y1, y2, col;
      if (kind === 'vol') { y1 = Y(p[1]); y2 = S.BOT; col = '#8b7bf0'; }
      else {
        var o = (p[4] > 0) ? p[4] : (k ? S.pts[k - 1][1] : p[1]);
        y1 = Math.min(Y(o), Y(p[1])); y2 = Math.max(Y(o), Y(p[1]));
        col = p[1] >= o ? '#22c55e' : '#ef4444';
        var wick = document.createElementNS(NSVG, 'line');
        wick.setAttribute('class', 'lx-ch lx-chcandle');
        wick.setAttribute('x1', x.toFixed(1)); wick.setAttribute('x2', x.toFixed(1));
        wick.setAttribute('y1', Y(p[2]).toFixed(1)); wick.setAttribute('y2', Y(p[3]).toFixed(1));
        wick.setAttribute('stroke', col); wick.setAttribute('stroke-width', Math.max(1.2, S.PW / 400).toFixed(1));
        svg.appendChild(wick);
      }
      var r = document.createElementNS(NSVG, 'rect');
      r.setAttribute('class', 'lx-ch lx-chcandle');
      r.setAttribute('x', (x - w / 2).toFixed(1)); r.setAttribute('y', y1.toFixed(1));
      r.setAttribute('width', w.toFixed(1)); r.setAttribute('height', Math.max(1.5, y2 - y1).toFixed(1));
      r.setAttribute('rx', '1'); r.setAttribute('fill', col);
      svg.appendChild(r);
    });
  }
  // TVL AND VOLUME, AS STELLAR'S POOL PAGE SHOWS THEM (RAZA 2026-10-30: "on Stellar Pools-pool page, we're
  // showing Volume and TVL not Volume and price"). The line is the pool's TVL and the bars its volume, both in
  // dollars, from Rhea's own daily history (api.data-service.ref.finance /api/pool/<id>/tvl and /volume,
  // current to today and back to the pool's creation; CORS open, so each visitor asks it). Daily is what
  // exists, so 1D is the last two days and 1W the last eight -- a line, never an invented intraday curve.
  // The Bar view's candles are the one part that is not this series: see renderCandles.
  var CH = { range: '1M', type: 'line', metric: 'tvl', pts: null, gen: 0, ohlc: {} };
  var CH_DAYS = { '1D': 2, '1W': 8, '1M': 31, '3M': 91, '1Y': 366, 'ALL': 100000 };
  var RHEA_DS = 'https://api.data-service.ref.finance/api/pool/';
  var DAILY = {};                      // pool id -> Promise of [[ms, tvlUsd, 0, 0, 0, volUsd], ...] oldest first
  // RHEA'S HISTORY HAS BAD DAYS, AND ONE IS NOT A TREND (RAZA 2026-10-30, on pool 4179: "is this real?"). That
  // pool holds ~$118K; Rhea's series reads $71.59M for 1-8 April 2026 and $118K either side -- 600x for eight
  // days, then straight back. A run that leaps more than 20x above the day before it AND falls back more than
  // 20x after it is a glitch in the record, and is left out rather than drawn as the pool's history. A one-way
  // jump (a pool's first real deposit, seen on 4512 and 3514) never comes back down, so it stays; so does a run
  // still going on the last day, and anything longer than a month.
  function dropGlitches(v) {
    var out = [], k = 0;
    while (k < v.length) {
      var prev = out.length ? out[out.length - 1][1] : 0;
      if (prev > 0 && v[k][1] > 20 * prev) {
        var j = k;
        while (j < v.length && j - k < 31 && v[j][1] > 20 * prev) j++;
        if (j < v.length && j - k < 31 && v[j][1] * 20 < v[k][1]) { k = j; continue; }
      }
      out.push(v[k]);
      k++;
    }
    return out;
  }
  function rheaDaily(id) {
    if (DAILY[id]) return DAILY[id];
    var key = 'lumos.nearPoolDaily.v2.' + id;
    try {
      var c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && c.t && Date.now() - c.t < 3600000 && Array.isArray(c.v) && c.v.length > 1) return (DAILY[id] = Promise.resolve(c.v));
    } catch (e) {}
    var get = function (k) {
      return fetch(RHEA_DS + encodeURIComponent(id) + '/' + k).then(function (r) { if (!r.ok) throw new Error(k + ' ' + r.status); return r.json(); });
    };
    DAILY[id] = Promise.all([get('tvl'), get('volume')]).then(function (r) {
      var byDay = {};
      (Array.isArray(r[0]) ? r[0] : []).forEach(function (x) {
        if (x && +x.time > 0 && isFinite(+x.tvl)) (byDay[+x.time] = byDay[+x.time] || [+x.time, 0, 0, 0, 0, 0])[1] = +x.tvl;
      });
      (Array.isArray(r[1]) ? r[1] : []).forEach(function (x) {
        if (x && +x.time > 0 && byDay[+x.time] && isFinite(+x.volume_dollar)) byDay[+x.time][5] = +x.volume_dollar;
      });
      var v = Object.keys(byDay).map(function (k) { return byDay[k]; }).sort(function (a, b) { return a[0] - b[0]; });
      v = dropGlitches(v);
      // A NEW POOL HAS NO HISTORY, and that is an answer, not a failure (RAZA 2026-11-04, LUMOS/wNEAR 9001 read
      // "Pool history is busy — retrying…" and then "Could not load"). The caller says "Not enough history"; only
      // an answer is cached, so it is asked again on the next visit.
      if (v.length < 2) return v;
      try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {}
      return v;
    });
    DAILY[id].catch(function () { delete DAILY[id]; });
    return DAILY[id];
  }
  var CH_R = {
    '1D': { tf: 'minute', agg: 15, limit: 96, ttl: 300000 }, '1W': { tf: 'hour', agg: 1, limit: 168, ttl: 900000 },
    '1M': { tf: 'hour', agg: 4, limit: 180, ttl: 1800000 }, '3M': { tf: 'day', agg: 1, limit: 90, ttl: 3600000 },
    '1Y': { tf: 'day', agg: 1, limit: 365, ttl: 3600000 }, 'ALL': { tf: 'day', agg: 1, limit: 1000, ttl: 3600000 }
  };
  // The chart reads as the header does: the first token priced in the second, "USDt per wNEAR".
  function chartSides() {
    var p = window.__lxnPool;
    if (!p) return null;
    return { base: p.a, quote: p.b, unit: p.b.name };
  }
  // At most 60 candles, the density Stellar draws (46): a year of daily candles at 1.6 units wide is a smear. Each
  // merged candle is a real one -- first open, last close, highest high, lowest low, summed volume.
  function mergeCandles(list) {
    var f = Math.ceil(list.length / 60), out = [];
    if (f < 2) return list;
    for (var i = 0; i < list.length; i += f) {
      var g = list.slice(i, i + f), hi = -Infinity, lo = Infinity, vol = 0;
      g.forEach(function (c) { if (c[2] > hi) hi = c[2]; if (c[3] < lo) lo = c[3]; vol += +c[5] || 0; });
      out.push([g[0][0], g[g.length - 1][1], hi, lo, g[0][4], vol]);
    }
    return out;
  }
  // The pool's daily TVL as candles, each day opening where the last closed, for a pool with no price feed.
  function tvlCandles(v) {
    return mergeCandles(v.slice(1).map(function (q, k) {
      var o = v[k][1], c = q[1];
      return [q[0], c, Math.max(o, c), Math.min(o, c), o, +q[5] || 0];
    }));
  }
  // The menu says what the chart is drawing: "Pool Price" only while price candles are up.
  function modeLabel(price) {
    var tv = price ? 'Pool Price' : 'Pool TVL', sel = $('.chart-mode-select');
    $$('.chart-mode-menu button[data-metric]').forEach(function (b) {
      if (b.getAttribute('data-metric') !== 'vol') { b.textContent = tv; b.setAttribute('data-logoed', '1'); }
    });
    if (sel) [].forEach.call(sel.childNodes, function (nd) { if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + (CH.metric === 'vol' ? 'Volume' : tv) + ' '; });
  }
  // REAL CANDLES, ON EVERY RANGE (RAZA 2026-11-05: "the Pool Activity section renders clean financial Japanese
  // candlesticks", against NEAR's solid purple bars). Rhea's history is one TVL figure a day, which cannot make a
  // candle: it has no high or low, and 1D would be a single bar. GeckoTerminal has true OHLCV per pool from 15
  // minutes up, in the header's own quote, so the candles are the pool's price and the tooltip adds the TVL of that
  // day. Stellar's candles are TVL because Horizon can rebuild its reserves at any moment; NEAR has no such series.
  // A pool GeckoTerminal does not track (every 3- and 4-token stable pool: a 404, an answer) or a feed that fails
  // draws daily TVL candles instead. Only an answer is kept in CH.ohlc: a failed read (GeckoTerminal's 429 reaches
  // the page as a bare network error) is asked again, and the price candles replace the TVL ones when it answers.
  function renderCandles(s, v) {
    var range = CH.range, gen = CH.gen, R = CH_R[range] || CH_R['1M'], p = window.__lxnPool;
    var drawn = function (hit) {
      if (gen !== CH.gen || CH.type !== 'bar' || CH.metric === 'vol') return;     // the reader moved on
      if (!hit) {
        modeLabel(false);
        drawChart(tvlCandles(v), { unit: '', base: s.base.name, metric: 'tvl', volUsd: 1, pre: '$', cand: true });
        chartBars('candle');
        return;
      }
      modeLabel(true);
      // The TVL of the day each candle opened, off the daily series already drawn as the line.
      var j = 0;
      hit.pts.forEach(function (c) {
        while (j + 1 < v.length && v[j + 1][0] <= c[0]) j++;
        c[6] = v[j][1];
      });
      drawChart(hit.pts, { unit: s.unit, base: s.base.name, metric: 'price', volUsd: hit.volUsd, cand: true });
      chartBars('candle');
    };
    if (CH.ohlc[range] !== undefined) { drawn(CH.ohlc[range]); return; }
    var at = 0, ask = function () {
      if (gen !== CH.gen) return;
      gtGet(gtId(p.id) + '/ohlcv/' + R.tf + '?aggregate=' + R.agg + '&limit=' + R.limit + '&currency=token&token=' + encodeURIComponent(s.base.i),
        'lumos.nearGtPoolOhlc.v2.' + p.id + '.' + range + '.' + s.base.i, R.ttl)
        .then(function (j) {
          // GeckoTerminal states volume in the quote token: in dollars here wherever NEAR is one of the two sides.
          var toUsd = !USD ? null : (s.quote.i === WNEAR ? function (c) { return c[5] * USD; } : (s.base.i === WNEAR ? function (c) { return c[5] / c[1] * USD; } : null));
          var seen = {}, list = ((j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [])
            .filter(function (c) { if (!c || !(c[4] > 0) || seen[c[0]]) return false; seen[c[0]] = 1; return true; })
            .map(function (c) { return [c[0] * 1000, +c[4], +c[2], +c[3], +c[1], +c[5]]; })
            .sort(function (x, y) { return x[0] - y[0]; });
          if (toUsd) list.forEach(function (c) { c[5] = toUsd(c); });
          CH.ohlc[range] = list.length ? { pts: mergeCandles(list), volUsd: toUsd ? 1 : null } : null;
          drawn(CH.ohlc[range]);
        }, function (e) {
          if (String(e && e.message) === '404') CH.ohlc[range] = null;
          drawn(null);
          if (CH.ohlc[range] === undefined && at < 3) { at++; setTimeout(ask, [3000, 15000, 30000][at - 1]); }
        });
    };
    ask();
  }
  function renderChart() {
    var s = chartSides(), v = CH.pts;
    if (!s || !v) return;
    if (CH.metric === 'vol') {
      modeLabel(false);
      drawChart(v.map(function (q) { return [q[0], +q[5] || 0, 0, 0, 0, 0]; }), { unit: '', base: s.base.name, metric: 'vol', volUsd: 1, pre: '$' });
      chartBars('vol');
    } else if (CH.type === 'bar') {
      renderCandles(s, v);
    } else {
      modeLabel(false);
      drawChart(v, { unit: '', base: s.base.name, metric: 'tvl', volUsd: 1, pre: '$' });
    }
  }
  function loadPoolChart(range) {
    var p = window.__lxnPool;
    if (!p || !chartSides() || !$('.chart-svg-wrap')) return;
    if (range) CH.range = range;
    $$('.tf-mini button').forEach(function (b) { b.classList.toggle('active', (b.textContent || '').trim().toUpperCase() === CH.range); });
    var gen = ++CH.gen, at = 0;
    var days = CH_DAYS[CH.range] || 31;
    var daily = function () {
      rheaDaily(p.id).then(function (all) {
        if (gen !== CH.gen) return;
        var list = all.slice(-days);
        if (list.length < 2) { CH.pts = null; clearChart(); chartNote('Not enough history for this range yet.'); return; }
        CH.pts = list;
        renderChart();
      }, function () {
        if (gen !== CH.gen) return;
        if (at < 3) { at++; chartNote('Pool history is busy — retrying…'); setTimeout(daily, [3000, 15000, 30000][at - 1]); return; }
        chartNote('Could not load this pool’s history. Reload to try again.');
      });
    };
    daily();
  }
  // The design's controls, driven for real: ranges, Line / Bar, and TVL / Volume.
  function wireChartControls() {
    if (window.__lxnPoolChartWired) return;
    window.__lxnPoolChartWired = 1;
    modeLabel(false);
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
        CH.metric = mb.getAttribute('data-metric') === 'vol' ? 'vol' : 'tvl';
        [].forEach.call(mb.parentNode.querySelectorAll('button'), function (b) { b.classList.toggle('active', b === mb); });
        mb.parentNode.classList.remove('open');
        if (mb.parentNode.style.display === 'block') mb.parentNode.style.display = 'none';
      }
      renderChart();
    }, true);
  }

  // ---- Pool Transactions: swaps -----------------------------------------------------------------------------
  var TX = { rows: null, err: false, filter: 'all', page: 1, ext: '' };
  // TWENTY A PAGE, with Stellar's "Page X of Y" between the buttons (RAZA 2026-10-30: "On Stellar, it shows 20
  // transactions on Pools-pool page ... please compare with Stellar"). _ammdata.js: TXPP 20, .lx-txpg chip.
  var TX_PER = 20, ACCT_RE = /^[a-z0-9._-]{2,64}$/;
  function txAmt(v) { return v >= 1000 ? num(v, 2) : num(v, 6); }
  // OUR OWN INDEX OF RHEA, READ OFF THE CHAIN (workers/near-pool-indexer; RAZA 2026-10-30: "it must show the
  // pool trxs"). Every pool's swaps, deposits and withdrawals, from the minute it started plus a backfill. It is
  // the ONLY source of deposits and withdrawals on NEAR, and of swaps in the pools GeckoTerminal does not track
  // (every 3- and 4-token stable pool). GeckoTerminal still supplies the swaps where it has them: its history
  // runs further back than ours yet.
  // '' switches this off (the page then falls back to GeckoTerminal alone and says what it cannot list). On since
  // the indexer found a free source that keeps up: a storage-change call per block, the block's logs only where a
  // pool changed. Pool 6065's deposits/withdrawals are not indexed (see SKIP in the Worker); its swaps come from
  // GeckoTerminal.
  var IDX = 'https://near-pool-indexer.usa282.workers.dev';
  var TXI = { rows: null, from: null, failed: false };
  // THE WINDOW THE EMPTY TABS SPEAK FOR (RAZA 2026-11-10, "No deposits in the last 600 pool operations"): what was read is
  // this pool's last TX_IDX_LIMIT operations in the index. When that many came back, the record goes further back than
  // the read, so the note names the count; fewer is the whole record, which starts at the index's first day (from) and
  // is kept 30 days (workers/near-pool-indexer KEEP_DAYS), so the note names that day.
  var TX_IDX_LIMIT = 300, TX_IDX_KEEP = 30 * 86400000;
  function tokName(id) {
    var p = window.__lxnPool, t = p && p.tokens.filter(function (x) { return x.i === id; })[0];
    return t ? t.name : (id.length > 14 ? id.slice(0, 6) + '…' : id);
  }
  function loadIdx() {
    var p = window.__lxnPool;
    if (!p) return;
    if (!IDX) { TXI.off = true; return; }
    fetch(IDX + '/pool?id=' + encodeURIComponent(p.id) + '&limit=' + TX_IDX_LIMIT).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error('index');
      var ids = p.tokens.map(function (t) { return t.i; });
      return Promise.all(ids.map(function (i) { return decOf(i).catch(function () { return null; }); })).then(function (decs) {
        var dec = {}; ids.forEach(function (i, k) { dec[i] = decs[k]; });
        var amt = function (raw, tok) { return dec[tok] != null ? scaled(raw, dec[tok]) : null; };
        TXI.from = d.from || null;
        TXI.cap = (d.rows || []).length >= TX_IDX_LIMIT;
        TXI.rows = (d.rows || []).map(function (x) {
          var r = { kind: x.kind === 'add' ? 'deposit' : x.kind === 'remove' ? 'withdraw' : 'swap', who: ACCT_RE.test(x.who || '') ? x.who : '',
            t: +x.t || 0, hash: /^[A-Za-z0-9]{20,64}$/.test(x.tx || '') ? x.tx : '', src: 'idx' };
          if (r.kind === 'swap') {
            r.fromAmt = amt(x.aa, x.ta); r.toAmt = amt(x.ab, x.tb); r.from = tokName(x.ta); r.to = tokName(x.tb);
            r.a = x.ta === p.a.i ? r.fromAmt : (x.tb === p.a.i ? r.toAmt : 0);
            r.b = x.ta === p.b.i ? r.fromAmt : (x.tb === p.b.i ? r.toAmt : 0);
            r.cells = [r.fromAmt != null ? txAmt(r.fromAmt) + ' ' + r.from : '—', r.toAmt != null ? txAmt(r.toAmt) + ' ' + r.to : '—'];
          } else {
            // Every token the deposit or withdrawal moved, then the LP shares it minted or burned.
            var toks = ((x.extra && x.extra.tokens) || []).filter(function (y) { return y && y.a && y.a !== '0'; });
            // A stable pool logs no token amounts; the call's own amounts stand, in the pool's token order
            // (minimums, marked "≥", for a stable withdrawal by shares).
            if (!toks.length && x.extra && Array.isArray(x.extra.amounts)) {
              toks = x.extra.amounts.map(function (a, k) { return { a: String(a), t: (p.tokens[k] || {}).i || '' }; })
                .filter(function (y) { return y.t && y.a && y.a !== '0'; });
            }
            var ge = x.extra && x.extra.atLeast ? '≥ ' : '';
            r.cells = [toks.length ? toks.map(function (y) { var v = amt(y.a, y.t); return ge + (v != null ? txAmt(v) : '?') + ' ' + tokName(y.t); }).join(' + ') : '—',
              x.extra && x.extra.shares ? txAmt(scaled(x.extra.shares, 24)) + ' LP' : '—'];
          }
          return r;
        });
        TXI.failed = false;
        mergeTx();
      });
    }).catch(function () { TXI.failed = true; mergeTx(); });
  }
  // GeckoTerminal's swaps where it has them, the index's otherwise; deposits and withdrawals always the index's.
  var GTROWS = null;
  // THE CHAIN'S SWAPS OF THIS POOL (RAZA 2026-11-12: NEAR20 / wNEAR read "No swaps in this pool recently" on every tab).
  // GeckoTerminal sends a pool's last 24 hours, and the indexer records a two-token pool's deposits and withdrawals, not
  // its swaps. When the feed has none, /lxapi/neartokentrades reads the swaps whose own message names this pool from the
  // history of its non-wNEAR token, and says how much of that history it read (scanned of total). Two-token pools only.
  var CHAIN = { rows: null, scanned: 0, total: 0, sym: '', failed: false, asked: false };
  function chainSwaps(attempt) {
    var p = window.__lxnPool, at = attempt || 0;
    if (!p || p.tokens.length !== 2) return;
    var tok = p.a.i === WNEAR ? p.b : p.a, oth = tok === p.a ? p.b : p.a;
    CHAIN.asked = true;
    fetch('/lxapi/neartokentrades?i=' + encodeURIComponent(tok.i) + '&pool=' + encodeURIComponent(p.id))
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.rows)) throw new Error('chain');
        CHAIN.rows = j.rows.map(function (x) {
          var mine = +x.amt, other = x.near != null ? +x.near : (x.oth && x.oth.v != null ? +x.oth.v : 0);
          var sell = x.side === 'sell';
          return { kind: 'swap', a: tok === p.a ? mine : other, b: tok === p.a ? other : mine, who: ACCT_RE.test(x.addr || '') ? x.addr : '',
            t: +x.t || 0, hash: x.hash || '', from: sell ? tok.name : oth.name, to: sell ? oth.name : tok.name,
            fromAmt: sell ? mine : other, toAmt: sell ? other : mine };
        });
        CHAIN.scanned = +j.scanned || 0; CHAIN.total = +j.total || 0; CHAIN.sym = tok.name; CHAIN.failed = false;
        mergeTx();
        if (j.partial && at < 3) setTimeout(function () { chainSwaps(at + 1); }, 6000);
      }).catch(function () {
        if (at < 3) { setTimeout(function () { chainSwaps(at + 1); }, [3000, 10000, 30000][at]); return; }
        CHAIN.failed = true; renderTx();
      });
  }
  function mergeTx() {
    var gt = GTROWS, idx = TXI.rows;
    if (gt == null && idx == null && !TXI.failed && TX.err !== 'untracked' && !TX.err) return;   // nothing back yet
    var swaps = (gt && gt.length) ? gt : (idx || []).filter(function (r) { return r.kind === 'swap'; });
    if (!swaps.length && CHAIN.rows && CHAIN.rows.length) swaps = CHAIN.rows;
    var liq = (idx || []).filter(function (r) { return r.kind !== 'swap'; });
    var all = swaps.concat(liq).sort(function (x, y) { return (y.t || 0) - (x.t || 0); });
    if (all.length || idx != null) { TX.rows = all; if (all.length) TX.err = false; }
    renderTx();
  }
  function loadTx() {
    var p = window.__lxnPool;
    if (!p) return;
    loadIdx();
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
        GTROWS = TX.rows;
        TX.err = false;
        mergeTx();
        if (!GTROWS.length && !CHAIN.asked) chainSwaps(0);      // a quiet day on the feed: the chain's older swaps
      }, function (e) {
        // A 404 IS AN ANSWER, NOT A HICCUP (RAZA 2026-10-30: "why aren't pool trxs loading for such pools?").
        // GeckoTerminal does not track Rhea's 3- and 4-token stable pools at all; retrying for 48 seconds and
        // then saying "could not be loaded" told the reader to try again for something that will never come.
        if (String(e && e.message) === '404') { TX.err = 'untracked'; GTROWS = []; mergeTx(); if (!CHAIN.asked) chainSwaps(0); return; }
        if (at < 3) { at++; setTimeout(go, [3000, 15000, 30000][at - 1]); return; }
        TX.err = true; renderTx();
      });
    };
    go();
  }
  function txNote() {
    var fromMs = TXI.from ? Math.max(+TXI.from, Date.now() - TX_IDX_KEEP) : 0;
    var since = fromMs ? new Date(fromMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    if (TX.filter === 'deposit' || TX.filter === 'withdraw') {
      var what = TX.filter === 'deposit' ? 'deposits' : 'withdrawals';
      if (TXI.off) return 'Deposits and withdrawals are not published for NEAR pools yet. Only swaps are listed.';
      if (TXI.rows == null && !TXI.failed) return 'Reading this pool’s ' + what + '…';
      if (TXI.failed) return 'This pool’s ' + what + ' could not be read right now. Reload to try again.';
      if (TXI.cap) return 'No ' + what + ' in the last ' + TX_IDX_LIMIT.toLocaleString('en-US') + ' pool operations.';
      return 'No ' + what + ' in this pool' + (since ? ' since ' + since : '') + '.';
    }
    // What the chain's read covered, when it was the one asked (chainSwaps).
    if (CHAIN.rows && !CHAIN.rows.length) {
      return CHAIN.total && CHAIN.scanned >= CHAIN.total ? 'No swaps of this pool in ' + CHAIN.sym + '’s history on chain.'
        : 'No swaps of this pool among ' + CHAIN.sym + '’s latest ' + CHAIN.scanned.toLocaleString('en-US') + ' transactions on chain.';
    }
    if (CHAIN.asked && !CHAIN.rows && !CHAIN.failed) return 'Reading this pool’s swaps from the chain…';
    if (TX.err === 'untracked' && TXI.off) return 'This pool’s swaps are not published by any feed LumosCore reads yet (GeckoTerminal does not track it), so they cannot be listed here.';
    if (TX.err === 'untracked' && TXI.rows == null && !TXI.failed) return 'Reading this pool’s recent swaps…';
    if (TX.err === 'untracked' && TXI.cap) return 'No swaps in the last ' + TX_IDX_LIMIT.toLocaleString('en-US') + ' pool operations.';
    if (TX.err === 'untracked') return 'No swaps in this pool' + (since ? ' since ' + since : ' recently') + '.';
    if (TX.err) return 'Recent swaps could not be loaded right now. Reload to try again.';
    if (!TX.rows) return 'Reading this pool’s recent swaps…';
    return 'No swaps in this pool recently.';
  }
  function renderTx() {
    var p = window.__lxnPool;
    if (!p) return;
    var list = (TX.rows || []).filter(function (r) { return TX.filter === 'all' || TX.filter === r.kind; });
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
        c1.appendChild(el('span', 'type-pill ' + (r.kind || 'swap'), r.kind === 'deposit' ? 'Deposit' : r.kind === 'withdraw' ? 'Withdraw' : 'Swap'));
        tr.appendChild(c1);
        // Two-token swaps read by token (column A is always the first token), as GeckoTerminal's rows always
        // have; the index's rows on a 3- or 4-token pool, and every deposit / withdrawal, carry their own cells.
        var cells = (r.cells && (p.tokens.length > 2 || r.kind !== 'swap')) ? r.cells
          : [r.a > 0 ? (txAmt(r.a) + ' ' + p.a.name) : '—', r.b > 0 ? (txAmt(r.b) + ' ' + p.b.name) : '—'];
        cells.forEach(function (txt) {
          var td = document.createElement('td');
          var s = el('span', 'num', txt);
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
          ? ('Showing ' + (from + 1) + '–' + (from + slice.length) + ' of ' + list.length.toLocaleString('en-US') + ' transactions') : 'Showing 0 transactions';
        var nb = foot.querySelectorAll('.controls button');
        if (nb[0]) nb[0].disabled = TX.page <= 1;
        if (nb[1]) nb[1].disabled = TX.page >= pages;
        var ctr = foot.querySelector('.controls'), ind = ctr && ctr.querySelector('.lx-txpg');
        if (ctr && !ind) {
          ind = el('span', 'lx-txpg');
          ind.setAttribute('data-logoed', '1');
          ind.style.cssText = 'margin:0 12px;color:var(--text-soft);font-size:13px';
          ctr.insertBefore(ind, nb[1] || null);
        }
        if (ind) ind.textContent = 'Page ' + TX.page + ' of ' + pages;
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
        var kd = r.kind || 'swap';
        info.appendChild(el('div', 'tx-type ' + kd, kd === 'deposit' ? 'Deposit' : kd === 'withdraw' ? 'Withdraw' : 'Swap'));
        info.appendChild(el('div', 'tx-amounts', kd === 'swap'
          ? (txAmt(r.fromAmt) + ' ' + r.from + ' → ' + txAmt(r.toAmt) + ' ' + r.to)
          : ((r.cells && r.cells[0]) || '—')));
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
      paintPositionIdentity();
      posRows().forEach(function (rows) {
        rows.forEach(function (row, k) {
          var amtEl = row.querySelector('.mp-asset-amt, .mpm-asset-amt');
          if (amtEl && p.reserves[k] != null) amtEl.textContent = share > 0 ? num(p.reserves[k] * share, 6) : '0';
        });
      });
      var fees = bothPos('fee-val');
      if (fees[0]) fees[0].textContent = '—';                         // Rhea keeps no per-LP fee record
      if (fees[1]) fees[1].textContent = share > 0 ? num(scaled(mine, 24), 6) : '0';
      var value = null;
      if (share > 0 && USD && window.__lxnPoolRow && window.__lxnPoolRow.liq != null) value = window.__lxnPoolRow.liq * USD * share;
      positionState(share > 0 ? 'held' : 'none', value != null ? usdShort(value) : num(scaled(mine, 24), 4) + ' LP');
      $$('#dwWithdraw .balance').forEach(function (b) { b.textContent = 'Your LP: ' + (share > 0 ? num(scaled(mine, 24), 6) : '0'); });
      holdDw();
    }, function () {});
    // Balances: the wNEAR side shows NEAR, which a deposit wraps.
    p.tokens.forEach(function (t, k) {
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
    findSweep();                                   // tokens left on Rhea by an earlier deposit or withdrawal
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
      var pb = icons.querySelector('.pb');
      tokImg(pb, b);
      // Every token's mark, up to four (RAZA 2026-11-10: pool 1910's DAI had none; the header drew two discs). The
      // extra discs are copies of the second, so they wear its ring, and all of them are placed here in one stack.
      [].slice.call(icons.querySelectorAll('.lx-phx')).forEach(function (x) { x.parentNode.removeChild(x); });
      var n = Math.min(4, T.length);
      if (!pb || n < 3) return;
      for (var k = n - 1; k >= 2; k--) {
        var x = pb.cloneNode(false);
        x.classList.add('lx-phx');
        pb.parentNode.insertBefore(x, pb.nextSibling);
        tokImg(x, T[k]);
      }
      var kids = [].slice.call(icons.children), size = icons.querySelector('.pa').offsetWidth || 44, step = Math.round(size * 0.62);
      kids.forEach(function (c, j) {
        c.style.setProperty('position', 'absolute', 'important');
        c.style.setProperty('top', '0', 'important');
        c.style.setProperty('left', (j * step) + 'px', 'important');
        c.style.setProperty('margin-left', '0', 'important');
        c.style.setProperty('z-index', String(kids.length - j), 'important');
      });
      icons.style.setProperty('position', 'relative', 'important');
      icons.style.setProperty('width', (size + step * (kids.length - 1)) + 'px', 'important');
      icons.style.setProperty('height', size + 'px', 'important');
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
    // The address bar shows the pair form whichever way the page was reached (an /id/ link, a stale slug).
    try {
      var want = poolHref(id, T.map(function (s) { return s.name; }));
      if (location.pathname.indexOf('/pools/near/') === 0 && location.pathname.replace(/\/$/, '') !== want)
        history.replaceState(history.state, '', want + location.search + location.hash);
    } catch (e) {}
    $$('.crumb a[data-lxback]').forEach(function (bk) { bk.setAttribute('href', '/pools/near'); });

    // The pool's identity line: its Rhea id, which the copy button copies, and nothing else, as Stellar's reads
    // (RAZA 2026-11-05: "Remove extra metadata tags").
    var idSpan = $('.ph-id span');
    if (idSpan) idSpan.textContent = 'Pool ID: ' + id;
    var copyBtn = $('.ph-id button[data-copy]');
    if (copyBtn) {
      copyBtn.setAttribute('data-copy', id);
      copyBtn.setAttribute('data-copy-label', 'Pool ID');
    }
    // THE EXPLORER BUTTON GOES TO NEARBLOCKS, as the account page's does (RAZA 2026-11-07: "redirects to an incorrect
    // destination"). A pool is an entry inside one contract, not an account, so NearBlocks has no page per pool; the
    // page it does have is the pool contract's, the one every classic pool lives in.
    var exp = $('.ph-id button[data-tooltip="View on Explorer"]') || $('.ph-id button:not([data-copy])');
    if (exp && exp.parentNode) {
      var ea = document.createElement('a');
      ea.href = 'https://nearblocks.io/address/v2.ref-finance.near';
      ea.target = '_blank';
      ea.rel = 'noopener noreferrer';
      ea.title = 'View on NearBlocks';
      ea.setAttribute('aria-label', 'View the pool contract on NearBlocks');
      ea.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;color:inherit;text-decoration:none';
      while (exp.firstChild) ea.appendChild(exp.firstChild);
      exp.parentNode.replaceChild(ea, exp);
    }

    // POOL PRICE: the second token per the first, the way the pair reads and the way Stellar's header does
    // ("6.2590 XLM per USDC"). The reserve ratio IS the price only in a classic (constant-product) pool, so that
    // is the only pool it is stated for -- and why LUMOS / wNEAR had a rate while wNEAR / USDt, a degen pool, had a
    // lone dash (RAZA 2026-11-05: "show the live exchange rate"). Every other kind asks the pool: curveRate below.
    if (row.kind === 'SIMPLE_POOL' && T.length === 2 && a.amount > 0 && b.amount != null) paintRate(b.amount / a.amount, a, b);

    // LIQUIDITY: every reserve, the first as the headline and the rest beneath it in the same weight
    // (Stellar's two-sided cell). No line under them (RAZA 2026-11-07: "retaining only the direct constituent asset amounts").
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
        // THE POOL IN DOLLARS, under the amounts, as Stellar's card closes (RAZA 2026-11-10: "$1.24M"). Not the "1.18M
        // NEAR" line 267 removed: it is every reserve at its own price, and a pool with a token that has no price
        // (nearpools sends liq null, or est when it doubled the wNEAR side) gets no total rather than half of one.
        if (USD && row.liq != null && !row.est) {
          var tot = el('span', 'lx-liqusd', usdShort(row.liq * USD));
          tot.style.display = 'block';
          tot.setAttribute('data-logoed', '1');
          ls.appendChild(tot);
        }
      }
    }

    // 24h VOLUME and FEES, in NEAR with the dollar line beneath, as Stellar's two cells read, "≥" included: a
    // figure from a feed is what that feed saw, so it is a floor. Null means DexScreener does not carry this
    // pool: an em dash and why, never a zero.
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
      unitVal(cell.querySelector('.v'), (x[1] > 0 ? '≥ ' : '') + num(x[1], 2), 'NEAR');
      if (s) s.textContent = (USD && x[1] > 0) ? ('≈ ' + usdShort(x[1] * USD)) : '';
    });

    // THE FOURTH STAT IS PARTICIPANTS, as on Stellar (RAZA 2026-11-05: "Replace the 4th metric card"). The count
    // comes with the pool: lps is null when no one has counted this pool yet, which is an em dash and never a 0.
    // The indexer's approximate flag (lpa) is not shown (RAZA 2026-11-07: "renders as a clean exact integer").
    var ap = $('.ph-stat.lx-partstat') || statCell('participant');
    if (ap) {
      var lab = ap.querySelector('.l');
      if (lab) lab.textContent = 'Participants';
      var av = ap.querySelector('.v');
      var lps = row.lps == null || !isFinite(row.lps) ? null : +row.lps;
      if (av) av.textContent = lps == null ? '—' : lps.toLocaleString('en-US');
      var as = ap.querySelector('.s');
      if (as) as.textContent = lps === 1 ? 'liquidity provider' : 'liquidity providers';
    }

    window.__lxnPool = { id: id, a: a, b: b, tokens: T, fee: row.fee, kind: row.kind };
    if (row.kind !== 'SIMPLE_POOL' || T.length !== 2) curveRate();
    paintDwStatic();
    paintPositionIdentity();
    holdDw();
    live(id, row);
    loadParticipants(id);
    liftPage();
  }

  function paintRate(rate, base, quote) {
    var pv = $('.ph-price .v') || $('.ph-price .value');
    if (!pv) pv = priceBlock('value');
    if (pv) pv.textContent = rateText(rate) + ' ' + quote.name;
    // The phone's sub-line is .ph-price-row .vs, which neither the desktop selectors nor priceBlock('sub')
    // reach -- found on the phone check, where the price stood with no 'per USDC' under it.
    var ps = $('.ph-price .s') || $('.ph-price .sub') || $('.ph-price-row .vs');
    if (!ps) ps = priceBlock('sub');
    if (ps) ps.textContent = ' per ' + base.name;
  }
  // The rate on a pool's own curve: what the pool itself pays for a sliver of the first token (one ten-thousandth
  // of its reserve, too small to move the price), with the pool's fee put back so the header states the pool's
  // rate, not the swap's. A pool of three or four tokens states its first two. If the pool cannot be asked the dash
  // stands: no figure rather than a wrong one.
  function curveRate() {
    var p = window.__lxnPool;
    poolRaw().then(function (R) {
      var sliver = (bigI(R.amounts[R.ids.indexOf(p.a.i)]) / BigInt(10000)).toString();
      if (sliver === '0') return;
      return nview(REF, 'get_return', { pool_id: +p.id, token_in: p.a.i, amount_in: sliver, token_out: p.b.i }).then(function (out) {
        var rate = scaled(out, R.decs[p.b.i]) / scaled(sliver, R.decs[p.a.i]) / (1 - (+p.fee || 0) / 100);
        if (window.__lxnPool === p && rate > 0) paintRate(rate, p.a, p.b);
      });
    }).catch(function () {});
  }

  // THE POSITION PANEL'S TWO ASSETS, WHATEVER THE CONNECTION. The design ships LUMOS and APT marks and
  // names there (RAZA 2026-09-15: "why's it showing APTOS logo"), and only a connected wallet's position
  // ever repainted the names — never the marks.
  // ONE ROW PER TOKEN in each position panel (desktop .mp-asset, phone .mpm-asset): the design has two, so a
  // 3- or 4-token pool gets the last one cloned for each token after it.
  function posRows() {
    var p = window.__lxnPool, out = [];
    if (!p) return out;
    ['.my-position .mp-asset', '.my-position-m .mpm-asset'].forEach(function (sel) {
      var rows = $$(sel);
      if (!rows.length) return;
      while (rows.length < p.tokens.length) {
        var c = rows[rows.length - 1].cloneNode(true);
        c.setAttribute('data-lxextra', '1');
        rows[rows.length - 1].parentNode.insertBefore(c, rows[rows.length - 1].nextSibling);
        rows = $$(sel);
      }
      out.push(rows.slice(0, p.tokens.length));
    });
    return out;
  }
  function paintPositionIdentity() {
    var p = window.__lxnPool;
    if (!p) return;
    posRows().forEach(function (rows) { rows.forEach(function (row, i) {
      var s = p.tokens[i];
      tokImg(row.querySelector('.mp-asset-ico, .mpm-asset-ico'), s);
      var nm = row.querySelector('.mp-asset-name, .mpm-asset-name');
      if (nm) { nm.setAttribute('data-logoed', '1'); nm.textContent = s.name; }
      var amtEl = row.querySelector('.mp-asset-amt, .mpm-asset-amt');
      if (amtEl) amtEl.textContent = '—';            // not read on NEAR yet
    }); });
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
    // ONE FIELD PER TOKEN (RAZA 2026-10-30: "how can we enable deposit and withdrawal for such pools on
    // LumosCore"). The design has two; a 3- or 4-token stable pool gets the second cloned, with its "+"
    // divider, for each token after it. Rhea's add_stable_liquidity and remove_liquidity take any count.
    var depBox = $('#dwDeposit'), fields = $$('#dwDeposit .dw-field');
    while (depBox && fields.length >= 2 && fields.length < p.tokens.length) {
      var plus = depBox.querySelector('.dw-plus');
      var f2 = fields[fields.length - 1].cloneNode(true);
      f2.setAttribute('data-lxextra', '1');
      var fin = f2.querySelector('input'); if (fin) fin.value = '';
      var bal2 = f2.querySelector('.balance'); if (bal2) bal2.textContent = 'Balance: —';
      if (plus) depBox.appendChild(plus.cloneNode(true));
      depBox.appendChild(f2);
      fields = $$('#dwDeposit .dw-field');
    }
    p.tokens.forEach(function (s, i) {
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
    // The two "You receive" rows on the withdraw side name the pool's assets. The box itself is hidden (RAZA 2026-11-12:
    // Stellar's withdraw box is the LP field, 25/50/75/Max and the summary rows); it is kept in the page, unseen,
    // because the withdraw code still reads its rows.
    var recv = $$('#dwWithdraw .dw-field')[1];
    if (recv) recv.style.display = 'none';
    if (recv) {
      var rows = recv.querySelectorAll('.row');
      while (rows.length && rows.length < p.tokens.length) {
        var rc = rows[rows.length - 1].cloneNode(true);
        rc.setAttribute('data-lxextra', '1');
        rows[rows.length - 1].parentNode.insertBefore(rc, rows[rows.length - 1].nextSibling);
        rows = recv.querySelectorAll('.row');
      }
      p.tokens.forEach(function (s, i) {
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

    // Share-after and network fee have nothing to compute from until the form can be used.
    setSummary('pool share', '—');
    setSummary('network fee', '—');
  }

  // Two rows, as on Stellar (RAZA 2026-11-05: "Remove the Trading fee tier"). Removed, not hidden, from holdDw so
  // the deposit and withdraw tabs, which share this one summary, both lose it however early they are drawn.
  function dropFeeRow() {
    $$('.dw-summary .r').forEach(function (r) {
      var k = r.querySelector('span');
      if (k && (k.textContent || '').toLowerCase().indexOf('trading fee') >= 0) r.parentNode.removeChild(r);
    });
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
    var dep = $$('#dwDeposit .dw-field input');
    return { a: dep[0], b: dep[1], dep: dep, lp: $('#dwWithdraw input') };
  }

  // ---- Deposit / Withdraw ---------------------------------------------------------------------------------
  // RAZA 2026-10-30: "Yes, build Deposit and Withdraw for NEAR pools next." Then, the same day, on a rated pool
  // (rNEAR / wNEAR): "its showing 'Adding liquidity to this pool type is not supported here' ... Make it list what
  // we have on Stellar and XRPL" -- where every listed pool takes a deposit. So every two-token Rhea pool does:
  //   CLASSIC (SIMPLE_POOL)               add_liquidity({pool_id, amounts, min_amounts: 99.5%})
  //   STABLE / RATED / DEGEN              add_stable_liquidity({pool_id, amounts, min_shares}), min_shares 99.5%
  //                                       of Rhea's own predict_add_stable_liquidity -- these pools mint on their
  //                                       curve, not the reserve ratio. 100 TGas, 0.01 NEAR: exactly what Rhea's
  //                                       app sent for a degen pool on 2026-10-30 (tx ACBgAYtu…), with no rate
  //                                       refresh beforehand (update_token_rate has no mainnet calls).
  // The amounts are still entered in the pool's own proportion (a balanced deposit) on every kind. Withdraw is
  // remove_liquidity on every kind: Rhea's predict_remove_liquidity on the rated pool returned the plain
  // proportional figures. Pools of three or more tokens (the two-field form cannot express them) say so.
  //
  // DEPOSIT, the transactions the launchpad already signs on mainnet (browser/nearmint.js, pool 8978):
  //   Rhea      [storage_deposit for the shortfall], register_tokens(the pool's tokens not yet in the account)
  //   wrap.near [storage_deposit if unregistered], near_deposit(NEAR side), ft_transfer_call(Rhea, msg "")
  //   token     ft_transfer_call(Rhea, msg "")
  //   Rhea      add_liquidity({pool_id, amounts, min_amounts: 99.5%}) 0.01 NEAR, ~0.009 refunded
  // Anything already sitting in the account on Rhea is used before more is sent. The second amount follows the
  // pool's reserve ratio exactly, in raw units.
  //
  // WITHDRAW, two presses on purpose. remove_liquidity({pool_id, shares, min_amounts: 99.5%}) puts the tokens in
  // the account ON RHEA; the exact amounts are known only after it runs. The button then reads "Withdraw to
  // wallet", which reads get_deposits and sends every pool token home (registering the account on a token
  // first if needed) and unwraps wNEAR to NEAR -- so nothing is left behind on Rhea, and the same button appears
  // whenever a deposit's leftovers or an interrupted withdrawal are found there.
  //
  // Every flow keeps 0.2 NEAR for gas (see browser/nearswap.js, SWAP_KEEP), and a wallet error is reported in
  // the wallet's own words after reading what reached the chain.
  var REF = 'v2.ref-finance.near', WNEAR = 'wrap.near';
  var BYTE = BigInt('10000000000000000000'), REF_NEW = BigInt('10000000000000000000000'), REF_TOKEN_BYTES = 148;
  var LIQ_DEPOSIT = '10000000000000000000000', GAS_KEEP = BigInt('200000000000000000000000'), FT_REG = '1250000000000000000000';
  var DW = { busy: false, sweep: null };
  function bigI(v) { try { return BigInt(String(v || '0')); } catch (e) { return BigInt(0); } }
  function toRaw(v, dec) {
    var s = String(v == null ? '' : v).replace(/,/g, '').trim();
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    var p = s.split('.'), frac = (p[1] || '').slice(0, dec);
    while (frac.length < dec) frac += '0';
    var r = ((p[0] || '0') + frac).replace(/^0+(?=\d)/, '');
    return r;
  }
  function fromRaw(raw, dec, dp) {
    var s = String(raw || '0');
    while (s.length <= dec) s = '0' + s;
    var whole = s.slice(0, s.length - dec), frac = s.slice(s.length - dec).slice(0, dp == null ? 6 : dp).replace(/0+$/, '');
    return whole + (frac ? '.' + frac : '');
  }
  function fcall(m, args, tgas, dep) { return { type: 'FunctionCall', params: { methodName: m, args: args, gas: String(tgas) + '000000000000', deposit: String(dep) } }; }
  function less(raw, bps) { return (bigI(raw) * BigInt(10000 - bps) / BigInt(10000)).toString(); }
  var DW_KINDS = { SIMPLE_POOL: 1, STABLE_SWAP: 1, RATED_SWAP: 1, DEGEN_SWAP: 1 };
  // Any number of tokens on a curve pool; a classic pool is always two.
  function canDw() {
    var p = window.__lxnPool;
    if (!p || !DW_KINDS[p.kind] || !p.tokens || p.tokens.length < 2) return false;
    return p.kind !== 'SIMPLE_POOL' || p.tokens.length === 2;
  }
  function stableKind() { var p = window.__lxnPool; return !!(p && p.kind !== 'SIMPLE_POOL'); }
  // The pool as Rhea holds it, in raw units and in its own token order.
  function poolRaw() {
    var p = window.__lxnPool;
    if (!p) return Promise.reject(new Error('no pool'));
    if (p.rawP) return p.rawP;
    p.rawP = Promise.all([nview(REF, 'get_pool', { pool_id: +p.id }), Promise.all(p.tokens.map(function (t) { return decOf(t.i); }))])
      .then(function (r) {
        var pool = r[0] || {}, ids = pool.token_account_ids || [], decs = {};
        p.tokens.forEach(function (t, k) { decs[t.i] = r[1][k]; });
        return { ids: ids, amounts: (pool.amounts || []).map(String), supply: String(pool.shares_total_supply || '0'), decs: decs };
      });
    p.rawP.catch(function () { p.rawP = null; });
    return p.rawP;
  }
  function dwSay(text, tone) {
    var card = $('.dw-card');
    if (!card) return;
    var box = card.querySelector('.lxx-dwsay');
    if (!box) {
      box = el('div', 'lxx-dwsay');
      box.setAttribute('data-logoed', '1');
      box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
      card.appendChild(box);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }
  function dwToast(msg) {
    if (typeof window.lxToast === 'function') { try { window.lxToast(msg); return; } catch (e) {} }
    dwSay(msg, 'good');
  }

  var DW_OFF = { deposit: 'Pools of more than two tokens cannot take deposits here yet', withdraw: 'Pools of more than two tokens cannot be withdrawn here yet' };
  function dwMode() {
    var t = $('.dw-tabs button.active');
    return (t && t.getAttribute('data-dw')) === 'withdraw' ? 'withdraw' : 'deposit';
  }
  // Stellar's two words: "Add Liquidity" and "Withdraw". The "+" in front of each is the design's own icon, which
  // both tabs share there too (RAZA 2026-11-05: "+ Withdraw").
  function ctaLabel() {
    if (!window.__lxnPool) return dwMode() === 'withdraw' ? 'Withdraw' : 'Add Liquidity';   // still reading
    if (!canDw()) return DW_OFF[dwMode()];
    if (DW.sweep && DW.sweep.length) return 'Withdraw to wallet';
    return dwMode() === 'withdraw' ? 'Withdraw' : 'Add Liquidity';
  }
  // Something to send: every deposit field above zero, or an LP amount; "Withdraw to wallet" needs neither. The
  // button stayed live on an empty form (RAZA 2026-11-05: "uses active button styling when form inputs are empty").
  function amountsIn() {
    if (DW.sweep && DW.sweep.length) return true;
    var i = dwInputs(), pos = function (x) { return parseFloat(inVal(x)) > 0; };
    if (dwMode() === 'withdraw') return pos(i.lp);
    return i.dep.length > 0 && i.dep.every(pos);
  }
  function syncCta() {
    var ready = canDw() && amountsIn();
    setCta(ctaLabel(), ready, canDw() && !ready ? 'Enter an amount' : '');
  }
  var CTA_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  function setCta(label, on, why) {
    $$('.dw-cta').forEach(function (b) {
      // lx-gate swaps this button to "Connect wallet" while no wallet is connected and restores data-lxorig /
      // data-lxdis on connect, so both always carry the state this layer wants.
      b.setAttribute('data-lxorig', label);
      b.setAttribute('data-lxdis', on ? '0' : '1');
      if ((b.textContent || '').trim() === 'Connect wallet') { b.classList.remove('lx-dwoff'); return; }
      if (DW.busy) return;
      b.classList.toggle('lx-dwoff', !on);
      b.disabled = !on;
      if (on) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
      b.title = on ? '' : (why || label);
      // lx-gate restores the label with textContent, which takes the icon with it.
      if (!b.querySelector('svg')) b.insertAdjacentHTML('afterbegin', CTA_ICON);
      var wrote = false;
      [].forEach.call(b.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) { nd.nodeValue = ' ' + label + ' '; wrote = true; }
      });
      if (!wrote) b.appendChild(document.createTextNode(' ' + label + ' '));
    });
  }
  function holdDw() {
    // Balances already read stay on screen when the tabs switch (loadMine fills them).
    var P = window.__lxnPool || {};
    $$('#dwDeposit .balance').forEach(function (b, k) {
      var v = P['bal' + k], t = P.tokens && P.tokens[k];
      b.textContent = 'Balance: ' + (v != null ? num(v, 6) + (t && t.i === WNEAR ? ' NEAR' : '') : '—');
    });
    $$('#dwWithdraw .balance').forEach(function (b) {
      b.textContent = 'Your LP: ' + (P.myShares != null ? (P.myShares !== '0' ? fromRaw(P.myShares, 24, 6) : '0') : '—');
    });
    try { document.documentElement.classList.add('lx-dwready'); } catch (e) {}
    var on = canDw();
    $$('#dwDeposit input, #dwWithdraw input').forEach(function (i) {
      if (!on) i.value = '';
      i.disabled = !on;
      if (on) i.removeAttribute('aria-disabled'); else i.setAttribute('aria-disabled', 'true');
    });
    $$('#dwDeposit .max-btn, #dwWithdraw .dw-pct-b').forEach(function (b) {
      b.style.pointerEvents = on ? '' : 'none';
      b.style.opacity = on ? '' : '.45';
      if (on) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
      if (b.tagName === 'BUTTON') b.disabled = !on;
    });
    syncCta();
    dropFeeRow();
    if (on) setSummary('network fee', '≈ 0.003 NEAR');
  }

  // ---- the form: amounts, ratio, previews ----
  function inVal(i) { return i ? String(i.value || '').replace(/,/g, '') : ''; }
  // The other fields follow the one typed in, in the pool's own proportion (a balanced deposit), for any count.
  function syncRatio(from) {
    var p = window.__lxnPool, i = dwInputs();
    var k0 = from === 'a' ? 0 : from === 'b' ? 1 : +from;
    if (!p || !i.dep[k0] || !p.tokens[k0]) return;
    poolRaw().then(function (R) {
      var t0 = p.tokens[k0], r0 = bigI(R.amounts[R.ids.indexOf(t0.i)]);
      if (!(r0 > BigInt(0))) return;
      var x0 = toRaw(inVal(i.dep[k0]), R.decs[t0.i]);
      p.tokens.forEach(function (t, k) {
        if (k === k0 || !i.dep[k]) return;
        var rk = bigI(R.amounts[R.ids.indexOf(t.i)]);
        i.dep[k].value = x0 && x0 !== '0' ? fromRaw((bigI(x0) * rk / r0).toString(), R.decs[t.i], 6) : '';
      });
      previewDeposit(R);
      syncCta();                                     // a value set from here fires no input event
    }, function () {});
  }
  // Every field's amount in raw units, keyed by token id; null when one is empty or zero.
  function depAmounts(R) {
    var p = window.__lxnPool, ins = dwInputs().dep, amt = {}, ok = true;
    p.tokens.forEach(function (t, k) {
      var x = toRaw(inVal(ins[k]), R.decs[t.i]);
      if (!x || x === '0') ok = false;
      amt[t.i] = x;
    });
    return ok ? amt : null;
  }
  function previewDeposit(R) {
    var p = window.__lxnPool, i = dwInputs();
    if (!p || !R) return;
    var ka = R.ids.indexOf(p.a.i), xa = toRaw(inVal(i.a), R.decs[p.a.i]);
    var ra = bigI(R.amounts[ka]), sup = bigI(R.supply), mine = bigI(p.myShares || '0');
    if (!xa || xa === '0' || !(ra > BigInt(0)) || !(sup > BigInt(0))) { setSummary('pool share', '—'); return; }
    if (stableKind()) {
      var all = depAmounts(R);
      if (!all) { setSummary('pool share', '—'); return; }
      var amts = R.ids.map(function (t) { return all[t]; });
      nview(REF, 'predict_add_stable_liquidity', { pool_id: +p.id, amounts: amts }).then(function (got) {
        var m2 = bigI(got);
        var af = Number((mine + m2) * BigInt(1000000) / (sup + m2)) / 1e4;
        setSummary('pool share', (af < 0.0001 ? '<0.0001' : af.toFixed(4)) + '%');
      }, function () { setSummary('pool share', '—'); });
      return;
    }
    var minted = sup * bigI(xa) / ra;
    var after = Number((mine + minted) * BigInt(1000000) / (sup + minted)) / 1e4;
    setSummary('pool share', (after < 0.0001 ? '<0.0001' : after.toFixed(4)) + '%');
  }
  function previewWithdraw() {
    var p = window.__lxnPool, i = dwInputs();
    if (!p || !i.lp) return;
    syncCta();
    poolRaw().then(function (R) {
      var sh = toRaw(inVal(i.lp), 24), sup = bigI(R.supply);
      var recv = $$('#dwWithdraw .dw-field')[1], rows = recv ? recv.querySelectorAll('.row') : [];
      p.tokens.forEach(function (t, k) {
        var out = rows[k] && recvOut(rows[k]);
        if (!out) return;
        var amt = (sh && sup > BigInt(0)) ? (bigI(R.amounts[R.ids.indexOf(t.i)]) * bigI(sh) / sup).toString() : '0';
        out.textContent = fromRaw(amt, R.decs[t.i], 6);
      });
      var mine = bigI(p.myShares || '0'), s = bigI(sh || '0');
      var after = (sup - s) > BigInt(0) ? Number((mine > s ? mine - s : BigInt(0)) * BigInt(1000000) / (sup - s)) / 1e4 : 0;
      setSummary('pool share', sh ? ((after < 0.0001 && after > 0 ? '<0.0001' : after.toFixed(4)) + '%') : '—');
    }, function () {});
  }

  // ---- signing ----
  function signTxs(me, txs) {
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      if (txs.length === 1) return w.signAndSendTransaction({ signerId: me, receiverId: txs[0].receiverId, actions: txs[0].actions }).then(function (r) { return [r]; });
      return w.signAndSendTransactions({ signerId: me, transactions: txs });
    });
  }
  function failed(res) {
    return (res || []).some(function (r) { return r && r.status && typeof r.status === 'object' && r.status.Failure; });
  }
  function errText(e, what) {
    var m = String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 180);
    try { console.warn('[LumosCore pool] wallet error:', e); } catch (x) {}
    return 'Nothing more was ' + what + '. The wallet said: "' + (m || 'no reason given') + '". Check your wallet activity before trying again.';
  }
  function storageOf(c, me) { return nview(c, 'storage_balance_of', { account_id: me }); }
  function refState(me, ids) {
    return storageOf(REF, me).then(function (sb) {
      if (!sb) return { need: REF_NEW.toString(), deps: {}, fresh: ids.slice() };
      return Promise.all([nview(REF, 'get_user_storage_state', { account_id: me }), nview(REF, 'get_deposits', { account_id: me })]).then(function (r) {
        var st = r[0] || {}, deps = r[1] || {};
        var fresh = ids.filter(function (t) { return !(t in deps); });
        var need = bigI(st.usage) + BigInt(fresh.length * REF_TOKEN_BYTES) * BYTE, have = bigI(st.deposit || sb.total);
        return { need: need > have ? (need - have).toString() : '0', deps: deps, fresh: fresh };
      });
    });
  }

  function doDeposit() {
    var p = window.__lxnPool, me = addr(), i = dwInputs();
    return Promise.all([poolRaw(), nativeBal(me)]).then(function (r0) {
      var R = r0[0], nearHave = bigI(r0[1]);
      if (p.tokens.some(function (t) { return R.ids.indexOf(t.i) < 0; })) throw new Error('This pool’s tokens could not be matched.');
      var amt = depAmounts(R);
      if (!amt) throw new Error('Enter an amount to deposit.');
      var amounts0 = R.ids.map(function (t) { return amt[t]; });
      return Promise.all([refState(me, R.ids), Promise.all(R.ids.map(function (t) {
        return t === WNEAR ? Promise.resolve(null) : nview(t, 'ft_balance_of', { account_id: me });
      })), storageOf(WNEAR, me),
      stableKind() ? nview(REF, 'predict_add_stable_liquidity', { pool_id: +p.id, amounts: amounts0 }) : Promise.resolve(null)]).then(function (r) {
        var st = r[0], bals = r[1], wrapReg = !!r[2], predicted = r[3];
        if (stableKind() && !(bigI(predicted) > BigInt(0))) throw new Error('The pool could not price this deposit. Nothing was sent.');
        var txs = [], needNear = BigInt(0), refActs = [];
        if (bigI(st.need) > BigInt(0)) { refActs.push(fcall('storage_deposit', { account_id: me, registration_only: false }, 30, st.need)); needNear += bigI(st.need); }
        if (st.fresh.length) refActs.push(fcall('register_tokens', { token_ids: st.fresh }, 30, '1'));
        if (refActs.length) txs.push({ receiverId: REF, actions: refActs });
        R.ids.forEach(function (t, k) {
          var want = bigI(amt[t]), already = bigI(st.deps[t] || '0'), send = want > already ? want - already : BigInt(0);
          if (!(send > BigInt(0))) return;
          if (t === WNEAR) {
            var w = [];
            if (!wrapReg) { w.push(fcall('storage_deposit', { account_id: me, registration_only: true }, 10, FT_REG)); needNear += bigI(FT_REG); }
            w.push(fcall('near_deposit', {}, 10, send.toString()));
            w.push(fcall('ft_transfer_call', { receiver_id: REF, amount: send.toString(), msg: '' }, 100, '1'));
            needNear += send;
            txs.push({ receiverId: WNEAR, actions: w });
          } else {
            if (bigI(bals[k]) < send) {
              var tk = p.tokens.filter(function (x) { return x.i === t; })[0] || { name: t };
              throw new Error('Insufficient ' + tk.name + ' balance — you have ' + fromRaw(bals[k], R.decs[t], 6));
            }
            txs.push({ receiverId: t, actions: [fcall('ft_transfer_call', { receiver_id: REF, amount: send.toString(), msg: '' }, 100, '1')] });
          }
        });
        var amounts = amounts0;
        if (stableKind()) {
          txs.push({ receiverId: REF, actions: [fcall('add_stable_liquidity', { pool_id: +p.id, amounts: amounts, min_shares: less(predicted, 50) }, 100, LIQ_DEPOSIT)] });
        } else {
          txs.push({ receiverId: REF, actions: [fcall('add_liquidity', { pool_id: +p.id, amounts: amounts, min_amounts: amounts.map(function (a) { return less(a, 50); }) }, 60, LIQ_DEPOSIT)] });
        }
        needNear += bigI(LIQ_DEPOSIT);
        if (nearHave < needNear + GAS_KEEP) {
          throw new Error('Not enough NEAR: this deposit needs ' + fromRaw(needNear.toString(), 24, 4) + ' NEAR plus 0.2 NEAR kept for gas. You have ' + fromRaw(nearHave.toString(), 24, 4) + ' NEAR.');
        }
        return txs;
      });
    }).then(function (txs) {
      dwSay(txs.length > 1 ? 'Approve ' + txs.length + ' transactions in your wallet…' : 'Confirm in your wallet…');
      return signTxs(me, txs).then(function (res) {
        if (failed(res)) throw new Error('A transaction failed on chain. Check your wallet activity; anything sent to the pool contract can be withdrawn with “Withdraw to wallet”.');
        return res;
      });
    });
  }

  function doRemove() {
    var p = window.__lxnPool, me = addr(), i = dwInputs();
    return poolRaw().then(function (R) {
      var mine = bigI(p.myShares || '0');
      var sh = i.lp && i.lp.__lxnAll ? mine.toString() : toRaw(inVal(i.lp), 24);
      if (!sh || sh === '0') throw new Error('Enter how many LP shares to remove.');
      if (bigI(sh) > mine) throw new Error('You only have ' + fromRaw(mine.toString(), 24, 6) + ' LP shares in this pool.');
      var sup = bigI(R.supply);
      var mins = R.ids.map(function (t, k) { return less((bigI(R.amounts[k]) * bigI(sh) / sup).toString(), 50); });
      return nativeBal(me).then(function (nb) {
        if (bigI(nb) < GAS_KEEP) throw new Error('Keep at least 0.2 NEAR in your wallet for gas. You have ' + fromRaw(nb, 24, 4) + ' NEAR.');
        dwSay('Confirm in your wallet…');
        return signTxs(me, [{ receiverId: REF, actions: [fcall('remove_liquidity', { pool_id: +p.id, shares: sh, min_amounts: mins }, 60, '1')] }]);
      });
    }).then(function (res) {
      if (failed(res)) throw new Error('The pool did not remove the liquidity (the price may have moved past 0.5%). Nothing was removed.');
      return res;
    });
  }

  // What this account holds ON RHEA in this pool's tokens -- the second withdraw step, and leftovers.
  function findSweep() {
    var p = window.__lxnPool, me = addr();
    if (!p || !me || !canDw()) return Promise.resolve(null);
    return nview(REF, 'get_deposits', { account_id: me }).then(function (deps) {
      DW.sweep = p.tokens.filter(function (t) { return bigI((deps || {})[t.i]) > BigInt(0); })
        .map(function (t) { return { i: t.i, name: t.name, raw: String(deps[t.i]) }; });
      if (DW.sweep.length) {
        Promise.all(DW.sweep.map(function (s) { return decOf(s.i); })).then(function (ds) {
          dwSay('Held for you in the pool contract: ' + DW.sweep.map(function (s, k) { return fromRaw(s.raw, ds[k], 6) + ' ' + (s.i === WNEAR ? 'NEAR' : s.name); }).join(' and ')
            + '. Press “Withdraw to wallet” to bring it home.');
        });
      }
      holdDw();
      return DW.sweep;
    }, function () { return null; });
  }
  function doSweep() {
    var me = addr(), list = DW.sweep || [];
    if (!list.length) return Promise.resolve();
    return Promise.all(list.map(function (s) { return storageOf(s.i, me); })).then(function (regs) {
      var txs = [], refActs = [], wnear = null;
      list.forEach(function (s, k) {
        if (!regs[k]) txs.push({ receiverId: s.i, actions: [fcall('storage_deposit', { account_id: me, registration_only: true }, 10, FT_REG)] });
        refActs.push(fcall('withdraw', { token_id: s.i, amount: s.raw, unregister: false }, 100, '1'));
        if (s.i === WNEAR) wnear = s.raw;
      });
      txs.push({ receiverId: REF, actions: refActs });
      if (wnear) txs.push({ receiverId: WNEAR, actions: [fcall('near_withdraw', { amount: wnear }, 10, '1')] });
      dwSay(txs.length > 1 ? 'Approve ' + txs.length + ' transactions in your wallet…' : 'Confirm in your wallet…');
      return signTxs(me, txs);
    }).then(function (res) {
      if (failed(res)) throw new Error('Part of the withdrawal failed on chain. Check your wallet activity; what is still in the pool contract can be withdrawn again.');
      return res;
    });
  }

  function submitDw() {
    if (DW.busy || !canDw()) return;
    var me = addr();
    if (!me) { dwSay('Connect a NEAR wallet first.', 'bad'); return; }
    var sweeping = DW.sweep && DW.sweep.length, mode = dwMode();
    var job = sweeping ? doSweep() : (mode === 'withdraw' ? doRemove() : doDeposit());
    DW.busy = true;
    $$('.dw-cta').forEach(function (b) { b.disabled = true; });
    var what = sweeping ? 'withdrawn' : (mode === 'withdraw' ? 'removed' : 'deposited');
    job.then(function () {
      DW.busy = false;
      var i = dwInputs();
      i.dep.concat([i.lp]).forEach(function (x) { if (x) { x.value = ''; x.__lxnAll = false; } });
      var p = window.__lxnPool;
      if (p) p.rawP = null;
      if (sweeping) { DW.sweep = null; dwSay(''); dwToast('Tokens withdrawn to your wallet'); }
      else if (mode === 'withdraw') dwToast('Liquidity removed');
      else { dwSay(''); dwToast('Liquidity added'); }
      setTimeout(function () { loadMine(); findSweep(); }, 1500);
    }, function (e) {
      DW.busy = false;
      var m = String((e && e.message) || e || '');
      // Our own checks (before signing) are exact; a wallet's error gets its own words and a look at the chain.
      var ours = /^(Enter |Insufficient |Not enough NEAR|Keep at least|You only have|This pool|Rhea did not|A transaction failed|Part of the withdrawal)/.test(m);
      dwSay(ours ? m : errText(e, what), 'bad');
      setTimeout(function () { loadMine(); findSweep(); }, 1500);
    }).then(holdDw, holdDw);
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
        if (!DW.sweep || !DW.sweep.length) dwSay('');
        holdDw();
      });
    });
    var i = dwInputs();
    // Delegated: a 3- or 4-token pool's extra fields are cloned after this runs.
    var depHost = $('#dwDeposit');
    if (depHost) {
      depHost.addEventListener('input', function (e) {
        var k = dwInputs().dep.indexOf(e.target);
        if (k >= 0) { syncCta(); syncRatio(k); }
      });
      depHost.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('.max-btn');
        if (!btn) return;
        e.preventDefault();
        var p = window.__lxnPool, ii = dwInputs();
        if (!p || !canDw()) return;
        var k = $$('#dwDeposit .max-btn').indexOf(btn), t = p.tokens[k], v = p['bal' + k];
        if (!t || v == null || !ii.dep[k]) return;
        // The NEAR side keeps 0.25 back: 0.2 for gas and room for the deposit's own storage.
        if (t.i === WNEAR) v = Math.max(0, v - 0.25);
        ii.dep[k].value = String(Math.floor(v * 1e6) / 1e6);
        syncRatio(k);
      }, true);
    }
    if (i.lp) i.lp.addEventListener('input', function () { i.lp.__lxnAll = false; previewWithdraw(); });
    $$('#dwWithdraw .dw-pct-b').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var p = window.__lxnPool, ii = dwInputs();
        if (!p || !ii.lp || !canDw()) return;
        var mine = bigI(p.myShares || '0');
        var tx = (btn.textContent || '').trim().toLowerCase(), f = tx === 'max' ? 100 : parseInt(tx, 10);
        if (!(f > 0)) f = 100;
        ii.lp.value = fromRaw((mine * BigInt(f) / BigInt(100)).toString(), 24, 6);
        ii.lp.__lxnAll = f === 100;                    // MAX removes every share, not the rounded figure
        previewWithdraw();
      }, true);
    });
    $$('.dw-cta').forEach(function (b) {
      b.addEventListener('click', function (e) {
        if (b.getAttribute('data-lxgate') === '1' || (b.textContent || '').trim() === 'Connect wallet') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        submitDw();
      }, true);
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

  // THE CARD READS AS STELLAR'S (RAZA 2026-11-05: "Rename the widget header title from My Position to Position
  // Value and remove the percentage badge"): "Position Value" over a centred "YOUR POSITION", an em dash and one
  // line saying why. Holding liquidity, the value takes the dash's place, the sub-header steps aside and the line
  // reads "current value", as there. 'unread' is a connected wallet not answered yet: saying "no liquidity" then
  // would be a claim.
  function positionState(state, value) {
    var line = state === 'held' ? 'current value' : (state === 'none' ? 'You have no liquidity in this pool'
      : (state === 'off' ? 'Connect your wallet to see your position' : ''));
    $$('.my-position, .my-position-m').forEach(function (mp) { mp.classList.toggle('active', state === 'held'); });
    $$('.position-share-pill, .my-position-m .mpm-share').forEach(function (s) { s.style.display = 'none'; });
    $$('.side-card .side-head h3').forEach(function (h) { if (/^my position$/i.test((h.textContent || '').trim())) h.textContent = 'Position Value'; });
    $$('.my-position .mp-label').forEach(function (l) { l.textContent = 'Your Position'; l.style.display = state === 'held' ? 'none' : ''; });
    bothPos('amount').forEach(function (a) { a.textContent = state === 'held' ? value : '—'; });
    // Replaced wholesale: the "· all time" is a bare text node beside the span, so blanking only
    // the span would leave the page reading "— · all time".
    bothPos('pnl').forEach(function (p) { p.textContent = line; p.style.color = 'var(--text-muted)'; });
  }

  function clearMockPosition() {
    positionState(addr() ? 'unread' : 'off');
    // The phone puts the delta straight into .pnl-up/.pnl-down with no .mpm-pnl wrapper.
    $$('.my-position-m .pnl-up, .my-position-m .pnl-down').forEach(function (p) { p.textContent = '—'; });

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
          fail('There is no pool with this id.', 'Pool not found');
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
