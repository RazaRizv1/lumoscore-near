// NEAR wallet connect, driving the DESIGN'S OWN connect modal.
//
// This replaces the inherited Stellar block (lx-realconnect) on NEAR pages, the way the XRPL fork
// replaced it — a Stellar connect flow on a NEAR page would store a G-address under lumos.address,
// the key every NEAR layer reads. Unlike the XRPL fork, this file builds NO modal of its own: the NEAR
// containers still carry the design's .lxw modal (and lx-mc's "Choose a network" screen), so the
// wallet rows, the Connecting steps and the Connected screen are all the design's, filled the way
// Stellar's _wallet_realconnect.js fills them. The near entry in the design's wallet table is added by
// _nearconnect.js at build time; this file only drives what the design renders.
//
// THE LIBRARY is NEAR Connect (@hot-labs/near-connect 0.11.4), self-hosted as one bundle under
// /assets/vendor/ and loaded only when someone actually connects or has a session to sign out of, so
// no page pays 56KB to show a button. connect({ walletId }) is used directly, which skips the
// library's own wallet picker — the design's list already is the picker.
//
// THE WALLET LIST IS PINNED, not fetched: /assets/vendor/near-wallets-manifest.json carries exactly the
// five wallets RAZA approved (HOT, Meteor, NEAR Mobile, MyNearWallet, Intear), so a wallet added to the
// public registry cannot appear here unannounced. Each wallet's own code still loads from where that
// wallet publishes it, inside a sandboxed iframe — that is how NEAR Connect works, and it is what lets a
// wallet update without a LumosCore release.
//
// Storage contract: the same keys the Stellar and XRPL builds use, so the chain-neutral layers (header
// chip, auth gate, disconnect) keep working.
//   lumos.address    the NEAR account id (alice.near, or a 64-hex / 0x implicit account)
//   lumos.wallet     display name, as the row shows it
//   lumos.transport  the NEAR Connect wallet id, which signing will need later
//   lumos.chain / lumos.network   'near'
//   cookie lx_chain=near   — the server's only way to know which build serves /dashboard and /wallet
//
// (Plain prose in comments here: this file is injected verbatim, never through a template literal, but
// keeping it free of backticks costs nothing and keeps it safe to move.)
(function () {
  if (window.__lxnConnect) return;
  window.__lxnConnect = 1;

  // DORMANT MODE. The combine injects this file into the OTHER build's pages that offer "Choose a
  // network", so picking NEAR connects in place instead of jumping into /trade/near first. RAZA
  // 2026-10-28: "the dashboard in the background automatically opens up when I even haven't connected
  // any Wallet yet ... I can close the connect wallet pop up and able to use the lumoscore without
  // wallet connected". Measured on production: choosing Stellar AND choosing XRP Ledger both stay on
  // the landing page and only open the wallet picker — NEAR was the only chain that entered the app.
  //
  // Dormant means: own the NEAR network row and nothing else. boot() must not run (connectOnArrive is
  // for arriving ON a NEAR page, and reconcile() would load the NEAR Connect library on a page that
  // has no NEAR session), and the network-row branch must not take a click meant for another chain.
  // The XRPL fork measured that exact failure when its layer claimed the page's connect UI: "picking
  // Stellar would have opened the XRPL picker".
  //
  // wrapOpen() DOES run dormant, deliberately — it is what records which chain's wallet list is on
  // screen, and the wallet-row handler below needs that to know a row is a NEAR row.
  var DORMANT = !!window.__lxnNoBoot;

  var LIB = '/assets/vendor/near-connect-0.11.4.min.js';
  var MANIFEST = '/assets/vendor/near-wallets-manifest.json';
  var NET = 'near';

  // The design row's data-wallet, normalised, -> NEAR Connect's wallet id.
  var IDS = {
    hotwallet: 'hot-wallet', meteorwallet: 'meteor-wallet', nearmobile: 'near-mobile',
    mynearwallet: 'mynearwallet', intearwallet: 'intear-wallet'
  };
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // A NEAR account id: 2-64 chars of lowercase letters, digits, - and _, dot-separated parts; or a
  // 64-hex implicit account; or a 0x... eth-implicit account. Anything else is refused rather than stored.
  function validAccount(a) {
    a = String(a || '');
    if (a.length < 2 || a.length > 64) return false;
    if (/^0x[0-9a-f]{40}$/.test(a)) return true;
    return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a);
  }
  function trunc(a) { a = String(a || ''); return a.length <= 22 ? a : a.slice(0, 8) + '…' + a.slice(-6); }

  // ---- the library, loaded on demand ------------------------------------------------------------
  var _lib = null, _conn = null;
  function lib() {
    if (_lib) return _lib;
    _lib = new Promise(function (res, rej) {
      if (window.NearConnect) return res(window.NearConnect);
      var s = document.createElement('script');
      s.src = LIB; s.async = true;
      s.onload = function () { window.NearConnect ? res(window.NearConnect) : rej(new Error('NEAR Connect did not load')); };
      s.onerror = function () { _lib = null; rej(new Error('NEAR Connect could not be loaded')); };
      document.head.appendChild(s);
    });
    return _lib;
  }
  function connector() {
    if (_conn) return _conn;
    _conn = Promise.all([lib(), fetch(MANIFEST).then(function (r) {
      if (!r.ok) throw new Error('wallet list unavailable');
      return r.json();
    })]).then(function (x) {
      return new x[0].NearConnector({ network: 'mainnet', manifest: x[1], footerBranding: null, autoConnect: false });
    });
    _conn.catch(function () { _conn = null; });
    return _conn;
  }
  function connectWallet(walletId) {
    return connector().then(function (c) { return c.connect({ walletId: walletId }); })
      .then(function (w) { return w.getAccounts({ network: 'mainnet' }); })
      .then(function (accts) {
        var a = accts && accts[0] && accts[0].accountId;
        if (!validAccount(a)) { var e = new Error('The wallet returned no usable NEAR account'); e.code = 'SHOW_MSG'; throw e; }
        return a;
      });
  }

  // ---- the design's screens, driven the way Stellar's connect layer drives them -----------------
  function q(sel) { return document.querySelector(sel); }
  function screen(name) {
    var s = document.querySelectorAll('.lxw-screen');
    for (var i = 0; i < s.length; i++) s[i].toggleAttribute('hidden', s[i].getAttribute('data-screen') !== name);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function setStep(i) {
    var s = document.querySelectorAll('.lxw-steps .lxw-step');
    for (var k = 0; k < s.length; k++) {
      s[k].classList.remove('is-done', 'is-active');
      if (k < i) s[k].classList.add('is-done'); else if (k === i) s[k].classList.add('is-active');
    }
  }

  function setConnected(row, addr, walletId) {
    var ic = row.querySelector('.lxw-ico'), nm = row.querySelector('.lxw-name');
    var name = nm ? nm.textContent : walletId;
    var ai = q('.lxw-acct-ico'); if (ai && ic) { ai.style.background = ic.style.background; ai.innerHTML = ic.innerHTML; }
    var aa = q('.lxw-acct-addr'); if (aa) aa.textContent = trunc(addr);
    var wd = q('.lxw-wnamedone'); if (wd) wd.textContent = name;
    var cn = q('.lxw-chipname'); if (cn) cn.textContent = 'NEAR';
    set('lumos.wallet', name); set('lumos.address', addr); set('lumos.transport', walletId);
    set('lumos.network', NET); set('lumos.chain', NET);
    // The "Last used" tag reads this, from data-wallet, the same as Stellar's layer writes it.
    set('lumos.lastWallet', row.getAttribute('data-wallet') || name);
    try { document.cookie = 'lx_chain=near; path=/; max-age=31536000; SameSite=Lax'; } catch (e) {}
    if (window.lxnsSetConnected) try { window.lxnsSetConnected(NET, name); } catch (e) {}
    screen('connected');
    postConnect();
  }

  // Where to go after connecting — Stellar's rule, unchanged: stay on a page whose chain matches the
  // connection (reloading so every layer reads the new session), otherwise Continue enters the
  // dashboard. The dashboard and wallet pages themselves never navigate away.
  function stayRefresh() {
    var fired = false;
    function go() { if (fired) return; fired = true; try { location.reload(); } catch (e) {} }
    var d = q('.lxw-done');
    if (d && !d.__lxnStay) { d.__lxnStay = 1; d.addEventListener('click', go); }
    var mo = q('.lxw-modal'), host = mo && mo.parentNode;
    if (host && !host.__lxnStayObs) {
      host.__lxnStayObs = 1;
      try {
        new MutationObserver(function () { if (host.hasAttribute('hidden')) go(); })
          .observe(host, { attributes: true, attributeFilter: ['hidden'] });
      } catch (e) {}
    }
  }
  function postConnect() {
    var p = location.pathname || '', dest = null;
    try { dest = sessionStorage.getItem('lumos.connDest'); sessionStorage.removeItem('lumos.connDest'); } catch (e) {}
    if (dest && dest.indexOf('stay:') === 0 && String(dest.slice(5)).toLowerCase() === NET) { stayRefresh(); return; }
    if (/\/near(\/|$)/.test(p)) { stayRefresh(); return; }
    if (/dashboard|lumoscore-home|wallet/.test(p)) { stayRefresh(); return; }
    var done = q('.lxw-done');
    if (!done || done.__lxnHome) return;
    done.__lxnHome = 1;
    done.addEventListener('click', function () {
      try { if (window.__lxNav) { window.__lxNav('lumoscore-home.html'); return; } } catch (e) {}
      try { location.href = '/dashboard'; } catch (e) {}
    });
  }

  function showErr(row, err) {
    var t = q('.lxw-ctitle'), nm = row.querySelector('.lxw-name'), name = nm ? nm.textContent : 'wallet';
    var msg = (err && err.code === 'SHOW_MSG') ? err.message : (name + ' connection failed or was rejected');
    if (t) { t.textContent = msg; t.style.color = '#ff6b6b'; }
    setTimeout(function () { if (t) t.style.color = ''; screen('wallet'); }, 2600);
  }

  // ---- the design's lxwOpenWallet, told which chain is open --------------------------------------
  // The design defines lxwOpenWallet; this only records which chain's list is on screen, so a row click
  // below knows it is a NEAR row. Wrapped once, whenever the design's function appears.
  function wrapOpen() {
    var o = window.lxwOpenWallet;
    if (typeof o !== 'function' || o.__lxn) return;
    var w = function (net) { window.__lxNet = net; return o.apply(this, arguments); };
    w.__lxn = 1;
    window.lxwOpenWallet = w;
  }
  wrapOpen();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrapOpen);

  // ---- clicks: network rows and wallet rows -------------------------------------------------------
  // WINDOW, capture phase, for the reason Stellar's layer gives: the design registers a demo connect
  // listener on document capture, and only a window-capture listener runs before it and can stop it.
  window.addEventListener('click', function (e) {
    var row = e.target && e.target.closest ? e.target.closest('.lxw-row') : null;
    if (!row) return;

    var netId = row.getAttribute('data-lxnet');
    if (netId) {
      // Dormant: this is another build's chooser. Claim the NEAR row only and let every other row
      // reach that build's own handler untouched — stopImmediatePropagation here would silently
      // break picking Stellar or XRP Ledger.
      if (DORMANT && netId !== NET) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (row.classList.contains('lxw-soon')) return;
      // NEAR connects here, in the modal we are already in.
      if (netId === NET) {
        set('lumos.chain', NET);
        try { if (window.lxAdoptChain) window.lxAdoptChain(NET); } catch (x) {}
        try { if (window.lxwOpenWallet) window.lxwOpenWallet(NET); } catch (x) {}
        return;
      }
      // Any other chain is another build: record the intent and go there; that build opens its own
      // wallet list on arrival. Never through lxSetChain, whose to===cur guard can swallow the click.
      set('lumos.chain', netId);
      try { sessionStorage.setItem('lumos.connectOnArrive', netId); } catch (x) {}
      var href = '';
      try { href = window.lxChainHref ? window.lxChainHref(netId) : ''; } catch (x) {}
      if (!href) href = '/trade/' + netId;
      try { location.assign(href); } catch (x) { location.href = href; }
      return;
    }

    var walletId = IDS[norm(row.getAttribute('data-wallet'))];
    if (!walletId || (window.__lxNet && window.__lxNet !== NET)) return;
    e.preventDefault(); e.stopImmediatePropagation();

    var ic = row.querySelector('.lxw-ico'), nm = row.querySelector('.lxw-name'), name = nm ? nm.textContent : walletId;
    var ci = q('.lxw-cwallet-ico'); if (ci && ic) { ci.style.background = ic.style.background; ci.innerHTML = ic.innerHTML; }
    var t = q('.lxw-ctitle'); if (t) { t.textContent = 'Confirming with ' + name; t.style.color = ''; }
    screen('connecting');
    setStep(0);
    var t0 = Date.now();
    var awaitT = setTimeout(function () { setStep(1); }, 520);
    connectWallet(walletId).then(function (addr) {
      clearTimeout(awaitT); setStep(1);
      return wait(Math.max(0, 900 - (Date.now() - t0)))
        .then(function () { setStep(2); return wait(760); })
        .then(function () { setStep(3); return wait(200); })
        .then(function () { setConnected(row, addr, walletId); });
    }).catch(function (err) { clearTimeout(awaitT); showErr(row, err); });
  }, true);

  // ---- arriving from another build that handed NEAR over -------------------------------------------
  function connectOnArrive() {
    var want = '';
    try { want = sessionStorage.getItem('lumos.connectOnArrive') || ''; } catch (e) {}
    if (want !== NET) return;
    try { sessionStorage.removeItem('lumos.connectOnArrive'); } catch (e) {}
    if (get('lumos.chain') === NET && validAccount(get('lumos.address'))) return;
    wrapOpen();
    try { if (window.lxwOpenWallet) window.lxwOpenWallet(NET); } catch (e) {}
  }

  // ---- signed out elsewhere --------------------------------------------------------------------------
  // The header's Disconnect clears the lumos.* keys and knows nothing about NEAR Connect, whose own
  // session would otherwise survive and silently reconnect the next sign-in to the old wallet. If the
  // site has no NEAR session but the library still holds one, end it. Only then is the library loaded.
  function reconcile() {
    var live = get('lumos.chain') === NET && validAccount(get('lumos.address'));
    if (live || !get('selected-wallet')) return;
    connector().then(function (c) { return c.disconnect(); }).catch(function () {
      try { localStorage.removeItem('selected-wallet'); } catch (e) {}
    });
  }

  // open(): show NEAR's wallet list in whatever modal is already on screen. This is what the other
  // build's chooser calls to connect NEAR IN PLACE instead of handing off to /trade/near — the same
  // role window.lxc.open() plays for XRPL. It works dormant, which is the whole point, and it is the
  // same three steps the netId===NET branch above runs on NEAR's own pages.
  //
  // Unlike XRPL's, this does NOT build or replace a modal: NEAR drives the design's own .lxw modal,
  // so the caller must leave it open. The near entry in that modal's wallet table is written into
  // NEAR's pages by _nearconnect.js, and into the other build's pages by chains/near.js.
  function openNear() {
    set('lumos.chain', NET);
    try { if (window.lxAdoptChain) window.lxAdoptChain(NET); } catch (e) {}
    wrapOpen();
    try { if (window.lxwOpenWallet) window.lxwOpenWallet(NET); } catch (e) {}
  }

  // A WALLET'S REFUSAL AS WORDS (RAZA 2026-11-03: a timed-out or rejected swap read "[object Object]"). Some
  // wallets reject with a plain object, not an Error, and every screen did String(e.message || e). The signing
  // calls are wrapped once here so every screen gets an Error whose message is the wallet's own text: its
  // message, error, reason or code, in that order, else the object as JSON. A timeout gets one sentence.
  function errText(e) {
    if (e == null) return '';
    if (typeof e === 'string') return e;
    var pick = [e.message, e.error && (e.error.message || e.error), e.reason, e.cause && e.cause.message, e.code];
    for (var i = 0; i < pick.length; i++) if (typeof pick[i] === 'string' && pick[i] && pick[i] !== '[object Object]') return pick[i];
    try { var j = JSON.stringify(e); if (j && j !== '{}') return j.slice(0, 180); } catch (x) {}
    return '';
  }
  function plainErr(e) {
    var m = errText(e);
    if (/time ?out|timed out|expired/i.test(m)) m = 'Transaction timed out. Please try again.';
    if (e instanceof Error && e.message === m) return e;
    var err = new Error(m || 'The wallet gave no reason.');
    err.raw = e;
    return err;
  }
  function plainErrors(w) {
    if (!w || w.__lxnPlain) return w;
    ['signAndSendTransaction', 'signAndSendTransactions', 'signMessage'].forEach(function (k) {
      if (typeof w[k] !== 'function') return;
      var f = w[k];
      w[k] = function () { return Promise.resolve(f.apply(w, arguments)).catch(function (e) { throw plainErr(e); }); };
    });
    try { w.__lxnPlain = 1; } catch (e) {}
    return w;
  }

  // For the signing workstreams: the connected wallet, loading the library only when asked.
  window.lxn = {
    open: openNear,
    account: function () { var a = get('lumos.address'); return (get('lumos.chain') === NET && validAccount(a)) ? a : ''; },
    wallet: function () { return connector().then(function (c) { return c.wallet(get('lumos.transport') || undefined); }).then(plainErrors); },
    connector: connector,
    validAccount: validAccount
  };

  // Dormant pages are another build's, where neither of these belongs: connectOnArrive() answers a
  // hand-off that only lands on a NEAR page, and reconcile() would fetch the NEAR Connect library on a
  // page with no NEAR session. lxn and the two click handlers above stay live, which is all the
  // chooser needs. NEAR's own pages never set the flag, so nothing there changes.
  function boot() { connectOnArrive(); reconcile(); }
  if (!DORMANT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
