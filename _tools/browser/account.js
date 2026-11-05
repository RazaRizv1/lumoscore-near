// NEAR Account page (/account/near/<account id>). PORTED FROM the XRPL fork's _tools/browser/account.js
// (2026-10-21) and kept structurally parallel, so a fix to one can be carried to the other. The dated
// notes below are that file's history and describe the XRP Ledger build where they name it; the
// behaviour they protect (the design's own rows and classes, the Assets/Pools tab switch at window
// capture, copy / QR / "Send to this wallet", the logo queue with a lettered placeholder) applies here.
//
// WHAT IS NEAR'S -- and none of it is a second implementation: balances, token metadata and activity are
// window.lxnCore (browser/nearcore.js), the SAME code the Wallet page reads the connected account with.
//   balances   view_account (liquid amount; storage is amount the account keeps), FastNEAR's token index,
//              decimals/logos/prices from /lxapi/nearmarket, ft_metadata for the rest under the 4s cap.
//   value      balance x price-in-NEAR x NEAR/USD, the wallet's sum, so the two pages cannot disagree.
//   activity   FastNEAR's transaction index (lxnCore.activityData), cached 60s, 429 backs off.
//   pools      Rhea LP shares (plus farm-staked), found via the account's Rhea deposits -- see paintPools.
//   tick       the curated list (the Trade roster) plus wNEAR, as on the Wallet page.
// Any id that is not a NEAR account id gets the design's empty states with a NEAR sentence; an id that
// is valid but unknown to the chain says that. Never a Stellar fallback.
//
// From the XRPL file:
//   Stellar's public wallet page, row for row: full address, identicon with the network badge,
//   "Explorer" beneath; each stat with its second line; .acc-row asset rows that open the token's
//   trade page; .activity-row rows with icon, what happened, when, the amounts, an explorer link.
(function () {
  if (window.__lxnAccount) return;
  window.__lxnAccount = 1;

  var C = window.lxnCore;
  var NEAR_LOGO = C.NEAR_LOGO, WNEAR = C.WNEAR;
  var EXPLORER = 'https://nearblocks.io/address/';
  var EXPLORER_TX = 'https://nearblocks.io/txns/';
  var PER = 25;                                    // the design's pager step (Stellar's account page)
  var EXT_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
  var ICONS = {
    receive: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>',
    swap: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>',
    lp: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
    settings: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    other: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>',
    order: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>'
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  var SUBD = String.fromCharCode(8320, 8321, 8322, 8323, 8324, 8325, 8326, 8327, 8328, 8329);
  function zsub(n) { var s = String(n), o = ''; for (var i = 0; i < s.length; i++) o += SUBD.charAt(+s.charAt(i)); return o; }
  function trimZ(t) {
    while (t.length > 1 && t.charAt(t.length - 1) === '0') t = t.slice(0, -1);
    if (t.charAt(t.length - 1) === '.') t = t.slice(0, -1);
    return t;
  }
  function smallNum(x, sig) {
    x = +x || 0; if (!(x > 0)) return '0';
    if (x >= 1e-8) return trimZ(x.toFixed(8));
    var e = x.toExponential((sig || 4) - 1), i = e.indexOf('e');
    if (i < 0) return String(x);
    var mant = trimZ(e.slice(0, i)).split('.').join(''), ex = -parseInt(e.slice(i + 1), 10);
    if (!(ex > 1)) return trimZ(x.toFixed(8));
    return '0.0' + zsub(ex - 1) + mant;
  }
  function bal(n) {
    n = +n; if (!isFinite(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1000) return Math.round(n).toLocaleString('en-US'); if (n >= 1) return trimZ(n.toFixed(4));
    if (n > 0) return smallNum(n, 4); return '0';
  }
  function money(n) {
    n = +n || 0; var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (a >= 1) return '$' + n.toFixed(2);
    if (a >= 0.01) return '$' + n.toFixed(4);
    if (a > 0) return '$' + smallNum(n, 4); return '$0';
  }
  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
  function issShort(a) { return a && a.length > 10 ? a.slice(0, 4) + '—' + a.slice(-4) : (a || ''); }
  function ago(ms) {
    if (!ms) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // A logo is accepted only as a data:image or https url, and made safe for url("...") -- the wallet's
  // rule (browser/wallet.js cssUrl): an SVG data url often carries a raw # or a newline.
  function cssUrl(u) {
    u = String(u || '');
    if (!/^data:image\//i.test(u) && !/^https:\/\//i.test(u) && u.indexOf('/assets/') !== 0) return '';   // LUMOS's curated logo is a site path
    if (u.indexOf('"') >= 0 || u.indexOf('\\') >= 0 || u.length > 400000) return '';
    u = u.replace(/[\r\n\t]/g, '');
    if (/^data:image\/svg\+xml,/i.test(u)) u = u.replace(/#/g, '%23');
    return u;
  }
  function logoOf(t) {
    if (!t || t.id === WNEAR) return NEAR_LOGO;
    return cssUrl(t.logo) || cssUrl((C.ICONS || {})[t.id]) || '';
  }

  // /account/near/<account id>, or ?address= on the built file
  function fromUrl() {
    var raw = '';
    try { var sp = new URLSearchParams(window.location.search); raw = sp.get('address') || sp.get('a') || ''; } catch (e) {}
    if (!raw) {
      var parts = window.location.pathname.replace(/\/+$/, '').split('/');
      try { raw = decodeURIComponent(parts[parts.length - 1] || ''); } catch (e) { raw = ''; }
      if (/^lumoscore-/.test(raw)) raw = '';         // the built file opened directly: no id in the path
    }
    return { raw: String(raw).trim(), id: String(raw).trim().toLowerCase() };
  }

  // The cell is <span class=l>label</span><b class=v data-k>main</b><span class=s data-s>sub</span>.
  function setStat(k, value, sub) {
    var v = $('.acc-stat .v[data-k="' + k + '"]');
    if (v && value != null && v.textContent !== value) v.textContent = value;
    var sl = $('.acc-stat .s[data-s="' + k + '"]');
    if (sl && sub != null && sl.textContent !== sub) sl.textContent = sub;
  }

  // The design's own empty row: <tr class="acc-empty-row"><td colspan><div class="acc-empty">.
  function tableNote(tbl, text, cols) {
    var tb = tbl && (tbl.querySelector('tbody') || tbl);
    if (!tb) return;
    tb.innerHTML = '';
    var tr = el('tr', 'acc-empty-row');
    var td = el('td');
    td.colSpan = cols || 4;
    td.appendChild(el('div', 'acc-empty', text));
    tr.appendChild(td);
    tb.appendChild(tr);
    setMore(tbl, 0, 0);
  }

  // ---- header ----------------------------------------------------------------------------------------
  // Runs as soon as this script does (the head is earlier in the body), so the address, identicon and
  // NEAR badge are in place before the first paint rather than swapped in after DOMContentLoaded.
  function paintHeader(a) {
    var addrEl = $('#accAddr');
    if (addrEl) { addrEl.textContent = a; addrEl.setAttribute('title', a); }
    var av = $('#accAvatar');
    if (av && window.lxIdent) {
      try {
        var sv = String(window.lxIdent(a, 64));
        if (sv.indexOf('xmlns=') < 0) sv = sv.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');   // required in a data URI
        av.style.backgroundImage = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(sv) + '")';
        av.style.backgroundSize = 'cover';
      } catch (e) {}
    }
    var sub = $('#accSub');
    if (sub) {
      sub.textContent = '';
      var ex = el('a', null, 'Explorer ');
      ex.href = EXPLORER + encodeURIComponent(a);
      ex.target = '_blank';
      ex.rel = 'noopener nofollow';
      ex.insertAdjacentHTML('beforeend', EXT_SVG);
      sub.appendChild(ex);
      activeSince(a, sub);
    }
  }
  // "Active since Feb 2024" before Explorer, as Stellar prints it (RAZA 2026-11-03). The creation date comes from
  // NearBlocks' account record (its transaction lists went stale, this one did not); kept for the session.
  // No date, no words: a failed read leaves the line as it was.
  function activeSince(a, sub) {
    var key = 'lxn.created.' + a, hit = null;
    try { hit = sessionStorage.getItem(key); } catch (e) {}
    var put = function (ms) {
      if (!(ms > 0) || sub.querySelector('.lxn-since')) return;
      var sp = el('span', 'lxn-since', 'Active since ' + new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
      sp.setAttribute('data-logoed', '1');
      sub.insertBefore(sp, sub.firstChild);
    };
    if (hit) { put(+hit); return; }
    fetch('https://api.nearblocks.io/v1/account/' + encodeURIComponent(a))
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) {
        var c = j && j.account && j.account[0] && j.account[0].created, ms = c && c.block_timestamp ? Math.floor(Number(c.block_timestamp) / 1e6) : 0;
        if (!(ms > 0)) return;
        try { sessionStorage.setItem(key, String(ms)); } catch (e) {}
        put(ms);
      })
      .catch(function () {});
  }
  // The network badge is NEAR's whatever the link says, so it is set before anything else.
  function paintNet() {
    var net = $('#accNet');
    if (!net) return;
    net.textContent = '';
    net.setAttribute('title', 'NEAR');
    net.style.backgroundImage = 'url("' + NEAR_LOGO + '")';
    net.style.backgroundSize = 'cover';
  }

  // ---- assets ----------------------------------------------------------------------------------------
  // LOGOS, A FEW AT A TIME, WITH A PLACEHOLDER WHEN THERE IS NONE (RAZA 2026-09-16: "If there's no logo to show, then show a
  // placeholder logo like we're doing on Stellar. Also in public wallet page, some asset logos are not loading"). A wallet of
  // a hundred tokens asked for a hundred logos at once and the upstream answered most of them 429, leaving blank circles.
  var LOGO_Q = [], LOGO_RUN = 0, LOGO_OK = {};
  function placeholder(code) {
    var ch = String(code || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?';
    var hh = 0, s0 = String(code || '');
    for (var i = 0; i < s0.length; i++) hh = (hh * 31 + s0.charCodeAt(i)) % 360;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="hsl(' + hh + ',48%,40%)"/>'
      + '<text x="20" y="26.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="800" fill="#fff">' + ch + '</text></svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }
  function queueLogo(node, url, code) {
    if (!node) return;
    node.style.backgroundSize = 'cover';
    if (!url) { node.style.backgroundImage = placeholder(code); return; }
    node.style.backgroundPosition = 'center';
    if (LOGO_OK[url] === true) { node.style.backgroundImage = 'url("' + url + '")'; return; }
    if (LOGO_OK[url] === false) { node.style.backgroundImage = placeholder(code); return; }
    LOGO_Q.push([node, url, code]);
    pumpLogos();
  }
  function pumpLogos() {
    while (LOGO_RUN < 5 && LOGO_Q.length) {
      (function (job) {
        LOGO_RUN++;
        var im = new Image(), tries = 0;
        function done(ok) {
          LOGO_RUN--;
          LOGO_OK[job[1]] = ok;
          job[0].style.backgroundImage = ok ? 'url("' + job[1] + '")' : placeholder(job[2]);
          pumpLogos();
        }
        im.onload = function () { done(true); };
        im.onerror = function () {
          if (++tries < 2 && /^https:/i.test(job[1])) { setTimeout(function () { im.src = job[1] + (job[1].indexOf('?') >= 0 ? '&' : '?') + 'r=' + tries; }, 1500); return; }
          done(false);
        };
        im.src = job[1];
      })(LOGO_Q.shift());
    }
  }

  // COPY, QR AND "SEND TO THIS WALLET" (RAZA 2026-09-16: "copy icon, barcode, and send to this wallet on right is not working").
  // Stellar's own three: copy with the site's toast, the address as a QR in the design's .acc-qrpop, and the wallet page's
  // Send dialog opened with this address in it.
  // THE QR OPENED UNDER THE STATS (RAZA 2026-10-31: "The bar code is appearing at the back of pool position box").
  // The header and the stats row both fade in with [data-lcmu].lcmu-in, whose will-change: transform makes each
  // its own stacking context at z-index auto -- so the stats row, later in the page, paints over everything in
  // the header, the QR's z-index:60 included (it only counts inside the header). Lifting the header fixes it.
  function liftHead() {
    if (document.getElementById('lxn-acc-qrfix')) return;
    var st = document.createElement('style');
    st.id = 'lxn-acc-qrfix';
    st.textContent = '.acc-head{position:relative;z-index:4}';
    (document.head || document.documentElement).appendChild(st);
  }
  function wireAccActions(a) {
    liftHead();
    var qb = $('#accQr');
    if (qb && !qb.__lxn) {
      qb.__lxn = 1;
      var build = function () {
        if (qb.querySelector('.acc-qrpop') || !window.qrcode) return;
        var q2 = null, lv = [[0, 'H'], [0, 'Q'], [8, 'H'], [10, 'H'], [0, 'M'], [4, 'M']];
        for (var i = 0; i < lv.length; i++) { try { var t = window.qrcode(lv[i][0], lv[i][1]); t.addData(a); t.make(); q2 = t; break; } catch (e) {} }
        if (!q2) return;
        var n = q2.getModuleCount(), pad = 2, size = n + pad * 2, sq = '';
        for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q2.isDark(y, x)) sq += '<rect x="' + (x + pad) + '" y="' + (y + pad) + '" width="1" height="1"></rect>';
        var pop = el('div', 'acc-qrpop');
        pop.innerHTML = '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg"><rect width="' + size + '" height="' + size + '" fill="#fff"></rect><g fill="#000">' + sq + '</g></svg>';
        pop.appendChild(el('div', 'cap', short(a)));
        qb.appendChild(pop);
      };
      qb.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); build(); qb.classList.toggle('on'); });
      qb.addEventListener('mouseenter', build);
      document.addEventListener('click', function (ev) { if (!qb.contains(ev.target)) qb.classList.remove('on'); }, true);
    }
    var sb = $('#accSend');
    if (sb && !sb.__lxn) {
      sb.__lxn = 1;
      sb.setAttribute('href', '/wallet?to=' + encodeURIComponent(a));
      sb.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = '/wallet?to=' + encodeURIComponent(a);
      }, true);
    }
    var cp = $('#accCopy');
    if (cp && !cp.__lxn) {
      cp.__lxn = 1;
      cp.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        try { navigator.clipboard.writeText(a); } catch (x) {}
        try { if (typeof window.showToast === 'function') window.showToast('Account id copied'); } catch (x) {}
      }, true);
    }
  }

  var VTICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  function assetRow(code, issLabel, balance, logo, key, href, ticked) {
    var tr = document.createElement('tr');
    tr.className = 'acc-row';
    tr.setAttribute('data-lxkey', key);
    var c0 = el('td');
    var pair = el('span', 'acc-pair');
    var ico = el('span', 'acc-ico');
    ico.setAttribute('data-logoed', '1');
    queueLogo(ico, logo, code);
    pair.appendChild(ico);
    var txt = el('span');
    var cd = el('span', 'acc-code', code);
    cd.setAttribute('data-logoed', '1');
    txt.appendChild(cd);
    if (ticked) {
      var tk = el('span', 'lx-vtick');
      tk.setAttribute('title', 'Curated on LumosCore');
      tk.innerHTML = VTICK;
      txt.appendChild(tk);
    }
    var iss = el('span', 'acc-iss', issLabel);
    iss.setAttribute('data-logoed', '1');
    txt.appendChild(iss);
    pair.appendChild(txt);
    c0.appendChild(pair);
    tr.appendChild(c0);
    tr.appendChild(el('td', 'num', balance == null ? '—' : bal(balance)));
    tr.appendChild(el('td', 'num acc-val', '—'));
    if (href) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { window.location.href = href; });
    } else {
      // NOTHING TO OPEN: native NEAR has no token page. The design's own row-click layer would still route
      // the tap, so the row is marked and the click stopped at window capture (wireAccTabs).
      tr.setAttribute('data-lxnorow', '1');
      tr.style.cursor = 'default';
    }
    return tr;
  }

  // The design's "Load N more" pager (.acc-more inside .acc-more-host, after the table in its pane).
  var aShown = PER, ROWS = [];
  function setMore(tbl, shown, total) {
    var card = tbl && (tbl.closest('.acc-pane') || tbl.closest('.acc-card'));
    if (!card) return;
    var host = card.querySelector('.acc-more-host');
    if (total <= shown) { if (host) host.innerHTML = ''; return; }
    if (!host) { host = el('div', 'acc-more-host'); card.appendChild(host); }
    host.innerHTML = '';
    var wrap = el('div', 'acc-more');
    var b = el('button', 'acc-more-b', 'Load ' + Math.min(PER, total - shown) + ' more');
    b.type = 'button';
    b.appendChild(el('span', 'acc-more-n', shown + ' of ' + total + ' shown'));
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      aShown += PER;
      drawRows();
    });
    wrap.appendChild(b);
    host.appendChild(wrap);
  }
  function drawRows() {
    var tbl = $('#accAssetsTbl');
    var tb = tbl && tbl.querySelector('tbody');
    if (!tb) return;
    tb.innerHTML = '';
    var n = Math.min(aShown, ROWS.length);
    for (var i = 0; i < n; i++) tb.appendChild(ROWS[i]);
    setMore(tbl, n, ROWS.length);
  }

  function paintAssets(tbl, near, held, curated) {
    if (!tbl) return;
    ROWS = [];
    if (near) ROWS.push(assetRow('NEAR', 'Native asset', near.balance, NEAR_LOGO, 'NEAR', null, true));
    for (var i = 0; i < held.length; i++) {
      var t = held[i];
      // A token IS its contract: the contract id is the second line, the symbol is display only.
      ROWS.push(assetRow(t.display, C.short(t.id), t.balance, logoOf(t), t.id,
        '/trade/near/' + encodeURIComponent(t.id), t.id === WNEAR || !!curated[t.id]));
    }
    drawRows();
  }

  // THE SAME SUM AS THE WALLET PAGE (browser/prices.js): the liquid NEAR balance at NEAR/USD plus every
  // token's balance x its price in NEAR x NEAR/USD, from the same /lxapi/nearmarket answer. A token with
  // no price is skipped, never counted as zero; the sub-line then says how much of the account it covers.
  function paintValues(near, held, mk) {
    var usd = mk && +mk.usd > 0 ? +mk.usd : 0;
    var setVal = function (key, v) {
      var cell = null;                               // rows past the pager are not in the DOM yet
      for (var i = 0; i < ROWS.length; i++) if (ROWS[i].getAttribute('data-lxkey') === key) cell = ROWS[i].querySelector('.acc-val');
      if (cell) cell.textContent = money(v);
    };
    if (!usd) {
      setStat('total', '—', 'NEAR price unavailable');
      setStat('xlm', near ? bal(near.balance) + ' NEAR' : '—', '');
      return;
    }
    var total = 0, priced = 0, unpriced = 0;
    if (near) {
      total += near.balance * usd;
      setVal('NEAR', near.balance * usd);
    }
    held.forEach(function (t) {
      if (t.id === WNEAR && t.balance != null) { var w = t.balance * usd; total += w; priced++; setVal(t.id, w); return; }
      if (t.priceNear == null || t.balance == null || !isFinite(t.priceNear)) { unpriced++; return; }
      var v = t.balance * t.priceNear * usd;
      if (!isFinite(v)) { unpriced++; return; }
      total += v; priced++;
      setVal(t.id, v);
    });
    setStat('total', money(total), 'Estimated value');                // Stellar's line (RAZA 2026-11-03)
    var tsl = $('.acc-stat .s[data-s="total"]');
    if (tsl) tsl.title = unpriced ? (unpriced + (unpriced === 1 ? ' token has' : ' tokens have') + ' no price and are not counted') : '';
    setStat('xlm', near ? bal(near.balance) + ' NEAR' : '—', near ? money(near.balance * usd) : '');
    window.__lxnAccountTotal = { usd: total, priced: priced, unpriced: unpriced, nearUsd: usd };
  }

  // ---- pools -----------------------------------------------------------------------------------------
  // RAZA 2026-10-31: "Pools are not being recorded of any individual user". How an account's pools are found is
  // lxnCore.positions (nearcore.js), shared with Pools -> My Pools since 2026-11-04.
  var POOL_CAP = 60;
  function poolHref(id, syms) {
    var slug = (syms || []).map(function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); })
      .filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '');
    return '/pools/near/' + (slug || 'pool') + '/' + encodeURIComponent(id);
  }
  function readPositions(a) { return C.positions(a); }
  function paintPools(tbl, a, mk) {
    tableNote(tbl, 'Loading pools…', 5);
    var logos = {};
    ((mk && mk.rows) || []).forEach(function (row) { if (row && row.i) logos[row.i] = row.logo || ''; });
    readPositions(a).then(function (res) {
      var rows = res.rows, pn = $('#accPoolsN');
      if (pn) pn.textContent = String(rows.length);
      setStat('pools', String(rows.length), res.failed ? 'some pools could not be read' : rows.length ? 'providing liquidity' : 'none');
      if (!rows.length) {
        tableNote(tbl, res.capped ? 'No pool liquidity found in the ' + POOL_CAP + ' largest NEAR pools this account trades.'
          : 'This account provides no pool liquidity.', 5);
        return;
      }
      var tb = tbl && tbl.querySelector('tbody');
      if (!tb) return;
      tb.innerHTML = '';
      rows.forEach(function (p) {
        var tr = el('tr', 'acc-row');
        tr.setAttribute('data-pool', p.id);
        var c0 = el('td'), pair = el('span', 'acc-pair'), icos = el('span', 'acc-icos');
        p.ids.slice(0, 2).forEach(function (t, k) {
          var ico = el('span', 'acc-ico');
          ico.setAttribute('data-logoed', '1');
          queueLogo(ico, t === WNEAR ? NEAR_LOGO : cssUrl(logos[t]) || cssUrl((C.ICONS || {})[t]) || '', p.syms[k]);
          icos.appendChild(ico);
        });
        pair.appendChild(icos);
        var txt = el('span');
        var cd = el('span', 'acc-code', p.syms.join(' / '));
        cd.setAttribute('data-logoed', '1');
        txt.appendChild(cd);
        txt.appendChild(el('span', 'acc-dom', 'Pool #' + p.id + (p.farm ? ' · farming' : '')));
        pair.appendChild(txt);
        c0.appendChild(pair);
        tr.appendChild(c0);
        tr.appendChild(el('td', 'num', (p.share >= 0.01 ? p.share.toFixed(2) : '<0.01') + '%'));
        tr.appendChild(el('td', 'num', p.usd != null ? money(p.usd) : '—'));
        tr.appendChild(el('td', 'num acc-hide-sm', p.tvl != null ? money(p.tvl) : '—'));
        var href = poolHref(p.id, p.syms);
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', function () { window.location.href = href; });
        tb.appendChild(tr);
      });
      setMore(tbl, 0, 0);
    }, function () {
      tableNote(tbl, 'Could not read pool positions — try again in a minute.', 5);
      setStat('pools', '—', 'could not read');
    });
  }

  // ---- activity --------------------------------------------------------------------------------------
  // The row the Stellar page draws (.activity-row, the classes #accActs is styled for), filled from the
  // Wallet page's own reading (lxnCore.activityData + entriesOf). The counterparty links to ITS account page.
  var MID = String.fromCharCode(183);
  function who(acct) {
    var a = el('a', 'acc-who', C.short(acct));
    a.href = '/account/near/' + encodeURIComponent(acct);
    a.title = acct;
    a.setAttribute('data-logoed', '1');
    return a;
  }
  function amt(v, code, sign) { return (v != null && isFinite(v)) ? (sign + fmtAmt(v) + ' ' + code) : ''; }
  function fmtAmt(v) {
    v = Number(v);
    if (!isFinite(v)) return '—';
    if (v > 0 && v < 0.000001) return '<0.000001';
    return v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 2 : 6 });
  }
  function describe(x) {
    if (x.kind === 'swap') {
      return { cls: 'swap', type: 'Swap ' + x.give.s + ' → ' + x.get.s, a1: x.ok ? amt(x.get.v, x.get.s, '+') : '', a2: x.ok ? amt(x.give.v, x.give.s, '−') : '' };
    }
    if (x.kind === 'received' || x.kind === 'sent') {
      var code = x.tok ? x.tok.s : 'NEAR', v = x.tok ? x.tok.v : x.near;
      var inb = x.kind === 'received';
      return { cls: x.kind, type: (inb ? 'Received ' : 'Sent ') + code, who: x.other, pre: inb ? 'from ' : 'to ',
        a1: x.ok ? amt(v, code, inb ? '+' : '−') : '', a2: '' };
    }
    return { cls: 'other', type: x.label || 'Transaction', who: x.other, pre: (x.method ? x.method + ' ' + MID + ' ' : '') + (x.mine ? 'on ' : 'by '),
      a1: (x.ok && x.near > 0) ? amt(x.near, 'NEAR', '−') : '', a2: '' };
  }
  function actNote(host, text) {
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(el('div', 'acc-empty', text));
  }
  function paintActivity(host, rows) {
    if (!host) return;
    host.innerHTML = '';
    if (!rows.length) { actNote(host, 'No activity on this account yet.'); return; }
    rows.forEach(function (x) {
      var d = describe(x);
      var row = el('div', 'activity-row');
      var ic = el('div', 'activity-icon ' + d.cls);
      ic.innerHTML = ICONS[({ received: 'receive', sent: 'send' })[d.cls] || d.cls] || ICONS.other;
      row.appendChild(ic);
      var info = el('div', 'activity-info');
      var ty = el('div', 'type', d.type + (x.ok ? '' : ' (failed)'));
      ty.setAttribute('data-logoed', '1');
      info.appendChild(ty);
      var meta = el('div', 'meta');
      if (d.who) { meta.appendChild(document.createTextNode(d.pre)); meta.appendChild(who(d.who)); meta.appendChild(document.createTextNode(' ' + MID + ' ')); }
      meta.appendChild(document.createTextNode(ago(x.ts)));
      info.appendChild(meta);
      row.appendChild(info);
      var am = el('div', 'activity-amt');
      am.appendChild(el('div', 'a1 ' + (({ received: 'up', sent: 'down', swap: 'swap' })[d.cls] || ''), d.a1));
      am.appendChild(el('div', 'a2', d.a2));
      row.appendChild(am);
      if (x.h) {
        var lk = el('a', 'lx-txlink');
        lk.href = EXPLORER_TX + encodeURIComponent(x.h);
        lk.target = '_blank';
        lk.rel = 'noopener nofollow';
        lk.title = 'View on NearBlocks';
        lk.innerHTML = EXT_SVG;
        row.appendChild(lk);
      }
      host.appendChild(row);
    });
  }

  // THE ASSETS / POOLS TABS (RAZA 2026-09-15: "Public wallet address page, cant open pools tab"). The panes ship with the
  // hidden attribute and nothing on this page toggled it.
  function wireAccTabs() {
    if (window.__lxnAccTabs) return;
    window.__lxnAccTabs = 1;
    // A row with nowhere to go swallows its own click before the design's resolver sees it.
    window.addEventListener('click', function (e) {
      var nr = e.target && e.target.closest && e.target.closest('[data-lxnorow]');
      if (nr) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    window.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.acc-tab[data-t]');
      if (!t) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var want = t.getAttribute('data-t');
      [].forEach.call(document.querySelectorAll('.acc-tab[data-t]'), function (bt) {
        bt.classList.toggle('active', bt === t);
        bt.setAttribute('aria-selected', bt === t ? 'true' : 'false');
      });
      [].forEach.call(document.querySelectorAll('.acc-pane[data-p]'), function (pn) { pn.hidden = pn.getAttribute('data-p') !== want; });
    }, true);
  }

  function bad(text, sub) {
    tableNote($('#accAssetsTbl'), text, 4);
    tableNote($('#accPoolsTbl'), text, 5);
    actNote($('#accActs'), sub || text);
    ['total', 'xlm', 'assets', 'pools'].forEach(function (k) { setStat(k, '—', ''); });
    var an = $('#accAssetsN'); if (an) an.textContent = '';
    var pn = $('#accPoolsN'); if (pn) pn.textContent = '';
  }

  var URL_ID = fromUrl();
  // Before DOMContentLoaded, on purpose: these elements are earlier in the body than this script.
  paintNet();
  if (C.isAccountId(URL_ID.id)) paintHeader(URL_ID.id);

  function load() {
    var tbl = $('#accAssetsTbl');
    if (!tbl && !$('#accStats')) return;              // not this page
    wireAccTabs();

    var a = URL_ID.id;
    if (!C.isAccountId(a)) {
      var addrEl = $('#accAddr');
      if (addrEl) { addrEl.textContent = URL_ID.raw ? 'Not a NEAR account' : 'No account'; addrEl.setAttribute('title', URL_ID.raw); }
      bad(URL_ID.raw ? 'This is not a NEAR account id.' : 'No NEAR account in this link.');
      return;
    }

    paintHeader(a);
    wireAccActions(a);

    var curated = {};
    Promise.all([C.readHoldings(a), C.market()]).then(function (r) {
      var data = r[0], mk = r[1];
      ((mk && mk.rows) || []).forEach(function (row) { if (row && row.i) curated[row.i] = 1; });
      window.__lxnAccountData = data;
      paintAssets($('#accAssetsTbl'), data.near, data.held, curated);
      paintPools($('#accPoolsTbl'), a, mk);
      // One count, used twice, including NEAR -- the convention wallet.js uses.
      var n = data.held.length + 1;
      var an = $('#accAssetsN');
      if (an) an.textContent = String(n);
      // The line under the count adds up to it (RAZA 2026-11-03: "18" over "17 tokens held" read as a mismatch).
      setStat('assets', String(n), 'NEAR + ' + data.held.length + (data.held.length === 1 ? ' token' : ' tokens'));
      paintValues(data.near, data.held, mk);
    }).catch(function (e) {
      var gone = e && (e.code === 'UNKNOWN_ACCOUNT' || /UNKNOWN_ACCOUNT|does not exist/i.test(e.message || ''));
      // The activity sentence is the one NearBlocks' empty answer produces, so whichever lands last the
      // text does not change under the reader.
      if (gone) { bad('This account does not exist on NEAR.', 'No activity on this account yet.'); return; }
      tableNote($('#accAssetsTbl'), 'Could not read this NEAR account — try again in a minute.', 4);
      tableNote($('#accPoolsTbl'), 'Could not read this NEAR account — try again in a minute.', 5);
    });

    var acts = $('#accActs');
    C.activityData(a).then(function (d) {
      var rows = C.entriesOf(a, d);
      paintActivity(acts, rows);
      var n = $('#accActN');
      if (n) n.textContent = rows.length ? String(rows.length) : '';
    }, function (e) {
      // A refusal from the rate limit is not "no activity": it says so, and the next view asks again.
      actNote(acts, e && e.code === 429 ? 'Activity is busy right now — try again in a minute.'
        : 'Could not load activity for this account.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxnAccountReload = load;
})();
