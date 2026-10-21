// NEAR Send and Receive. PORTED FROM the XRPL fork's _tools/browser/write.js (2026-10-21) by an exact-count
// port script: its Receive QR, Paste/Scan, asset picker, status line, failure toast, ?to= hand-off and the
// open-time reset are kept as they are. Its Cancel-order, Swap and Trustline sections are NOT carried: NEAR
// has no orders yet, swaps are a later phase (the design's #modalSwap is shown with a disabled "coming
// soon" button instead, the precedent browser/dexasset.js set on the token page), and NEAR has no trust
// lines. The dated notes below are the XRPL file's history.
//
// WHAT IS NEAR'S:
//   recipient   window.lxn.validAccount (named, 64-hex implicit, or 0x eth-implicit). A NAMED account must
//               exist (view_account) -- a transfer to a name nobody created fails on chain after the fee.
//               An implicit account may be new; sending NEAR to it is how it is created, and the dialog
//               says so.
//   NEAR        one Transfer action, deposit in yoctoNEAR built from the typed STRING (never a float).
//               Max leaves 0.05 NEAR for gas and storage, on top of the storage the account must keep.
//   tokens      ft_transfer to the token contract with 1 yoctoNEAR attached and 30 TGas. If the recipient
//               is not registered with that token (storage_balance_of answers null), storage_deposit
//               { account_id: recipient, registration_only: true } goes FIRST in the SAME transaction,
//               attaching the contract's own storage_balance_bounds.min -- otherwise ft_transfer panics
//               and the user pays for a failure.
//   signing     (await lxn.wallet()).signAndSendTransaction({ signerId, receiverId, actions }) through NEAR
//               Connect, with its action shape: { type: 'Transfer' | 'FunctionCall', params: {...} }.
// Signed transactions: Receive QR, Send, and Cancel order.
//
// Everything else on this build READS the ledger. This is the first layer that asks the user's wallet
// to sign something, which changes what a bug costs: a read that goes wrong shows a wrong number, a
// write that goes wrong moves someone's money to the wrong place and cannot be undone.
//
// So the rules here are stricter than elsewhere in this project:
//
//   * NOTHING IS SUBMITTED THAT HAS NOT BEEN CHECKED AGAINST THE LEDGER FIRST. Every failure mode
//     below was chosen because the transaction would otherwise be signed by the user, succeed or fail
//     on-chain, and cost a real fee or real funds to learn what this code could have known for free.
//   * The design's own modals are used exactly as they ship. No new dialog, no new field, no new
//     page — the amount input, the recipient input, the asset button and the confirm button are all
//     the design's, and only their behaviour is added.
//   * Amounts are built from the ledger's own units (drops, issued-currency objects), never from the
//     formatted strings on screen.
//
// Signing goes through window.lxc.submit(tx), which refuses rather than guesses when the stored
// connection has no transport. That refusal is deliberate and is not worked around here.
(function () {
  if (window.__lxnSend) return;
  window.__lxnSend = 1;

  var RPC = 'https://free.rpc.fastnear.com';
  var NEAR_LOGO = '/assets/networks/near.png';
  var TGAS30 = '30000000000000';
  var GAS_KEEP = 0.05;                                   // NEAR left behind by Max, for gas and storage

  // NEAR reads, FastNEAR's free RPC. A 429 or a dropped request is retried twice; an answer is final.
  function view(params, attempt) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 15000);
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'lx', method: 'query', params: params }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 429 || r.status >= 500) { var e1 = new Error('NEAR RPC busy (' + r.status + ')'); e1.transient = 1; throw e1; }
      return r.json();
    }, function (e) {
      clearTimeout(timer);
      var e0 = new Error((e && e.name === 'AbortError') ? 'NEAR did not answer in time — try again.' : 'NEAR RPC unreachable');
      e0.transient = 1; throw e0;
    }).then(function (j) {
      var err = j && j.error;
      if (err) {
        // The machine code travels with the error: matching prose is how the XRPL build once let a
        // whole validation branch go dead (see the note in its rpc()).
        var e = new Error(String((err.cause && err.cause.name) || err.message || 'RPC error'));
        e.code = (err.cause && err.cause.name) || '';
        throw e;
      }
      if (j && j.result && j.result.error) { var e2 = new Error(String(j.result.error)); e2.code = 'CALL'; throw e2; }
      return j.result;
    }).catch(function (e) {
      if (!(e && e.transient) || (attempt || 0) >= 2) throw e;
      return new Promise(function (r) { setTimeout(r, 900 + 900 * (attempt || 0)); })
        .then(function () { return view(params, (attempt || 0) + 1); });
    });
  }
  function callView(contract, method, args) {
    return view({
      request_type: 'call_function', finality: 'final', account_id: contract,
      method_name: method, args_base64: btoa(JSON.stringify(args || {}))
    }).then(function (r) {
      var bytes = new Uint8Array((r && r.result) || []), txt = '';
      try { txt = new TextDecoder().decode(bytes); } catch (e) { for (var i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]); }
      return txt ? JSON.parse(txt) : null;
    });
  }
  function accountExists(id) {
    return view({ request_type: 'view_account', finality: 'final', account_id: id }).then(function () { return true; }, function (e) {
      if (e && (e.code === 'UNKNOWN_ACCOUNT' || /UNKNOWN_ACCOUNT|does not exist/i.test(e.message || ''))) return false;
      throw e;
    });
  }

  // ---- amounts as strings ---------------------------------------------------------------------------
  // "1.5" with 24 decimals -> "1500000000000000000000000". Refuses rather than rounds: more decimals than
  // the token has is an amount that cannot be sent exactly, and silently shaving it is a different amount.
  function toUnits(str, dec) {
    var s = String(str == null ? '' : str).trim().replace(/,/g, '');
    if (!/^[0-9]*\.?[0-9]*$/.test(s) || !/[0-9]/.test(s)) return null;
    var p = s.split('.'), whole = p[0] || '0', frac = p[1] || '';
    if (frac.length > dec) return null;
    while (frac.length < dec) frac += '0';
    var out = (whole + frac).replace(/^0+/, '');
    return out || '0';
  }
  // The inverse, exact: raw units -> a plain decimal string with no trailing zeros.
  function fromUnits(raw, dec) {
    var s = String(raw == null ? '0' : raw).replace(/^0+/, '') || '0';
    if (!dec) return s;
    while (s.length <= dec) s = '0' + s;
    var w = s.slice(0, s.length - dec), f = s.slice(s.length - dec).replace(/0+$/, '');
    return f ? (w + '.' + f) : w;
  }
  function cmpUnits(a, b) {                              // compares two non-negative integer strings
    a = String(a).replace(/^0+/, '') || '0'; b = String(b).replace(/^0+/, '') || '0';
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  }
  function cssUrl(u) {
    u = String(u || '');
    if (!/^data:image\//i.test(u) && !/^https:\/\//i.test(u)) return '';
    if (u.indexOf('"') >= 0 || u.indexOf('\\') >= 0 || u.length > 400000) return '';
    u = u.replace(/[\r\n\t]/g, '');
    if (/^data:image\/svg\+xml,/i.test(u)) u = u.replace(/#/g, '%23');
    return u;
  }
  function validAcct(a) {
    try { if (window.lxn && window.lxn.validAccount) return window.lxn.validAccount(a); } catch (e) {}
    return false;
  }
  // Implicit accounts exist as soon as something is sent to them; a named one must have been created.
  function isImplicit(a) { return /^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a); }

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  // The logo layer claims any element holding one to five characters and empties it. data-logoed is
  // its own skip marker. Same helper as wallet.js, for the same reason.
  function plain(e, text) {
    try {
      e.removeAttribute('data-logo');
      e.style.background = '';
      e.style.backgroundImage = '';
      e.setAttribute('data-logoed', '1');
    } catch (_) {}
    e.textContent = text;
  }

  function thumbOf(a) {
    if (!a || a.native || a.id === 'wrap.near') return NEAR_LOGO;
    return cssUrl(a.logo);
  }
  // Scanning is a phone action: on a desktop the camera points at the user. Same UA test the site already
  // uses to decide which page to serve.
  function isPhone() {
    try { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); } catch (e) { return false; }
  }

  // ---- Receive: Stellar's layout -------------------------------------------------------------------
  // RAZA 2026-09-15: "The receive popup is not same as on Stellar." lumoscore.com rebuilds this body as
  // .lx-rc — the QR on a white card with accent corners and the logo in its centre, a globe-marked
  // "Your … address" label, the address in a copyable box, and a one-line warning. The inherited sheet
  // carries every .lx-rc* rule; only the markup was missing, because the layer that wrote it was Stellar's.
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
  var WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  // The Receive dialog's copy controls toast "Copied to clipboard", as lumoscore.com's do — see wallet.js setChip.
  function stripCopyLabels() {
    $$('#modalReceive [data-copy-label], .lx-rc [data-copy-label]').forEach(function (b) { b.removeAttribute('data-copy-label'); });
  }

  function enhanceReceive() {
    var me = addr();
    // The address is written into markup, so it must be a real r-address and nothing else.
    if (!me || !validAcct(me)) return;
    $$('.qr-display').forEach(function (disp) {
      var body = disp.closest('.modal-body');
      if (!body || body.getAttribute('data-lxrc') === '1') return;
      body.setAttribute('data-lxrc', '1');
      var wrap = document.createElement('div');
      wrap.className = 'lx-rc';
      wrap.innerHTML = '<div class="lx-rc-qrwrap"><div class="qr-frame"><svg></svg></div>'
        + '<span class="lx-rc-corner tl"></span><span class="lx-rc-corner tr"></span>'
        + '<span class="lx-rc-corner bl"></span><span class="lx-rc-corner br"></span>'
        + '<div class="lx-rc-qrlogo"><img src="/assets/favicon.png" alt=""></div></div>'
        + '<div class="lx-rc-addrlabel">' + GLOBE + ' Your NEAR account</div>'
        + '<div class="lx-rc-addr" data-copy="' + me + '">' + me + '</div>'
        + '<div class="lx-recv-note lx-rc-note">' + WARN
        + '<span><strong>NEAR assets only.</strong> Other networks = lost funds.</span></div>';
      var ov = body.closest('.modal-overlay');
      if (ov) ov.classList.add('lx-recv-modal');
      body.innerHTML = '';
      body.appendChild(wrap);
      var ad = wrap.querySelector('.lx-rc-addr');
      ad.addEventListener('click', function () {
        try { if (navigator.clipboard) navigator.clipboard.writeText(ad.getAttribute('data-copy') || me); } catch (e) {}
        ad.classList.add('lx-copied');
        setTimeout(function () { ad.classList.remove('lx-copied'); }, 1400);
      });
    });
  }

  // ---- Send: recipient Paste and Scan ----------------------------------------------------------------
  // A scanned or pasted value may be a bare address or a wallet URI carrying one (and maybe a tag).
  // Returns true only when an XRP Ledger address was found and written.
  function fillRecipient(rec, raw) {
    var t = String(raw || '').trim().replace(/^near:/i, '').split(/[?\s]/)[0].toLowerCase();
    if (!validAcct(t)) return false;
    rec.value = t;
    try { rec.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    return true;
  }

  // jsQR, self-hosted beside xrpl.js and fetched only when someone taps Scan — Stellar's scanner.
  var qrLib = null;
  function loadQrLib() {
    if (qrLib) return qrLib;
    qrLib = new Promise(function (res, rej) {
      if (window.jsQR) return res(window.jsQR);
      var s = document.createElement('script');
      s.src = '/assets/vendor/jsqr-1.4.0.js';
      s.onload = function () { window.jsQR ? res(window.jsQR) : rej(new Error('The scanner failed to load.')); };
      s.onerror = function () { qrLib = null; rej(new Error('The scanner failed to load.')); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  // The camera sheet. Everything that can end it goes through stop(), so the camera is never left running.
  function scanQr(onText) {
    if (!window.isSecureContext) { say('The camera needs a secure (https) connection.', 'bad'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This browser cannot open the camera.', 'bad'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center';
    var vid = document.createElement('video');
    vid.setAttribute('playsinline', ''); vid.muted = true; vid.autoplay = true;
    vid.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
    var frame = document.createElement('div');
    frame.style.cssText = 'position:relative;width:66vw;max-width:300px;aspect-ratio:1;border:3px solid rgba(255,255,255,.9);border-radius:18px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55)';
    var hint = document.createElement('div');
    hint.textContent = 'Point at a NEAR account QR code';
    hint.style.cssText = 'position:absolute;left:0;right:0;bottom:14vh;text-align:center;color:#fff;font:600 14px system-ui,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8)';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:6vh;padding:11px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.5);color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer';
    ov.appendChild(vid); ov.appendChild(frame); ov.appendChild(hint); ov.appendChild(cancel);
    document.body.appendChild(ov);
    var stream = null, raf = 0, dead = false;
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); stop(); } }
    function stop() {
      if (dead) return;
      dead = true;
      try { cancelAnimationFrame(raf); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { vid.srcObject = null; } catch (e) {}
      document.removeEventListener('keydown', onKey, true);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); stop(); });
    var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    loadQrLib().then(function (dec) {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (st) {
        if (dead) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = st;
        vid.srcObject = st;
        return vid.play().catch(function () {}).then(function () {
          (function tickScan() {
            if (dead) return;
            if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
              var w = 480, h = Math.max(1, Math.round(vid.videoHeight * (w / (vid.videoWidth || w))));
              if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
              cx.drawImage(vid, 0, 0, w, h);
              var r = null;
              try { r = dec(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' }); } catch (e) {}
              if (r && r.data) { stop(); onText(r.data); return; }
            }
            raf = requestAnimationFrame(tickScan);
          })();
        });
      });
    }).catch(function (err) {
      stop();
      var n = (err && err.name) || '';
      if (n === 'NotAllowedError' || n === 'SecurityError') say('Camera permission was declined.', 'bad');
      else if (n === 'NotFoundError' || n === 'OverconstrainedError') say('No camera found on this device.', 'bad');
      else say((err && err.message) || 'Could not open the camera.', 'bad');
    });
  }

  function addRecipientButtons(rec) {
    if (rec.__lxnRecBtns) return;
    rec.__lxnRecBtns = 1;
    var wrap = document.createElement('div');
    wrap.style.position = 'relative';
    rec.parentNode.insertBefore(wrap, rec);
    wrap.appendChild(rec);
    var bar = document.createElement('div');
    bar.className = 'lx-recbtns';
    if (isPhone()) {
      var sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'lx-paste-btn lx-scan-btn';
      sb.setAttribute('data-logoed', '1');
      sb.setAttribute('aria-label', 'Scan a QR code');
      sb.title = 'Scan a QR code';
      sb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M21 16v3a2 2 0 0 1-2 2h-3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M7 12h10"></path></svg>';
      sb.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        scanQr(function (txt) {
          if (fillRecipient(rec, txt)) say('Address scanned.', 'good');
          else say('That QR code has no NEAR account in it.', 'bad');
        });
      });
      bar.appendChild(sb);
    }
    var pb = document.createElement('button');
    pb.type = 'button';
    pb.className = 'lx-paste-btn';
    pb.setAttribute('data-logoed', '1');                           // five letters: keep the logo healer off it
    pb.textContent = 'Paste';
    pb.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!navigator.clipboard || !navigator.clipboard.readText) { say('Clipboard unavailable — paste with Ctrl+V.', 'bad'); return; }
      navigator.clipboard.readText().then(function (x) {
        if (!fillRecipient(rec, x)) { rec.value = String(x || '').trim(); }
        say('');
        try { rec.focus(); } catch (e2) {}
      }, function () { say('Clipboard blocked — paste with Ctrl+V.', 'bad'); });
    });
    bar.appendChild(pb);
    wrap.appendChild(bar);
    function fit() {
      try { var bw = bar.getBoundingClientRect().width; if (bw > 0) rec.style.paddingRight = Math.round(bw + 14) + 'px'; } catch (e) {}
    }
    rec.style.paddingRight = isPhone() ? '118px' : '70px';
    fit(); setTimeout(fit, 60); setTimeout(fit, 400);
  }

  // ---- Receive QR ----------------------------------------------------------------------------------
  // The design ships a hand-drawn SVG under a comment that says "Faux QR pattern (decorative)". It is
  // a picture of a QR code: it encodes nothing, and it sits directly above the correct address on the
  // one screen whose entire purpose is telling somebody where to send money. A person who scans it
  // gets garbage, and the only reason that is not worse is that no wallet will parse it as an address.
  //
  // Replaced with a real one. The renderer is the Stellar build's, unchanged, because it is already
  // the corrected version — an earlier attempt there shipped unscannable and the two fixes are both
  // load-bearing and both invisible if you only look at it:
  //
  //   width/height 1.04 rather than 1 — at 1 the modules meet exactly on a pixel boundary and the
  //   renderer's antialiasing leaves a pale seam between every pair, which reads as noise to a decoder.
  //
  //   fill dark on an explicitly white background — QR polarity is not a style choice. Inverted, it is
  //   not a low-contrast QR code, it is not a QR code, and it fails silently on every scanner.
  //
  // The error-correction ladder tries the densest levels first so the code stays small; addData throws
  // when the data will not fit the requested version, hence the try/catch walk rather than a guess.
  function makeQR(txt) {
    var lv = [[0, 'H'], [0, 'Q'], [8, 'H'], [10, 'H'], [0, 'M'], [4, 'M']];
    for (var i = 0; i < lv.length; i++) {
      try {
        var q = window.qrcode(lv[i][0], lv[i][1]);
        q.addData(txt);
        q.make();
        return q;
      } catch (e) {}
    }
    return null;
  }

  // EVERY frame, not the first one. The page ships TWO complete sets of modals — the desktop set, and
  // a second set inside #lx-mobmodals that is the one a phone actually shows. querySelector returns
  // the desktop copy, so painting "the" QR left the phone's untouched. Same trap as the duplicated
  // .section-heading .meta, and the reason nothing below uses a singular lookup either.
  function paintQR() {
    try {
      if (!window.qrcode) return;
      var me = addr();
      if (!me) return;
      var q = null;
      $$('.qr-frame svg, .qr-display svg').forEach(function (fr) {
        if (fr.getAttribute('data-lxqr') === me) return;         // keyed on the address, so it
        q = q || makeQR(me);                                     // repaints if the wallet changes
        if (!q) return;
        var n = q.getModuleCount(), s = '';
        for (var r = 0; r < n; r++) {
          for (var c = 0; c < n; c++) {
            if (q.isDark(r, c)) s += '<rect x="' + c + '" y="' + r + '" width="1.04" height="1.04"></rect>';
          }
        }
        fr.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
        fr.setAttribute('fill', '#0d1117');
        fr.style.background = '#fff';
        fr.innerHTML = s;
        fr.setAttribute('data-lxqr', me);
        fr.classList.add('lx-qr-ready');
        // AND THEN IT WAS STILL INVISIBLE — a correct, decodable, 551-module QR rendering as a plain
        // white square. The orphaned Stellar stylesheet carries
        //     .qr-display .qr-frame svg, .qr-display canvas, .qr-display img { visibility:hidden!important }
        // which hides the design's faux QR until a data layer supplies a real one. Its companion rule,
        //     .lx-rc-qrwrap .qr-frame svg:not(.lx-qr-ready) { visibility:hidden }
        // shows that the intended escape was for Stellar's layer to REBUILD the receive body inside its
        // own .lx-rc-qrwrap — so within .qr-display there is no escape at all: the rule is unconditional
        // and !important, and adding .lx-qr-ready does nothing against it.
        //
        // Rebuilding the modal to dodge a stylesheet would be changing the design to work around a rule
        // belonging to a layer that is gone. Lifting the gate on the one element now holding real data
        // is smaller and says what it means. An inline !important is what outranks a sheet !important.
        fr.style.setProperty('visibility', 'visible', 'important');
      });
    } catch (e) {}
  }

  // THE RECEIVE SCREEN WAS TELLING PEOPLE THE WRONG ADDRESS, ON THE WRONG CHAIN.
  //
  // On a phone it read, in full: a QR, the label "Your Aptos address", the address
  // GA7K5N4M2X9P3R8Q1L6T2V8W4Y7Z3A5B8C2D6E1F4G7H9J2K5N4M2 — a Stellar-shaped string from the design
  // mock, belonging to nobody — and under it "Only send APT and Aptos-based assets to this address.
  // Sending assets from other networks will result in loss of funds."
  //
  // The data-copy attribute beside it held the RIGHT address the whole time, so the Copy button worked
  // and only the visible text was wrong. That is the worst possible split: anyone who copied was fine,
  // anyone who read the screen — or photographed it, or typed it out — sent funds into nothing. It is
  // also why no DOM check caught it; every probe I ran read data-copy and came back correct.
  //
  // Stellar's wallet layer used to rewrite this text (matching the same GA7K5N4M prefix). Stripping
  // that layer took the correction with it and left the mock, which is the general hazard recorded in
  // the stripped-layer notes: the CSS and the markup stay, only the fix leaves.
  function fixReceive() {
    var me = addr();
    if (!me) return;

    // The address line. Keyed on data-copy where the design provides it — that attribute is the
    // design's own statement of which element holds the address — and otherwise on the mock's shape.
    $$('.qr-addr, [data-copy]').forEach(function (e) {
      var t = (e.textContent || '').trim();
      if (!t || t === me) return;
      var looksLikeAddr = /^[Gr][A-Za-z0-9]{24,}$/.test(t) || /^0x[0-9a-fA-F]{8,}$/.test(t);
      if (!looksLikeAddr) return;                                // never touch a button's label
      e.textContent = me;
      if (e.hasAttribute('data-copy')) e.setAttribute('data-copy', me);
    });

    $$('.qr-label').forEach(function (e) {
      if (/aptos|stellar/i.test(e.textContent || '')) e.textContent = 'Your NEAR account';
    });

    // The warning is the most important sentence on the screen and it named the wrong chain twice.
    // Rewritten as text, on the element that holds it, so the design's box and accent styling stay.
    $$('.modal-body div, .lx-recv-note, .lt-hint').forEach(function (e) {
      if (e.__lxwarn) return;
      var t = e.textContent || '';
      if (!/Only send/i.test(t) || !/APT|Aptos/.test(t)) return;
      e.__lxwarn = 1;
      [].forEach.call(e.childNodes, function (nd) {
        if (nd.nodeType !== 3) return;
        nd.nodeValue = nd.nodeValue
          .replace(/Only send APT and Aptos-based assets/i, 'Only send NEAR and NEAR assets')
          .replace(/\bAptos-based\b/gi, 'NEAR')
          .replace(/\bAPT\b/g, 'NEAR')
          .replace(/\bAptos\b/g, 'NEAR');
      });
    });
  }

  // ---- shared: the connected account's holdings ----------------------------------------------------
  // wallet.js publishes these. Reading its object rather than re-fetching keeps one answer about what
  // is held and what is spendable, so Send can never offer an amount the balance list disagrees with.
  function held() {
    var d = window.__lxnData;
    if (!d) return [];
    var out = [];
    if (d.near) {
      out.push({
        code: 'NEAR', id: null, native: true, dec: 24, logo: NEAR_LOGO,
        balance: d.near.balance, spendable: Math.max(0, d.near.spendable - GAS_KEEP)
      });
    }
    (d.held || []).forEach(function (t) {
      if (t.dec == null || t.balance == null) return;     // metadata unknown: cannot build an exact amount
      out.push({
        code: t.display, id: t.id, dec: t.dec, raw: t.raw, logo: t.logo,
        balance: t.balance, spendable: t.balance
      });
    });
    return out;
  }

  // ---- Send ----------------------------------------------------------------------------------------
  var sendPick = null;                                          // the asset currently selected

  function sendModal() { return $('#modalSend'); }

  // A REAL LOGO (RAZA 2026-09-15: "Wallet → Swap popup, most of the logos are incorrect"). The page's logo healer paints any
  // one-letter badge from a ticker lookup that knows nothing about XRP Ledger issuers — XYIELD came out as a letter, LUMOS
  // as a stock flame. An <img> child is the one thing the healer leaves alone, so the token's own thumbnail goes in one.
  function icoImg(host, a) {
    host.textContent = '';
    host.setAttribute('data-logoed', '1');
    host.style.background = 'transparent';
    host.style.overflow = 'hidden';
    host.style.padding = '0';
    var im = document.createElement('img');
    im.alt = '';
    im.src = thumbOf(a);
    // FEED THE CHANNEL THE SHARED CSS ACTUALLY READS.
    //
    // The swap modal's picker is .lx-ap-ico, and the wallet stylesheet -- authored on the Stellar
    // side, shared because /wallet serves both chains -- takes its logo from a custom property and
    // hides anything else:
    //     .lx-ap-ico{background-image:var(--lxlogo,none)!important}
    //     .lx-ap-ico img{display:none!important}
    // So the <img> below was inserted, loaded (48x48, confirmed), and rendered at 0x0 behind a
    // display:none that an inline style cannot outrank -- a stylesheet !important beats an inline
    // declaration. RAZA 2026-10-11: "No logos shown on swap popup on mobile."
    //
    // Nothing else is affected: .lx-ap-ico is the ONLY rule reading --lxlogo, so setting it on the
    // other hosts this function serves (.a-ico, .dxa-pl-ico) is inert, and their imgs keep showing
    // as they already do. Both channels carry the same url, so there is nothing to disagree about.
    //
    // The quote guard is the url(") trap this project has hit before: a quote inside the value would
    // close the CSS string early. Our own endpoint encodes its parameters, so this is belt only.
    try {
      var lu = thumbOf(a);
      if (lu && lu.indexOf('"') < 0 && lu.indexOf("'") < 0) {
        host.style.setProperty('--lxlogo', 'url("' + lu + '")');
      }
    } catch (e) {}
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
    im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); plain(host, a.code.charAt(0).toUpperCase()); };
    host.appendChild(im);
  }

  function setSendAsset(a) {
    var m = sendModal();
    if (!m || !a) return;
    sendPick = a;

    var btn = $('.asset-pick', m);
    if (btn) {
      // The button holds an icon span, the ticker as a bare text node, and a chevron svg. Only the
      // text node is replaced: rewriting the button would take the design's icon and chevron with it.
      var ico = $('.a-ico', btn);
      if (ico) plain(ico, a.code.charAt(0).toUpperCase());
      [].forEach.call(btn.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + a.code + ' ';
      });
    }

    var lp = $('.lx-asset-pick', m);
    if (lp) {
      var lc = $('.lx-ap-code', lp);
      if (lc) plain(lc, a.code);
      var li = $('.lx-ap-ico', lp);
      if (li) { plain(li, ''); li.style.setProperty('--lxlogo', 'url("' + thumbOf(a) + '")'); }
    }

    var bal = $('.field-meta strong', m);
    // "Balance" here means what can actually be sent. For XRP that is the balance MINUS the reserve,
    // which is not a detail: the design shipped this row reading 25,420.18 APT, and a Max button that
    // offers the full balance of an XRP account builds a transaction the ledger always rejects.
    if (bal) bal.textContent = fmt(a.spendable, 6) + ' ' + a.code;

    var fee = $('.modal-body strong[style*="JetBrains"]', m);
    if (fee) fee.textContent = a.native ? '~0.0001 NEAR' : '~0.001 NEAR';
    say('');
  }

  // The asset menu. Built from the design's own field styling and anchored under the picker button,
  // because the design ships a button with a chevron and no menu behind it.
  function openAssetMenu(btn) {
    var m = sendModal();
    if (!m) return;
    var old = $('.lxw-astmenu', m);
    if (old) { old.parentNode.removeChild(old); return; }        // second click closes

    var list = held().filter(function (a) { return a.spendable > 0 && !a.frozen; });
    if (!list.length) return;

    var menu = document.createElement('div');
    menu.className = 'lxw-astmenu';
    menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:210px;'
      + 'max-height:260px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
      + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
    list.forEach(function (a) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'lxw-astrow';
      row.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
        + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
      var ic = document.createElement('span');
      ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
      icoImg(ic, a);
      var nm = document.createElement('span');
      nm.style.cssText = 'flex:1;font-weight:700';
      plain(nm, a.code);
      var bl = document.createElement('span');
      bl.style.cssText = 'opacity:.7;font-size:12px';
      bl.textContent = fmt(a.spendable, 4);
      row.appendChild(ic); row.appendChild(nm); row.appendChild(bl);
      row.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setSendAsset(a);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      menu.appendChild(row);
    });

    var host = btn.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);

    // Closing on an outside click is registered on the NEXT frame. Binding it synchronously means the
    // very click that opened this menu is still propagating, reaches document, and closes it again —
    // which on a phone looks exactly like "the dropdown shuts the first time you tap it".
    requestAnimationFrame(function () {
      function away(e) {
        if (menu.contains(e.target) || btn.contains(e.target)) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', away, true);
      }
      document.addEventListener('click', away, true);
    });
  }

  // STELLAR'S FAILURE TOAST (RAZA 2026-09-17: "When Wallet → send trx is canceled, you need to show the same message that
  // you show on Stellar"). lumoscore.com ends a failed send with `lxToast(err.message || "Send failed", true)` — a toast at
  // the foot of the page with a red mark — and a wallet that refuses carries no message, which is why the Stellar screenshot
  // reads exactly "Send failed". Same element and classes the copy toast on the Wallet page already uses; only the mark
  // differs, so the two cannot drift apart visually.
  function toastBad(msg) {
    if (!document.getElementById('lx-toastbad-css')) {
      var st = document.createElement('style');
      st.id = 'lx-toastbad-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}'
        + '.lx-ctoast.bad .ci{background:#e5484d}';
      (document.head || document.documentElement).appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast bad';
    var ic = document.createElement('span'); ic.className = 'ci'; ic.textContent = '✕';
    var tx = document.createElement('span'); tx.textContent = msg || 'Send failed';
    t.appendChild(ic); t.appendChild(tx);
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  // Status line. Reuses the modal's own body so nothing new is introduced; created once, then reused.
  function say(text, tone) {
    var m = sendModal();
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

  // NEAR has no destination tag: an exchange that needs a reference asks for a memo on its own deposit
  // page, and the design's Send dialog carries no such field. Nothing is added here.
  function tagInput() { return null; }

  function parseDest(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (!s) return { err: 'Enter a recipient account.' };
    if (!validAcct(s)) return { err: 'That is not a valid NEAR account. Use a name like alice.near or a 64-character account.' };
    return { account: s };
  }

  // Everything NEAR can tell us BEFORE the user signs. Each check here is a transaction that would
  // otherwise be signed, submitted, and fail -- costing gas and a lot of confusion.
  function preflight(dest, a) {
    return accountExists(dest.account).then(function (exists) {
      var warn = '';
      if (!exists) {
        if (!isImplicit(dest.account)) return { err: 'That NEAR account does not exist. Check the spelling.' };
        warn = a.native ? 'This account has not been used yet — this transfer creates it.'
          : 'This account has not been used yet. Its owner holds the key, so the tokens are theirs once it is used.';
      }
      if (a.native) return { warn: warn };
      return callView(a.id, 'storage_balance_of', { account_id: dest.account }).then(function (sb) {
        if (sb) return { warn: warn, reg: false };
        // Not registered with this token: register in the same transaction, paying the contract's own minimum.
        return callView(a.id, 'storage_balance_bounds', {}).then(function (b) {
          var min = b && b.min != null ? String(b.min) : '';
          if (!/^[0-9]+$/.test(min)) return { err: 'This token did not say what registering a new holder costs, so nothing was sent.' };
          return { warn: (warn ? warn + ' ' : '') + 'They are not registered with ' + a.code + ' yet; '
            + fromUnits(min, 24) + ' NEAR of storage is added to this transaction.', reg: true, min: min };
        });
      });
    });
  }

  // The transaction, in NEAR Connect's action shape. Built only from strings and the preflight answer.
  function buildTx(me, dest, a, units, chk) {
    if (a.native) {
      return { signerId: me, receiverId: dest.account, actions: [{ type: 'Transfer', params: { deposit: units } }] };
    }
    var actions = [];
    if (chk && chk.reg) {
      actions.push({ type: 'FunctionCall', params: {
        methodName: 'storage_deposit', args: { account_id: dest.account, registration_only: true },
        gas: TGAS30, deposit: chk.min } });
    }
    actions.push({ type: 'FunctionCall', params: {
      methodName: 'ft_transfer', args: { receiver_id: dest.account, amount: units },
      gas: TGAS30, deposit: '1' } });
    return { signerId: me, receiverId: a.id, actions: actions };
  }

  function txHashOf(r) {
    if (!r) return '';
    if (typeof r === 'string') return r;
    return (r.transaction && r.transaction.hash) || (r.transaction_outcome && r.transaction_outcome.id) || r.hash || '';
  }

  function doSend() {
    var m = sendModal();
    if (!m) return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !toIn || !go) return;
    if (go.getAttribute('data-busy') === '1') return;

    var a = sendPick || held()[0];
    if (!a) { say('No balance to send.', 'bad'); return; }
    var me = addr();
    if (!me) { say('Connect a NEAR wallet first.', 'bad'); return; }

    var typed = String(amtIn.value || '').trim().replace(/,/g, '');
    var units = toUnits(typed, a.dec);
    if (units == null) { say(/\./.test(typed) ? ('That is more decimal places than ' + a.code + ' has (' + a.dec + ').') : 'Enter an amount greater than zero.', 'bad'); return; }
    if (cmpUnits(units, '0') <= 0) { say('Enter an amount greater than zero.', 'bad'); return; }
    // Tokens are checked exactly against the raw balance; NEAR against what is available less the gas keep.
    var over = a.native ? (parseFloat(typed) > a.spendable + 1e-12) : (cmpUnits(units, a.raw) > 0);
    if (over) {
      say('That is more than you can send. ' + fmt(a.spendable, 6) + ' ' + a.code + ' is available'
        + (a.native ? ' (0.05 NEAR stays for gas and storage).' : '.'), 'bad');
      return;
    }
    var dest = parseDest(toIn.value);
    if (dest.err) { say(dest.err, 'bad'); return; }
    if (dest.account === me) { say('That is your own account.', 'bad'); return; }

    var label = go.textContent;
    go.disabled = true;
    go.setAttribute('data-busy', '1');
    say('Checking the recipient…');

    preflight(dest, a).then(function (chk) {
      if (chk && chk.err) { say(chk.err, 'bad'); return; }
      say((chk && chk.warn ? chk.warn + ' ' : '') + 'Approve the transfer in your wallet…');
      var nudge = setTimeout(function () {
        say('Still waiting for your wallet. If you closed or declined the request, nothing was sent — press Cancel and try again.');
      }, 20000);
      var tx = buildTx(me, dest, a, units, chk);
      if (!window.lxn || !window.lxn.wallet) { clearTimeout(nudge); throw new Error('Connect a NEAR wallet first.'); }
      return window.lxn.wallet().then(function (w) {
        if (!w || typeof w.signAndSendTransaction !== 'function') throw new Error('This wallet cannot sign transactions here.');
        return w.signAndSendTransaction(tx);
      }).then(function (res) {
        clearTimeout(nudge);
        var hash = txHashOf(res);
        say('Sent.' + (hash ? ' ' + short(hash) : ''), 'good');
        amtIn.value = '';
        toIn.value = '';
        setTimeout(function () { closeSend(); }, 1800);
        setTimeout(function () {
          try { sessionStorage.removeItem('lxn.act.' + me); } catch (e) {}
          if (window.__lxnReload) window.__lxnReload();
        }, 3500);
      }, function (e) {
        clearTimeout(nudge);
        throw e;
      });
    }).catch(function (e) {
      // A wallet that refuses, closes, or answers with nothing tells us one thing: it did not go. Stellar
      // says "Send failed" for that, so this does too. A message from NEAR itself is real information.
      var msg = String((e && e.message) || '');
      var plumbing = !msg || /reject|denied|cancel|closed|user|did not respond|could not sign/i.test(msg);
      say(plumbing ? '' : msg, 'bad');
      toastBad(plumbing ? 'Send failed' : msg);
    }).then(function () {
      go.disabled = false;
      go.removeAttribute('data-busy');
      go.textContent = label;
    });
  }
  function closeSend() {
    var m = sendModal();
    if (!m) return;
    var x = m.querySelector('.modal-close, [data-close]');
    if (x) x.click();
    else { m.classList.remove('open'); m.style.display = 'none'; }
  }

  // Blanks the form. Called when the dialog opens, so nothing survives from the last time it was used.
  function resetSend() {
    var m = sendModal();
    if (!m) return;
    var amt = $('.field-amt input', m);
    var to = $('.field-input.mono', m) || $('input.mono', m);
    var tg = tagInput();
    if (amt) amt.value = '';
    // …except the one case where an address was asked for deliberately: "Send to this wallet" arrives as /wallet?to=r…
    // and opens this dialog by clicking Send, so that address must survive the reset it triggers.
    if (to) { to.value = pendingTo || ''; }
    pendingTo = null;
    if (tg) tg.value = '';
    say('');
  }

  function wireSend() {
    var m = sendModal();
    if (!m || m.getAttribute('data-lxw') === '1') return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var pick = $('.asset-pick', m);
    var max = $('.pill-btn', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !go) return;                                   // markup not ready yet
    m.setAttribute('data-lxw', '1');

    // STELLAR'S SEND ROW (RAZA 2026-09-15: "Max button is different on XRPL. Paste button is missing. On
    // mobile … barcode scan icon is missing"). lumoscore.com hides the design's asset button behind its own
    // .lx-asset-pick, moves Max INTO the amount field as .lx-max-inline, and puts Paste (with Scan on a
    // phone) inside the recipient box. The inherited sheet carries every one of those rules.
    var famt = $('.field-amt', m);
    if (pick && famt && !$('.lx-asset-pick', m)) {
      pick.style.display = 'none';
      var np = document.createElement('button');
      np.type = 'button';
      np.className = 'lx-asset-pick';
      np.setAttribute('data-lx-noswap', '');
      np.innerHTML = '<span class="lx-ap-ico" data-logoed="1"></span><span class="lx-ap-code" data-logoed="1">NEAR</span>'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      pick.parentNode.insertBefore(np, pick.nextSibling);
      pick = np;
    }
    if (max && famt && max.parentNode !== famt) {
      famt.classList.add('lx-send-amt');
      max.classList.add('lx-max-inline');
      famt.appendChild(max);
    }
    if (toIn) addRecipientButtons(toIn);
    if (sendPick) setSendAsset(sendPick);

    // The recipient placeholder shipped as Stellar's: "G... or domain.com*username". On this ledger
    // that is an address format that cannot exist, telling the user to type something invalid.
    if (toIn) toIn.setAttribute('placeholder', 'alice.near or a 64-character account');
    var lbl = $('.field-label .meta', m);
    if (lbl) lbl.textContent = 'NEAR account';

    if (pick) {
      // pick is Stellar's .lx-asset-pick by now (above); the design's own button is hidden.
      pick.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openAssetMenu(pick);
      });
    }
    if (max) {
      max.addEventListener('click', function (e) {
        e.preventDefault();
        var a = sendPick || held()[0];
        if (!a) return;
        // For XRP this is already balance minus reserve; a little is left for the network fee, or the
        // transaction cannot pay for itself and fails for an amount the button just offered.
        // NEAR: available less the gas keep (held() already took it off), floored to 6 places. A token:
        // its exact balance from the raw units, so Max never rounds above what is held.
        amtIn.value = a.native ? String(Math.floor(a.spendable * 1e6) / 1e6) : fromUnits(a.raw, a.dec);
        say('');
      });
    }
    go.addEventListener('click', function (e) { e.preventDefault(); doSend(); });
  }

  // SEPARATE FROM wireSend ON PURPOSE. Wiring happens once and then marks itself done — but the
  // balances it needs arrive from the ledger a second or two later, so the first pass had nothing to
  // select and the guard stopped it ever trying again. The listeners worked (a click read the right
  // balance), while the asset button still read "APT" and the balance row "25,420.18 APT" beside it:
  // correct behaviour under a label from another chain, which is the worst way for this to be wrong.
  //
  // So the display keeps trying until there is something real to show, independently of the wiring.
  var sendPre = null, pendingTo = null;
  window.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button');
    if (!b || !/^\s*send\s*$/i.test(b.textContent || '')) return;
    if (b.closest('.modal-overlay') || b.classList.contains('qa-row-btn')) return;
    // wallet.js leaves the row's asset here just before it clicks this button.
    sendPre = window.__lxnSendPre || 'NEAR';
    window.__lxnSendPre = null;
    // EMPTY EVERY TIME IT OPENS (RAZA 2026-09-17: "there's already an address filled in which is not correct", and "if i
    // paste in the address but not click review & send and just close the popup, it should just refresh it"). The design
    // keeps this dialog in the DOM between openings, so a half-filled form came back with it — including a recipient
    // address from a payment the reader had decided not to make.
    setTimeout(function () { resetSend(); applySendPre(); }, 0);
  }, true);
  // "SEND TO THIS WALLET" hands the address over as /wallet?to=<r-address> (RAZA 2026-09-16); the Send dialog opens with it
  // filled in, as a click on Send would.
  (function () {
    var to = '';
    try { to = new URLSearchParams(window.location.search).get('to') || ''; } catch (e) {}
    to = String(to).toLowerCase();
    if (!to || !validAcct(to)) return;
    var tries = 0;
    (function openIt() {
      // Already open — a retry got there, or the page opened it itself. Skip straight to filling.
      var mOpen = sendModal();
      if (mOpen && mOpen.classList.contains('open')) {
        pendingTo = to;
      }
      var btn = (mOpen && mOpen.classList.contains('open')) ? null
        : [].slice.call(document.querySelectorAll('.quick-actions .qa-btn, button')).filter(function (b) {
          return /^\s*send\s*$/i.test(b.textContent || '') && !b.closest('.modal-overlay') && b.getBoundingClientRect().height > 0;
        })[0];
      if (!btn && !(mOpen && mOpen.classList.contains('open'))) {
        if (++tries < 40) setTimeout(openIt, 250);
        return;
      }
      // CLICKING IS NOT OPENING, AND THIS IS WHY IT FAILED ON PHONES. NO BACKTICKS IN THIS COMMENT.
      //
      // RAZA 2026-10-20: tapping Send on an account page "should take me to the wallet page (which it
      // does) but also open the send popup with the recipient wallet address entered in."
      //
      // Measured on the phone layout: the opener FOUND a perfectly good button — .action-btn, 94px
      // tall, outside any modal, passing its own filter — clicked it, and #modalSend stayed closed,
      // class "modal-overlay" with no "open". The button exists in the markup well before the page's
      // own script binds a handler to it, so on a slower layout the click lands on a button that does
      // nothing yet. Then this code moved straight on to filling a dialog that was never opened.
      //
      // Stellar hit exactly this and its note says so in as many words: "clicking is not the same as
      // having opened... fill() then returned true anyway (it only checked that a button was FOUND)".
      // Its fix is to click, CHECK, and let the poll come back — and that is what was missing here.
      // Same page, same handoff, same bug, fixed on one side a month ago.
      if (btn) {
        pendingTo = to;                                  // survives the open-time reset; see resetSend()
        try { btn.click(); } catch (e) {}
      }
      var mNow = sendModal();
      if (!mNow || !mNow.classList.contains('open')) {
        if (++tries < 40) setTimeout(openIt, 250);        // not open yet — come back and try again
        return;
      }
      var fill = 0;
      (function put() {
        var m = sendModal();
        var toIn = m && ($('.field-input.mono', m) || $('input.mono', m));
        if (!toIn) { if (++fill < 20) setTimeout(put, 150); return; }
        toIn.value = to;
        toIn.dispatchEvent(new Event('input', { bubbles: true }));
        toIn.dispatchEvent(new Event('change', { bubbles: true }));
      })();
    })();
  })();

  function applySendPre() {
    if (!sendPre) return;
    var list = held();
    if (!list.length) return;                                   // balances still loading; the poll retries
    var pickA = null;
    if (sendPre !== 'NEAR') pickA = list.filter(function (h) { return h.id === sendPre; })[0] || null;
    if (!pickA) pickA = list.filter(function (h) { return h.native; })[0] || list[0];
    sendPre = null;
    setSendAsset(pickA);
  }

  function refreshSendAsset() {
    if (sendPre) { applySendPre(); return; }
    if (sendPick) return;
    var first = held()[0];
    if (first) setSendAsset(first);
  }

  // ---- Swap: not on NEAR yet ------------------------------------------------------------------------
  // The wallet's Swap button opens the design's #modalSwap through the design's own handler. On NEAR
  // nothing quotes or executes a swap yet, and the dialog ships an Aptos mock -- "Balance: 25,420.18 APT",
  // "1 APT ≈ 0.4128 USDC", a live Confirm Swap. So, as the token page does (browser/dexasset.js): what is
  // invented is blanked, the pair reads NEAR -> USDC, and the design's own button is disabled with a label
  // that says why. Painted while the dialog is still closed, so the mock is never what opens.
  var SWAP_SOON = 'Swaps on NEAR are coming soon';
  function swapPickTo(b, code) {
    var ico = $('.a-ico', b);
    if (ico) plain(ico, code.charAt(0));
    [].forEach.call(b.childNodes, function (nd) {
      if (nd.nodeType === 3 && nd.nodeValue.trim() && nd.nodeValue.trim() !== code) nd.nodeValue = ' ' + code + ' ';
    });
  }
  function paintSwapSoon() {
    $$('#modalSwap').forEach(function (m) {
      $$('.field-label .meta', m).forEach(function (x, i) {
        var t = i === 0 ? 'Balance: —' : 'Estimated';
        if (x.textContent !== t) x.textContent = t;
      });
      $$('.asset-pick', m).forEach(function (b, i) { swapPickTo(b, i === 0 ? 'NEAR' : 'USDC'); });
      var rate = $('.swap-rate span', m);
      if (rate && rate.textContent !== 'Rate —') rate.textContent = 'Rate —';
      $$('.modal-body > div[style] strong', m).forEach(function (x) { if (x.textContent !== '—') x.textContent = '—'; });
      $$('.field-amt input', m).forEach(function (inp) { if (!inp.disabled) { inp.value = ''; inp.disabled = true; } });
      var go = $('.modal-foot .btn-primary', m);
      if (go && go.textContent !== SWAP_SOON) {
        go.textContent = SWAP_SOON;
        go.disabled = true;
        go.setAttribute('aria-disabled', 'true');
        go.style.opacity = '.55';
        go.style.cursor = 'not-allowed';
      }
    });
  }

  // ---- boot ------------------------------------------------------------------------------------------
  // The modals are build-time markup but the balances they need arrive asynchronously, and the Receive
  // QR must repaint if the connected wallet changes. Polling briefly is simpler than subscribing to
  // three different layers, and it stops on its own.
  function tick() {
    enhanceReceive();
    stripCopyLabels();
    paintQR();
    fixReceive();
    wireSend();
    refreshSendAsset();
    paintSwapSoon();
  }

  function boot() {
    // `#modalSwap` joins the list because the dashboard carries that dialog and none of the other
    // three. Without it this returned immediately there, so wireSwap() never ran and the Custom Swap
    // card had nothing to open — the dialog was present, correct and completely inert.
    if (!$('#modalSend') && !$('.qr-display') && !$('#tlExistingList') && !$('#modalSwap')) return;
    tick();
    var n = 0;
    var t = setInterval(function () {
      tick();
      if (++n > 40) clearInterval(t);                             // ~20s
    }, 500);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button, a');
      // The phone's modal set can be inserted when it opens, so repaint a few times after the click
      // rather than once — the elements may not exist on the first frame.
      if (b && /receive/i.test(b.textContent || '')) {
        [60, 220, 600].forEach(function (ms) {
          setTimeout(function () { enhanceReceive(); paintQR(); fixReceive(); }, ms);
        });
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
