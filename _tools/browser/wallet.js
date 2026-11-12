// NEAR Wallet page. PORTED FROM the XRPL fork's _tools/browser/wallet.js (2026-10-21) by an exact-count
// port script, and kept structurally parallel so a fix to one can be carried to the other. The long dated
// notes below are that file's history and describe the XRP Ledger build where they name it; the behaviour
// they protect (the anti-flash gates and who lifts them, both renderers, the logo healer's opt-outs, the
// probe queue, pins, the row menus, the runtime-built Open orders tab bar) is the same design and applies
// here unchanged.
//
// WHAT IS NEAR'S:
//   account      FastNEAR RPC view_account: liquid balance, staked (locked), storage_usage. "Available" is
//                the balance less the storage the account must keep (storage_usage x 1e19 yocto) once its
//                stake no longer covers it -- NEAR's own rule.
//   tokens       FastNEAR's index (/v1/account/<id>/ft): every NEP-141 contract with a balance. Zero
//                balances are not listed (a storage registration is not a holding).
//   identity     a token IS its contract id; the symbol is display only. Curated tokens take symbol,
//                decimals and logo from /lxapi/nearmarket (one call, also the price source); anything
//                else asks its own contract for ft_metadata, three at a time, and remembers symbol and
//                decimals in localStorage. Logos are accepted only as data:image or https urls.
//   tick         membership of the curated list -- the Trade page's roster -- plus wNEAR.
//   activity     NearBlocks txns-only + ft-txns, ONE pair of calls per view, cached 60s in sessionStorage,
//                and a 429 holds every further call for a minute (its free tier is rate-limited).
//   orders/pools none on NEAR yet: the design's own empty states.
//   chart        NEAR/USD from CoinGecko, asked from the visitor's browser exactly as Stellar's wallet asks
//                for XLM (CoinGecko refuses Cloudflare's egress).
//   explorer     NearBlocks.
// Wallet page: real XRP Ledger balances, on desktop AND mobile.
//
// Written as a FILE and injected verbatim, never assembled as a string in the transform. Every
// escaping accident in the Stellar project came from browser code living inside quoted strings --
// a template literal ate the backslashes out of a regex and shipped it inert, an SVG's quotes closed
// the string it sat in and crashed the transform. A file has no layers to survive.
//
// TWO RENDERERS, because the two designs are not the same markup:
//   desktop  <tbody id="assetsTable">   table rows, 5 columns
//   mobile   <div  id="assetList">      .asset-row cards
// Writing only the desktop one is the single most repeated bug in the Stellar project -- a fix aimed
// at a desktop selector silently does nothing on the phone, and it caused at least five separate
// reports there. Whichever container exists is the one that gets filled.
//
// Depends on window.lxx (xrpl-core.js), injected immediately above and byte-identical to the file the
// node tests run against, so the currency and reserve rules cannot drift between test and page.
(function () {
  if (window.__lxnWallet) return;
  window.__lxnWallet = 1;

  // The NEAR reads -- balances, token metadata, NearBlocks activity -- live in browser/nearcore.js, shared
  // with the Account page and the search so there is one implementation of each. Same calls, same order.
  var C = window.lxnCore;
  var market = C.market, ftMetadata = C.ftMetadata, ICONS = C.ICONS,
    activityData = C.activityData, entriesOf = C.entriesOf;

  var EXPLORER_ACCT = 'https://nearblocks.io/address/';
  var EXPLORER_TX = 'https://nearblocks.io/txns/';
  var WNEAR = 'wrap.near';
  var NEAR_LOGO = '/assets/networks/near.png';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  // THE DESIGN'S NUMBERS GO BEFORE THEY CAN BE READ (RAZA 2026-09-17: "there's a flash bug when i refresh. It shows that i
  // have 5 assets and 2 pools for split seconds"). The markup ships "5 holdings · 31,108.45 APT total" with tab counts of 5
  // and 2, and this layer only overwrote them once the ledger answered — a second or two of someone else's portfolio on
  // every refresh. Cleared as this file runs, which is before anything is painted.
  (function blankHeaderMock() {
    [].forEach.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) { c.textContent = ''; });
    [].forEach.call(document.querySelectorAll('.section-heading .meta, h2 .meta, h3 .meta'), function (m) {
      if (/holding|APT|Aptos|active|total/i.test(m.textContent || '')) { m.textContent = ''; m.setAttribute('data-lxmeta', '1'); }
    });
  })();

  // The icon for a token with none in hand: memory first, else its contract, asked when the row is near.
  function ftIcon(id) {
    if (ICONS[id] != null) return Promise.resolve(cssUrl(ICONS[id]));
    return ftMetadata(id).then(function (m) { ICONS[id] = (m && m.icon) || ''; return cssUrl(ICONS[id]); });
  }

  function addr() {
    try { if (window.lxn && window.lxn.account) return window.lxn.account(); } catch (e) {}
    try {
      var a = localStorage.getItem('lumos.address') || '', c = localStorage.getItem('lumos.chain') || '';
      return (c === 'near' && /^[a-z0-9._-]{2,64}$/.test(a)) ? a : '';
    } catch (e) { return ''; }
  }

  // THE INHERITED ANTI-FLASH GATES, WHICH NOTHING IN THIS BUILD WAS LIFTING.
  //
  // RAZA 2026-10-17: "the portfolio still doesnt load", with a phone screenshot of grey bars where the
  // address and the total should be. The data was never missing. Measured on production at 375px:
  //
  //   .portfolio-value  text="1,466.41 XRP"   color=rgba(0, 0, 0, 0)
  //   .portfolio-sub    text="≈ $1,906 USD"   color=rgba(0, 0, 0, 0)
  //
  // Correct figures, painted on time, rendered in transparent ink. Stellar ships two gates that hold
  // a value invisible until its painter says it is real —
  //
  //   html:not(.lx-adrdone) .wallet-chip .text,.chip .text            {color:transparent!important}
  //   html:not(.lx-pvdone)  .portfolio-value,.portfolio-sub,.portfolio-usd {color:transparent!important}
  //
  // — and the layers that ADD those classes are Stellar's, stripped from this fork. Grepped across
  // every source file in the XRPL build: both classes are set in zero of them. So the gates closed at
  // first paint and never opened, on every XRPL wallet page this fork has ever shipped.
  //
  // MOBILE ONLY, which is why it survived this long: .portfolio-value exists only in the phone layout.
  // The desktop hero uses .value-side .value, gated on :not(.lxp) instead, and paintTotal has always
  // added that one. Every check I ran at desktop width passed. See [[verify-on-production]] and
  // [[browser-pane-viewport-is-not-375]] — reading textContent proves a value was written, never that
  // anyone can see it.
  //
  // AND IT CANNOT STICK, for the same reason the open-orders gate carries a timer: a gate whose lifter
  // can fail is just a slower way to hide the page. If the ledger read never lands, the honest outcome
  // is the em dashes clearTotalMock() already wrote — visible — not an endless grey bar.
  // NOT named lift(): this file already has one, 900 lines down, and the second declaration of a
  // hoisted function silently wins. That is [[lumoscore-silent-failures]] exactly.
  function liftGate(cls) {
    try { document.documentElement.classList.add(cls); } catch (e) {}
  }
  window.__lxnLiftGate = liftGate;
  setTimeout(function () { liftGate('lx-adrdone'); liftGate('lx-pvdone'); }, 3500);

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  // textContent everywhere for ledger-supplied values: a currency name is arbitrary bytes off a public
  // ledger and anyone can issue one containing markup.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- the asset mark ------------------------------------------------------------------------------
  //
  // RAZA, 2026-09-08: "in Wallet -> my assets -> the asset logos are missing."
  //
  // They were, and the design was never the problem. The container carries the styling for both
  // marks — the table's `.asset-id .ico.lx-aico`, which paints from a `--ic` custom property and
  // draws `data-l` in an ::after, and the card's 38px `.asset-ico` disc. This layer simply was not
  // building either of them: the table row had NO mark at all and used two classes of its own
  // invention (`.asset-nm`, `.asset-sb`) that the stylesheet has no rules for, which is also why
  // that column looked unstyled beside every other list on the site.
  //
  // Neither mark holds text of its own, and that is what keeps the page's logo engine off them: it
  // repaints any element carrying one to five characters, and a letter drawn by a pseudo-element is
  // not text it can see.
  // A logo is accepted only as a data:image or https url, and made safe to sit inside url("...") -- an
  // SVG data url commonly carries a raw # (read as a fragment, truncating the image) or a newline.
  function cssUrl(u) {
    u = String(u || '');
    // /assets/ too (RAZA 2026-11-05: Recent Activity drew letters for NEAR and LUMOS, whose logos are site paths).
    if (!/^data:image\//i.test(u) && !/^https:\/\//i.test(u) && u.indexOf('/assets/') !== 0) return '';
    if (u.indexOf('"') >= 0 || u.indexOf('\\') >= 0 || u.length > 400000) return '';
    u = u.replace(/[\r\n\t]/g, '');
    if (/^data:image\/svg\+xml,/i.test(u)) u = u.replace(/#/g, '%23');
    return u;
  }

  // NEAR's own mark for the native coin and wNEAR; a curated token's logo from the market row; any other
  // token's, lazily, from its own contract (paintMark resolves the function when the row is near).
  function thumb(tok, w) {
    if (!tok || tok.id === WNEAR) return NEAR_LOGO;
    var u = cssUrl(tok.logo);
    if (u) return u;
    if (tok.curated || !tok.id) return '';
    return function () { return ftIcon(tok.id); };
  }
  // A stable colour per ticker, so a mark waiting on its image is never a grey hole and two
  // different tokens never read as the same one.
  function hue(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',52%,42%)';
  }

  // ---- probing, deferred and throttled ------------------------------------------------------------
  //
  // 350 HOLDINGS IS A REAL WALLET, and one probe per row fired at once does not work. A browser
  // keeps about six connections to a host, so the rest queue — and a timeout meant to measure "is
  // there a logo?" ends up measuring "how long did this wait behind 300 other requests?".
  //
  // Measured on an account with 349 trust lines: 310 of 350 rows fell back to a letter. Four of
  // them were then requested directly — STX, LAWAS, PEPE, WIND — and all four answered 200. Every
  // one of those marks existed. Nothing was missing; they had simply timed out in the queue, which
  // would have shipped as "the logos are still missing".
  //
  // So a probe waits until its row is near the viewport, and then only a few run at a time. A
  // wallet shows about ten rows at once, so what you can see resolves immediately and the other
  // three hundred cost nothing until they are scrolled to.
  //
  // AND THE WHOLE QUEUE STOPS WHEN THE UPSTREAM SAYS SO. Measured on the deployed build, 2026-10-05: a
  // wallet holding 65 tokens asks for 65 marks, and xrpl.to answered 429 to roughly half of them — six
  // at a time is a burst it will not serve. A 429 is not a fact about a token, it is "ask me later", so
  // the answer is to ask later rather than to ask harder: the first one pauses every pending probe for
  // a few seconds and drops the width to two. Total requests go DOWN, not up, which is the point — a
  // per-row retry against a rate limit is just a second way to be refused.
  var Q = [], active = 0, MAXQ = 6, HOLD = 0, HOLDT = 0;
  function pump() {
    if (!Q.length) return;
    var wait = HOLD - Date.now();
    if (wait > 0) {
      if (!HOLDT) HOLDT = setTimeout(function () { HOLDT = 0; pump(); }, wait + 50);
      return;
    }
    while (active < MAXQ && Q.length) { active++; (Q.shift())(); }
  }
  function done1() { active--; pump(); }
  // TUNED AGAINST THE REAL LIST, not guessed. The first attempt — a five-second pause and two in flight
  // — was measured on a 65-holding wallet and left 62 rows still queued after half a minute, which is
  // the bug again wearing a different face: a mark nobody waits for is a mark nobody sees. 2.5s and
  // three in flight clears the same list while staying well inside what the upstream will serve.
  function backOff() { HOLD = Date.now() + 2500; MAXQ = 3; }

  // Runs cb once, when the element comes within a screen of the viewport.
  //
  // MEASURED, NOT OBSERVED, and deliberately so. IntersectionObserver is the obvious tool and was
  // the first implementation — but if it does not report, nothing is ever probed and EVERY mark
  // stays a letter, which is a worse version of the bug this is fixing. A feature whose failure
  // mode is "the thing you asked for never appears" should not be load-bearing, and this one does
  // not have to be: a rect check on scroll is a few hundred reads, it works in every browser, and
  // it is directly testable.
  //
  // The rows also live inside .assets-card, which is its OWN scroll container — 558px tall over
  // 28,000px of rows — so the listener is on document in the capture phase, where an inner
  // container's scroll is seen just as well as the window's.
  var WAIT = [], sweeping = false, wired = false;

  function sweep() {
    sweeping = false;
    if (!WAIT.length) return;
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    var keep = [];
    for (var i = 0; i < WAIT.length; i++) {
      var w = WAIT[i];
      if (!document.contains(w.node)) continue;               // row replaced; drop it
      var r = w.node.getBoundingClientRect();
      // Within one screen above or below, and actually laid out.
      if (r.height > 0 && r.bottom > -400 && r.top < h + 400) w.run();
      else keep.push(w);
    }
    WAIT = keep;
  }

  // setTimeout, NOT requestAnimationFrame. rAF does not fire while the page is not being rendered,
  // and `sweeping` is cleared by the sweep itself — so a scheduled frame that never arrives latches
  // this permanently and no mark is ever probed again. Measured: every row stayed unprobed with the
  // rAF version. A timer owes nothing to the compositor.
  function schedule() {
    if (sweeping) return;
    sweeping = true;
    setTimeout(sweep, 16);
  }

  function near(node, cb) {
    WAIT.push({ node: node, run: cb });
    if (!wired) {
      wired = true;
      // Capture phase, so an inner container's scroll is seen as well as the window's.
      document.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
      // AND a poll, because the scroll listener is an optimisation rather than the mechanism. Rows
      // are appended after this first runs, layout is not final on the first frame, and a row can
      // come into view without any scroll at all — a tab switching, a section expanding, the list
      // being filtered. The poll is what makes "it eventually resolves" true independently of any
      // event firing; it stops the moment nothing is waiting.
      var iv = setInterval(function () {
        if (!WAIT.length) { clearInterval(iv); return; }
        schedule();
      }, 400);
    }
    schedule();
  }

  // PROBE, THEN PAINT — never letter-then-logo.
  //
  // The obvious shape is to draw the initial at once and replace it when the image lands, and that
  // is what the Stellar wallet does. It is also precisely the bug just fixed on the Stellar
  // dashboard: a hundred marks each drawn twice, which reads as the section glitching for seconds
  // after every load. So a mark is painted once, when its fate is known. The disc keeps its colour
  // meanwhile, so nothing looks empty, and the initial is drawn if the image fails or is slow.
  // 429 IS NOT "THIS TOKEN HAS NO LOGO" (RAZA 2026-10-05: "On Wallet page --> My assets: why isn't
  // LUMOS logo shown"). Measured on the deployed build: half the thumbnail requests a 65-holding wallet
  // makes come back 429, every one of those rows drew a letter, and none of them ever asked again — the
  // marks were all there, the wallet simply took a refusal as an answer. Asked by hand a second later,
  // the same urls are 200.
  //
  // AN <img> CANNOT TELL A 429 FROM A 404. Both arrive as `onerror`, which is why this looked for a
  // year like missing artwork rather than a rate limit, and why the fix had to change the probe: a
  // fetch can read the status. The mark is still painted through the stylesheet, and that costs nothing
  // extra — the answer is immutable for a week, so the url() that follows is a browser-cache hit.
  //
  //   200        the mark exists; paint it
  //   400 / 404  a real answer about this token: it has none, draw the letter and stop asking
  //   anything else (429, 5xx, a dropped request) is about the MOMENT, so the row waits and asks again
  //
  // A 429 holds the whole queue rather than spinning this row alone (see pump()), and it is counted
  // separately from a dropped request: "ask me later" said six times is still a logo that exists, while
  // six silent failures in a row is a network that is not going to answer. Measured on a cold cache,
  // sixty-five holdings: three attempts left two rows lettered, both of them 429s that had simply not
  // got to the front of the line yet.
  function paintMark(node, setLogo, setLetter, url0) {
    var url = typeof url0 === 'string' ? url0 : '';
    if (!url0) { setLetter(); return; }
    var tries = 0, held = 0;
    function go() {
      Q.push(function () {
        var fired = false;
        if (!url) {
          // A token with no logo in hand asks its own contract for one, here, once its row is near.
          return url0().then(function (u) { url = u || ''; done1(); if (url) go(); else setLetter(); },
            function () { done1(); setLetter(); });
        }
        // This times the REQUEST, not a wait behind three hundred of them.
        var t = setTimeout(function () { settle(0); }, 8000);
        function settle(status) {
          if (fired) return;
          fired = true;
          clearTimeout(t);
          done1();
          if (status === 200) { setLogo(url); return; }
          if (status === 400 || status === 404 || status === 415) { setLetter(); return; }
          if (status === 429 ? ++held > 6 : ++tries > 3) { setLetter(); return; }
          if (status === 429) backOff();
          setTimeout(go, status === 429 ? 1500 : 1200);
        }
        // A NEAR logo is a data: url or a plain https image -- no endpoint of ours stands between, so there
        // is no status to read. The image itself is the probe: it decodes, or it is a letter.
        var im = new Image();
        im.onload = function () { settle(im.naturalWidth > 0 ? 200 : 415); };
        im.onerror = function () { settle(404); };
        im.src = url;
      });
      pump();
    }
    near(node, go);
  }

  // THE VERIFIED TICK (RAZA 2026-09-16: "Also add verification tick for LUMOS on all other places where it should be").
  // The same span, glyph and class the market table and the search rows use, so the inherited .lx-vtick rule styles it;
  // the sizing is inline as well because this page's sheet does not carry that rule.
  function vtick() {
    var s = el('span', 'lx-vtick');
    s.title = 'Curated on LumosCore';
    s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;margin-left:5px;border-radius:50%;background:#2fb46a;color:#fff;vertical-align:middle;flex:none';
    s.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    return s;
  }

  // WHICH HOLDINGS GET ONE (RAZA 2026-10-05: "verification ticks missing on most like Army and phnix.
  // they're already in our curated list"). They are: both sit in the roster the Trade page lists, and
  // this page was ticking exactly one issuer — LUMOS, hardcoded — so every other holding read as
  // unvetted beside it.
  //
  // THE RULE IS THE TRADE PAGE'S RULE, deliberately, because that table is what "our curated list"
  // means on this build: the live top of the XRP Ledger market from /lxapi/xrpltokens, with LUMOS
  // pinned into it. Two surfaces disagreeing about whether a token is verified is worse than either
  // answer on its own. The same caveat recorded in trade.js applies here and is not re-argued: the
  // roster is ranked by volume, not vetted by anyone, so the tick means "we list it". If it is ever to
  // mean verification again, a real issuer+currency allowlist replaces VSET and both surfaces follow.
  //
  // NOT xrpl.to's own `vf` flag, which the search rows use: it is 0 for both ARMY and PHNIX, so
  // reading it here would have answered RAZA's report with "working as intended" and no ticks.
  //
  // Rows are painted before this lands, so the tick is applied twice — inline when a row is built, and
  // again over the whole table once the roster arrives. The key lives on the name node in `data-lxvk`,
  // which is also what lets the second pass find rows without re-rendering them.
  var VSET = null;
  function isVerified(tok) {
    if (!tok || !tok.id) return false;                  // NEAR itself is the chain, not a listing
    if (tok.id === WNEAR) return true;
    return !!(VSET && VSET[tok.id]);
  }
  function markVerified(host, tok) {
    if (!host || !tok || !tok.id) return;
    host.setAttribute('data-lxvk', tok.id);
    if (isVerified(tok) && !host.querySelector('.lx-vtick')) host.appendChild(vtick());
  }
  function applyTicks() {
    [].forEach.call(document.querySelectorAll('[data-lxvk]'), function (h) {
      var k = h.getAttribute('data-lxvk') || '';
      var ok = k === WNEAR || !!(VSET && VSET[k]);
      var has = h.querySelector('.lx-vtick');
      if (ok && !has) h.appendChild(vtick());
      else if (!ok && has && has.parentNode) has.parentNode.removeChild(has);
    });
  }
  // THE LINE UNDER THE NAME (RAZA 2026-11-07, tickets 296 and 304): Stellar's .lx-hd domain, then .lx-iss, then the copy
  // button. Its home domain's nearest true thing here is the curated list's website (/lxapi/nearmarket's w). A token with
  // none has an empty .lx-hd, which the sheet hides: a name like "gear.near" would be invented.
  var DOM = {};
  function domainOf(u) {
    try {
      var x = new URL(String(u || ''));
      if (x.protocol !== 'https:' && x.protocol !== 'http:') return '';
      return x.hostname.indexOf('www.') === 0 ? x.hostname.slice(4) : x.hostname;
    } catch (e) { return ''; }
  }
  function applyDomains() {
    [].forEach.call(document.querySelectorAll('[data-lxdom]'), function (e) {
      var t = DOM[e.getAttribute('data-lxdom')] || '';
      if (e.textContent !== t) { e.textContent = t; e.title = t; }
    });
  }
  // Shared by the table row and the phone's card; claimRowActions serves the copy button on both.
  function issuerLine(name, tok) {
    var asb = el('span', 'lx-asb');
    asb.setAttribute('data-vk', name + '|' + tok.id);
    // One line at any width: Stellar's sheet lets this wrap, and "tinkerunion.com" dropped the contract onto a second
    // line and made its row twice as tall. A long domain gives way instead; its hover has it whole.
    asb.style.cssText = 'display:inline-flex;align-items:center;gap:7px;flex-wrap:nowrap;max-width:100%;min-width:0';
    var hd = el('span', 'lx-hd', DOM[tok.id] || '');
    hd.setAttribute('data-lxdom', tok.id);
    hd.setAttribute('data-logoed', '1');
    hd.title = DOM[tok.id] || '';
    hd.style.cssText = 'flex:0 1 auto;min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    asb.appendChild(hd);
    var iss = el('span', 'lx-iss', short(tok.id));
    iss.setAttribute('data-logoed', '1');
    iss.title = tok.id;
    iss.style.flex = 'none';
    iss.style.whiteSpace = 'nowrap';
    asb.appendChild(iss);
    var cp = el('button', 'lx-isscopy');
    cp.type = 'button';
    cp.setAttribute('data-iss', tok.id);
    cp.setAttribute('aria-label', 'Copy issuer address');
    cp.title = 'Copy issuer address';
    cp.innerHTML = ICON_COPY;
    cp.style.flex = 'none';
    asb.appendChild(cp);
    return asb;
  }
  market().then(function (d) {
    if (!d) return;
    var s = {};
    d.rows.forEach(function (t) {
      if (t && t.i) s[t.i] = 1;
      if (t && t.i && t.w && domainOf(t.w)) DOM[t.i] = domainOf(t.w);
    });
    VSET = s;
    applyTicks();
    applyDomains();
  });
  // ---- rows, per design ---------------------------------------------------------------------------
  function tableRow(name, sub, right, rightSub, frozen, tok) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxkey', tok ? tok.id : 'NEAR');
    var c1 = el('td');
    var aid = el('div', 'asset-id');
    var ico = el('div', 'ico lx-aico');
    ico.style.setProperty('--ic', hue(name));
    try { ico.setAttribute('data-logoed', '1'); } catch (e) {}
    paintMark(ico, function (u) {
      ico.style.setProperty('--ic', 'url("' + u + '")');
      ico.setAttribute('data-l', '');
      ico.classList.add('lx-din');
    }, function () {
      ico.setAttribute('data-l', (name || '?').slice(0, 1).toUpperCase());
    }, thumb(tok, 48));
    aid.appendChild(ico);
    var meta = el('div', 'meta');
    var nm = el('div', 'nm');
    plain(nm, name + (frozen ? ' (frozen)' : ''));
    markVerified(nm, tok);
    meta.appendChild(nm);

    // STELLAR'S ROW (RAZA 2026-09-15: "My assets section is different on Stellar"), read off lumoscore.com:
    // the native asset's sub-line is "Stellar · native"; a token's is its issuer, shortened, with a copy
    // button — `.lx-asb`, `.lx-iss`, `.lx-isscopy`, all styled by the inherited sheet. The price cell
    // is `.p1.lx-p1` plus the price in the native asset, the balance cell is `.b1` over "≈ $x" in
    // `.b2`, and the actions carry their icons and a third, icon-only button.
    var sb = el('div', 'sb');
    if (!tok) {
      var nat = el('span', 'lx-asb-t', 'NEAR Protocol · native');
      nat.style.whiteSpace = 'nowrap';
      sb.appendChild(nat);
    } else {
      sb.appendChild(issuerLine(name, tok));
    }
    meta.appendChild(sb);
    aid.appendChild(meta);
    c1.appendChild(aid);
    tr.appendChild(c1);
    tr.appendChild(el('td', 'price-cell', '—'));        // prices.js fills it
    // `spark-cell` IS THE CLASS THAT HIDES THIS COLUMN, as on Stellar — see the note in prices.js.
    tr.appendChild(el('td', 'spark-cell'));
    var c4 = el('td', 'right balance-cell');
    c4.appendChild(el('div', 'b1', right));
    c4.appendChild(el('div', 'b2', ''));
    // NEAR's available/storage split stays available on hover; Stellar's row has no line for it.
    if (rightSub) c4.title = rightSub;
    tr.appendChild(c4);
    var c5 = el('td', 'right');
    c5.appendChild(rowActions(name, tok));
    tr.appendChild(c5);
    return tr;
  }

  // COLUMN 5 WAS 260px OF NOTHING ON EVERY ROW. lumoscore.com fills it — read off the live table, it
  // holds `.row-quick-actions` with two `.qa-row-btn` buttons, Trade and Send. The design's own
  // classes and its own column; nothing is styled or invented here.
  function rowActions(name, tok) {
    var wrap = el('div', 'row-quick-actions');

    var trade = el('button', 'qa-row-btn');
    trade.innerHTML = ICON_TRADE + ' Trade';
    trade.type = 'button';
    // TRADE OPENS A CHOICE, IT DOES NOT NAVIGATE (RAZA 2026-10-02: "When im tapping on Trade button, it
    // should show me 'Swap, Trade on Dex' options like it does on Stellar. On XRPL, it just takes me to
    // the asset trade page").
    //
    // There are two different things someone means by "trade this holding" — the order book, and an
    // instant swap — and the button was silently picking one. The menu is the same .lx-rowmenu the
    // kebab opens, so there is one menu implementation on this page rather than two.
    //
    // XRP keeps an empty issuer here: it has no asset page of its own, and the DEX item falls back to
    // the market for it.
    trade.setAttribute('data-lxtrade', (name || 'NEAR') + '|' + ((tok && tok.id) || ''));
    wrap.appendChild(trade);

    // SEND WORKS ON EVERY ROW, as on lumoscore.com: the Send dialog's picker (browser/send.js) holds the
    // tokens as well as NEAR, so the row opens it on its own asset. NEAR has no trust lines, so there is
    // no "remove trustline" branch; a zero balance is not listed at all.
    var send = el('button', 'qa-row-btn');
    send.innerHTML = ICON_SEND + ' Send';
    send.type = 'button';
    send.setAttribute('data-lxsend', tok ? tok.id : 'NEAR');
    wrap.appendChild(send);
    // The third, icon-only button Stellar's row ends on. It opens Stellar's row menu — View asset, Pin to
    // top, Copy issuer address, View on Explorer (RAZA 2026-09-15: "instead of opening the dropdown, it
    // opens up bithomp").
    var more = el('button', 'qa-row-btn icon-only');
    more.type = 'button';
    more.innerHTML = ICON_MORE;
    more.setAttribute('aria-label', 'More actions');
    more.setAttribute('data-lxmenu', tok ? (name + '|' + tok.id) : 'NEAR');
    wrap.appendChild(more);
    return wrap;
  }

  // Stellar hides this header at RUNTIME — its `th` carries an inline `display:none`, and there is no
  // stylesheet rule for it in either build, which is why grepping the CSS found nothing. Same thing
  // here, so the column disappears completely instead of standing empty over hidden cells.
  function hideSparkHead() {
    var body = document.getElementById('assetsTable');
    var tbl = body && body.closest ? body.closest('table') : null;
    if (!tbl) return;
    var ths = tbl.querySelectorAll('thead th');
    if (ths.length > 2) ths[2].style.display = 'none';
  }

  // The row buttons have to be claimed on WINDOW CAPTURE, for the same reason the trade and pools
  // rows are: the design claims clicks anywhere in a list page and routes them through its own
  // resolver, and a bubble-phase listener on the button never runs first.
  function claimRowActions() {
    if (window.__lxnWalletActs) return;
    window.__lxnWalletActs = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var go = t.closest('[data-lxgo]');
      // A Liq Pools row is a link as well, but its buttons keep their own jobs: the kebab has no data-lxgo of its
      // own, so without this the row would swallow it.
      if (go && go.tagName === 'TR' && t.closest('button, a')) go = null;
      if (go) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
          if (go.tagName !== 'TR') return;                 // a <tr> is no link: the browser cannot do this for it
          e.preventDefault();
          e.stopImmediatePropagation();
          window.open(go.getAttribute('data-lxgo'), '_blank', 'noopener');
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = go.getAttribute('data-lxgo');
        return;
      }

      var tb = t.closest('[data-lxtrade]');
      if (tb) { e.preventDefault(); e.stopImmediatePropagation(); openTradeMenu(tb); return; }
      var mb = t.closest('[data-lxmenu]');
      if (mb) { e.preventDefault(); e.stopImmediatePropagation(); openRowMenu(mb); return; }
      var pb = t.closest('[data-lxpmenu]');
      if (pb) { e.preventDefault(); e.stopImmediatePropagation(); openPoolMenu(pb); return; }
      var mi = t.closest('.lx-rowmenu [data-lxmi]');
      if (mi) { e.preventDefault(); e.stopImmediatePropagation(); rowMenuAct(mi); return; }
      var pi = t.closest('.lx-rowmenu [data-lxpi]');
      if (pi) { e.preventDefault(); e.stopImmediatePropagation(); poolMenuAct(pi); return; }
      if (!t.closest('.lx-rowmenu')) closeRowMenu();

      // THE WALLET CHIP'S LINK ICON opens this account on NearBlocks (XRPL: Bithomp, RAZA 2026-09-15), as Stellar's opens it on
      // stellar.expert. Found by its external-link glyph, the way Stellar's layer finds it.
      var xb = t.closest('.wallet-chip button, .wallet-chip a, .hero-id-row button, .hero-id-row a');
      var xpoly = xb && xb.querySelector('polyline');
      if (xb && ((xb.getAttribute('title') || '') === 'Explorer' || (xpoly && /^15\s+3\s+21\s+3\s+21\s+9$/.test((xpoly.getAttribute('points') || '').trim())))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (addr()) window.open(EXPLORER_ACCT + encodeURIComponent(addr()), '_blank', 'noopener');
        return;
      }

      var ex = t.closest('[data-lxexp]');
      if (ex) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var xv = ex.getAttribute('data-lxexp');
        if (xv) window.open(EXPLORER_ACCT + encodeURIComponent(xv), '_blank', 'noopener');
        return;
      }
      var cpb = t.closest('.lx-isscopy');
      if (cpb) {
        e.preventDefault();
        e.stopImmediatePropagation();
        copyText(cpb.getAttribute('data-iss') || '', 'Issuer address copied');
        return;
      }

      var sd = t.closest('[data-lxsend]');
      if (sd) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Opens the page's OWN Send dialog by clicking the header button that already does it, so
        // whichever of the two modal sets is live (this page ships a desktop and a mobile copy) is
        // the one that opens, and nothing here duplicates that logic.
        // write.js reads this when the dialog opens and selects the row's asset.
        window.__lxnSendPre = sd.getAttribute('data-lxsend') || 'NEAR';
        var btns = document.querySelectorAll('.quick-actions .qa-btn');
        for (var i = 0; i < btns.length; i++) {
          if (/^\s*send\s*$/i.test(btns[i].textContent || '')) { btns[i].click(); return; }
        }
      }
    }, true);
  }

  // Stellar's row icons, copied off lumoscore.com's live table (RAZA 2026-09-15: "the send and trade icon is
  // different on XRPL"): a candlestick chart for Trade, a paper plane for Send, at 11px; the kebab at 12px.
  var SVG_OPEN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON_TRADE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M8 6v3"></path><rect x="6" y="9" width="4" height="6" rx="1"></rect><path d="M8 15v3"></path><path d="M16 4v2"></path><rect x="14" y="6" width="4" height="9" rx="1"></rect><path d="M16 15v3"></path></svg>';
  var ICON_SEND = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  // The trash glyph lumoscore.com uses on this button, copied from its own markup so the two builds draw the same row.
  var ICON_TRUSTLINE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
  var ICON_MORE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';

  // ---- the row menu ----------------------------------------------------------------------------------
  // Stellar's .row-menu, built the way lumoscore.com builds it: fixed-position under the kebab, a child of
  // body, four actions with a divider before the explorer link. The inherited sheet styles it.
  // Figures the way Stellar's pool rows print them: whole units past 100K, one decimal past 1K, two below.
  function lpAmt(v) {
    v = Number(v);
    if (!(v > 0)) return '0';
    var dp = v >= 100000 ? 0 : (v >= 1000 ? 1 : (v >= 1 ? 2 : 6));
    return v.toLocaleString('en-US', { maximumFractionDigits: dp });
  }

  var PIN_KEY = 'lumos.pinned';
  function pinnedList() {
    try { var v = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function closeRowMenu() {
    [].forEach.call(document.querySelectorAll('.lx-rowmenu'), function (m) { if (m.parentNode) m.parentNode.removeChild(m); });
  }
  function menuSvg(inner) {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  // THE MENU'S OWN STYLING EXISTS ONLY ON THE DESKTOP PAGE.
  //
  // RAZA 2026-10-19: "On mobile, wallet -> my assets -> dropdown on 3 dots icon is breaking." His
  // screenshot shows the three items as bare white pills sitting side by side across the card — a
  // <div> of <button>s with no panel, no rows, no dividers.
  //
  // Measured on the built pages: the desktop wallet carries 12 `.row-menu` rules including the two
  // that matter --
  //     .row-menu        { position:absolute; min-width:180px; background:var(--surface); border:...;
  //                        border-radius:11px; padding:6.6px; display:none }
  //     .row-menu button { display:flex; width:100%; padding:9.9px 12.1px; ... }
  // -- and the MOBILE wallet carries four, none of them these. So the menu has never had a look on a
  // phone; nothing styled it and nothing ever has.
  //
  // THIS IS MY REGRESSION, in the sense that it is now reachable: the kebab was added to the phone's
  // asset cards on 2026-10-18, and that is what put an unstyled menu in front of anyone. The missing
  // CSS predates it. Same shape as the .qa-row-btn gap found in that same change, where every rule
  // was scoped to #assetsTable -- see [[lumoscore-stripped-layer-css]].
  //
  // DETECTED BY MEASUREMENT, NOT BY GUESSING THE PAGE. A button in a styled menu computes to
  // display:flex; an unstyled one does not. So this asks the DOM what it got rather than testing the
  // viewport or the filename, and on any page that already has the design's rules it does nothing.
  function rowMenuCss(m) {
    if (document.getElementById('lx-rowmenu-base-css')) return;
    var b = m.querySelector('button');
    if (b && getComputedStyle(b).display === 'flex') return;   // the design's own rules are present
    var st = document.createElement('style');
    st.id = 'lx-rowmenu-base-css';
    // Scoped to .lx-rowmenu -- the class THIS file puts on the menus it builds -- so it cannot
    // restyle anything of the design's own. Values mirror the desktop rules above; only the type is
    // sized for a phone rather than carrying the desktop build's +10% scale.
    st.textContent = '.lx-rowmenu{min-width:200px;background:var(--surface,#14141b);'
      + 'border:1px solid var(--border,#2a2a35);border-radius:11px;padding:6px;'
      + 'box-shadow:0 12px 28px rgba(0,0,0,.28);z-index:100;display:block}'
      + '.lx-rowmenu button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;'
      + 'border-radius:7px;border:none;background:transparent;cursor:pointer;font-family:inherit;'
      + 'font-size:15px;font-weight:500;color:var(--text,#e8e8ee);text-align:left}'
      + '.lx-rowmenu button svg{flex-shrink:0;color:var(--text-soft,#9aa0aa)}'
      + '.lx-rowmenu button:hover{background:var(--surface-2,#1c1c25);color:var(--accent,#ea6a2c)}'
      + '.lx-rowmenu button:hover svg{color:var(--accent,#ea6a2c)}'
      + '.lx-rowmenu .divider{height:1px;background:var(--border,#2a2a35);margin:4px 0}';
    document.head.appendChild(st);
  }

  function openRowMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;                                       // a second click on the same kebab closes it
    var key = btn.getAttribute('data-lxmenu') || 'NEAR';
    var parts = key.split('|'), code = parts[0], iss = parts[1] || '';
    var pinKey = iss || 'NEAR';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxcode', code);
    m.setAttribute('data-lxiss', iss);
    // NEAR itself has no asset page to view (RAZA 2026-11-10, ticket 317): its menu is Pin to top and the explorer.
    var h = (iss ? '<button type="button" data-lxmi="view">' + menuSvg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>') + ' View asset</button>' : '')
      + '<button type="button" data-lxmi="pin">' + menuSvg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>')
      + (pinnedList().indexOf(pinKey) >= 0 ? ' Unpin' : ' Pin to top') + '</button>';
    if (iss) h += '<button type="button" data-lxmi="copy">' + menuSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>') + ' Copy token contract</button>';
    h += '<div class="divider"></div>'
      + '<button type="button" data-lxmi="explorer">' + menuSvg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>') + ' View on NearBlocks</button>';
    m.innerHTML = h;
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    rowMenuCss(m);                 // BEFORE measuring: the fallback changes the panel's size
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 170;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))) + 'px';
    m.style.visibility = '';
    if (!window.__lxnRowMenuClose) {
      window.__lxnRowMenuClose = 1;
      window.addEventListener('scroll', closeRowMenu, true);
      window.addEventListener('resize', closeRowMenu);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeRowMenu(); });
    }
  }
  // THE LIQ POOLS KEBAB IS A MENU, NOT A LINK (RAZA 2026-10-06: "clicking on 3 dots icon on the right is
  // taking me to bithomp when it should actually open the dropdown for 'View pool details' and 'Copy pool
  // address'. Please compare with Stellar").
  //
  // The asset rows got their menu and the pool rows did not: that third button was simply given
  // `data-lxexp` and a "View on Bithomp" tooltip, so the kebab beside a pool behaved differently from the
  // identical kebab one tab away.
  //
  // Two items, matching lumoscore.com. The design's own definition for an `lp` row carries THREE —
  // "View pool details", "View transaction history", "Copy pool address" — read out of the live
  // lx-aed79fbe3c71.js; Stellar ships the first and the last, which is also what RAZA's screenshot shows,
  // so the middle one is left out here too rather than invented for XRPL alone. The icons are the
  // design's: the info circle and the copy rectangles.
  //
  // The explorer is NOT kept as a third item. Nothing about the pool page is missing from it, and the
  // kebab's job here is the two actions Stellar offers.
  function openPoolMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;
    var acct = btn.getAttribute('data-lxpmenu') || '';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxpool', acct);
    m.innerHTML =
      '<button type="button" data-lxpi="details">'
      + menuSvg('<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>')
      + ' View pool details</button>'
      + '<button type="button" data-lxpi="copy">'
      + menuSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>')
      + ' Copy pool address</button>';
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    rowMenuCss(m);                 // these are .lx-rowmenu panels too, and equally unstyled here
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 96;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))) + 'px';
    m.style.visibility = '';
  }

  function poolMenuAct(item) {
    var m = item.closest('.lx-rowmenu');
    var acct = (m && m.getAttribute('data-lxpool')) || '';
    var what = item.getAttribute('data-lxpi');
    closeRowMenu();
    if (!acct) return;
    var href = (m && m.__lxFor && m.__lxFor.getAttribute('data-lxphref')) || '';   // the kebab that opened it
    if (what === 'details') window.location.href = href || ('/pools/near/pool/' + encodeURIComponent(acct));
    else if (what === 'copy') copyText(acct);
  }

  // The Trade button's two-item menu, in the same shell the kebab uses so it inherits the design's
  // surface, placement and dismissal. Two lines per item, as Stellar's has: what it is, and what it is
  // for — "Order book & charts" against "Instant swap" is the whole distinction being offered.
  function openTradeMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;
    var parts = (btn.getAttribute('data-lxtrade') || 'NEAR|').split('|');
    var code = parts[0], iss = parts[1] || '';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu lx-trademenu';
    m.setAttribute('data-lxnonav', '1');             // the global label bridge's opt-out, as on Stellar's menu
    m.__lxFor = btn;
    m.setAttribute('data-lxcode', code);
    m.setAttribute('data-lxiss', iss);
    m.innerHTML =
      '<button type="button" data-lxmi="dex"><span class="lx-tmt">Trade on DEX</span>'
      + '<span class="lx-tms">Order book &amp; charts</span></button>'
      + '<button type="button" data-lxmi="swap"><span class="lx-tmt">Swap</span>'
      + '<span class="lx-tms">Instant swap</span></button>';
    if (!document.getElementById('lx-trademenu-css')) {
      var st = document.createElement('style');
      st.id = 'lx-trademenu-css';
      // STELLAR'S NUMBERS, READ OFF ITS OWN SOURCE (RAZA 2026-10-06: "On XRPL, the text is larger than
      // what we have on Stellar. please compare").
      //
      // The two menus were never the same object. lumoscore.com builds this one in its own shell,
      // `.lx-trmenu` (_walletdata.js), which sets `font:700 13px/1.25` on the button and 11.5px/600
      // muted on the sub-line. This build reuses the design's `.row-menu` — the shell the kebab beside
      // it uses — whose button is 18.7px/500, and only ever overrode the sub-line. So the title came out
      // at 18.7px against Stellar's 13px, which is the whole report.
      //
      // The SHELL is deliberately left as `.row-menu`: it is the design's own surface, placement and
      // dismissal, and it matches the kebab menu sitting next to it on the same row. Only the type is
      // brought into line.
      //
      // `.row-menu.lx-trademenu button` rather than `.lx-trademenu button`, because the latter ties
      // 0-1-1 with `.row-menu button` and would then be decided by source order — and `_externalize.js`
      // hoists every `lx-*` stylesheet into <head>, so source order is not something to rely on.
      st.textContent = '.row-menu.lx-trademenu button{display:flex;flex-direction:column;align-items:flex-start;'
        + 'gap:1px;font:700 13px/1.25 "Hanken Grotesk",system-ui,sans-serif}'
        + '.row-menu.lx-trademenu .lx-tmt{font-weight:700}'
        + '.row-menu.lx-trademenu .lx-tms{font-weight:600;font-size:11.5px;opacity:1;'
        + 'color:var(--text-muted,#8b90a0)}';
      (document.head || document.documentElement).appendChild(st);
    }
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    rowMenuCss(m);                 // these are .lx-rowmenu panels too, and equally unstyled here
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 96;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.left))) + 'px';
    m.style.visibility = '';
  }

  function rowMenuAct(item) {
    var m = item.closest('.lx-rowmenu');
    var code = m.getAttribute('data-lxcode'), iss = m.getAttribute('data-lxiss') || '';
    var what = item.getAttribute('data-lxmi');
    closeRowMenu();
    if (what === 'dex') {
      window.location.href = iss ? ('/trade/near/' + encodeURIComponent(iss)) : '/trade/near';
      return;
    }
    if (what === 'swap') {
      // The one swap implementation on this page. If it is not wired yet — a cold load — the DEX page
      // is the honest fallback rather than a button that does nothing.
      // The asset this menu was opened on is passed through, so the dialog starts on the row the
      // reader picked instead of its own defaults (RAZA 2026-10-19: Swap on the XLM row opened
      // XRP -> RLUSD). The menu already carries both halves of the identity for its other items.
      var opened = false;
      try {
        opened = typeof window.__lxnOpenSwap === 'function'
          && window.__lxnOpenSwap({ code: code, issuer: iss });
      } catch (e) {}
      if (!opened) window.location.href = iss ? ('/trade/near/' + encodeURIComponent(iss)) : '/trade/near';
      return;
    }
    if (what === 'view') {
      window.location.href = iss ? ('/trade/near/' + encodeURIComponent(iss)) : '/trade/near';
    } else if (what === 'copy') {
      copyText(iss, 'Issuer address copied');
    } else if (what === 'explorer') {
      var target = iss || addr();
      if (target) window.open(EXPLORER_ACCT + encodeURIComponent(target), '_blank', 'noopener');
    } else if (what === 'pin') {
      var k = iss || 'NEAR', list = pinnedList(), at = list.indexOf(k);
      if (at >= 0) list.splice(at, 1); else list.unshift(k);
      try { localStorage.setItem(PIN_KEY, JSON.stringify(list)); } catch (e) {}
      applyPins();
    }
  }
  // Pinned rows go to the top of My Assets, newest pin first, each with Stellar's star badge.
  // BOTH LAYOUTS, because the phone has no #assetsTable and this used to give up on not finding one.
  //
  // RAZA 2026-10-19: "mobile - wallet : my assets -> 3 dots icon -> pin to top: it doesn't pin the
  // asset to top". The pin itself was being stored correctly — his menu already read "Unpin" on the
  // second open — so the preference was saved and then nothing on screen moved. A control that
  // records a choice and shows no result is indistinguishable from a broken one.
  //
  // The desktop table and the phone's card list are the same operation over different markup, so the
  // badge pass and the reorder now run over whichever hosts are present. The key is identical on both
  // (card() stamps the same data-lxkey tableRow() does); only the element and the name node differ.
  function applyPins() {
    var list = pinnedList();
    var hosts = [];
    var tb = document.getElementById('assetsTable');
    if (tb) hosts.push({ host: tb, sel: 'tr[data-lxkey]' });
    var al = document.getElementById('assetList');
    if (al) hosts.push({ host: al, sel: '.asset-row[data-lxkey]' });
    if (!hosts.length) return;
    hosts.forEach(function (H) { pinPass(H.host, H.sel, list); });
  }

  function pinPass(tb, sel, list) {
    [].forEach.call(tb.querySelectorAll(sel), function (tr) {
      var on = list.indexOf(tr.getAttribute('data-lxkey')) >= 0;
      tr.classList.toggle('lx-pinned', on);
      // `.nm` on the desktop row, `.asset-name` on the phone's card: the badge hangs off whichever
      // this layout calls the name.
      var nm = tr.querySelector('.nm, .asset-name'), bd = nm && nm.querySelector('.lx-pin-badge');
      if (on && nm && !bd) {
        bd = document.createElement('span');
        bd.className = 'lx-pin-badge';
        bd.title = 'Pinned';
        bd.setAttribute('data-logoed', '1');
        bd.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>';
        nm.appendChild(bd);
      } else if (!on && bd) {
        bd.parentNode.removeChild(bd);
      }
    });
    // A SORT, NOT A SHUFFLE. This used to walk the pin list back-to-front moving each row to the very
    // top, which promotes correctly and can never undo itself: on unpin the row kept the position the
    // pin had given it until something repainted the whole list.
    //
    // Sorting on (pin position, original position) does both jobs with one rule — pinned rows lead in
    // pin order, everything else falls back to where the ledger put it, so a row returns home the
    // moment it stops being pinned. data-lxord is stamped by paint(); a row without one sorts as 0,
    // which is the old behaviour rather than a crash.
    var rows = [].slice.call(tb.querySelectorAll(sel));
    rows.sort(function (a, b) {
      var pa = list.indexOf(a.getAttribute('data-lxkey'));
      var pb = list.indexOf(b.getAttribute('data-lxkey'));
      if (pa < 0) pa = Infinity;
      if (pb < 0) pb = Infinity;
      if (pa !== pb) return pa - pb;
      return (+a.getAttribute('data-lxord') || 0) - (+b.getAttribute('data-lxord') || 0);
    });
    rows.forEach(function (el) { tb.appendChild(el); });
  }
  try { window.__lxnApplyPins = applyPins; } catch (e) {}
  var ICON_COPY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  // Balances the way Stellar prints them: whole units past a thousand, cents above one, and enough
  // precision below one that a small holding does not read as zero.
  function balTxt(v) {
    v = Number(v);
    if (!isFinite(v)) return '—';
    if (v >= 1000) return fmt(v, 0);
    if (v >= 1) return fmt(v, 2);
    return fmt(v, 6);
  }

  function copyText(text, said) {
    if (!text) return;
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
      else fallback();
    } catch (e) { fallback(); }
    toast(said || 'Copied to clipboard');
  }

  // Stellar's bottom-centre toast, the same element the rest of the site uses.
  function toast(msg) {
    if (!document.getElementById('lx-copytoast-css')) {
      var st = document.createElement('style');
      st.id = 'lx-copytoast-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}';
      document.head.appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast';
    t.appendChild(Object.assign(document.createElement('span'), { className: 'ci', textContent: '✓' }));
    t.appendChild(Object.assign(document.createElement('span'), { textContent: msg || 'Copied to clipboard' }));
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1800);
  }

  // A token mark inside an activity row's label: Stellar's `.lx-act-ilogo`, painted from a CSS variable.
  function actLogo(a) {
    var s = el('span', 'lx-act-ilogo');
    var u = (!a || a.native) ? NEAR_LOGO : cssUrl(a.logo);
    if (u) ['--al', '--ic', '--lxlogo'].forEach(function (k) { s.style.setProperty(k, 'url("' + u + '")'); });
    s.setAttribute('data-l', u ? '' : String((a && a.code) || '?').charAt(0).toUpperCase());
    s.setAttribute('data-logoed', '1');
    return s;
  }
  function card(name, sub, right, rightSub, frozen, tok) {
    var row = el('div', 'asset-row');
    // The same key the desktop row carries, so applyPins can find this card. Without it the phone's
    // "Pin to top" stored the pin and reordered nothing (RAZA 2026-10-19).
    row.setAttribute('data-lxkey', tok ? tok.id : 'NEAR');
    var top = el('div', 'asset-top');
    // EVERY ROW'S BADGE READ "L". This builder wrote the token's first two letters, but the page's
    // logo layer repaints any short-text element from the surrounding words, and those words include
    // the site's own name — so XRP, LUMOS, XYIELD and SLT all ended up wearing the same LUMOS "L",
    // four different tokens rendered as one. plain() claims the element so what we draw stands.
    var ico = el('div', 'asset-ico');
    plain(ico, '');                                   // claim it first: plain() clears background
    ico.style.background = hue(name);
    paintMark(ico, function (u) {
      ico.style.backgroundImage = 'url("' + u + '")';
      ico.style.backgroundSize = 'cover';
      ico.style.backgroundPosition = 'center';
      ico.textContent = '';
    }, function () {
      ico.textContent = (name || '?').slice(0, 2).toUpperCase();
    }, thumb(tok, 48));
    top.appendChild(ico);
    var meta = el('div', 'asset-meta');
    var nr = el('div', 'asset-name-row');
    var anm = el('span', 'asset-name');
    plain(anm, name + (frozen ? ' (frozen)' : ''));
    nr.appendChild(anm);
    // The phone's card carried no tick at all — not LUMOS's either — so the two renderers disagreed
    // about every holding. Same rule, same node shape, so applyTicks() reaches both.
    markVerified(nr, tok);
    meta.appendChild(nr);
    var csub = el('div', 'asset-sub', tok ? null : (sub || ''));
    if (tok) csub.appendChild(issuerLine(name, tok));
    meta.appendChild(csub);
    top.appendChild(meta);
    var bal = el('div', 'asset-balance-block');
    bal.appendChild(el('div', 'v1', right));
    if (rightSub) bal.appendChild(el('div', 'v2', rightSub));
    top.appendChild(bal);
    row.appendChild(top);

    // THE PHONE'S CARD HAD NO ACTIONS AT ALL (RAZA 2026-10-18, user report: "Missing action buttons
    // (Trade / Send / Swap) on the mobile 'My Assets' page. Unlike the desktop interface...").
    //
    // rowActions() had exactly one caller — tableRow(), the DESKTOP builder. This card builder is the
    // phone's, and it simply never called it, so every holding on a phone was read-only: no Trade, no
    // Send, no row menu, no "remove trust line" on an empty holding. The same two-renderers-disagree
    // shape as the verified tick a few lines above, which was fixed here for the same reason.
    //
    // The buttons are delegated (data-lxtrade / data-lxsend / data-lxmenu / data-lxrmtl), so the
    // handlers that already serve the desktop rows pick these up with no extra wiring.
    cardActionCss();
    row.appendChild(rowActions(name, tok));
    return row;
  }

  // ...AND THE PHONE HAS NONE OF THE STYLING EITHER, which is the half that would have shipped broken.
  //
  // Every `.qa-row-btn` rule in the mobile container is scoped to `#assetsTable` — the desktop table —
  // and the base `.qa-row-btn` look (padding, radius, border, muted colour, hover) lives only in the
  // DESKTOP page's stylesheet. Measured: 5 rules in lumoscore-wallet-mobile.html, all `#assetsTable…`,
  // and no bare `.qa-row-btn` rule anywhere in it. Appending the buttons alone would have put three
  // browser-default grey boxes on every card. See [[lumoscore-stripped-layer-css]].
  //
  // So the base look is restated here, scoped to the card list, matching the desktop rule rather than
  // inventing a second visual language. Sizes are the phone's, not the desktop's 17.6px.
  function cardActionCss() {
    if (document.getElementById('lx-cardact-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-cardact-css';
    st.textContent = '#assetList .asset-row .row-quick-actions{display:flex;align-items:center;gap:8px;'
      + 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border,rgba(255,255,255,.08))}'
      + '#assetList .asset-row .qa-row-btn{flex:1 1 0;padding:8px 10px;border-radius:8px;'
      + 'border:1px solid var(--border,rgba(255,255,255,.12));background:transparent;color:var(--text,#16171b);'
      + 'font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;'
      + 'display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .12s}'
      + '#assetList .asset-row .qa-row-btn:hover{border-color:var(--accent,#ea6a2c);color:var(--accent,#ea6a2c)}'
      // The kebab keeps its square footprint instead of stretching to a third of the card.
      + '#assetList .asset-row .qa-row-btn.icon-only{flex:0 0 38px;width:38px;padding:8px 0}'
      // Same red trash glyph the desktop row gets, which is scoped to #assetsTable over there.
      + '#assetList .asset-row .qa-row-btn.lx-rmtrust svg{stroke:var(--red,#ea3943)}'
      + '#assetList .asset-row .qa-row-btn svg{width:15px;height:15px;flex:0 0 auto}'
      // A card has 142px beside the balance at 375: the domain whole, or the contract, with the copy button either way.
      + '#assetList .lx-hd:not(:empty)~.lx-iss{display:none}';
    document.head.appendChild(st);
  }

  // BOTH containers exist on every wallet page -- the design keeps a table and a card list and shows
  // one by media query. Taking whichever is found first would fill the hidden one and leave the
  // visible one empty, which on a phone looks exactly like the page failing to load.
  // getClientRects() cannot be used to decide: both are EMPTY at this point and so have no rects.
  function hidden(e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  }

  function host() {
    var t = $('#assetsTable'), l = $('#assetList');
    if (t && !hidden(t)) return { node: t, kind: 'table' };
    if (l && !hidden(l)) return { node: l, kind: 'cards' };
    if (t) return { node: t, kind: 'table' };
    if (l) return { node: l, kind: 'cards' };
    return null;
  }

  // The mobile design ships an anti-flash gate inherited from the Stellar build:
  //     body:not(.lxmw-ready) #assetList { visibility: hidden }
  // and it lifts only when window.__lxWalletEarly / __lxWalletReady is set -- flags that belonged to
  // Stellar's wallet data layer, which does not exist here. Left alone the phone renders a page that
  // is fully populated and completely invisible: 65 correct cards, correct colours, opacity 1, and
  // nothing on screen. Nothing in the console, because nothing is wrong.
  //
  // This layer is now the thing that fills that list, so it is the thing that says it is ready. Set
  // BOTH: the flag, for the design's own pass() when it runs after us, and the class, for when it has
  // already run. Called before the first note(), so the loading and error messages are visible too --
  // they live inside the gated container.
  // THE SAME TRAP HAS A SECOND DOOR, and stripping the Stellar layer is what closed it. lx-walletdata
  // is gone but its STYLESHEET stays -- a stripped script takes its markup and its logic with it and
  // leaves every rule it relied on standing. Four of those rules wait on a class only that script ever
  // set:
  //     body:not(.lx-wd-ready) .value-side .sub-value          { visibility: hidden }
  //     body:not(.lx-wd-ready) .asset-tabs .cnt                { visibility: hidden }
  //     body:not(.lx-wd-ready) h2 .meta, h3 .meta              { visibility: hidden }
  //     body:not(.lx-wd-ready) .insight-card ... .headline,.sub{ visibility: hidden }
  //
  // So the USD sub-total, all four tab counts and the holdings summary were computed correctly, written
  // correctly, and invisible -- reading them back through the DOM returned the right strings the whole
  // time, which is exactly why this survived several rounds of checking. Only a screenshot showed the
  // tabs with no numbers on them.
  //
  // This layer fills those elements now, so it raises the flag for them, the same way it does the
  // mobile one directly above.
  function lift() {
    try {
      window.__lxWalletReady = 1;
      document.body.classList.add('lxmw-ready');
      document.body.classList.add('lx-wd-ready');
    } catch (e) {}
  }

  function note(h, text) {
    h.node.innerHTML = '';
    if (h.kind === 'table') {
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 5;
      td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
      tr.appendChild(td);
      h.node.appendChild(tr);
    } else {
      var d = el('div', null, text);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
    }
  }

  function setMeta(held, pools, xrp) {
    var n = held + (xrp ? 1 : 0);
    // The summary line is NOT written here any more. This used to take $('.section-heading .meta') —
    // the first match — and the first .section-heading on this page is Open Orders, so the holdings
    // summary landed on the orders section while My Assets kept its mock. setChip() writes every
    // summary, scoped to the headings that are actually about holdings; doing it in one place is what
    // stops the two from disagreeing.
    // THE COUNTS WERE CROSS-WIRED. '.asset-tabs .cnt' also matches the two tabs buildTabs() inserts —
    // Open orders and Claimable payments — and they come FIRST in the DOM. So [0] and [1] were writing
    // the holdings count into "Open orders" and the pool count into "Claimable payments", which is why
    // this account showed "Open orders 10" (its 10 holdings) and "Claimable payments 0" (its 0 pools),
    // while Assets and Liq Pools kept the design's 5 and 2. Every number on that row was wrong and two
    // of them looked plausible.
    //
    // Excluded by .lx-wcgroup, the marker buildTabs() stamps on its own group. Stellar carries the
    // identical guard for the identical reason; matching its name keeps one contract across both
    // builds rather than two selectors that happen to agree today.
    var cnt = [].filter.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) {
      return !(c.closest && c.closest('.lx-wcgroup'));
    });
    if (cnt[0]) cnt[0].textContent = String(n);
    if (cnt[1]) cnt[1].textContent = String(pools);
  }

  function paint(data) {
    var h = host();
    if (!h) return;
    h.node.innerHTML = '';
    var make = h.kind === 'table' ? tableRow : card;

    // NEAR first, carrying the number people actually need: what is available once storage is held back.
    if (data.near) {
      var rs = fmt(data.near.spendable, 4) + ' available · ' + fmt(data.near.storage, 4) + ' held for storage'
        + (data.near.staked > 0 ? (' · ' + fmt(data.near.staked, 4) + ' staked') : '');
      // null marks the native coin: it has no contract.
      h.node.appendChild(make('NEAR', 'NEAR Protocol', balTxt(data.near.balance) + ' NEAR', rs, false, null));
    }

    // Already ordered by load(): priced holdings by value, then the rest by name.
    for (var i = 0; i < data.held.length; i++) {
      var t = data.held[i];
      h.node.appendChild(make(t.display, short(t.id), (t.balance == null ? '—' : balTxt(t.balance)) + ' ' + t.display, '', false, t));
    }
    // THE ORDER THE LEDGER GAVE US, recorded before anything reorders it.
    //
    // applyPins only ever PROMOTES a pinned row to the top; it has no idea where a row came from, so
    // unpinning cleared the badge and left the row sitting where the pin had put it (RAZA 2026-10-19).
    // Stamping the natural position here — the one place every row passes through, in the order the
    // balances arrived — lets the pin pass sort rather than shuffle, so unpinning puts a row back.
    [].forEach.call(h.node.children, function (el, i) {
      if (el.setAttribute) el.setAttribute('data-lxord', i);
    });

    if (!data.held.length && !data.near) note(h, 'Nothing held on this account yet.');
    hideSparkHead();
    claimRowActions();
    setMeta(data.held.length, data.pools.length, data.near);
    setChip();
    clearTotalMock();
    revealAll();
  }

  // Releases the page's card-reveal gate on the containers this layer fills.
  //
  // The design fades sections in on scroll. Its driver takes a snapshot of what to watch ONCE, at
  // DOMContentLoaded, and drops anything that is hidden at that instant — so an element the wallet
  // gates until its data lands is never observed, and when the gate finally lifts the reveal rule is
  // still holding it at opacity 0. Nothing re-runs. The section is then invisible for good.
  //
  // .assets-card is where that landed: the whole My Assets card, 560px of correct, priced, real
  // holdings, on a blank screen. It answers every DOM query — ten rows, right numbers, opacity 1 on
  // the rows themselves — because the zero is on the container. That is why this needed a screenshot
  // to find and could not have been caught by reading the page.
  //
  // Safe to call broadly: this only clears an opacity gate. An element hidden for a real reason —
  // display:none on the inactive Liq Pools panel — stays hidden, because that is a different rule.
  // THE ORDERS BLOCKS ARE DELIBERATELY NOT IN THIS LIST.
  //
  // revealAll() runs from paint(), which fires the moment the ledger balances land. paintOrders()
  // runs AFTER it and does its own fetch first, so there is a window — measured at about two seconds
  // on a phone — where the balances are painted but the orders panel still holds the design's three
  // Aptos mock cards with their red Cancel buttons.
  //
  // reveal() stamps data-lcm-done, which is the exact attribute the open-orders flash gate keys on.
  // So including these two here meant paint() threw the gate open over the mock and then waited for
  // the real orders to arrive: the gate was not failing to work, it was being unlocked early by a
  // different painter. RAZA 2026-10-17, after the gate shipped: "the apt flash bug still shows up for
  // split seconds when i refresh the page".
  //
  // paintOrders() calls reveal(block) itself on BOTH of its endings — rendered rows and the "no open
  // orders" note — so these blocks still get stamped, just at the point the content is actually real.
  // And if that never happens, the gate's own 3s timer in _xrplwallet.js releases them anyway, so
  // nothing can stay hidden. Dropping them here costs no reveal and closes the window.
  function revealAll() {
    var SEL = '.hero, .insight-card, .assets-card, .lp-card';
    [].forEach.call(document.querySelectorAll(SEL), reveal);
  }

  // Blanks the Total Portfolio headline the moment real rows are painted.
  //
  // prices.js fills this block properly, but it needs a price fetch first, so for roughly two seconds
  // the largest number on the page read "31,108.45 APT" — a fabricated Aptos figure sitting above ten
  // real XRP Ledger holdings. Worse, when that fetch is slow or fails the mock never gets overwritten
  // at all: on one load it was still showing nine seconds in, which is indefinitely as far as anyone
  // reading the page is concerned.
  //
  // So the mock is cleared here rather than merely overwritten later. An em dash reads as "not in yet"
  // and is self-evidently not a balance; a stale number from another chain reads as your money. This
  // layer knows the holdings but not their prices, so it cannot fill the total itself — it can only
  // make sure nothing false occupies the slot while prices.js is on its way.
  // THE HERO'S TOTAL EXISTS IN TWO SHAPES, and only one was ever addressed.
  //
  // Desktop is `.value-side` wrapping `.value` / `.sub-value`. The PHONE has no `.value-side` at
  // all — it is `.portfolio-value` (with the unit in a `.unit` span) and `.portfolio-sub`. So both
  // the clear below and prices.js's paintTotal returned on their first line, and a phone showed the
  // design's mock permanently: "31,108.45 APT" as the largest number on the page, "≈ $12,847.62
  // USD" under it, "+11.08%" and "+3,114.20 APT" beside it. Four fabricated figures describing
  // someone's holdings, on the wallet page, in another chain's asset, and never replaced.
  //
  // Resolved in ONE place and published, because prices.js needs exactly the same four elements and
  // two copies of this lookup is two things to update when a variant changes.
  function totalBlock() {
    var vs = $('.value-side');
    if (vs && vs.querySelector('.value')) {
      return {
        root: vs, value: vs.querySelector('.value'), sub: vs.querySelector('.sub-value'),
        pill: vs.querySelector('.delta-pill'), secondary: vs.querySelector('.delta-secondary')
      };
    }
    var pv = $('.portfolio-value');
    if (!pv) return null;
    return {
      root: pv.parentElement || pv, value: pv, sub: $('.portfolio-sub'),
      pill: $('.delta-pill'), secondary: $('.delta-secondary')
    };
  }
  try { window.lxnTotals = totalBlock; } catch (e) {}

  function clearTotalMock() {
    var b = totalBlock();
    if (!b || b.root.getAttribute('data-lxxcleared')) return;
    var v = b.value;
    if (v) {
      var unit = v.querySelector('span');
      var first = v.firstChild;
      if (first && first.nodeType === 3) first.nodeValue = '— ';
      else v.insertBefore(document.createTextNode('— '), v.firstChild);
      if (unit) unit.textContent = 'NEAR';
    }
    if (b.sub) b.sub.textContent = '';
    if (b.pill) { b.pill.style.visibility = 'hidden'; }
    if (b.secondary) b.secondary.textContent = '';
    b.root.setAttribute('data-lxxcleared', '1');

    // prices.js may already have fetched and given up because this list was still empty when its
    // response landed. Nudging it here closes that race from the side that knows the rows now exist.
    try { if (window.__lxnPricesApply) window.__lxnPricesApply(); } catch (e) {}
  }

  // The header chip shipped showing the design's mock address, `0x09c7…a802` — an EVM-shaped string
  // on an XRP Ledger wallet page, sitting above this account's real balances. Whatever else is wrong
  // on a page, the address it claims to be showing must be the one that is connected.
  function setChip() {
    var a = addr();
    if (!a) return;
    var chip = $('.wallet-chip .text') || $('.wallet-chip .addr');
    if (chip && chip.textContent.trim() !== short(a)) chip.textContent = short(a);
    // `.hero-id-row .wallet-chip .text:not(.lxp)` is hidden by the inherited sheet — which is the
    // "wallet address is empty" top left (RAZA 2026-09-15). Written correctly, never released.
    if (chip) chip.classList.add('lxp');
    // The address is real and written, so open the gate that was holding every .wallet-chip/.chip
    // .text in transparent ink. .lxp alone was never enough: the hero pill carried .lxp and was still
    // invisible, because these are two independent gates and this build only ever lifted one.
    liftGate('lx-adrdone');
    // "COPIED TO CLIPBOARD", as lumoscore.com says (RAZA 2026-09-15). The design's copy handler builds its toast from
    // data-copy-label — "Wallet address copied to clipboard" — so the label is removed from the address controls.
    [].forEach.call(document.querySelectorAll('.wallet-chip [data-copy-label], .hero-id-row [data-copy-label]'), function (b) {
      b.removeAttribute('data-copy-label');
    });

    // THE PAGE HAS MORE THAN ONE HOLDINGS SUMMARY. setMeta writes $('.section-heading .meta'), which
    // is the FIRST match — and a second one lives in another .section-heading further down, so it kept
    // the mock "5 holdings · 31,108.45 APT total" while the list beneath it was already correct.
    // querySelector returning the first of several is the quiet version of this bug; take them all.
    var d = window.__lxnData;
    if (!d) return;
    var n = d.held.length + (d.near ? 1 : 0);
    // Stellar's wording: "3 Holdings | Total worth: ~326 XLM". The worth arrives with prices (prices.js).
    var line = n + (n === 1 ? ' Holding' : ' Holdings')
      + (window.__lxnWorthNear > 0 ? (' | Total worth: ~' + Math.round(window.__lxnWorthNear).toLocaleString('en-US') + ' NEAR') : '');
    [].forEach.call(document.querySelectorAll('.section-heading .meta, h2 .meta'), function (m) {
      // Only summaries, never an activity row's own .meta (which is "From r… · 06:16").
      if (!m.hasAttribute('data-lxmeta') && !/holding|APT|Aptos/i.test(m.textContent || '')) return;
      // AND ONLY THE ONES ABOUT HOLDINGS. Matching on the mock's text alone was too loose: the Open
      // Orders heading shipped its own meta reading "3,442 APT", which matched, so that section
      // announced "10 holdings · 15.57 XRP" above a list of orders. The test has to be what the
      // section IS, not what its placeholder happened to say.
      var head = m.closest('.section-heading, h2, h3');
      // The heading's title WITHOUT its own .meta. Reading head.textContent whole was circular: the
      // meta is inside the heading, so once anything had written "10 holdings" into it, the heading
      // matched /holding/ and kept qualifying on every later pass — the guard authorised exactly the
      // write it was meant to prevent.
      var title = '';
      if (head) {
        [].forEach.call(head.childNodes, function (nd) {
          if (nd.nodeType === 1 && nd.classList && nd.classList.contains('meta')) return;
          title += (nd.textContent || '') + ' ';
        });
      }
      if (!/asset|holding|portfolio|balance/i.test(title)) {
        // Not a holdings summary — but it still held an Aptos figure ("3,442 APT") that nothing on
        // this build fills. Leaving it would trade one wrong number for another, so it is emptied.
        if (/APT|Aptos/i.test(m.textContent || '')) m.textContent = '';
        return;
      }
      m.textContent = line;
    });
  }
  try { window.__lxnSetChip = setChip; } catch (e) {}

  // ---- Open orders and Claimable -------------------------------------------------------------------
  // Both tabs were driven by Stellar layers (lx-qorders, lx-wclaim) that queried horizon.stellar.org.
  // Those are stripped on NEAR. Open orders lists the account's Rhea DCL limit orders (paintOrders, via
  // browser/neardcl.js) and cancels / collects them; Claimable is NEAR-less and not built (RAZA: hidden on NEAR), exactly as on XRPL.
  //
  // THE TABS ARE NOT IN THE MARKUP, which cost a deploy to learn. Reading the built page for
  // ".lx-wctab" found it and I took that for design markup — but every hit was a CSS rule and this
  // file's own selector. On Stellar the bar is BUILT AT RUNTIME by _walletclaim.js, so stripping that
  // layer took the Open orders and Claimable tabs off the page entirely, and the painters below had
  // nothing to write into. The check that would have caught it is querySelector in a live page, not
  // grep in a built one: markup you can find in the HTML and markup a script creates look identical
  // in a text search and are opposites in the DOM.
  //
  // So the bar is rebuilt here, structurally identical to Stellar's — same classes, same copy, same
  // two insight cards folded away — which is why it inherits lx-qorders-css and lx-wclaim-css and
  // looks the same. This is a port of the same layer, not a new design.
  //
  // "Claimable payments" is Stellar's claimable-balance feature, which this ledger does not have, so the
  // tab is NOT built here (RAZA 2026-09-15: "remove the claimable tab on XRPL"). Open orders stands alone.
  function selectTab(which) {
    var tabs = document.querySelectorAll('.lx-wctab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-t') === which);
    }
    var o = $('.lx-wcpanel-orders'), c = $('.lx-wcpanel-claim');
    if (o) { if (which === 'orders') o.removeAttribute('hidden'); else o.setAttribute('hidden', ''); }
    if (c) { if (which === 'claim') c.removeAttribute('hidden'); else c.setAttribute('hidden', ''); }
  }

  function buildTabs() {
    // The desktop wraps these three cards in .insights-rail and the phone in .insights-stack. Both,
    // or the tabs appear on one device only.
    var stack = $('.insights-stack,.insights-rail');
    if (!stack || $('.lx-wctabs')) return;

    // Found by what they SAY, not by position: the stack's order is the design's to change.
    var cards = [].slice.call(stack.querySelectorAll('.insight-card'));
    var ordersCard = null, poolsCard = null;
    cards.forEach(function (c) {
      var t = ((c.querySelector('.ttl') || {}).textContent || '').trim();
      if (/open orders/i.test(t)) ordersCard = c;
      if (/liquidity pools/i.test(t)) poolsCard = c;
    });
    if (!ordersCard && !poolsCard) return;
    // These two shipped reading "3 Active" and "3,442 APT" — mock figures on an XRP Ledger account.
    // The tabs replace them and carry the real counts, so the mocks go with the cards.
    if (ordersCard) ordersCard.style.display = 'none';
    if (poolsCard) poolsCard.style.display = 'none';

    var bar = document.createElement('div');
    bar.className = 'asset-tabs-row lx-wctabs';
    // lx-wcgroup is load-bearing, and it is Stellar's own fix for the bug this file hit independently:
    // reusing .asset-tabs is what makes these tabs match the Assets / Liq Pools pair exactly, but it
    // puts a SECOND .asset-tabs group on the page, and setMeta addresses that class by index. The
    // marker lets it exclude this group by name instead of hoping about DOM order.
    bar.innerHTML = '<div class="asset-tabs lx-wcgroup">'
      + '<button class="lx-wctab active" type="button" data-t="orders">Open orders'
      + ' <span class="cnt">0</span></button>'
      + '</div>';
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.lx-wctab');
      if (b) selectTab(b.getAttribute('data-t'));
    });

    // The orders list the page already ships becomes the first panel; the second is ours. Desktop
    // ships .orders-block, the phone ships .orders-stack — take whichever is here.
    var orders = $('.orders-block') || $('.orders-stack');
    var host = orders ? orders.parentNode : stack.parentNode;
    var anchor = orders || stack.nextSibling;

    var pOrders = document.createElement('div'); pOrders.className = 'lx-wcpanel lx-wcpanel-orders';

    host.insertBefore(bar, anchor);
    host.insertBefore(pOrders, anchor);
    if (orders) {
      // The list's own heading comes with it where there is one, so the tab does not end up floating
      // above a section title that repeats what the tab already says. Only the duplicated title text
      // is hidden; anything else in that header (a Cancel all control) stays reachable.
      var head = orders.previousElementSibling;
      if (head && /open orders/i.test(head.textContent || '') && head.querySelector('h2,h3')) {
        var hh = head.querySelector('h2,h3');
        if (hh) hh.style.display = 'none';
        pOrders.appendChild(head);
      }
      pOrders.appendChild(orders);
    }

    // "CANCEL ALL" MOVES ONTO THE TAB ROW (RAZA 2026-09-17: "place the cancel all button aligning with Claimable payments
    // (but on right side)"). It belongs to the heading this layer hides, so it was left sitting on a line of its own above
    // the tabs. Re-parented, not restyled — the design's own button, at the end of the row the tabs are on.
    // Searched across the page, not inside the panel: the control lives in its own `.section-heading .right`, a sibling of
    // the orders list rather than a child of it, so looking only within the panel found nothing.
    var cancel = null;
    [].slice.call(document.querySelectorAll('.section-heading .ctrl-btn, .section-heading button, .section-heading a')).forEach(function (b) {
      if (!cancel && /cancel all/i.test(b.textContent || '')) cancel = b;
    });
    if (cancel) {
      bar.style.display = 'flex';
      bar.style.alignItems = 'center';
      bar.style.gap = '10px';
      cancel.style.marginLeft = 'auto';
      bar.appendChild(cancel);
    }

    // Always opens on Open orders: it is the list with money at stake and an action attached.
    selectTab('orders');
  }

  function setTab(which, n) {
    var t = document.querySelector('.lx-wctab[data-t="' + which + '"] .cnt');
    if (t) t.textContent = String(n);
  }

  // Fills one cloned .order-row from one account_offers entry.
  //
  // WRITTEN AFTER FLATTENING IT ONCE. The first version set .order-pair's textContent, which replaced
  // the two token circles, the pair name and the Buy/Sell pill with a single string — the row rendered
  // as "997,393.739396 XYIELD → 9,973.937392 XRP Price 0.0142 APT Amount 10,000 USDT" because the real
  // pair had eaten the design's structure while the three mock columns beside it were never touched.
  // Every field the design ships gets written or removed here; none is left holding another chain's
  // numbers, and none is written by destroying the element that held it.
  //
  // XRPL semantics: an offer says "I give taker_gets, I want taker_pays". From the owner's side that
  // is always a SELL of taker_gets, so the pill is fixed — there is no buy-side offer to mirror.
  // Sets short text on an element the LOGO ENGINE would otherwise claim.
  //
  // The page carries a 76KB unnamed layer (window.__lumosLogoEngine) that treats ANY element holding
  // one to five characters as a ticker badge: it paints a logo into the background and empties the
  // text. It re-runs a few seconds after load, so writing the text once is not enough.
  //
  // It cost a deploy to find, because the failure looks like nothing. The Buy/Sell pill came back
  // EMPTY with a Tether logo behind it — the mock row said "10,000 USDT", the engine had already
  // claimed that row's pill and stamped data-logo="USDT" on it, and cloning the row as a template
  // carried the stamp onto every real order. Setting .textContent afterwards was undone on the
  // engine's next pass, because its own test short-circuits on that attribute:
  //     if (el.getAttribute('data-logo')) return true;
  //
  // So the stamp is what has to go, not just the text. Once it is gone the element is judged on its
  // content, and neither "Sell" nor a single letter matches any symbol it knows, so it is left alone.
  function plain(el, text) {
    try {
      el.removeAttribute('data-logo');
      el.style.background = '';
      el.style.backgroundImage = '';
      // data-logoed is the engine's OWN "already handled, leave alone" marker — it skips such nodes
      // exactly as it skips an <svg> or an <img>. Claiming the element with its own contract is a far
      // better opt-out than smuggling an SVG in to look unappetising, and it survives its re-runs.
      el.setAttribute('data-logoed', '1');
    } catch (e) {}
    el.textContent = text;
  }

  // Releases an element from the page's card-reveal gate.
  //
  // The design fades sections in on scroll:
  //     html.lcm-ready .orders-block:not([data-lcm-done]) { opacity: 0; transform: translateY(8px) }
  // with a driver that adds .lcm-on when the element comes into view. buildTabs() moves .orders-block
  // into a new panel, and after that move the driver never released it — so the panel sat at opacity 0
  // holding a correctly built, correctly sized, fully painted order row that nobody could see. The row
  // even answered elementFromPoint, because a transparent element is still hit-testable; the only
  // measurement that showed the truth was its computed opacity.
  //
  // data-lcm-done is the gate's own "already handled" attribute, so setting it opts the element out
  // rather than fighting the rule, and .lcm-on covers the case where the driver has since run.
  function reveal(node) {
    if (!node) return;
    try {
      node.setAttribute('data-lcm-done', '1');
      node.classList.add('lcm-on');
    } catch (e) {}
  }

  // ---- NEAR limit orders (Rhea DCL, browser/neardcl.js) ----------------------------------------------
  // list_active_orders, read-only. Each order is shown from its TOKEN's side against its quote: NEAR when
  // either side is wNEAR, else a stablecoin, else whatever it buys. Selling the quote is a Buy of the token.
  var QUOTES = ['wrap.near', '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    'usdt.tether-token.near', 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near'];
  function qrank(id) { var i = QUOTES.indexOf(id); return i < 0 ? 99 : i; }
  function metaOf(id) {
    if (id === 'wrap.near') return Promise.resolve({ s: 'NEAR', d: 24 });
    return C.tokenMeta(id).then(function (m) { return (m && !m.x) ? m : { s: C.short(id), d: null }; },
      function () { return { s: C.short(id), d: null }; });
  }
  function shapeOrder(o, M) {
    var buy = qrank(o.sell_token) < qrank(o.buy_token);
    var tok = buy ? o.buy_token : o.sell_token, quo = buy ? o.sell_token : o.buy_token;
    var mt = M[tok] || {}, mq = M[quo] || {}, ms = M[o.sell_token] || {};
    var px = null;
    var xy = String(o.pool_id).split('|');
    var dx = M[xy[0]] && M[xy[0]].d, dy = M[xy[1]] && M[xy[1]].d;
    if (dx != null && dy != null) {
      var pxy = Math.pow(1.0001, +o.point) * Math.pow(10, dx - dy);     // token_x in token_y
      px = xy[0] === tok ? pxy : 1 / pxy;                                // token in quote
    }
    var D = window.lxnDcl, dec = ms.d;
    var orig = dec != null ? Number(D.fromUnits(o.original_amount, dec)) : null;
    var remain = dec != null ? Number(D.fromUnits(o.remain_amount, dec)) : null;
    var cancelled = dec != null ? Number(D.fromUnits(o.cancel_amount || '0', dec)) : 0;
    var filled = (orig != null && remain != null) ? Math.max(0, orig - remain - cancelled) : null;
    // Amount is the token, Total the quote, whichever side is sold.
    var amt = null, tot = null;
    if (orig != null && px > 0) { if (buy) { tot = orig; amt = orig / px; } else { amt = orig; tot = orig * px; } }
    return {
      id: o.order_id, buy: buy, tok: tok, quo: quo, sym: mt.s || C.short(tok), qsym: mq.s || C.short(quo),
      px: px, amt: amt, tot: tot, orig: orig, filled: filled, ssym: ms.s || '',
      collect: D.big(o.remain_amount) <= BigInt(0)
    };
  }
  function orderLogo(id) {
    if (id === 'wrap.near') return C.NEAR_LOGO;
    var h = (window.__lxnData && window.__lxnData.held) || [];
    for (var i = 0; i < h.length; i++) if (h[i].id === id && h[i].logo) return h[i].logo;
    return '';
  }
  // STELLAR'S AMOUNTS (RAZA 2026-11-05: "instead of 100,000,000 you could have just written 100M"): its wallet's amt()
  // in _walletdata.js, figure for figure: 1.00M, 1,000.0, 500.10, 0.005.
  function orderAmt(n) {
    n = +n || 0;
    var a = Math.abs(n), num = function (v, dp) { return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); };
    if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return num(n, a >= 1e4 ? 0 : 1);
    if (a >= 1) return num(n, 2);
    if (a > 0) {
      var d = Math.min(7, Math.max(2, 2 - Math.floor(Math.log(a) / Math.LN10))), t = n.toFixed(d);
      return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/[.]$/, '') : t;
    }
    return '0';
  }
  function orderRow(tpl, x) {
    var row = tpl.cloneNode(true);
    // data-oid is what the design's gate (.order-row:not([data-oid]){display:none}) waits for, and what
    // the Cancel click reads: the DCL order id itself.
    row.setAttribute('data-oid', x.id);
    if (x.collect) row.setAttribute('data-collect', '1');
    var nm = row.querySelector('.pair-text .name');
    if (nm) plain(nm, x.sym + ' / ' + x.qsym);
    var side = row.querySelector('.pair-text .side, .order-side');
    if (side) {
      side.className = (side.classList.contains('order-side') ? 'order-side' : 'side') + (x.buy ? ' buy' : ' sell');
      plain(side, x.buy ? 'Buy' : 'Sell');
      // The logo healer took "Buy" on a USDC row for a ticker slot and painted the USDC mark over it (it
      // reads the symbol from the ROW). An empty [data-logo] child is its own "leave this alone" escape.
      var esc = document.createElement('span');
      esc.setAttribute('data-logo', '');
      esc.style.display = 'none';
      side.appendChild(esc);
    }
    var ico = row.querySelectorAll('.pair-ico .b');
    for (var ik = 1; ik < ico.length; ik++) if (ico[ik].parentNode) ico[ik].parentNode.removeChild(ico[ik]);
    if (ico[0]) {
      var lg = orderLogo(x.tok);
      plain(ico[0], lg ? '' : String(x.sym || '?').charAt(0).toUpperCase());
      if (lg) {
        ico[0].style.background = 'transparent';
        var im = document.createElement('img');
        im.alt = ''; im.src = lg;
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
        ico[0].appendChild(im);
      }
      // Same escape as the side pill: without it the healer stamped the QUOTE's logo (USDC) on a QTC row.
      [ico[0], ico[0].parentNode].forEach(function (n) {
        if (!n || n.querySelector(':scope > [data-logo=""]')) return;
        var e2 = document.createElement('span');
        e2.setAttribute('data-logo', '');
        e2.style.display = 'none';
        n.appendChild(e2);
      });
    }
    var cols = row.querySelectorAll('.order-details .col');
    var vals = [
      x.px != null ? orderAmt(x.px) + ' ' + x.qsym : '—',
      x.amt != null ? orderAmt(x.amt) + ' ' + x.sym : '—',
      x.tot != null ? orderAmt(x.tot) + ' ' + x.qsym : '—'
    ];
    for (var i = 0; i < cols.length && i < 3; i++) { var v = cols[i].querySelector('.v'); if (v) plain(v, vals[i]); }
    // No fill bar, as on Stellar (RAZA 2026-11-05: "remove filled section on near open orders").
    var prog = row.querySelector('.order-progress-wrap');
    if (prog && prog.parentNode) prog.parentNode.removeChild(prog);
    var cb = row.querySelector('.order-cancel');
    if (cb) {
      // COLLECT is the same button (RAZA 2026-10-21): a fully filled order's proceeds wait in the contract
      // until cancel_order with amount "0" sends them.
      var phoneBtn = /order/i.test(cb.textContent || '');
      plain(cb, x.collect ? 'Collect' : (phoneBtn ? 'Cancel Order' : 'Cancel'));
      cb.removeAttribute('data-order'); cb.removeAttribute('data-side');
    }
    return row;
  }

  // CANCEL / COLLECT through the design's own confirmation dialog: #modalCancelOrder on desktop,
  // #cancelModal on the phone. Its confirm button is replaced by a clean clone each time (one listener per
  // opening would cancel the same order again on the next use), and nothing signs until the person
  // approves in their wallet.
  function cancelDialog(ids, describe, collectOnly) {
    var m = document.getElementById('modalCancelOrder') || document.getElementById('cancelModal');
    if (!m) return;
    var desk = m.id === 'modalCancelOrder';
    var title = document.getElementById(desk ? 'cancelOrderTitle' : 'cancelModalTitle');
    var text = document.getElementById(desk ? 'cancelOrderText' : 'cancelModalText');
    var det = document.getElementById(desk ? 'cancelOrderDetails' : 'cancelModalDetail');
    var lbl = document.getElementById(desk ? 'cancelOrderBtnLabel' : 'cancelModalBtnLabel');
    var keep = document.getElementById('cancelOrderKeepSuffix');
    var go = document.getElementById(desk ? 'cancelOrderConfirm' : 'cancelModalConfirm');
    if (!go) return;
    var many = ids.length > 1;
    if (title) title.textContent = collectOnly ? 'Collect this order?' : (many ? ('Cancel ' + ids.length + ' orders?') : 'Cancel this order?');
    if (text) {
      text.textContent = collectOnly
        ? 'It has filled. Collecting sends what it bought to your wallet.'
        : ((many ? 'Each order is cancelled by its own transaction, so your wallet will ask you to approve ' + ids.length + '. ' : '')
          + 'What is left of the order comes back to your wallet, together with anything it has already bought.');
    }
    if (det) { det.textContent = describe || ''; det.style.display = describe ? '' : 'none'; }
    if (lbl) lbl.textContent = collectOnly ? 'Collect' : (many ? ('Cancel all (' + ids.length + ')') : 'Cancel order');
    if (keep) keep.textContent = '';
    var fresh = go.cloneNode(true);
    go.parentNode.replaceChild(fresh, go);
    var flbl = fresh.querySelector('span') || fresh;
    var orig = flbl.textContent;
    fresh.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var who = addr();
      if (!who) { flbl.textContent = 'Connect a NEAR wallet first'; return; }
      fresh.disabled = true;
      flbl.textContent = 'Checking…';
      window.lxnDcl.buildCancel(who, ids).then(function (b) {
        window.__lxnLastCancel = b;
        flbl.textContent = 'Confirm in wallet…';
        return window.lxnDcl.sign(b.txs);
      }).then(function () {
        m.classList.remove('open', 'show', 'active');
        document.body.style.overflow = '';
        fresh.disabled = false; flbl.textContent = orig;
        try { if (window.showToast) window.showToast(collectOnly ? 'Collected' : (many ? ids.length + ' orders cancelled' : 'Order cancelled')); } catch (x) {}
        paintOrders(who);
      }).catch(function (err) {
        fresh.disabled = false;
        var msg = (err && err.message) || '';
        flbl.textContent = err && err.lxnWallet && window.lxnDcl.walletErr ? window.lxnDcl.walletErr(err, 'cancelled') : (msg || 'Could not cancel');
      });
    });
    m.classList.add('open');
    if (desk) document.body.style.overflow = 'hidden';
  }
  function wireCancels() {
    if (window.__lxnCancels) return;
    window.__lxnCancels = 1;
    // WINDOW capture: ahead of the design's own mock handlers (which only delete the row and toast).
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || !window.lxnDcl) return;
      var one = t.closest('.order-cancel');
      if (one) {
        var row = one.closest('[data-oid]');
        if (!row) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var nm = ((row.querySelector('.pair-text .name') || {}).textContent || '').trim();
        var sd = ((row.querySelector('.pair-text .side, .order-side') || {}).textContent || '').trim();
        cancelDialog([row.getAttribute('data-oid')], (sd ? sd + ' · ' : '') + nm, row.getAttribute('data-collect') === '1');
        return;
      }
      var all = t.closest('#cancelAllBtn, .order-cancel-all, [data-cancel-all]');
      if (all) {
        var rows = [].slice.call(document.querySelectorAll('[data-oid]'));
        e.preventDefault(); e.stopImmediatePropagation();
        if (!rows.length) return;
        cancelDialog(rows.map(function (r) { return r.getAttribute('data-oid'); }),
          rows.length + ' open order' + (rows.length === 1 ? '' : 's'), false);
      }
    }, true);
  }

  function paintOrders(me) {
    wireCancels();
    // Rhea DCL limit orders, read-only; metadata for both sides of every order before anything paints.
    (window.lxnDcl ? window.lxnDcl.activeOrders(me) : Promise.resolve([]))
      .then(function (list) {
        var ids = {};
        list.forEach(function (o) {
          ids[o.sell_token] = 1; ids[o.buy_token] = 1;
          String(o.pool_id).split('|').slice(0, 2).forEach(function (t) { ids[t] = 1; });
        });
        var keys = Object.keys(ids);
        return Promise.all(keys.map(metaOf)).then(function (ms) {
          var M = {};
          keys.forEach(function (k, i) { M[k] = ms[i]; });
          return { offers: list.map(function (o) { return shapeOrder(o, M); }) };
        });
      })
      .then(function (r) {
        var offers = r.offers || [];
        setTab('orders', offers.length);

        // The Open Orders heading ships its own summary reading "3 active". Nothing filled it, so it
        // sat directly above a tab correctly badged "Open orders 1" — two counts of the same thing,
        // side by side, disagreeing, with the invented one in the larger type.
        [].forEach.call(document.querySelectorAll('.section-heading'), function (sh) {
          var m = sh.querySelector('.meta');
          if (!m) return;
          var title = '';
          [].forEach.call(sh.childNodes, function (nd) {
            if (nd === m || (nd.contains && nd.contains(m))) {
              // walk into the wrapper but skip the meta itself
              [].forEach.call(nd.childNodes || [], function (k) { if (k !== m) title += (k.textContent || '') + ' '; });
              return;
            }
            title += (nd.textContent || '') + ' ';
          });
          if (/open orders/i.test(title)) {
            m.textContent = offers.length + ' active';
          }
        });

        // TWO LAYOUTS, AND ONLY ONE OF THEM WAS WIRED. Desktop lists orders as .order-row inside
        // .orders-block; the phone lists them as .order-card inside .orders-stack — different
        // container, different item, same fields. Keying on the desktop pair alone meant the phone
        // showed the tab correctly badged "Open orders 1" above a completely empty panel: the count
        // came from the ledger, the list came from markup that was never found, and nothing errored.
        var block = $('.lx-wcpanel-orders .orders-block') || $('.lx-wcpanel-orders .orders-stack')
          || $('.orders-block') || $('.orders-stack');
        if (!block) return;
        // The panel may have been emptied by the flash gate's 3s safety net before this returned —
        // on a cold phone that is the normal case, not the exception. It stashes the row template on
        // window before clearing precisely so this clone still has something to work from; without
        // the fallback, a slow ledger read would end in a permanently empty Open Orders.
        var rowT = block.querySelector('.order-row, .order-card') || window.__lxOrdTpl;
        if (!rowT) return;
        rowT = rowT.cloneNode(true);
        block.innerHTML = '';

        // CANCEL ALL FOLLOWS THE ORDERS. It lives in the section header, outside this block, so
        // emptying the block left it sitting above "No open orders on this account." offering to
        // cancel nothing. RAZA 2026-10-11: "why's it even there when I don't have any open orders".
        // Stellar hides it in exactly this branch (_walletdata.js, twice -- on render and again in
        // orderCount), which is the behaviour being matched.
        //
        // It also ships as <a href="#" id="cancelAllBtn"> with NO CLASS, so it rendered in the
        // browser's default link blue, underlined, among styled controls -- "why cancel all shown in
        // blue". Styled here rather than in a stylesheet because the element is the design's and
        // carries an id, not a class, so there is nothing to hook a rule onto that would not be
        // inventing one.
        var cah = document.getElementById('cancelAllBtn')
          || document.querySelector('.order-cancel-all,[data-cancel-all]');
        if (cah) {
          cah.style.display = offers.length ? '' : 'none';
          // Lifts the <head> gate that has been holding this hidden since the first frame. Stamped
          // here, in the same breath as the display decision, so the control can never be on screen
          // before this line has decided whether there is anything for it to cancel. With no orders
          // the display:none above keeps it hidden anyway; the attribute only ends the blanket hide.
          cah.setAttribute('data-lxca', '1');
          // -webkit-text-fill-color AS WELL AS color, because that property wins over color for the
          // rendered text and the UA sets it on a link. Measured on a fresh load: font-weight and
          // text-decoration from this very same inline style applied, and color alone did not --
          // computed color stayed rgb(0,0,238) with -webkit-text-fill-color matching it. Setting one
          // without the other leaves the anchor default-blue however loudly the color is declared.
          cah.style.color = 'var(--accent, #ea6a2c)';
          cah.style.setProperty('-webkit-text-fill-color', 'var(--accent, #ea6a2c)');
          cah.style.textDecoration = 'none';
          cah.style.fontWeight = '600';
          cah.style.fontSize = '13px';
          cah.style.cursor = 'pointer';
        }

        if (!offers.length) {
          var d = el('div', 'lx-wcnote', 'No open orders on the DEX');
          block.appendChild(d);
          reveal(block);
          return;
        }
        offers.forEach(function (x) { block.appendChild(orderRow(rowT, x)); });
        reveal(block);
      }).catch(function () {
        // A dropped read is not "no orders": say so, rather than leave the design's mock or claim none.
        var block = $('.lx-wcpanel-orders .orders-block') || $('.lx-wcpanel-orders .orders-stack')
          || $('.orders-block') || $('.orders-stack');
        if (!block) return;
        var t = block.querySelector('.order-row, .order-card');
        if (t && !window.__lxOrdTpl) window.__lxOrdTpl = t.cloneNode(true);
        block.innerHTML = '';
        block.appendChild(el('div', 'lx-wcnote', 'Could not read open orders right now.'));
        reveal(block);
      });
  }

  // ---- Activity ------------------------------------------------------------------------------------
  // The design ships thirty rows of invented transactions — "Received USDT from 0x0222…02b2",
  // "Sell 500 APT @ 0.4128" — dated today and sitting under this account's real balances. That is the
  // most dangerous thing on the page: a blank section reads as unfinished, a fabricated one reads as
  // your history. The dashboard's own activity feed was replaced for exactly this reason.
  //
  // The design's markup is reused, not replaced: a real .activity-row and .day-divider are kept as
  // templates and cloned, so every class, icon and layout stays the design's.
  // NEAR's activity is two NearBlocks lists: transactions this account signed or received (NEAR transfers,
  // contract calls, keys) and its token movements (NEP-141 events, with each token's own metadata). Token
  // events win for any transaction they cover, and a transaction that moved one token out and another in
  // is a swap -- the same shape the XRPL feed draws for a payment to self.
  var IC = {
    received: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    sent: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    swap: '<path d="M7 10l-3 3 3 3M4 13h11M17 14l3-3-3-3M20 11H9"/>',
    bridge: '<circle cx="5" cy="12" r="2.4"/><circle cx="19" cy="12" r="2.4"/><line x1="7.4" y1="12" x2="16.6" y2="12"/><polyline points="14 9.6 16.6 12 14 14.4"/>',
    lp: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    order: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };
  function actIcon(kind) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (IC[kind] || IC.swap) + '</svg>';
  }

  // The design ships thirty invented rows in this block, so every exit from the activity path has to
  // say something rather than leave them. One helper, so a new exit cannot forget the clearing half.
  function activityNote(text) {
    var b = $('.activity-block');
    if (!b) return;
    b.innerHTML = '';
    var n = el('div', 'lxp');
    n.style.cssText = 'padding:22px;text-align:center;color:var(--text-muted);font-size:13px';
    n.textContent = text;
    b.appendChild(n);
    b.setAttribute('data-lxact', '1');               // lifts the head gate (_nearwallet.js)
  }

  function addrLink(acct) {
    var a = document.createElement('a');
    a.className = 'lx-addr-link';
    a.href = EXPLORER_ACCT + encodeURIComponent(acct);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = short(acct);
    a.title = acct;
    a.setAttribute('data-logoed', '1');     // the logo engine repaints short-text elements
    return a;
  }

  // The explorer mark at the end of a row, styled as the XRPL feed's (browser/explorer.js there).
  function txLink(hash) {
    if (!hash) return null;
    if (!document.getElementById('lxn-explorer-css')) {
      var st = document.createElement('style');
      st.id = 'lxn-explorer-css';
      st.textContent = '.activity-row .lx-actlink{margin-left:12px;flex:0 0 auto;display:inline-flex;'
        + 'align-items:center;color:var(--text-muted);text-decoration:none;opacity:.45;'
        + 'transition:opacity .14s ease,color .14s ease}'
        + '.activity-row:hover .lx-actlink{opacity:1}'
        + '.activity-row .lx-actlink:hover{color:var(--accent)}';
      (document.head || document.documentElement).appendChild(st);
    }
    var a = document.createElement('a');
    a.className = 'lx-actlink';
    a.href = EXPLORER_TX + encodeURIComponent(hash);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'View this transaction on NearBlocks';
    a.setAttribute('aria-label', a.title);
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    a.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
    return a;
  }

  function tokOf(f) { return { code: f.s, logo: f.ic || (f.c === WNEAR ? NEAR_LOGO : orderLogo(f.c)) }; }

  // ---- cross-chain rows ------------------------------------------------------------------------------
  // RAZA 2026-11-10, ticket 320: a bridge out of NEAR read "Sent NEAR" and, for Omni, a second row "Contract call ·
  // storage_deposit on omni.bridge.near". Stellar's row is "Cross-chain swap · via <bridge> · <network>", the incoming
  // figure over the outgoing one (_walletdata.js mapOp, from the bridge's own record). Here, a transaction is a bridge when:
  //   * this browser recorded it (browser/nibridge.js, 'lumos.near.ni.txs'): by its hash, or for NEAR Intents by the
  //     one-time deposit address it paid. The record also knows the network and what was promised.
  //   * or the chain says so: it paid omni.bridge.near or contract.portalbridge.near (the nearbridges.js contracts),
  //     or it paid LumosCore's fee account AND a 64-hex implicit account in one go -- nibridge.js's own on-chain test
  //     for a NEAR Intents deposit. A plain transfer to an implicit account pays no fee account, so it stays "Sent".
  // Omni's first transaction (storage_deposit on omni.bridge.near, the relayer's fee) joins the transfer it paid for:
  // the next bridge row from this account within ten minutes. Alone, it stays what it is.
  // The incoming figure is shown only once the record says the transfer finished; before that it is a quote.
  var BR_OMNI = 'omni.bridge.near', BR_PORTAL = 'contract.portalbridge.near', BR_FEE = 'fees-lumoscore.near';
  // MUST MATCH NI_CHAIN in browser/nibridge.js (1Click's chain ids). Omni and Wormhole records carry the name itself.
  var BR_NET = {
    eth: 'Ethereum', arb: 'Arbitrum', base: 'Base', op: 'Optimism', pol: 'Polygon',
    avax: 'Avalanche', bsc: 'BNB Chain', scroll: 'Scroll', gnosis: 'Gnosis', bera: 'Berachain',
    monad: 'Monad', plasma: 'Plasma', xlayer: 'X Layer', abs: 'Abstract', hood: 'Hood',
    hypercore: 'Hyperliquid', sol: 'Solana', sui: 'Sui', starknet: 'Starknet',
    aptos: 'Aptos', movement: 'Movement', ton: 'TON', tron: 'Tron', cardano: 'Cardano',
    btc: 'Bitcoin', ltc: 'Litecoin', doge: 'Dogecoin', bch: 'Bitcoin Cash', dash: 'Dash',
    zec: 'Zcash', aleo: 'Aleo', fogo: 'Fogo', adi: 'ADI', stellar: 'Stellar', xrp: 'XRPL'
  };
  function bridgeRecs(me) {
    var l = [];
    try { l = JSON.parse(localStorage.getItem('lumos.near.ni.txs') || '[]'); } catch (e) {}
    return (Array.isArray(l) ? l : []).filter(function (r) { return r && r.from === me; });
  }
  function bridgeRows(me, d, list) {
    var recs = bridgeRecs(me), found = {}, store = [], fees = [];
    (d.txns || []).forEach(function (t) {
      if (t.sg !== me || !t.h) return;
      var to = t.to || [], rec = null, via = '', net = '';
      recs.forEach(function (r) {
        if (rec) return;
        if (r.hash === t.h || (r.dep && (r.dep === t.rc || to.indexOf(r.dep) >= 0))) rec = r;
      });
      if (rec) {
        via = rec.route === 'om' ? 'Omni Bridge' : (rec.route === 'wh' ? 'Wormhole' : 'NEAR Intents');
        net = rec.route ? (rec.chain || '') : (BR_NET[rec.chain] || '');
      } else if (t.rc === BR_PORTAL || to.indexOf(BR_PORTAL) >= 0) via = 'Wormhole';
      else if (t.rc !== BR_OMNI && to.indexOf(BR_OMNI) >= 0) via = 'Omni Bridge';
      else if (to.indexOf(BR_FEE) >= 0 && to.some(function (x) { return /^[0-9a-f]{64}$/.test(x); })) via = 'NEAR Intents';
      if (via) { found[t.h] = { via: via, net: net, rec: rec, ts: t.ts }; return; }
      if (t.rc === BR_OMNI && t.acts.length && t.acts.every(function (a) { return a.m === 'storage_deposit'; })) store.push(t);
      else if (to.length === 1 && to[0] === BR_FEE) fees.push(t);
    });
    // Omni's storage top-up goes with the transfer that follows it; Wormhole's fee, which cannot share the bridge's receipt
    // (nearbridges.js), with the transfer it follows. A fee paid on its own, nowhere near a bridge, keeps its row.
    var drop = {};
    function near(t, via, after) {
      Object.keys(found).forEach(function (h) {
        var f = found[h], dt = after ? t.ts - f.ts : f.ts - t.ts;
        if (f.via === via && dt >= 0 && dt < 600000) drop[t.h] = 1;
      });
    }
    store.forEach(function (t) { near(t, 'Omni Bridge', false); });
    fees.forEach(function (t) { near(t, 'Wormhole', true); });
    var out = [], done = {};
    list.forEach(function (x) {
      if (drop[x.h]) return;
      var f = found[x.h];
      if (!f) { out.push(x); return; }
      if (done[x.h]) return;
      done[x.h] = 1;
      // What left the wallet: the outgoing leg of this transaction, as the row it replaces printed it.
      var give = null;
      list.forEach(function (y) {
        if (give || y.h !== x.h) return;
        if (y.kind === 'sent' && y.tok) give = { v: y.tok.v, s: y.tok.s, c: y.tok.c, ic: y.tok.ic };
        else if (y.kind === 'sent' && y.near > 0) give = { v: y.near, s: 'NEAR', c: 'near' };
        else if (y.kind === 'swap' && y.give) give = y.give;
        else if (y.kind === 'contract' && y.near > 0) give = { v: y.near, s: 'NEAR', c: 'near' };
      });
      var r = f.rec, get = null;
      if (r && /^(SUCCESS|COMPLETED|DELIVERED)$/i.test(String(r.status || '')) && r.out != null && isFinite(+r.out) && +r.out > 0) {
        get = { v: +r.out, s: String(r.sym || '') };
      }
      out.push({ kind: 'bridge', ts: x.ts, h: x.h, ok: x.ok, via: f.via, net: f.net, give: give, get: get });
    });
    return out;
  }

  // ---- pending cross-chain claims ------------------------------------------------------------------------
  // Stellar's section above Recent Activity (_walletdata.js lxPendClaims; RAZA 2026-11-12, ticket 351), same markup and
  // classes, whose rules ship in the inherited sheet. On NEAR the only transfer that waits on its owner is a Wormhole one,
  // and the rule is the bridge page's (nibridge.js pendCandidates / pendList), from the same two sources: this browser's
  // records and /lxapi/nearbridgetx, the connected wallet's Wormhole sends not yet marked SUCCESS or FAILED, listed only
  // once Wormholescan has said READY on THIS visit. A stored status never lists a row, and a read that fails lists nothing.
  // Omni and NEAR Intents deliver by themselves: nothing to claim. No row, no section.
  var PEND_WH = {};
  // MUST MATCH whStatus in browser/nearbridges.js (not loaded on this page): the same question, answered the same way.
  function whStatus(hash) {
    return fetch('https://api.wormholescan.io/api/v1/operations?txHash=' + encodeURIComponent(hash)).then(function (r) {
      if (r.status >= 400 && r.status < 500) return {};
      if (!r.ok) throw new Error('wormholescan ' + r.status);
      return r.json();
    }).then(function (j) {
      var op = j && j.operations && j.operations[0];
      if (!op) return { status: 'PENDING' };
      var tc = op.targetChain;
      if (tc && /completed|confirmed/i.test(String(tc.status || '')) && tc.transaction && tc.transaction.txHash) return { status: 'SUCCESS' };
      if (op.vaa && op.vaa.raw) return { status: 'READY' };
      return { status: 'PENDING' };
    });
  }
  function pendCands(me) {
    var mine = bridgeRecs(me), have = {}, out = [];
    mine.forEach(function (r) {
      if (r.hash) have[r.hash] = 1;
      if (r.route === 'wh' && r.hash && r.status !== 'SUCCESS' && r.status !== 'FAILED') out.push({ hash: r.hash, out: r.out, sym: r.sym, chain: r.chain });
    });
    return fetch('/lxapi/nearbridgetx').then(function (x) { return x.json(); }).then(function (j) {
      ((j && j.ok && j.rows) || []).forEach(function (r) {
        if (!r || r.route !== 'wh' || r.from !== me || !r.hash || have[r.hash] || (r.feeTx && have[r.feeTx])) return;
        have[r.hash] = 1;
        out.push({ hash: r.hash, out: r.out, sym: r.sym, chain: r.chain });
      });
      return out;
    }, function () { return out; });
  }
  function pendClaims(me, block) {
    pendCands(me).then(function (cands) {
      return Promise.all(cands.slice(0, 12).map(function (c) {
        var p = PEND_WH[c.hash] || (PEND_WH[c.hash] = whStatus(c.hash).catch(function () { delete PEND_WH[c.hash]; return null; }));
        return p.then(function (st) { return st && st.status === 'READY' ? c : null; });
      }));
    }).then(function (rows) {
      if (addr() !== me || !document.contains(block)) return;
      [].forEach.call(block.querySelectorAll('[data-lxpend]'), function (n) { n.parentNode.removeChild(n); });
      rows = rows.filter(Boolean);
      if (!rows.length) return;
      var first = block.firstChild, dv = el('div', 'day-divider lxp', 'Pending cross-chain claims');
      dv.setAttribute('data-lxpend', '1');
      block.insertBefore(dv, first);
      rows.forEach(function (c) {
        // The bridge page opens its Pending claims tab for #pending (see the report: nibridge.js reads it).
        var a = el('a', 'activity-row lx-pendclaim');
        a.href = '/bridge/near#pending';
        a.setAttribute('data-lxpend', '1');
        a.setAttribute('data-h', c.hash);
        a.setAttribute('data-lxnonav', '1');             // the label bridge's opt-out: this is a real link
        var ic = el('div', 'activity-icon bridge');
        ic.innerHTML = actIcon('bridge');
        var info = el('div', 'activity-info');
        info.appendChild(el('div', 'type', 'Cross-chain → ' + (c.chain || 'destination chain')));
        info.appendChild(el('div', 'meta lxp lx-pcs', 'Open Bridge to claim'));
        var am = el('div', 'activity-amt');
        var n = Number(c.out);
        am.appendChild(el('div', 'a1 lxp', (isFinite(n) && n > 0 ? fmt(n, 8) + ' ' : '') + (c.sym || '')));
        am.appendChild(el('div', 'a2', 'Not claimed yet'));
        a.appendChild(ic); a.appendChild(info); a.appendChild(am);
        block.insertBefore(a, first);
      });
    });
  }

  function paintActivity(me) {
    var block = $('.activity-block');
    if (!block) return;
    var rowT = block.querySelector('.activity-row') || window.__lxnActRowT;
    var dayT = block.querySelector('.day-divider') || window.__lxnActDayT;
    if (!rowT) return;
    rowT = rowT.cloneNode(true);
    dayT = dayT ? dayT.cloneNode(true) : null;
    window.__lxnActRowT = rowT; window.__lxnActDayT = dayT;

    activityData(me).then(function (d) {
      var list = bridgeRows(me, d, entriesOf(me, d));
      if (!list.length) { activityNote('No activity on this account yet.'); return; }
      block.innerHTML = '';
      var lastDay = '';
      list.forEach(function (x) {
        var when = new Date(x.ts), day = when.toDateString();
        if (day !== lastDay && dayT) {
          lastDay = day;
          var dv = dayT.cloneNode(true);
          dv.textContent = (day === new Date().toDateString() ? 'Today · ' : '')
            + when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          dv.classList.add('lxp');
          block.appendChild(dv);
        }
        var row = rowT.cloneNode(true);
        var ico = row.querySelector('.activity-icon');
        if (ico) { ico.className = 'activity-icon ' + x.kind; ico.innerHTML = actIcon(x.kind); }

        var ty = row.querySelector('.type');
        if (ty) {
          var verb = x.kind === 'bridge' ? 'Cross-chain swap' : x.kind === 'swap' ? 'Swap' : x.kind === 'received' ? 'Received' : x.kind === 'sent' ? 'Sent' : x.label;
          ty.textContent = verb + (x.ok ? '' : ' (failed)');
          if (x.kind === 'bridge') {
            // Stellar's row carries no token mark in its title; the amounts say what moved.
          } else if (x.kind === 'swap') {
            ty.appendChild(actLogo(tokOf(x.give)));
            ty.appendChild(document.createTextNode(x.give.s + ' →'));
            ty.appendChild(actLogo(tokOf(x.get)));
            ty.appendChild(document.createTextNode(x.get.s));
          } else if (x.tok) {
            ty.appendChild(actLogo(tokOf(x.tok)));
            ty.appendChild(document.createTextNode(x.tok.s));
          } else if (x.kind !== 'contract') {
            ty.appendChild(actLogo({ native: true }));
            ty.appendChild(document.createTextNode('NEAR'));
          }
        }

        var mt = row.querySelector('.meta');
        if (mt) {
          mt.textContent = '';
          if (x.kind === 'bridge') mt.textContent = 'via ' + x.via + (x.net ? ' · ' + x.net : '');
          else if (x.kind === 'received' && x.other) { mt.textContent = 'From '; mt.appendChild(addrLink(x.other)); }
          else if (x.kind === 'sent' && x.other) { mt.textContent = 'To '; mt.appendChild(addrLink(x.other)); }
          else if (x.kind === 'contract') {
            mt.textContent = (x.method ? x.method + ' · ' : '') + (x.mine ? 'on ' : 'by ');
            if (x.other) mt.appendChild(addrLink(x.other));
          }
          mt.classList.add('lxp');
        }

        var a1 = row.querySelector('.a1');
        if (a1) {
          a1.classList.remove('up', 'down', 'swap');
          var v = null, code = '', sign = '';
          if (x.kind === 'bridge') {
            if (x.get) { v = x.get.v; code = x.get.s; sign = '+'; }
            else if (x.give) { v = x.give.v; code = x.give.s; sign = '−'; }
          } else if (x.kind === 'swap') { v = x.get.v; code = x.get.s; sign = '+'; }
          else if (x.tok) { v = x.tok.v; code = x.tok.s; sign = x.kind === 'received' ? '+' : '−'; }
          else if (x.near > 0) { v = x.near; code = 'NEAR'; sign = x.kind === 'received' ? '+' : '−'; }
          if (v != null && isFinite(v) && x.ok) {
            a1.textContent = sign + fmt(v, 6) + ' ' + code;
            a1.classList.toggle('up', x.kind === 'received');
            a1.classList.toggle('down', x.kind === 'sent' || x.kind === 'contract');
            a1.classList.toggle('swap', x.kind === 'swap' || (x.kind === 'bridge' && !!x.get));
            if (x.kind === 'bridge' && !x.get) a1.classList.add('down');
            a1.classList.add('lxp');
          } else a1.textContent = '';
        }
        var a2 = row.querySelector('.a2');
        if (a2) {
          a2.textContent = '';
          if ((x.kind === 'swap' || (x.kind === 'bridge' && x.get)) && x.ok && x.give && x.give.v != null) {
            a2.textContent = '−' + fmt(x.give.v, 6) + ' ' + x.give.s; a2.classList.add('lxp');
          }
        }
        var xl = txLink(x.h);
        if (xl) row.appendChild(xl);
        block.appendChild(row);
      });
      block.setAttribute('data-lxact', '1');
      pendClaims(me, block);
    }).catch(function (e) {
      // A refusal from the rate limit is not "no activity": it says so, and the next view asks again.
      activityNote(e && e.code === 429 ? 'Activity is busy right now — try again in a minute.'
        : 'Could not load activity for this account.');
    });
  }
  // ---- Liq Pools -----------------------------------------------------------------------------------
  //
  // RAZA 2026-09-15: "Whys it showing 2 pools when the count says 0. Also where did this APT come from."
  // The panel was the design's mock rows — APT / USDC, LUMOS / APT — and nothing ever replaced them.
  //
  // Each LP-token trust line IS a position, and its issuer is the pool's AMM account, so amm_info on it
  // gives the pair, the reserves and the LP supply; the account's share is its balance over that supply.
  // The design's own row is the template. APR and rewards have no ledger source and say so.
  function paintLpPositions(data) {
    var panel = document.getElementById('lpPanel');
    var body = panel && panel.querySelector('tbody');
    if (!body) return;
    var tpl = body.querySelector('tr');
    tpl = (tpl && tpl.children.length >= 6) ? tpl.cloneNode(true) : null;
    var pools = (data && data.pools) || [];
    function empty(text) {
      body.innerHTML = '';
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 6;
      td.style.cssText = 'padding:28px;text-align:center;color:var(--text-muted)';
      tr.appendChild(td);
      body.appendChild(tr);
    }
    // RAZA 2026-11-04: "Liq Pools 0" while treasury.lumoscore.near held all of LUMOS/wNEAR 9001. The positions are
    // lxnCore.positions (nearcore.js) -- the reader Pools -> My Pools and the account page use -- painted into the
    // design's row the way the XRPL fork fills it (Stellar's figures: share, your side of each reserve).
    var a = addr();
    if (!a || !tpl || !C.positions) { empty('No liquidity positions'); return; }
    empty('Reading your positions…');
    function setCount(n) {
      var cnt = [].filter.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) {
        return !(c.closest && c.closest('.lx-wcgroup'));
      });
      if (cnt[1]) cnt[1].textContent = String(n);
    }
    // Stellar's amt(), as the Open Orders rows above print it (RAZA 2026-11-07: match Stellar's row).
    function fmtAmt(v) { return (v == null || !isFinite(v)) ? '—' : orderAmt(v); }
    // "0.30% fee tier · NEAR AMM", Stellar's sub-line. The fee is the pool's own (total_fee, in basis points), asked of
    // the contract once per row; a pool that did not answer says only what is certain.
    function feeLine(p) {
      return C.callView('v2.ref-finance.near', 'get_pool', { pool_id: +p.id }).then(function (x) {
        p.fee = x && x.total_fee != null ? (+x.total_fee / 100).toFixed(2) + '% fee tier · ' : '';
      }, function () { p.fee = ''; });
    }
    function slug(syms) {
      return (syms || []).map(function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); })
        .filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '') || 'pool';
    }
    C.positions(a).then(function (res) {
      if (addr() !== a) return;
      var rows = res.rows || [];
      if (!rows.length) { empty(res.failed ? 'Could not read your positions — try again in a minute.' : 'No liquidity positions'); setCount(res.failed ? '—' : 0); return; }
      return Promise.all(rows.map(function (p) {
        return Promise.all(p.ids.map(function (t) { return C.tokenMeta(t).catch(function () { return null; }); }).concat(feeLine(p))).then(function (ms) {
          p.mine = p.ids.map(function (t, k) { var m = ms[k]; return m && m.d != null ? C.units(p.amounts[k], m.d) * p.fraction : null; });
          return p;
        });
      })).then(function () {
        if (addr() !== a) return;
        var mk = (window.__lxnData && window.__lxnData.held) || [];
        body.innerHTML = '';
        rows.forEach(function (p) {
          var tr = tpl.cloneNode(true), td = tr.children;
          var icos = tr.querySelectorAll('.lp-ico');
          p.ids.slice(0, 2).forEach(function (t, i) {
            var ic = icos[i];
            if (!ic) return;
            // Stellar's own mark, .lx-lpico painted from --ic with the letter in ::after: an <img> inside the design's
            // disc sat 4px smaller inside its border than the row it was being compared with.
            ic.innerHTML = '';
            ic.removeAttribute('style');
            ic.classList.add('lx-lpico');
            ic.setAttribute('data-logoed', '1');
            var held = mk.filter(function (h) { return h && h.id === t; })[0];
            // An <img> src, so the site's own /assets/ path is fine too (LUMOS's curated logo is one).
            var own = held && /^\/assets\/[\w\/.-]+$/.test(String(held.logo || '')) ? held.logo : '';
            var src = t === WNEAR ? NEAR_LOGO : (own || (held && cssUrl(held.logo)) || cssUrl((C.ICONS || {})[t]) || '');
            ic.style.setProperty('--ic', src ? 'url("' + src + '")' : hue(p.syms[i]));
            ic.setAttribute('data-l', src ? '' : String(p.syms[i] || '?').charAt(0).toUpperCase());
          });
          var nm = tr.querySelector('.lp-nm');
          if (nm) plain(nm, p.syms.join(' / '));
          var sb = tr.querySelector('.lp-sb');
          if (sb) { sb.textContent = (p.fee || '') + 'NEAR AMM' + (p.farm ? ' · farming' : ''); sb.title = 'Pool #' + p.id; }
          if (td[1]) {
            var s1 = td[1].querySelector('.p1'), s2 = td[1].querySelector('.p2');
            if (s1) s1.textContent = p.share > 0 && p.share < 0.01 ? '<0.01%' : p.share.toFixed(2) + '%';
            // Stellar's "5.77 LP tokens" (RAZA 2026-11-07, ticket 299): Rhea's classic and stable shares carry 24 decimals.
            // The dollars stay on hover. An order-book position has no LP token, so no line.
            var lpv = p.lp ? C.units(p.lp, 24) : 0;
            if (s2) {
              s2.textContent = lpv > 0 ? orderAmt(lpv) + ' LP tokens' : '';
              s2.title = p.usd != null ? '≈ $' + p.usd.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
            }
          }
          if (td[2]) { td[2].textContent = '—'; td[2].title = 'Rhea does not publish a per-position APR'; }
          if (td[3]) {
            var q1 = td[3].querySelector('.p1'), q2 = td[3].querySelector('.p2');
            if (q1) {
              q1.textContent = fmtAmt(p.mine[0]) + ' ';
              var un = el('span', null, p.syms[0]);
              un.style.cssText = 'color:var(--text-soft);font-size:14px';
              un.setAttribute('data-logoed', '1');
              q1.appendChild(un);
            }
            if (q2) q2.textContent = p.mine.length > 1 ? fmtAmt(p.mine[1]) + ' ' + p.syms[1] : '';
          }
          if (td[4]) {
            var r1 = td[4].querySelector('.p1'), r2 = td[4].querySelector('.p2');
            if (r1) { r1.textContent = '—'; r1.style.color = ''; }
            if (r2) r2.textContent = 'fees accrue into the pool';
          }
          var href = '/pools/near/' + slug(p.syms) + '/' + encodeURIComponent(p.id);
          // THE ROW OPENS ITS POOL (RAZA 2026-11-07), as Stellar's does; claimRowActions leaves its buttons alone.
          tr.setAttribute('data-pool', String(p.id));
          tr.setAttribute('data-lxgo', href);
          tr.style.cursor = 'pointer';
          var btns = tr.querySelectorAll('.qa-row-btn');
          if (btns[0]) { btns[0].innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add'; btns[0].setAttribute('data-lxgo', href); }
          if (btns[1]) { btns[1].innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg> Remove'; btns[1].setAttribute('data-lxgo', href + '?act=withdraw'); }
          if (btns[2]) {
            btns[2].setAttribute('data-lxpmenu', String(p.id));
            btns[2].setAttribute('data-lxphref', href);
            btns[2].removeAttribute('data-lxexp');
            btns[2].title = '';
            btns[2].setAttribute('aria-label', 'Pool actions');
          }
          body.appendChild(tr);
        });
        setCount(rows.length);
      });
    }).catch(function () {
      if (addr() !== a) return;
      empty('Could not read your positions — try again in a minute.');
      setCount('—');
    });
  }
  // ---- the My Assets search ------------------------------------------------------------------------
  // Stellar's lxAssetFilter (RAZA 2026-11-07: searching "XRP" left GEAR / NEARLY on screen). It lived in lx-walletdata,
  // stripped here, and the design's own wiring filters only its data-target, the assets table, so Liq Pools had none.
  // Rows match on the identity cell alone: the whole row would match "1" in every figure. The observer is Stellar's
  // too: these tables are rewritten by the painters, which drops the inline display set here.
  function assetFilter() {
    var box = $('.search-box.inline-filter'), inp = box && $('input', box);
    if (!inp || inp.__lxnf) return;
    inp.__lxnf = 1;
    function bodyOf(t) { return t.querySelector('tbody') || t; }
    function rowsOf(t) { var r = t.querySelectorAll('tbody tr'); return r.length ? r : t.querySelectorAll(':scope > tr'); }
    function apply() {
      var q = (inp.value || '').trim().toLowerCase();
      ['#assetsTable', '#lpPanel'].forEach(function (sel) {
        var t = $(sel);
        if (!t) return;
        var rows = rowsOf(t), shown = 0;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (r.getAttribute('data-lxempty')) continue;
          var cell = r.querySelector('td');
          var hit = !q || ((cell || r).textContent || '').toLowerCase().indexOf(q) >= 0;
          r.style.display = hit ? '' : 'none';
          if (hit) shown++;
        }
        var tb = bodyOf(t), msg = tb.querySelector('tr[data-lxempty]');
        if (q && !shown) {
          if (!msg) {
            msg = document.createElement('tr');
            msg.setAttribute('data-lxempty', '1');
            var td = el('td');
            td.colSpan = 12;
            td.style.cssText = 'padding:22px 14px;text-align:center;color:var(--text-muted);font-size:13px';
            msg.appendChild(td);
            tb.appendChild(msg);
          }
          msg.firstChild.textContent = 'No asset matches “' + inp.value.trim() + '”.';     // typed text, never markup
          msg.style.display = '';
        } else if (msg) msg.style.display = 'none';
      });
    }
    inp.addEventListener('input', apply);
    ['#assetsTable', '#lpPanel'].forEach(function (sel) {
      var t = $(sel), tb = t && bodyOf(t);
      if (!tb) return;
      try { new MutationObserver(function () { if ((inp.value || '').trim()) apply(); }).observe(tb, { childList: true }); } catch (e) {}
    });
  }

  // ---- the hero chart ------------------------------------------------------------------------------
  //
  // WHAT IT PLOTS: XRP/USD over the chosen timeframe. Not the account's portfolio value — and that is
  // not a shortcut, it is what lumoscore.com draws in the same box. Its wallet fetches CoinGecko's
  // `coins/stellar/market_chart` and plots XLM/USD; the comment beside its hidden 7-day delta says
  // why — "no portfolio history feed". Neither ledger publishes a balance series, so a true portfolio
  // curve would mean replaying every transaction on the account. This is the Stellar chart with
  // `stellar` swapped for `ripple`, served through /lxapi/xrplchart.
  //
  // This box previously carried my own note reading "Portfolio history is not available yet." That
  // was honest but it was not the page main ships, and it is now gone.
  //
  // EVERY CLASS BELOW IS INHERITED. `.lx-chartskel`, `.lx-carea`, `.lx-cbase`, `.lx-cline`,
  // `.lx-chart-none`, `.lx-cx`, `.lx-cd`, `.lx-ctip` and the two gates `#heroChart:not(.lx-chart-ready)
  // {visibility:hidden}` / `.chart-axis:not(.lx-axis-ready){visibility:hidden}` all came across with
  // the fork — the stylesheet survived and only the script that used it was stripped. So nothing here
  // adds CSS; it raises the gates the design already has and fills the shapes it already styles.
  // The SVG is built to match the live one exactly: viewBox 0 0 600 100, a `lxhc` gradient, an area
  // path and a 1.6px line.
  var CHART_TF = '1W';                       // the design ships 1W pre-selected
  var CHART_GEN = 0;                         // guards against a slow response for an abandoned tab

  // NEAR/USD from CoinGecko, asked from the browser (CoinGecko refuses Cloudflare's egress; Stellar's
  // wallet asks for XLM the same way). Cached per timeframe for the session, so switching tabs back and
  // forth costs nothing. Resolves { ok, pts: [[ms, usd], ...] } in the shape the XRPL chart endpoint used.
  var CG_DAYS = { '1D': 1, '1W': 7, '1M': 30, '1Y': 365, 'ALL': 'max' };
  function nearSeries(tf) {
    var key = 'lxn.nearchart.' + tf, ttl = tf === '1D' ? 300000 : 1800000;
    try {
      var c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && Date.now() - c.t < ttl && c.pts && c.pts.length > 1) return Promise.resolve({ ok: true, pts: c.pts });
    } catch (e) {}
    return fetch('https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=' + (CG_DAYS[tf] || 7))
      .then(function (r) { if (!r.ok) throw new Error('coingecko ' + r.status); return r.json(); })
      .then(function (j) {
        var raw = (j && j.prices) || [], pts = [], step = Math.max(1, Math.floor(raw.length / 240));
        for (var i = 0; i < raw.length; i += step) if (raw[i] && raw[i][1] > 0) pts.push([+raw[i][0], +raw[i][1]]);
        var last = raw[raw.length - 1];
        if (last && pts.length && pts[pts.length - 1][0] !== +last[0]) pts.push([+last[0], +last[1]]);
        if (pts.length > 1) { try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), pts: pts })); } catch (e) {} }
        return { ok: pts.length > 1, pts: pts };
      });
  }
  function chartHost() { return document.getElementById('heroChart'); }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Matched to Stellar's tfLbl(), and the year format is the reason this is not just toLocaleDateString.
  // `{month:'short',year:'2-digit'}` renders August 2022 as "Aug 22", which on an axis sitting beside
  // "Aug 27" and "Sep 3" reads as the 22nd of August. The ALL axis came out "Jun 18 | Jul 20 | Aug 22 |
  // Aug 24 | Today" — five day-of-month labels spanning eight years. The apostrophe is what separates
  // a year from a date, and main already writes it that way.
  function tfLabel(t, tf) {
    var d = new Date(t);
    if (tf === '1D') return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00';
    if (tf === '1Y' || tf === 'ALL') return MON[d.getMonth()] + ' ’' + String(d.getFullYear()).slice(2);
    return MON[d.getMonth()] + ' ' + d.getDate();
  }

  function chartSkeleton(host) {
    // The design's own loading shape, animated by `.lx-cline`'s inherited keyframes.
    host.innerHTML = '<div class="lx-chartskel"><svg viewBox="0 0 300 90" preserveAspectRatio="none">'
      + '<path class="lx-carea" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22 300,90 0,90Z"></path>'
      + '<path class="lx-cbase" pathLength="100" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22"></path>'
      + '<path class="lx-cline" pathLength="100" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22"></path>'
      + '</svg></div>';
    host.classList.add('lx-chart-ready', 'lx-chart-loading');
  }

  function chartNone(host, msg) {
    host.innerHTML = '';
    var d = el('div', 'lx-chart-none', msg);
    host.appendChild(d);
    host.classList.add('lx-chart-ready');
    host.classList.remove('lx-chart-loading');
  }

  function drawChart(host, pts, tf) {
    var W = 600, H = 100;
    var lo = pts[0][1], hi = pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    // A perfectly flat series has no range to scale into; centre it rather than divide by zero.
    var span = hi - lo;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    var tspan = (t1 - t0) || 1;

    var line = '', xs = [], ys = [];
    for (var j = 0; j < pts.length; j++) {
      var x = ((pts[j][0] - t0) / tspan) * W;
      var y = span > 0 ? (H - 9) - ((pts[j][1] - lo) / span) * (H - 18) : H / 2;
      xs.push(x); ys.push(y);
      line += (j ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';

    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%"'
      + ' height="100%" style="display:block">'
      + '<defs><linearGradient id="lxhc" x1="0" x2="0" y1="0" y2="1">'
      + '<stop offset="0%" stop-color="#ea6a2c" stop-opacity="0.28"></stop>'
      + '<stop offset="100%" stop-color="#ea6a2c" stop-opacity="0"></stop>'
      + '</linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#lxhc)"></path>'
      + '<path d="' + line + '" fill="none" stroke="#ea6a2c" stroke-width="1.6"'
      + ' stroke-linecap="round" stroke-linejoin="round"></path>'
      + '</svg>';

    host.classList.add('lx-chart-ready');
    host.classList.remove('lx-chart-loading');

    // The axis spans are the design's five; only their text changes. Last one reads "Today" as it
    // does on main.
    var axis = $('.chart-axis');
    if (axis) {
      var sp = axis.querySelectorAll('span');
      for (var k = 0; k < sp.length; k++) {
        var frac = sp.length > 1 ? k / (sp.length - 1) : 1;
        sp[k].textContent = (k === sp.length - 1) ? 'Today' : tfLabel(t0 + tspan * frac, tf);
      }
      axis.classList.add('lx-axis-ready');
    }

    var mini = $('.timeframe-mini');
    if (mini) {
      var map = { '1D': 'past 24 hours', '1W': 'past 7 days', '1M': 'past 30 days', '1Y': 'past year', 'ALL': 'all-time' };
      mini.textContent = map[tf] || '';
    }

    chartHover(host, pts, xs, ys, tf);
  }

  // Scrub-to-read, using the three elements the inherited stylesheet already dresses: a vertical
  // rule, a dot and a tooltip. Rebuilt with the chart so it can never point at a stale series.
  function chartHover(host, pts, xs, ys, tf) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var cx = el('div', 'lx-cx'), cd = el('div', 'lx-cd'), tip = el('div', 'lx-ctip');
    cd.style.background = '#ea6a2c';
    host.appendChild(cx); host.appendChild(cd); host.appendChild(tip);

    function show(e) {
      var r = host.getBoundingClientRect();
      if (!r.width) return;
      var px = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - r.left;
      var frac = Math.max(0, Math.min(1, px / r.width));
      // Nearest point by x, so the readout is a real sample and never an interpolation.
      var idx = 0, best = Infinity;
      for (var i = 0; i < xs.length; i++) {
        var d = Math.abs(xs[i] / 600 - frac);
        if (d < best) { best = d; idx = i; }
      }
      var lx = (xs[idx] / 600) * r.width, ly = (ys[idx] / 100) * r.height;
      cx.style.left = lx + 'px';
      cd.style.left = lx + 'px'; cd.style.top = ly + 'px';
      tip.style.left = Math.max(38, Math.min(r.width - 38, lx)) + 'px';
      tip.style.top = ly + 'px';
      tip.innerHTML = '';
      tip.appendChild(document.createTextNode(usdPrice(pts[idx][1])));
      var sub = el('span', 'lx-ctd', fullWhen(pts[idx][0], tf));
      tip.appendChild(sub);
      cx.style.opacity = '1'; cd.style.opacity = '1'; tip.style.opacity = '1';
    }
    function hide() { cx.style.opacity = '0'; cd.style.opacity = '0'; tip.style.opacity = '0'; }

    host.addEventListener('mousemove', show);
    host.addEventListener('mouseleave', hide);
    host.addEventListener('touchstart', show, { passive: true });
    host.addEventListener('touchmove', show, { passive: true });
    host.addEventListener('touchend', hide);
  }

  // XRP has traded under a dollar for most of its life and is quoted to four decimals everywhere
  // that matters, so the wallet's own 2dp money format would flatten the whole series to "$0.74".
  function usdPrice(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
    if (v >= 1) return '$' + v.toFixed(3);
    return '$' + v.toFixed(4);
  }

  // The tooltip has room for the unabbreviated form, so it always carries the year — no reader should
  // have to work out which August a point belongs to.
  function fullWhen(t, tf) {
    var d = new Date(t);
    var day = MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    if (tf !== '1D') return day;
    return day + ' · ' + (d.getHours() < 10 ? '0' : '') + d.getHours()
      + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function loadChart(tf) {
    var host = chartHost();
    if (!host) return;
    CHART_TF = tf;
    var gen = ++CHART_GEN;
    chartSkeleton(host);

    nearSeries(tf)
      .then(function (d) {
        if (gen !== CHART_GEN) return;                   // a later tab won the race
        if (!d || !d.ok || !d.pts || d.pts.length < 2) {
          chartNone(host, 'Price history unavailable right now');
          return;
        }
        drawChart(host, d.pts, tf);
      })
      .catch(function () {
        if (gen !== CHART_GEN) return;
        chartNone(host, 'Price history unavailable right now');
      });
  }

  // The design's own tab buttons. Its listeners are gone — the block they lived in is made to bail
  // at build time, because the same function drew a Math.random() series — so the active state is
  // driven here too.
  function wireChart() {
    var host = chartHost();
    if (!host || host.getAttribute('data-lxch') === '1') return;
    host.setAttribute('data-lxch', '1');

    var btns = document.querySelectorAll('.tf-row .tf-btn');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          var tf = (b.textContent || '').trim().toUpperCase();
          for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('active', btns[j] === b);
          loadChart(tf);
        });
      })(btns[i]);
    }

    var active = document.querySelector('.tf-row .tf-btn.active');
    loadChart(active ? (active.textContent || '').trim().toUpperCase() : '1W');
  }

  // THE MONEY DIALOGS CARRY THE DESIGN'S BALANCES, AND ONLY ONE OF THEM GETS REWRITTEN.
  //
  // write.js sets `.field-label .meta` for the FROM field only — by design, it is the field a MAX
  // button reads. Every other one keeps what the template shipped, and the template's numbers are
  // another chain's: measured in the Send dialog, "Balance: 25,420.18 APT" and
  // "Balance: 4,200.00 USDC" sat beside the real "Balance: 0.923838 XRP".
  //
  // Hidden today, because the picker currently offers only XRP. That is not a reason to leave them:
  // a wrong balance inside a dialog that moves money is one selector change away from being read,
  // and this project has already shipped mock that was invisible right up until it was not.
  //
  // Blanked, not deleted, and blanked at LOAD so write.js still fills in the ones it owns whenever
  // a dialog opens — the design's element stays exactly where the layer expects to find it.
  function clearMockBalances() {
    // querySelectorAll directly: this file defines `$` and NOT `$$`. Written as `$$` first, which
    // `node -c` accepts happily — it is a runtime reference, not a syntax error — and it would have
    // thrown inside load() and taken the whole wallet page down with it.
    [].forEach.call(document.querySelectorAll('.field-label .meta'), function (m) {
      if (/Balance:/i.test(m.textContent || '')) m.textContent = 'Balance: —';
    });
  }

  // THE BALANCE READ IS NO LONGER GATED ON WALLET MARKUP, and that split is what lets the Custom
  // Swap dialog work off this page.
  //
  // `write.js` — Send, Swap, Trustlines, the signing paths — reads `window.__lxnData` for balances
  // and for the asset it is allowed to offer. That object was published inside a function which
  // returned immediately unless the page had `#assetsTable` / `#assetList`, so on any page that is
  // not the wallet, write.js loaded with no balances and every field it fills stayed empty. The
  // dashboard carries the same `#modalSwap` markup and could never have driven it.
  //
  // So the read runs whenever an address is connected, and only the PAINTING is gated on `h`. The
  // wallet page behaves exactly as before — same calls, same order — and any other page carrying a
  // dialog gets the data it needs without a second copy of this logic.
  function load() {
    var h = host();
    if (h) {
      lift();
      // The chart is NEAR's price, not this account's, so it is valid with no wallet connected.
      wireChart();
      clearMockBalances();
      assetFilter();
    }

    var a = addr();
    if (!a) {
      if (h) note(h, 'Connect a NEAR wallet to see your balances.');
      activityNote('Connect a NEAR wallet to see its activity.');
      return;
    }

    if (h) note(h, 'Reading your NEAR account…');

    C.readHoldings(a).then(function (data) {
        window.__lxnData = data;
        try { window.dispatchEvent(new CustomEvent('lxn:walletdata')); } catch (e2) {}

        if (!h) return;                                    // data only — nothing here to paint
        paint(data);
        buildTabs();
        setMeta(data.held.length, data.pools.length, data.near);
        paintActivity(a);
        paintOrders(a);
        paintLpPositions(data);
        applyPins();
        // A repaint (after a Send) rebuilds the rows blank; the prices already in hand go straight back on.
        try { if (window.__lxnPricesApply) window.__lxnPricesApply(); } catch (e3) {}
    }).catch(function (e) {
      var gone = e && (e.code === 'UNKNOWN_ACCOUNT' || /UNKNOWN_ACCOUNT|does not exist/i.test(e.message || ''));
      activityNote(gone ? 'No activity on this account yet.' : 'Could not load activity for this account.');
      if (!h) return;
      if (gone) { note(h, 'This account does not exist on NEAR yet.'); return; }
      note(h, 'Could not read your NEAR account — ' + ((e && e.message) || 'try again'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxnReload = load;
})();
