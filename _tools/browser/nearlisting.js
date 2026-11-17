// Curated listing request, on NEAR -- paid in NEAR (RAZA 2026-11-17: "In their own coin").
//
// REPLACES the inherited Stellar layer (lx-listtoken) on this page, which on a NEAR page would have
// charged a Stellar mainnet fee in XLM. Same sequence as the XRP Ledger layer (C:\LumosCore-XRPL\_tools\
// browser\listing.js), with NEAR's own parts:
//   1. quote   GET /lxapi/nearlisting -> the fee in NEAR and the collector (fees-lumoscore.near).
//   2. check   the form (token contract, description, logo) BEFORE any wallet prompt.
//   3. pending saved locally BEFORE signing, so a wallet that redirects away and back can still finish.
//   4. pay     window.lxn.wallet() -> signAndSendTransaction({ Transfer }) -> the hash.
//   5. record  POST /lxapi/nearlisting with the hash AND the signer (NEAR RPC needs both to find a tx).
(function () {
  if (window.__lxnListing) return;
  window.__lxnListing = 1;

  var COLLECTOR = 'fees-lumoscore.near';      // must equal the server's COLLECTOR
  var API = '/lxapi/nearlisting';
  var PENDING_KEY = 'lumos.listing.near';
  var PENDING_MAX_AGE = 24 * 3600 * 1000;
  var LOGO_MAX = 512 * 1024;
  var LOGO_OK = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };
  var ACCT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$|^[0-9a-f]{64}$/;

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function show(el, yes) { if (el) { if (yes) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); } }
  function money(n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: d || 2 }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // "78.12345" NEAR -> yoctoNEAR as an exact integer string (no floating point on money).
  function yocto(s) {
    var p = String(s).split('.'), i = p[0].replace(/^0+/, ''), f = (p[1] || '').slice(0, 24);
    var out = (i + f + '0'.repeat(24 - f.length)).replace(/^0+/, '');
    return out || '0';
  }
  function txHashOf(r) {
    if (!r) return '';
    if (typeof r === 'string') return r;
    return (r.transaction && r.transaction.hash) || (r.transaction_outcome && r.transaction_outcome.id) || r.hash || '';
  }
  function validAcct(a) { return typeof a === 'string' && a.length >= 2 && a.length <= 64 && ACCT_RE.test(a); }

  var quote = null, logoData = '', logoName = '', busy = false;

  function status(t) { var e = $('ltStatus'); if (e) e.textContent = t || ''; }
  function formErr(t) { var e = $('ltFormErr'); if (e) { e.textContent = t || ''; show(e, !!t); } }
  function fieldErr(id, t) {
    var e = $(id + 'Err'), i = $(id);
    if (e) { e.textContent = t || ''; show(e, !!t); }
    if (i) i.classList.toggle('lt-wrong', !!t);
  }
  function clearErrors() { ['ltIssuer', 'ltDescr', 'ltSite', 'ltLogo'].forEach(function (i) { fieldErr(i, ''); }); formErr(''); }

  function paintQuote() {
    var amt = $('ltAmt'), rate = $('ltRate'), to = $('ltTo');
    if (to) { to.textContent = COLLECTOR; to.title = COLLECTOR; }
    if (!quote) { if (amt) amt.textContent = '—'; if (rate) rate.textContent = 'rate unavailable'; return; }
    if (amt) amt.textContent = money(quote.amount, 5) + ' NEAR';
    if (rate) rate.textContent = '1 NEAR = $' + Number(quote.nearUsd).toFixed(4);
  }
  function loadQuote() {
    return fetch(API, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var o = d && d.ok && d.options && d.options[0];
      if (!o || d.collector !== COLLECTOR) throw new Error('bad quote');
      quote = { amount: o.amount, nearUsd: d.nearUsd, at: Date.now(), valid: (d.validForSeconds || 900) * 1000 };
      paintQuote();
    }).catch(function () { quote = null; paintQuote(); });
  }

  function me() { try { return (window.lxn && window.lxn.account && window.lxn.account()) || ''; } catch (e) { return ''; } }
  function paintButton() {
    var t = $('ltGoT'); if (!t || busy) return;
    t.textContent = me() ? 'Pay ' + (quote ? money(quote.amount, 5) + ' NEAR ' : '') + 'and submit' : 'Connect wallet to pay';
  }
  function setBusy(yes) { busy = yes; var g = $('ltGo'); if (g) { g.disabled = yes; g.style.opacity = yes ? '.7' : ''; } if (!yes) paintButton(); }
  var lastMe = null;
  setInterval(function () { var a = me(); if (a !== lastMe) { lastMe = a; paintButton(); } }, 600);

  function paintLogo() {
    var box = $('ltDropIn'); if (!box) return;
    if (!logoData) {
      box.className = 'lt-drop-in';
      box.innerHTML = '<span class="lt-drop-t">Choose a logo</span><span class="lt-drop-d">Square PNG, JPEG, WebP or GIF · 256 × 256px or larger · up to 512KB</span>';
      return;
    }
    box.className = 'lt-picked';
    box.innerHTML = '';
    var img = document.createElement('img'); img.src = logoData; img.alt = '';
    var txt = document.createElement('div');
    txt.innerHTML = '<div class="lt-picked-ok"><span>Logo ready</span></div><div class="lt-picked-n"></div>';
    txt.querySelector('.lt-picked-n').textContent = (logoName ? logoName + ' · ' : '') + 'Click to change';
    box.appendChild(img); box.appendChild(txt);
  }
  function takeFile(file) {
    fieldErr('ltLogo', '');
    if (!file) return;
    if (!LOGO_OK[String(file.type).toLowerCase()]) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'The logo must be a PNG, JPEG, WebP or GIF.'); }
    if (file.size > LOGO_MAX) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'That file is ' + Math.round(file.size / 1024) + 'KB, over the 512KB limit.'); }
    var fr = new FileReader();
    fr.onload = function () {
      var data = String(fr.result || ''), probe = new Image();
      probe.onload = function () {
        var w = probe.naturalWidth || 0, h = probe.naturalHeight || 0;
        if (w < 256 || h < 256) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'That logo is ' + w + ' × ' + h + 'px. It needs to be 256 × 256px or larger.'); }
        if (Math.abs(w - h) > Math.max(w, h) * 0.01) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'That logo is ' + w + ' × ' + h + 'px. It needs to be square.'); }
        logoData = data; logoName = file.name || ''; paintLogo();
      };
      probe.onerror = function () { logoData = ''; paintLogo(); fieldErr('ltLogo', 'That image could not be read.'); };
      probe.src = data;
    };
    fr.readAsDataURL(file);
  }

  function val(id) { var e = $(id); return e ? (e.value || '').trim() : ''; }
  function readForm() {
    return { network: 'near', issuer: val('ltIssuer').toLowerCase(), code: val('ltCode'), descr: val('ltDescr'),
      website: val('ltSite'), twitter: val('ltX'), telegram: val('ltTg'), discord: val('ltDs'), logo: logoData };
  }
  function validate(f) {
    var ok = true;
    if (!validAcct(f.issuer)) { fieldErr('ltIssuer', 'The token contract account, for example token.near.'); ok = false; }
    if (f.descr.length < 20) { fieldErr('ltDescr', 'Say what the project is, in at least a sentence.'); ok = false; }
    if (f.website && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(f.website)) { fieldErr('ltSite', 'That does not look like a web address.'); ok = false; }
    if (!f.logo) { fieldErr('ltLogo', 'A logo is required: a square image, 256 × 256px or larger.'); ok = false; }
    if (!ok) formErr('Fix the fields marked above, then try again.');
    return ok;
  }

  function savePending(rec) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(rec)); }
    catch (e) { try { rec.f = Object.assign({}, rec.f, { logo: '' }); localStorage.setItem(PENDING_KEY, JSON.stringify(rec)); } catch (e2) {} }
  }
  function readPending() {
    try {
      var p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      if (!p || !p.f) return null;
      if (Date.now() - (+p.ts || 0) > PENDING_MAX_AGE) { localStorage.removeItem(PENDING_KEY); return null; }
      return p;
    } catch (e) { return null; }
  }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }

  function post(f, hash, payer) {
    return fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network: 'near', issuer: f.issuer, code: f.code || '', descr: f.descr, logo: f.logo || '',
        txHash: hash, payer: payer, website: f.website || '', twitter: f.twitter || '', telegram: f.telegram || '', discord: f.discord || '' }) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); });
  }
  function record(f, hash, payer, attempt) {
    attempt = attempt || 1;
    return post(f, hash, payer).then(function (r) {
      if (r.d && r.d.ok) return r.d;
      var msg = (r.d && r.d.error) || 'Server error';
      var retry = r.status >= 500 || /yet/i.test(msg);
      var e = new Error(msg); e.final = !retry; throw e;
    }).catch(function (err) {
      if (err.final || attempt >= 8) throw err;
      return wait(Math.min(2000 + attempt * 1500, 6000)).then(function () { return record(f, hash, payer, attempt + 1); });
    });
  }
  function showDone(f, paid, hash, id) {
    clearPending();
    show($('ltForm'), false); show($('ltStranded'), false); show($('ltDone'), true);
    var set = function (i, v) { var e = $(i); if (e) { e.textContent = v; e.title = v; } };
    set('ltDoneAsset', f.issuer);
    set('ltDonePaid', paid ? money(paid, 5) + ' NEAR' : '—');
    set('ltDoneTx', hash); set('ltDoneId', id || '—');
    try { $('ltDone').scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
  }
  function showStranded(hash) {
    show($('ltStranded'), true);
    var e = $('ltStrandedTx'); if (e) e.textContent = hash;
    try { $('ltStranded').scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e2) {}
  }

  function run(f) {
    var signer = me();
    if (!quote || Date.now() - quote.at > quote.valid) {
      status('Refreshing the price…');
      return loadQuote().then(function () { if (!quote) throw new Error('The NEAR price is unavailable right now. Try again in a minute.'); return run(f); });
    }
    savePending({ f: f, ts: Date.now(), paid: quote.amount, payer: signer });
    status('Approve the payment of ' + money(quote.amount, 5) + ' NEAR in your wallet…');
    return window.lxn.wallet().then(function (w) {
      if (!w || typeof w.signAndSendTransaction !== 'function') throw new Error('This wallet cannot sign transactions here.');
      return w.signAndSendTransaction({ signerId: signer, receiverId: COLLECTOR, actions: [{ type: 'Transfer', params: { deposit: yocto(quote.amount) } }] });
    }).then(function (r) {
      var hash = txHashOf(r);
      if (!hash) throw new Error('The wallet did not return a transaction hash.');
      savePending({ f: f, ts: Date.now(), paid: quote.amount, payer: signer, hash: hash });
      status('Payment sent. Recording your application…');
      return record(f, hash, signer).then(function (d) { showDone(f, quote.amount, hash, d.id); }, function (err) {
        formErr(err.message || 'The application could not be recorded.');
        showStranded(hash);
      });
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    clearErrors();
    if (!window.lxn) { formErr('The wallet layer did not load. Reload the page and try again.'); return; }
    if (!me()) { try { window.lxn.open(); } catch (e2) {} return; }
    var f = readForm();
    if (!validate(f)) return;
    setBusy(true);
    run(f).catch(function (err) { formErr(err && err.message ? err.message : 'The payment did not go through.'); })
      .then(function () { status(''); setBusy(false); });
  }

  // Finish a payment that went out but was never recorded -- including a redirect wallet coming back
  // with ?transactionHashes=… in the url.
  function resume() {
    var p = readPending();
    if (!p) return;
    var q = '';
    try { q = new URLSearchParams(location.search).get('transactionHashes') || ''; } catch (e) {}
    var hash = p.hash || (q ? q.split(',').pop() : '');
    if (!hash || !p.payer) return;
    status('Finishing your earlier application…');
    record(p.f, hash, p.payer).then(function (d) { showDone(p.f, p.paid, hash, d.id); },
      function (err) { status(''); formErr(err.message); showStranded(hash); });
  }

  function boot() {
    if (!$('ltForm') || !$('ltGo')) return;
    on($('ltForm'), 'submit', onSubmit);
    on($('ltLogo'), 'change', function () { takeFile(this.files && this.files[0]); });
    var drop = $('ltDrop');
    ['dragenter', 'dragover'].forEach(function (ev) { on(drop, ev, function (e) { e.preventDefault(); drop.classList.add('lt-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { on(drop, ev, function () { drop.classList.remove('lt-over'); }); });
    on(drop, 'keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && $('ltLogo')) { e.preventDefault(); $('ltLogo').click(); } });
    on($('ltDescr'), 'input', function () { var c = $('ltCount'); if (c) c.textContent = String(this.value.length); });
    var to = $('ltTo'); if (to) { to.textContent = COLLECTOR; to.title = COLLECTOR; }   // the price stays 'loading…' until it arrives
    paintLogo(); loadQuote().then(paintButton); paintButton();
    resume();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
