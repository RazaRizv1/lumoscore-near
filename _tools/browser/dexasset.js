// NEAR Trade-Asset page (/trade/near/<contract id>). PORTED FROM the XRPL fork's
// _tools/browser/dexasset.js (2026-10-21) and kept structurally parallel, so a fix to one can be carried
// to the other. The long dated notes below are that file's history and describe the XRP Ledger build
// where they name it; the behaviour they protect -- lift() and the design's no-flash gates, the
// transition safety net, cellByLabel/setCell, the chart and its hover, the tab counts, the logo-healer
// opt-outs (data-logoed, an empty data-logo child, an svg/img child) -- is the same design and applies
// here unchanged. xrp()/xrpPx() format the NATIVE unit, which is NEAR on this build; the names are the
// XRPL file's so the two diff cleanly.
//
// WHAT IS NEAR'S (phase 1):
//   identity, price, volume, supply, pools, curated tick, lock  /lxapi/neartoken (one call, edge-cached;
//            a curated token's market figures are the Trade table's own row, so the two pages agree)
//   chart + price-change row  CoinGecko market_chart for a curated token with a CoinGecko id, re-priced
//            in NEAR by NEAR's own series; otherwise GeckoTerminal OHLCV on the token's largest wNEAR
//            pool. Both FROM THE BROWSER: they answer 429 to Cloudflare. Cached in localStorage.
//   NO NEAR SOURCE YET: order book (Rhea DCL, later), exchanges, holders, my trades, swap/limit
//            execution. Those show the design's own empty state or an em dash -- never the design's
//            Aptos mock and never Stellar's data.
// Trade-Asset page: one XRP Ledger token.
//
// REPLACES THE MOST VISIBLY WRONG PAGE ON THE SITE. `lx-dxadata` ignored the token in the URL
// entirely and rendered Stellar LUMOS: 105 mentions of XLM and 124 Stellar addresses, under a title
// reading "LUMOS price, pools and holders on Stellar". It was reached by clicking any row in the
// XRP Ledger market table, so the better the Trade page got, the more people it sent here.
//
// Two sources, on purpose:
//   token details  /lxapi/xrpltoken  -- proxied and cached (333 upstream requests per DAY per IP)
//   ORDER BOOK     the XRP Ledger itself, via book_offers, straight from the browser. No rate limit
//                  worth proxying for, no third party to trust, and a book should be as live as the
//                  ledger. It is also the one number here nobody has to take on faith.
(function () {
  if (window.__lxnDexAsset) return;
  window.__lxnDexAsset = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // SUBSCRIPT ZEROS for the very small (RAZA 2026-09-15: "instead of 0.00000000000000000070 just use subscript notation"):
  // 0.0₁₈70 — the subscript counts the zeros after the decimal point, then four significant digits.
  function subZero(v) {
    var ex = v.toExponential(3).split('e');
    var zeros = -parseInt(ex[1], 10) - 1;
    var m = ex[0].replace('.', '').replace(/0+$/, '');
    if (m.length < 2) m += '0';
    var SUB = '₀₁₂₃₄₅₆₇₈₉';
    return '0.0' + String(zeros).split('').map(function (ch) { return SUB.charAt(+ch); }).join('') + m;
  }

  function xrp(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    if (v > 0 && v < 1e-8) return subZero(v);
    // Plain decimals at any size, as lumoscore.com prints prices — never "7.64e-12" (RAZA 2026-09-15).
    if (v > 0 && v < 0.000001) return v.toFixed(Math.min(20, Math.ceil(-Math.log10(v)) + 3));
    if (v < 1) return v.toPrecision(dp || 5);
    return v.toLocaleString('en-US', { maximumFractionDigits: dp || 4 });
  }

  // A PRICE IS SIZED BY ITS MAGNITUDE, NOT BY A FIXED NUMBER OF DECIMALS.
  //
  // The price surfaces all passed dp:6, which means six decimals on a five-figure number: BTC read
  // "58,964.239979 XRP" in a headline 259px wide inside a 375px phone. RAZA 2026-10-11: "In price,
  // don't add too many decimals otherwise it will go out of the box like now. See what logic we used
  // on mobile on stellar. Use the same logic."
  //
  // This IS Stellar's logic -- xlmAmt in _dexassetdata.js, ladder for ladder: a thousand or more is a
  // whole number with separators, because the hundredths of an XRP on a 58,964 price are noise; one
  // and up keeps four places and drops trailing zeros; below one hands back to xrp(), which already
  // owns this build's small-number conventions including the subscript run below 1e-8.
  //
  // xrp() itself is left alone -- twenty call sites, and several (1372, 1751, 1795) already do this
  // same ">= 1000 ? amount : xrp" test by hand. The ladder is named once here instead.
  // SUBSCRIPT ZERO-RUNS, the same notation Stellar uses (RAZA 2026-10-17: "if the price is something
  // like 0.000006891 XRP, so you can use subscript notation").
  //
  // Ported from _dexassetdata.js rather than reinvented, so a price reads identically on both
  // chains: 0.000006891 becomes 0.0(5)6891, which is seven characters instead of eleven and loses
  // nothing. The threshold is FIVE leading zeros, not four -- 0.000324 spelled out is eight
  // characters and perfectly readable, and compressing something that already fits only makes it
  // harder to read.
  //
  // Half a price is worse than a compressed one: in a column this narrow the long form truncates,
  // and nobody can tell 0.0000324 from 0.0000009 by its first four characters.
  var SUBD = String.fromCharCode(8320, 8321, 8322, 8323, 8324, 8325, 8326, 8327, 8328, 8329);
  function zsub(n) { var s = String(n), o = ''; for (var i = 0; i < s.length; i++) o += SUBD.charAt(+s.charAt(i)); return o; }
  function trimZ(t) {
    while (t.length > 1 && t.charAt(t.length - 1) === '0') t = t.slice(0, -1);
    if (t.charAt(t.length - 1) === '.') t = t.slice(0, -1);
    return t;
  }
  function smallNum(x, sig) {
    x = +x || 0; if (!(x > 0)) return '0';
    var e = x.toExponential((sig || 4) - 1), i = e.indexOf('e');
    if (i < 0) return String(x);
    var mant = trimZ(e.slice(0, i)).split('.').join(''), exp = -parseInt(e.slice(i + 1), 10);
    if (exp >= 5) return '0.0' + zsub(exp - 1) + mant;
    if (x >= 1e-8) return trimZ(x.toFixed(8));
    if (!(exp > 1)) return trimZ(x.toFixed(8));
    return '0.0' + zsub(exp - 1) + mant;
  }

  // THE ZERO COUNT HAS TO SIT LOWER THAN THE DIGITS AROUND IT (RAZA 2026-10-17: "the subscript
  // notation number should be a bit below so that there's no confusion"). U+2085 is a subscript by
  // name, but JetBrains Mono has no glyph for it, so the browser substitutes from a fallback face
  // and it lands near mid-height -- in 0.0(5)6892 the 5 then reads as part of the number instead of
  // a count of the zeros before it, which is precisely the confusion the notation exists to avoid.
  //
  // So the count is wrapped and shifted in CSS rather than trusted to the font. Returns HTML, which
  // is why it is separate from xrpPx: every other caller writes through textContent and must keep
  // getting a plain string.
  // A LOCAL ESCAPER, because this file has none. The first version called esc(), which exists in
  // other layers and not in this one -- a bare name that parses fine and throws the moment a price
  // is formatted. node --check cannot see it; only running it can.
  function pxEsc(s2){ return String(s2).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function pxHtml(v) {
    var t = xrpPx(v);
    var i = t.indexOf('0.0');
    if (i !== 0) return pxEsc(t);
    var out = '', run = '';
    for (var k = 0; k < t.length; k++) {
      var c = t.charCodeAt(k);
      if (c >= 8320 && c <= 8329) { run += String.fromCharCode(48 + (c - 8320)); continue; }
      if (run) { out += '<span class="lx-zsub">' + run + '</span>'; run = ''; }
      out += pxEsc(t.charAt(k));
    }
    if (run) out += '<span class="lx-zsub">' + run + '</span>';
    return out;
  }

  // The phone row's own rules, injected once. The design's .ex-row is a four-column grid
  // ("24px 1fr 70px auto"), so the explorer anchor became a fifth child with no column and dropped
  // to its own line under every row -- RAZA: "why the explorer link icon dropped down". Stellar
  // solved this the same way and its comment says so outright; this is that rule, for this grid.
  function exRowCss() {
    if (document.getElementById('lx-exrow-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-exrow-css';
    st.textContent =
      '#mdxaExList .ex-row[data-lxex]{grid-template-columns:24px 1fr auto auto 16px}'
      // Real amounts run longer than the mock's "18 USDC"; the design's fixed 70px column wrapped
      // them and left rows at uneven heights, which is the other half of what looked like breakage.
      + '#mdxaExList .ex-row[data-lxex] .ex-num{white-space:nowrap;text-align:right}'
      + '#mdxaExList .ex-row[data-lxex] .ex-num .sub{display:block;white-space:nowrap}'
      + '.lx-exlink{display:inline-flex;align-items:center;justify-content:center;color:var(--text-soft,#8a8fa3)}'
      + '.lx-zsub{font-size:.72em;vertical-align:-.32em;line-height:1;padding-left:.5px}';
    (document.head || document.documentElement).appendChild(st);
  }

  // THE TRADE FEED CUTS AT THREE DECIMALS AND SAYS SO (RAZA 2026-10-17: "instead of writing for
  // eg (0.1000000 or 0.01922361 etc), show it like on Stellar for eg 0.010..").
  //
  // Seven decimals spend the widest cell in the row on precision nobody reads in a trade list, and
  // it is what pushed these lines onto three rows. Two dots say the figure continues rather than
  // letting the reader believe it ended there -- and they appear ONLY when something was actually
  // dropped, so an exact 0.5 stays "0.5". Ported from Stellar so the two feeds read alike.
  //
  // Below a thousandth three decimals would round the number away entirely, so the leading-zero
  // compression takes over there instead and keeps every digit.
  function tradeNum(n) {
    n = +n || 0; var a = Math.abs(n);
    // amount() only abbreviates from a million up, so a four-figure trade came out "1,234.5" where
    // Stellar's abbrNum says "1.2K" -- three characters wider, in the column that was already
    // overflowing. Take the thousands band here and hand everything above it to amount(), which
    // agrees with abbrNum from 1e6 on.
    if (a >= 1e6) return amount(n);
    if (a >= 1000) return (n / 1000).toFixed(1) + 'K';
    // Above a unit, Stellar's qtyTxt rounds to two places and does NOT add the dots -- "123.46", not
    // "123.456..". Two decimals is already the whole readable part of a figure that size, so there is
    // nothing dropped worth announcing. Keeping the dots here is what made the XRPL rows wider than
    // Stellar's for the same trade.
    if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (a >= 0.001) { var t = n.toFixed(3); return (Math.abs((+t) - n) < 1e-12) ? String(+t) : (t + '..'); }
    return (n < 0 ? '-' : '') + smallNum(a, 4);
  }

  function xrpPx(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    if (v >= 1) return String(+v.toFixed(4));
    if (v > 0) return smallNum(v, 4);
    return '0';
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e18) return (v / 1e18).toFixed(2) + 'Qi';
    if (v >= 1e15) return (v / 1e15).toFixed(2) + 'Qa';
    if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    // A unit is chosen by what the figure ROUNDS to: 999,999,999 read "1000.00M" under a 1e9 cut.
    if (v >= 9.995e8) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    // A TRADE OF 0.00132 ATOM IS NOT "0" (seen on the exchanges rows 2026-09-16: "0 ATOM · 1 XRP"). Two decimal places
    // rounded every small holding to zero, so the AMOUNT column denied that the trade had a size at all.
    if (v > 0 && v < 0.01) return v < 1e-8 ? subZero(v) : String(Number(v.toPrecision(4)));
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // THE HEADLINE STATS COMPACT FROM A THOUSAND, NOT FROM A MILLION (RAZA 2026-10-06: "Now on
  // Trade-Asset page, in Volume and Market cap, please use K,M,B etc, just like on Stellar").
  //
  // amount() already had M, B, T, Qa and Qi, all at two decimals — the ladder simply had no K, so
  // anything between a thousand and a million printed in full: "26,422.66 XRP" and "633,891.84 XRP"
  // beside a supply reading "5.33B". One box switching conventions.
  //
  // The K step is ONE DECIMAL, which is not a guess: lumoscore.com's AQUA page reads "129.8K XLM" for
  // 24h Volume and "80.05B AQUA" for supply, so its ladder is K→1dp, M→2dp, B→2dp. amount() already
  // matches above a million; this completes it below.
  //
  // SEPARATE FROM amount(), because amount() also formats the trades table, where a fill of 1,234 ATOM
  // should stay 1,234 rather than become "1.2K" — the AMOUNT column there is a quantity to read, not a
  // magnitude to skim. Only the four headline cells call this.
  function statAmt(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e3 && v < 1e6) return (v / 1e3).toFixed(1) + 'K';
    return amount(v);
  }

  // ---- the token in the URL --------------------------------------------------------------------
  // /trade/near/<contract id>. A NEAR contract id is a whole account id -- lowercase, dot/dash/underscore
  // separated, or a 64-hex implicit account -- so the last path segment IS the identity; there is no
  // code/issuer pair to split. The built file opened directly (/near/lumoscore-dex-asset-mobile) has no
  // id in its path, so ?asset= (or ?i=) names the token instead.
  var ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
  function isId(v) { return ID_RE.test(String(v || '')); }
  function shortId(id) {
    id = String(id || '');
    return id.length > 24 ? (id.slice(0, 6) + '…' + id.slice(-4)) : id;
  }
  function fromUrl() {
    var q = null;
    try { var sp = new URLSearchParams(window.location.search); q = sp.get('asset') || sp.get('i'); } catch (e) {}
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    var raw = q || '';
    if (!raw) { try { raw = decodeURIComponent(parts[parts.length - 1] || ''); } catch (e) { raw = ''; } }
    raw = String(raw).trim().toLowerCase();
    if (!isId(raw) || /^lumoscore-/.test(raw)) return null;
    // code is the label used until the contract's own symbol arrives.
    return { id: raw, code: shortId(raw) };
  }

  var NEAR_LOGO = '/assets/networks/near.png';
  var WNEAR = 'wrap.near';

  // The design gates the book behind a class its old script set once it had data:
  //     #dxaObAsks:not(.lxda) .dxa-ob-row { visibility: hidden }
  // The style block (lx-dxa-css) is a separate element and survives stripping the script, so without
  // this the rows are laid out with correct prices and never appear. Fourth gate of this exact shape
  // in this project; assume every replaced section has one until checked.
  // There are TWO on this page, not one -- the stat row is gated separately from the book:
  //     #dxaObAsks:not(.lxda) .dxa-ob-row            { visibility: hidden }
  //     .stat-row:not(.lxda) .val, ... .sub          { visibility: hidden }
  // The second was found only because a screenshot disagreed with the DOM: every stat cell read back
  // with the right text and computed visibility:hidden. Reading values out of the DOM would have
  // called this page finished while it showed six blank cards.
  // THE POOLS AND HOLDERS TABS SHOWED THE DESIGN'S MOCK FIRST (RAZA 2026-09-15: "There's a flash bug on Trade-Asset → Pools
  // tab. It shows this for split second" — USDC / APT, APR, "Add liquidity"). The design writes its sample table whenever a
  // tab opens; it stays hidden until this token's rows are in it, the same gate shape as the rest of this page.
  (function () {
    if (document.getElementById('lxx-dxa-tabgate')) return;
    var st = document.createElement('style');
    st.id = 'lxx-dxa-tabgate';
    st.textContent = '.dxa-tab-extra.dxa-pools:not(.lxda) .dxa-pl-head,.dxa-tab-extra.dxa-pools:not(.lxda) table,'
      + '.dxa-tab-extra.dxa-holders:not(.lxda) table,.dxa-tab-extra.dxa-holders:not(.lxda) .dxa-hl-stat .val,'
      + '.dxa-tab-extra.dxa-holders:not(.lxda) .dxa-hl-pgn{visibility:hidden}'
      // THE PHONE HAD NO GATE AT ALL. Every selector above names the DESKTOP classes, and the mobile
      // build renders different containers entirely -- .mdxa-tab-extra, .mdxa-pools, .mdxa-pl-list --
      // so none of them matched and the design's mock sat there in full view until our paint landed.
      // RAZA 2026-10-11: "There's possibly a flash bug in trade-asset (pools tab). I noticed it
      // showed Aptos for split seconds when I switched to this tab." The mock it was showing is in
      // the served markup: Pools 7, TVL $7.76M, 24h vol $1.63M, over Aptos pairs.
      //
      // The same omission covers the holders tab, which is the other panel he reported as breaking
      // on the phone -- same mock, same missing gate, one tab across.
      // A SEPARATE RULE, not a comma after the block above. Appending ",.mdxa-..." straight after
      // "{visibility:hidden}" produces a selector list following a declaration block, which is not
      // CSS: the browser drops the whole thing and the gate silently does nothing. Caught only
      // because the panel reported gated=true while its contents still computed to visible.
      + '.mdxa-tab-extra.mdxa-pools:not(.lxda) .mdxa-pl-head,.mdxa-tab-extra.mdxa-pools:not(.lxda) .mdxa-pl-list,'
      + '.mdxa-tab-extra.mdxa-holders:not(.lxda) .mdxa-hl-list,'
      + '.mdxa-tab-extra.mdxa-holders:not(.lxda) .mdxa-hl-stat .val,'
      + '.mdxa-tab-extra.mdxa-holders:not(.lxda) .mdxa-hl-pgn{visibility:hidden}'
      // The snapshot camera is removed from the chart controls (RAZA 2026-09-16: "Remove the camera icon for screenshot").
      + '.lxda-snap{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  })();

  function liftIdentity() {
    ['.stat-row', '.dxa-stat-row', '.mdxa-stat-row', '.asset-header', '.asset-top'].forEach(function (s) {
      $$(s).forEach(function (n) { n.classList.add('lxda'); });
    });
  }

  function lift() {
    // `.asset-header` / `.asset-top` ARE THE REASON THE PAGE LOOKED EMPTY, and they were missing from
    // this list. They gate the token's own NAME:
    //     .asset-header:not(.lxda) .asset-name, .asset-top:not(.lxda) .asset-name { visibility:hidden }
    // paintHeader() writes `h1.asset-name` correctly on every load, and it has been invisible the
    // whole time — a page about ARMY that never said ARMY, with a blank where the heading belongs.
    // Found only by screenshotting; the DOM read back "ARMY" at opacity 1 with no console error, and
    // I called this page working three times on that evidence.
    //
    // NOT added here, deliberately: `#dxaChart`, `#dxaExTable`, `#mdxaExList` and `.dxa-hl-stat`.
    // Those gates hide the DESIGN'S MOCK — this layer does not paint any of them (there is no OHLC
    // source for the chart) — so lifting them would replace a blank with a fabricated price history
    // and invented trades. A blank is the honest state until they have real data.
    // THE HEADER AND STATS ARE LIFTED ONLY ONCE THEY HOLD THIS TOKEN (RAZA 2026-09-15: "Whenever i open any trade-asset
    // page, it shows this for split seconds then it fixes"). Lifting them here, before the token feed answered, put the
    // design's "USDC · 0x0409…f072 · circle.com · 4.2271 APT" on screen until paintHeader overwrote it. See liftIdentity().
    var sels = ['#dxaObAsks', '#dxaObBids', '#mdxaObAsks', '#mdxaObBids'];
    for (var i = 0; i < sels.length; i++) {
      var nodes = document.querySelectorAll(sels[i]);
      for (var j = 0; j < nodes.length; j++) nodes[j].classList.add('lxda');
    }

    // THE SECOND GATE FAMILY, which nothing in this file ever satisfied. A separate stylesheet hides
    // individual VALUES until they carry `.lxp`:
    //     .ohlc-strip .pair .v:not(.lxp), .dxa-perf-grid .dxa-perf-cell .ch:not(.lxp),
    //     … { visibility:hidden !important }
    // It is `!important`, so the class is the only way past it — and this layer had never added it,
    // which is why the H/L strip and the performance row rendered as empty space even after being
    // filled with real figures.
    //
    // Only the ones this layer actually writes are released. `.dxa-hl-stat .val`,
    // `.tabs-bar .tab .count` and the trade-summary rows are left gated for the same reason as the
    // chart: nothing here fills them yet.
    var vals = [];                     // NEAR: each painter releases its own values (see the port note)
    for (var k = 0; k < vals.length; k++) {
      var vn = document.querySelectorAll(vals[k]);
      for (var m = 0; m < vn.length; m++) vn[m].classList.add('lxp');
    }

    safetyNet();
  }

  // THE WHOLE PAGE IS REVEALED BY A TRANSITION, AND A TRANSITION CAN FAIL TO RUN.
  //
  // Measured on the served page: `.dxa-grid` — which contains the name, the issuer card, the chart
  // and the trade panel, i.e. everything — sits at computed opacity 0 with two CSSTransitions
  // (opacity and transform, 550ms) reported as `running` at currentTime 0. The tabs bar and the
  // Recent Exchanges panel are the same, via `[data-lcmu]{opacity:0}` lifted by `.lcmu-in`.
  //
  // So the page's VISIBILITY depends on an animation completing. That is fail-closed: when the
  // transition does not run, the markup is perfect, the data is correct, there is no console error,
  // and the reader sees nothing. This project has shipped that exact outage before —
  // prefers-reduced-motion masking a deleted card-reveal driver, 2026-08-14 — and the rule written
  // down afterwards was that a mechanism whose failure mode is "the feature never happens" must not
  // be load-bearing.
  //
  // ONLY A NET, NOT AN OVERRIDE. It runs once, late, and forces opacity only on elements STILL at
  // zero — so where the animation works it has already finished and this changes nothing, and the
  // design's fade is preserved. Content beats choreography when the two disagree.
  //
  // Deliberately a timer and not requestAnimationFrame: rAF is exactly the kind of frame-driven
  // mechanism that is not firing when this situation arises.
  function safetyNet() {
    if (window.__lxnDxaNet) return;
    window.__lxnDxaNet = 1;
    setTimeout(function () {
      var main = document.querySelector('main') || document.body;
      var nodes = main.querySelectorAll('.dxa-grid, [data-lcmu], .dxa-trade-card, .tabs-bar, .panel');
      for (var i = 0; i < nodes.length; i++) {
        try {
          var n = nodes[i];
          if (getComputedStyle(n).opacity !== '0') continue;          // the reveal did its job

          // SETTING opacity IS NOT ENOUGH, and the first version of this net proved it: the trade
          // card lifted and the grid did not. A CSS transition sits ABOVE !important in the cascade,
          // so a transition frozen at its from-value keeps winning however the inline style is
          // written. (Recorded in this project before as "a stuck transition outranking
          // !important".) The transition has to be ENDED, not out-shouted.
          n.style.setProperty('transition', 'none', 'important');
          if (n.getAnimations) {
            var as = n.getAnimations();
            for (var k = 0; k < as.length; k++) { try { as[k].finish(); } catch (_) {} }
          }
          n.style.setProperty('opacity', '1', 'important');
          n.style.setProperty('transform', 'none', 'important');
        } catch (e) {}
      }
    }, 1500);
  }

  // ---- stats ------------------------------------------------------------------------------------
  // These six cells ship with MOCK values baked into the markup -- "4.2271 XRP / $0.916142",
  // "+2.66%", "4.14M XRP / $980,137" -- and they are not written by any data layer, so they survived
  // stripping the Stellar one. Whatever token you opened, the page quoted those numbers as if they
  // were its own. Invented figures on a price page are worse than blank ones, so anything without
  // real data behind it is set to an em dash rather than left as the mock.
  function money(v) {
    if (v == null || !isFinite(v)) return null;
    if (v === 0) return '$0';
    if (v < 0.01) return '$' + v.toPrecision(3);
    // UNDER A DOLLAR, THREE SIGNIFICANT FIGURES: two decimals printed RHEA at $0.0765 as "$0.08".
    if (v < 1) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + Math.round(v).toLocaleString('en-US');
    if (v < 1e9) return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + (v / 1e9).toFixed(2) + 'B';
  }

  // THE PHONE LABELS THESE CELLS DIFFERENTLY, and an exact match silently skipped one.
  //
  // Desktop reads "24h volume"; the phone reads just "Volume". The comparison was `=== name`, so on
  // mobile that cell was never found, never painted, and kept the design's mock — displaying
  // "4.14M APT" beside three cells that HAD been painted, which is the most convincing way for a
  // wrong number to appear: surrounded by right ones.
  //
  // Matched either way round now, so a shorter phone label finds a longer desktop key. Scoped to
  // .stat-cell, where the label set is small and unambiguous.
  function cellByLabel(name) {
    var cells = document.querySelectorAll('.stat-cell');
    var want = String(name).toLowerCase();
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.lbl');
      if (!l) continue;
      var got = l.textContent.trim().toLowerCase();
      if (got === want || got.indexOf(want) >= 0 || want.indexOf(got) >= 0) return cells[i];
    }
    return null;
  }

  function setCell(name, main, unit, sub, dir) {
    var c = cellByLabel(name);
    if (!c) return;
    var v = c.querySelector('.val'), s = c.querySelector('.sub');
    if (v) {
      v.textContent = main == null ? '—' : main;
      if (main != null && unit) {
        var u = el('span', 'u', unit);
        v.appendChild(u);
      }
      if (dir) v.className = 'val change ' + dir + ' mono';
    }
    if (s) s.textContent = sub == null ? '' : sub;
  }

  // THE PRICE-CHANGE ROW WAS THE DESIGN'S FICTION, ON A PAGE ABOUT ONE REAL TOKEN.
  //
  // Six cells — 1h, 24h, 7d, 1m, 3m, 6m — and every one of them shipped as static markup: "+0.42%",
  // "+2.66%", "-1.18%", "+12.34%", "+28.91%", "+47.62%". Nothing ever painted them, so ARMY showed
  // "24h +2.66%" while the header directly above it showed the real 24h move, which was NEGATIVE.
  // Two contradictory answers about the same token, on the same screen, and the invented one was in
  // the bigger type.
  //
  // Three of the six are real and were already in the payload this page fetches: /lxapi/xrpltoken
  // maps the upstream's pro1h / pro24h / pro7d to p1h / p24 / p7. They were simply never read.
  //
  // THE OTHER THREE DO NOT EXIST. The upstream carries no 1-month, 3-month or 6-month change — the
  // full field list was checked, not assumed — so they become em dashes rather than being computed
  // from a series this page does not have. A missing figure reads as missing; an invented one reads
  // as a 47% gain.
  //
  // Matched on each cell's own label rather than by index, so a change to the row's order cannot
  // silently put the 7-day number under the 1-hour heading.
  // THE LOGO HEALER EATS THIS ROW, which is why the labels have to be rebuilt rather than read.
  //
  // Measured on the live page: after the first paint, cells 4-6 were `innerHTML: ""` — not em-dashed,
  // EMPTY. That engine repaints any element holding one to five characters as a ticker logo and
  // clears its text, and "1m", "3m", "6m" are two characters each. The first three cells survive only
  // because this function repaints them afterwards; anything it skips stays wiped.
  //
  // So the labels come from this list, not from the DOM, and every cell is stamped `data-logoed="1"`
  // — the healer's own skip marker, and the documented escape.
  var PERF = ['1h', '24h', '7d', '1m', '3m', '6m'];

  // Same contract as wallet.js's plain(): undo whatever the logo engine did to this node, claim it
  // with the engine's OWN skip marker, then write the text. `null` leaves the text alone, for a
  // container that only needs releasing.
  function plain(node, text) {
    try {
      node.removeAttribute('data-logo');
      node.style.background = '';
      node.style.backgroundImage = '';
      node.style.boxShadow = '';
      node.setAttribute('data-logoed', '1');
    } catch (e) {}
    if (text != null) node.textContent = text;
  }

  // The upstream publishes 1h / 24h / 7d and nothing longer, so 1m, 3m and 6m read as em dashes on
  // arrival. They are filled in by loadLongPerf() from the token's own daily close series — a real
  // price history from the same source, not a series this page lacks. Kept here so a later
  // paintPerf() (the Buy/Sell toggle re-runs it) does not blank what has already been computed.
  var LONG = {}, LASTD = null, PERF = { h1: 'pending', long: 'pending' };

  function paintPerf(d) {
    // `[class*="dxa-perf-cell"]` MATCHES BOTH LAYOUTS, and selecting only `.dxa-perf-cell` is why
    // the phone shipped fabricated performance figures for weeks. The mobile page has ZERO
    // `.dxa-perf-cell` and six `.mdxa-perf-cell` — the phone's class is the desktop's with a letter
    // in front — so this function found nothing there and returned, leaving the design's mock in
    // place: "1h +0.42%  24h +2.66%" against an API saying +0.003% and -0.347%. And lift() had
    // already released the `.lxp` gate on those cells, so the invented numbers were fully visible
    // and looked authoritative. Exactly the trap in [[lumoscore-hidden-mock-sweep]]: a layer that
    // names the desktop container does nothing on the phone.
    var cells = $$('[class*="dxa-perf-cell"]');
    if (!cells.length) return;
    if (d) LASTD = d;
    // All in NEAR terms, like the price headline. 24h is the token payload's own change converted
    // with NEAR's move (d24n); 1h comes off the 1D chart series and 7d/1m/3m/6m off one daily series.
    var have = {
      '1h': LONG['1h'], '24h': d ? d.d24n : null, '7d': LONG['7d'],
      '1m': LONG['1m'], '3m': LONG['3m'], '6m': LONG['6m'],
    };

    cells.forEach(function (c, i) {
      var label = PERF[i] || (((c.querySelector('.tf') || {}).textContent) || '').trim();
      var v = Object.prototype.hasOwnProperty.call(have, label) ? have[label] : null;
      var ok = (v != null && isFinite(v));

      // Rebuilt, because the healer may have emptied the cell entirely.
      var tf = c.querySelector('.tf') || c.appendChild(el('div', 'tf'));
      var ch = c.querySelector('.ch') || c.appendChild(el('div', 'ch'));

      // STAMPING data-logoed IS NOT ENOUGH ON ITS OWN. The first attempt set only that marker and
      // the cell came back carrying `data-logo="CELL"` and a base64 token-logo background, with its
      // children gone — the engine had already claimed it, and the leftover attribute and background
      // kept the logo painted over the row. The marker has to be set AND the engine's existing state
      // undone, which is exactly what wallet.js's plain() does and why it does all three things.
      plain(c, null);
      plain(tf, label);
      var wait = !ok && ((label === '1h' && PERF.h1 === 'pending') || (label !== '1h' && label !== '24h' && PERF.long === 'pending'));
      plain(ch, ok ? ((v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%') : (wait ? '' : '—'));

      // AND THIS IS THE LINE THAT ACTUALLY SAVES THE CELL. There are two logo engines on this page
      // and they use different contracts: the second honours `data-logoed`, the FIRST does not look
      // at it at all. Its test is "no img/svg/[data-logo] descendant AND text of 1-5 characters",
      // so a cell reading "1h-0.06%" (8 chars) is safe while one reading "1m—" (3) is treated as a
      // ticker — which is why only the three em-dashed cells were being eaten. The symbol it settled
      // on was CELL, taken from this element's own class name, `dxa-perf-cell`.
      //
      // An empty `data-logo` on a CHILD is that engine's own escape: the parent then fails its
      // `querySelector('img,svg,[data-logo]')` check and is skipped, and the empty value matches no
      // logo so nothing is drawn. Same trick the snapshot button already uses a few lines below.
      try { tf.setAttribute('data-logo', ''); } catch (e) {}

      try { if (wait) ch.classList.remove('lxp'); else ch.classList.add('lxp'); } catch (e) {}
      c.classList.remove('up', 'down');
      if (ok) c.classList.add(v >= 0 ? 'up' : 'down');
    });
  }

  // 1m / 3m / 6m, computed from ONE year of daily closes rather than three separate calls — the
  // upstream budget is 333 requests a DAY, and a 1Y daily series already contains every window.
  //
  // A young token is the case that matters: if the series does not reach back far enough, the figure
  // stays an em dash instead of quietly measuring from the token's first ever candle and calling
  // that "6 months". The tolerance is three days, because daily candles do not land on exact
  // boundaries and an illiquid token can miss days entirely.
  function changeOver(pts, days) {
    if (!pts || pts.length < 2) return null;
    var last = pts[pts.length - 1];
    var cut = last[0] - days * 86400000;
    if (pts[0][0] > cut + 3 * 86400000) return null;       // history is shorter than the window
    var base = null;
    for (var i = pts.length - 1; i >= 0; i--) { if (pts[i][0] <= cut) { base = pts[i]; break; } }
    if (!base || !(base[1] > 0)) return null;
    return (last[1] - base[1]) / base[1] * 100;
  }

  // 7d / 1m / 3m / 6m from ONE daily series in NEAR terms (a year from CoinGecko, or 200 days of
  // GeckoTerminal day candles), never three calls. A series too short for a window leaves it an em dash.
  function loadLongPerf(asset) {
    if (!$$('[class*="dxa-perf-cell"]').length) return;   // both layouts — see paintPerf
    seriesFor('PERF', 'NEAR')
      .then(function (pts) {
        LONG['7d'] = changeOver(pts, 7);
        LONG['1m'] = changeOver(pts, 30);
        LONG['3m'] = changeOver(pts, 90);
        LONG['6m'] = changeOver(pts, 180);
      }, function () {})
      .then(function () { PERF.long = 'done'; paintPerf(LASTD); });
  }

  // WHY THE FIGURES ARE MISSING, said once, instead of six dashes and an empty chart.
  //
  // RAZA on 2026-09-29: "Why's BCHAMP token not showing details". Because /lxapi/xrpltoken answers
  // {"ok":false,"error":"upstream 404"} for it — xrpl.to has no record of that token, which is what
  // happens to an asset with no market on the DEX. The page was right to show nothing, and wrong to
  // show nothing WITHOUT SAYING SO: four dashes, a blank chart and a dead swap panel are what a
  // broken page looks like, so a reader cannot tell a thin token from an outage.
  //
  // The description and issuer above still render, because those come from XRPLMeta rather than
  // xrpl.to — which is exactly why the page looked half-loaded rather than empty.
  // TWO DIFFERENT SILENCES, and they must not be told apart by guesswork.
  //
  // A token the feed has never heard of (upstream 404) has no market — that is a fact about the
  // token, and it is permanent until someone makes a market. A feed that refused THIS request is an
  // outage, and the same token will price fine on a reload. Both render as six dashes, which is why
  // RAZA asked "Why's BCHAMP token not showing details" — and BCHAMP turned out to have a perfectly
  // good market (0.00601582 XRP, $20,430 of 24h volume) that had simply failed to load that once.
  //
  // So the note says which one happened. Telling someone their token has no market when the feed
  // merely rate-limited us would be a confident falsehood about their asset, and xrpl.to's cap is
  // 333 requests a day per IP -- being refused is ordinary.
  function noMarketNote(kind) {
    // THIS NOTE HAD NEVER ONCE RENDERED. It looks for .dxa-stats, which exists only on the
    // /xrpl/ page build -- and the combined site serves /trade/xrpl/<CODE-ISSUER> from the ROOT
    // lumoscore-dex-asset.html, which carries no dxa-* class at all (measured: 0 occurrences in the
    // built file, against 64 .stat-cell). So `host` was null, the function returned at the guard
    // below, and the entire explanation written for the BCHAMP complaint silently did nothing on the
    // page people actually visit. RAZA hit it again on 2026-10-12 with FLR: four dashes, no reason
    // given -- which is the exact failure this note exists to prevent.
    //
    // Anchored on .stat-cell instead, which both builds have, with the dxa-* lookup kept first so the
    // /xrpl/ build keeps placing it exactly where it did.
    var anchor = document.querySelector('.dxa-stats') || document.querySelector('[class*="dxa-stat"]');
    if (!anchor) {
      var cell = document.querySelector('.stat-cell');
      anchor = cell && cell.parentElement;          // the row the stat cells sit in
    }
    var note = document.querySelector('.lx-nomarket');
    if (!kind) { if (note && note.parentNode) note.parentNode.removeChild(note); return; }
    if (!anchor || !anchor.parentNode) return;
    if (!note) {
      note = document.createElement('div');
      note.className = 'lx-nomarket';
      note.setAttribute('data-logoed', '1');
      note.style.cssText = 'margin:12px 0 0;padding:11px 14px;border-radius:12px;'
        + 'border:1px solid var(--border);background:var(--surface-2);'
        + 'font:400 12.5px/1.5 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)';
      // Directly below the stat row on both builds, rather than appended inside a container whose
      // shape differs between them.
      anchor.parentNode.insertBefore(note, anchor.nextSibling);
    }
    // 'nottoken': the chain answered that this address holds no fungible-token contract (or no account
    // at all) and no pool lists it -- a different fact from a real token with no market.
    note.textContent = kind === 'nottoken'
      ? 'This address is not a NEAR token contract: the chain has no token here and no pool lists it. '
        + 'Check the contract id in the address bar.'
      : kind === 'none'
      ? 'No market data for this token. The contract exists on NEAR, but no pool with a live price was '
        + 'found for it. Its name, supply and contract above are read straight from the chain.'
      : 'Market data could not be loaded just now — the price feed did not answer. Reloading usually fixes it.';
  }

  // The design's four cells: Price, 24h Volume (phone: Volume), Market Cap, Supply. There is no 24h
  // change, liquidity or trades cell in this design, so those figures appear where the design does put
  // them -- the change pill and the 24h perf cell, the Pools tab's Combined TVL -- and nowhere new.
  function paintStats(d) {
    var supplyCell = function () {
      setCell('supply', (d && d.supply != null) ? statAmt(d.supply) + ' ' : null, (d && d.symbol) || '',
        (d && d.symbol) ? (d.symbol + ' total supply') : '');
    };
    if (!d || d.price == null) {
      ['price', '24h volume', 'market cap'].forEach(function (n) { setCell(n, null, '', ''); });
      supplyCell();                            // the contract's own figure survives a missing market
      var miss = window.__lxnAssetMiss;
      noMarketNote(miss === 'none' || miss === 'nottoken' ? miss : 'down');
      return;
    }
    noMarketNote(null);
    var usd = d.nearUsd > 0 ? +d.nearUsd : null;     // USD per NEAR

    setCell('price', xrpPx(d.price) + ' ', 'NEAR', d.usd == null ? '' : money(d.usd));

    setCell('24h volume', d.v24 == null ? null : statAmt(d.v24) + ' ', 'NEAR',
      (d.v24 != null && usd) ? money(d.v24 * usd) : '');

    // Market cap = total supply x dollar price, in dollars only (the XRPL note below explains why
    // dollars only and why it is the two figures on screen multiplied). Total supply is the
    // contract's ft_total_supply: NEAR tokens publish no circulating figure.
    var mcap = (d.supply != null && d.usd != null) ? d.supply * d.usd : null;
    setCell('market cap', mcap != null ? usdCompact(mcap) : null, '', '');
    (function () {
      var c = cellByLabel('market cap');
      var sb = c && c.querySelector('.sub');
      if (sb) sb.style.display = 'none';
    })();

    supplyCell();
  }

  // ---- the price chart ----------------------------------------------------------------------------
  //
  // THE BIGGEST THING ON THE PAGE WAS AN EMPTY BOX, and that is what "the page doesn't load" looked
  // like. The design's own chart was gated shut by `#dxaChart:not(.lxda) svg{visibility:hidden}` —
  // correctly, because its contents are mock: gridlines labelled 4.61 / 4.56, which are Aptos prices.
  // Nothing here ever replaced them, so the gate stayed shut and the reader got 395px of nothing
  // above a real order book.
  //
  // The data existed the whole time. /lxapi/xrplohlc serves per-token history — the $LUMOS page's
  // chart is built on it — and it takes `iss` + `cur` and derives the upstream's token id at the
  // edge. For ARMY it returns 168 real points. It was simply never called from this page.
  //
  // Drawn into the design's own SVG at its own viewBox, with the same gridline/label structure it
  // ships, so nothing new is introduced: only the numbers become real.
  var CH_RANGE = { '1D': '24H', '1W': '7D', '1M': '30D', '1Y': '1Y', 'ALL': 'ALL' };
  var chGen = 0;
  // What the chart plots and in which unit: Stellar's Price/MCap and $/XLM controls, with XRP. Opens on
  // 1D, which is the range lumoscore.com has selected on arrival.
  var CH_VIEW = { metric: 'price', vs: 'NEAR', supply: 0, label: '1D', type: 'area' };
  // THE LINE / CANDLE TOGGLE (RAZA 2026-09-15: "when i switch to candlestick, the charts just disappears"). The design's own
  // handler redrew its mock into the box; the click is taken first and this token's candles are drawn instead.
  if (!window.__lxnChartType) {
    window.__lxnChartType = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button[data-type="area"], button[data-type="candle"]');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      [].forEach.call(b.parentNode.querySelectorAll('button[data-type]'), function (x) { x.classList.toggle('active', x === b); });
      CH_VIEW.type = b.getAttribute('data-type') === 'candle' ? 'candle' : 'area';
      if (typeof lastRawPts !== 'undefined' && lastRawPts) drawChart(lastRawPts);
    }, true);
  }

  // THE CHART TAKES UP THE SLACK (RAZA 2026-09-15: "there's again a lot of empty space below the price change boxes").
  // The page's left card is stretched to the height of the trade panel beside it; when a token's header is short —
  // no description, as USDC's — the card ran ~140px past its last row. Measured at 1920px: card bottom 1126, the %
  // boxes' card 988. The chart grows by exactly the slack instead, and is REDRAWN in the taller box rather than
  // stretched (its SVG has preserveAspectRatio="none", so stretching would squash its labels). 28px is the card's
  // own bottom padding, measured where nothing is stretched.
  var NATURAL_H = 395, lastRawPts = null, fitWired = false, fitTimer = null;
  function chartH(svg) {
    var h = svg && parseFloat(svg.style.height);
    return h > NATURAL_H ? Math.round(380 * h / NATURAL_H) : 380;
  }
  function fitChartHeight() {
    // RETIRED (RAZA 2026-09-15: "This section is bigger than on Stellar. Due to which theres also blank space below promoted
    // box. Make it identical to Stellar chart size"). The chart keeps lumoscore.com's fixed height; any height an earlier
    // version set is taken back off. The code below stays unreachable rather than deleted, as the record of the attempt.
    var c0 = chartSvg();
    if (c0 && c0.host && c0.host.style.height) {
      c0.host.style.height = '';
      c0.svg.style.height = '';
      if (lastRawPts) drawChart(lastRawPts);
    }
    return;
    var c = chartSvg(), ah = $('.asset-header'), perf = $('.dxa-perf-card');
    if (!c || !c.svg || !ah || !perf || c.host.id !== 'dxaChart') return;
    if (!fitWired) {
      fitWired = true;
      var again = function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitChartHeight, 120); };
      window.addEventListener('resize', again);
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(again);
        [$('.dxa-trade-col'), $('.asset-header-top')].forEach(function (n) { if (n) ro.observe(n); });
      }
    }
    var grid = ah.parentElement;
    var twoCols = grid && getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length > 1;
    // THE BOX, NOT ONLY THE DRAWING. #dxaChart carries a fixed 395px height of its own, so growing the SVG alone
    // changed nothing in the layout — the slack stayed, and every resize grew the SVG again. Both move together
    // now, and the growth is capped so no measurement can run it away.
    var cur = parseFloat(c.host.style.height) || NATURAL_H;
    var want = NATURAL_H;
    if (twoCols) {
      var slack = ah.getBoundingClientRect().bottom - perf.getBoundingClientRect().bottom - 28;
      want = Math.min(NATURAL_H + 320, Math.max(NATURAL_H, Math.round(cur + slack)));
    }
    if (Math.abs(want - cur) < 4) return;
    var hv = want > NATURAL_H ? (want + 'px') : '';
    c.host.style.height = hv;
    c.svg.style.height = hv;
    if (lastRawPts) drawChart(lastRawPts);
  }

  function chartSvg() {
    var host = document.getElementById('dxaChart') || document.getElementById('mdxaChart');
    return host ? { host: host, svg: host.querySelector('svg') } : null;
  }

  function drawChart(pts) {
    var c = chartSvg();
    if (!c || !c.svg || !pts || pts.length < 2) return;
    lastRawPts = pts;

    // The price band stops above a volume band, as on lumoscore.com (RAZA 2026-09-15: "volume bars missing").
    var W = 900, H = chartH(c.svg), L = 18, R = 836, T = 16, VB = H - 30, VH = 64, B = VB - VH - 12;
    // MCap is the same series times ISSUED supply — the figure the supply and market-cap boxes use.
    var K = (CH_VIEW.metric === 'mcap' && CH_VIEW.supply > 0) ? CH_VIEW.supply : 1;
    if (K !== 1) pts = pts.map(function (p) { return [p[0], p[1] * K, p[2] * K, p[3] * K, p[4] * K, p[5], p[6] != null ? p[6] * K : null]; });
    var axisTxt = function (v) { return (CH_VIEW.vs === 'USD' ? '$' : '') + (K !== 1 ? amount(v) : xrp(v, 5)); };
    var lo = pts[0][1], hi = pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    if (CH_VIEW.type === 'candle') {
      pts.forEach(function (p) {
        if (isFinite(p[2]) && p[2] > 0 && p[2] > hi) hi = p[2];
        if (isFinite(p[3]) && p[3] > 0 && p[3] < lo) lo = p[3];
      });
    }
    var span = hi - lo;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0], tspan = (t1 - t0) || 1;
    var y = function (v) { return span > 0 ? B - ((v - lo) / span) * (B - T) : (T + B) / 2; };

    // GREEN OR RED BY DIRECTION — and this line used to say the opposite, which is worth keeping
    // rather than deleting, because the history is the argument.
    //
    // It read: "THE BRAND ACCENT, NOT GREEN-OR-RED. This line was coloured by direction ... and
    // lumoscore.com never does that: its chart is always var(--accent,#ea6a2c) ... RAZA 2026-09-15:
    // 'WTF does the chart have red line. We dont have that on Stellar.'"
    //
    // That was correct when it was written, and the reason it gave was PARITY, not a dislike of
    // coloured lines. On 2026-10-16 RAZA asked for direction colouring on the Stellar Trade-Asset
    // chart, and then for it here. Stellar now does do that, so the same rule that removed this
    // colouring is the rule that brings it back. Anyone reading only the old note would "fix" this
    // straight back to accent and be wrong.
    // REVERSED ON 2026-10-16, AND THE NOTE ABOVE IS WHY IT IS NOT A CONTRADICTION. The red line was
    // removed from this chart on 2026-09-15 for one stated reason — lumoscore.com did not have it —
    // and that reason has now gone: RAZA asked for exactly this on the STELLAR Trade-Asset chart
    // first ("If the chart is UP in the last 24 hours, then it will be green. If down ... red. Same
    // logic applies on 1W, 1M, 1Y"), then for it here. The rule that governed both decisions is the
    // same one: this chart matches Stellar's. Only the answer moved.
    //
    // FIRST CLOSE VERSUS LAST, over the points actually drawn, so the colour always describes the
    // span on screen and every timeframe is served by one rule. pts[i][1] is the close — the same
    // value the line itself is plotted from, so the colour can never disagree with the shape.
    //
    // BOTH AN ATTRIBUTE AND A style, which is this file's existing pattern and not belt-and-braces
    // for its own sake: see the note at the top of chart.js about var() in SVG presentation
    // attributes. Measured in Chrome today, var() DOES resolve there — but the literal costs
    // nothing and keeps the line coloured anywhere it does not.
    var xUp  = (pts.length > 1) ? (+pts[pts.length - 1][1] >= +pts[0][1]) : true;
    var xHex = xUp ? '#35c07f' : '#ff5b5b';
    var xVar = xUp ? 'var(--green,#35c07f)' : 'var(--red,#ff5b5b)';
    var s = '<defs><linearGradient id="dxaAreaGrad" x1="0" x2="0" y1="0" y2="1">'
      + '<stop offset="0%" stop-color="' + xHex + '" style="stop-color:' + xVar + '" stop-opacity="0.20"></stop>'
      + '<stop offset="100%" stop-color="' + xHex + '" style="stop-color:' + xVar + '" stop-opacity="0"></stop></linearGradient></defs>';

    // Five gridlines, labelled with REAL prices off this series rather than the design's constants.
    for (var g = 0; g < 5; g++) {
      var gv = hi - (span * g / 4), gy = y(gv);
      s += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + R + '" y2="' + gy.toFixed(1)
        + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,5" class="lxda-candle"></line>'
        + '<text x="842" y="' + (gy + 3).toFixed(1) + '" font-size="10" fill="var(--text-soft)"'
        + ' font-family="JetBrains Mono, monospace">' + axisTxt(gv) + '</text>';
    }

    // Volume, square-root scaled like Stellar's band so an ordinary session still shows beside the outlier,
    // green when that close is at or above the one before it. xrplohlc's volume is in TOKEN units whatever
    // the price unit (measured: identical sums for vs=XRP and vs=USD), so only its shape is drawn here.
    var vmax = 0;
    for (var vi = 0; vi < pts.length; vi++) { var vv0 = +pts[vi][5] || 0; if (vv0 > vmax) vmax = vv0; }
    if (vmax > 0) {
      var bw = Math.max(1, Math.min(14, (R - L) / pts.length * 0.62)), vroot = Math.sqrt(vmax);
      for (var bi = 0; bi < pts.length; bi++) {
        var bv = +pts[bi][5] || 0;
        if (!(bv > 0)) continue;
        var bx = L + ((pts[bi][0] - t0) / tspan) * (R - L);
        var bh = Math.max(3, (Math.sqrt(bv) / vroot) * VH);
        var upv = bi === 0 || pts[bi][1] >= pts[bi - 1][1];
        s += '<rect class="lxda-vol" x="' + (bx - bw / 2).toFixed(1) + '" y="' + (VB - bh).toFixed(1)
          + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (upv ? '#22c55e' : '#ff5b5b')
          + '" fill-opacity="0.5"></rect>';
      }
    }

    var line = '';
    for (var j = 0; j < pts.length; j++) {
      var px = L + ((pts[j][0] - t0) / tspan) * (R - L);
      line += (j ? ' L' : 'M') + px.toFixed(1) + ' ' + y(pts[j][1]).toFixed(1);
    }
    // The accent goes in a style declaration as well as the attribute: chart.js records that a var()
    // inside an SVG presentation attribute can leave a path uncoloured, so the attribute carries the
    // literal fallback and the style carries the theme token.
    if (CH_VIEW.type === 'candle') {
      // xrplohlc candles are [t, close, high, low, open, volume]; a candle missing its open opens at the close before it.
      var cdw = Math.max(1.5, Math.min(12, (R - L) / pts.length * 0.62));
      for (var cdi = 0; cdi < pts.length; cdi++) {
        var cdp = pts[cdi], cdx = L + ((cdp[0] - t0) / tspan) * (R - L);
        var cdc = cdp[1];
        var cdo = (isFinite(cdp[4]) && cdp[4] > 0) ? cdp[4] : (cdi ? pts[cdi - 1][1] : cdc);
        var cdh = (isFinite(cdp[2]) && cdp[2] > 0) ? cdp[2] : Math.max(cdo, cdc);
        var cdl = (isFinite(cdp[3]) && cdp[3] > 0) ? cdp[3] : Math.min(cdo, cdc);
        var cdcol = cdc >= cdo ? '#22c55e' : '#ff5b5b';
        var cdyt = y(Math.max(cdo, cdc)), cdyb = y(Math.min(cdo, cdc));
        s += '<line class="lxda-candle lxda-cwick" x1="' + cdx.toFixed(1) + '" x2="' + cdx.toFixed(1) + '" y1="' + y(cdh).toFixed(1) + '" y2="' + y(cdl).toFixed(1)
          + '" stroke="' + cdcol + '" stroke-width="1"></line>'
          + '<rect class="lxda-candle lxda-cbody" x="' + (cdx - cdw / 2).toFixed(1) + '" y="' + cdyt.toFixed(1) + '" width="' + cdw.toFixed(1)
          + '" height="' + Math.max(1, cdyb - cdyt).toFixed(1) + '" fill="' + cdcol + '"></rect>';
      }
    } else {
      s += '<path d="' + line + ' L' + R + ' ' + B + ' L' + L + ' ' + B + ' Z" fill="url(#dxaAreaGrad)" class="lxda-area"></path>'
        + '<path d="' + line + '" fill="none" stroke="' + xHex + '" style="stroke:' + xVar + '" stroke-width="2"'
        + ' stroke-linecap="round" stroke-linejoin="round" class="lxda-line"></path>';
    }

    c.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    c.svg.innerHTML = s;
    // Only now is the gate lifted: the box stays hidden while it holds the design's Aptos prices,
    // and opens the moment it holds this token's own.
    c.host.classList.add('lxda');
    wireChartHover(c.host, { pts: pts, L: L, R: R, t0: t0, tspan: tspan, y: y, K: K });

    // (The XRPL build feeds Stellar's snapshot camera from here; that layer is not on the NEAR page.)
  }

  // THE HOVER READOUT (RAZA 2026-09-15: "where's the chart hover that we also have on Stellar"). Stellar's own
  // elements — .lxda-chtip / .lxda-chdot / .lxda-chvl, styled by the inherited sheet — with the date, the
  // price in the chart's unit and dollars beneath it, and that bucket's volume in dollars.
  function tipDate(ms) {
    try {
      var o = (CH_VIEW.label === '1D' || CH_VIEW.label === '1W')
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
      return new Date(ms).toLocaleString('en-US', o);
    } catch (e) { return ''; }
  }
  function usdCompact(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return v >= 0.01 ? ('$' + v.toFixed(2)) : '<$0.01';
  }
  function tipEl(cls, text) {
    var e = el('div', cls, text);
    e.setAttribute('data-logoed', '1');                         // "Price" is five letters: keep the logo healer off
    return e;
  }
  function wireChartHover(host, st) {
    host.__lxxHov = st;
    ['lxda-chtip', 'lxda-chdot', 'lxda-chvl'].forEach(function (cls) {
      if (!host.querySelector('.' + cls)) host.appendChild(el('div', cls));
    });
    if (host.__lxxHovWired) return;
    host.__lxxHovWired = 1;
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    function hide() {
      ['lxda-chtip', 'lxda-chdot', 'lxda-chvl'].forEach(function (c2) { var n = host.querySelector('.' + c2); if (n) n.style.opacity = 0; });
    }
    function move(cx, cy) {
      var S = host.__lxxHov, svg = host.querySelector('svg');
      var tip = host.querySelector('.lxda-chtip'), dot = host.querySelector('.lxda-chdot'), vl = host.querySelector('.lxda-chvl');
      if (!S || !svg || !tip || !dot || !vl) return;
      var m = null;
      try { m = svg.getScreenCTM(); } catch (e) {}
      if (!m) return;
      var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      var vx = pt.matrixTransform(m.inverse()).x;
      var P = S.pts, best = 0, bd = Infinity;
      for (var i = 0; i < P.length; i++) {
        var dx = Math.abs(S.L + ((P[i][0] - S.t0) / S.tspan) * (S.R - S.L) - vx);
        if (dx < bd) { bd = dx; best = i; }
      }
      var p = P[best];
      var sp = svg.createSVGPoint();
      sp.x = S.L + ((p[0] - S.t0) / S.tspan) * (S.R - S.L);
      sp.y = S.y(p[1]);
      var scr = sp.matrixTransform(m), hr = host.getBoundingClientRect();
      var lx = scr.x - hr.left, ly = scr.y - hr.top;
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = 1;
      vl.style.left = lx + 'px'; vl.style.opacity = 1;

      var d = window.__lxnAssetData, usdPerXrp = (d && d.nearUsd > 0) ? +d.nearUsd : 0;
      var inUsd = CH_VIEW.vs === 'USD', mcap = S.K !== 1;
      var head = inUsd ? ('$' + (mcap ? amount(p[1]) : xrp(p[1], 6))) : ((mcap ? amount(p[1]) : xrp(p[1], 6)) + ' NEAR');
      // The dollar line is the point's OWN dollar price when the series carries it (CoinGecko does),
      // and today's NEAR rate otherwise.
      var pu = (p[6] != null && isFinite(p[6])) ? p[6] : (usdPerXrp > 0 ? p[1] * usdPerXrp : null);
      var sub = (!inUsd && pu != null) ? (mcap ? usdCompact(pu) : ('$' + xrp(pu, 6))) : '';
      // Per-candle volume exists only on GeckoTerminal candles (in the chart's unit). CoinGecko's
      // volume is a rolling 24h total, not a candle's, so its points carry none and no row is shown.
      var volUsd = (isFinite(p[5]) && p[5] > 0) ? (inUsd ? +p[5] : +p[5] * usdPerXrp) : 0;
      tip.textContent = '';
      tip.appendChild(tipEl('d', tipDate(p[0])));
      tip.appendChild(tipEl('l', mcap ? 'Market cap' : 'Price'));
      tip.appendChild(tipEl('p', head));
      if (sub) tip.appendChild(tipEl('v', sub));
      if (volUsd > 0) {
        var row = el('div', 'lxrow');
        row.appendChild(tipEl('l', 'Volume'));
        row.appendChild(tipEl('p', usdCompact(volUsd)));
        tip.appendChild(row);
      }
      tip.style.opacity = 1;
      var tw = tip.offsetWidth, th = tip.offsetHeight, tx = lx + 14;
      if (tx + tw > hr.width) tx = lx - tw - 14;
      if (tx < 2) tx = 2;
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(2, ly - th - 12) + 'px';
    }
    // A browser follows a touch with synthetic mouse events, so the mouseleave after a finger lifts would
    // erase the reading the tap was for; Stellar ignores it for 1.5s after a touch, and so does this.
    var touchAt = 0, tp0 = null;
    host.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    host.addEventListener('mouseleave', function () { if (Date.now() - touchAt < 1500) return; hide(); });
    host.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      touchAt = Date.now(); tp0 = { x: t.clientX, y: t.clientY }; move(t.clientX, t.clientY);
    }, { passive: true });
    host.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      touchAt = Date.now();
      if (tp0 && Math.abs(t.clientX - tp0.x) > Math.abs(t.clientY - tp0.y)) { try { e.preventDefault(); } catch (x) {} }
      move(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchstart', function (e) {
      if (e.target && e.target.closest && e.target.closest('#dxaChart, #mdxaChart')) return;
      hide();
    }, true);
  }

  // THE PRICE LINE ABOVE THE CHART (RAZA 2026-09-15: "The section above the chart is different on
  // Stellar"). lumoscore.com leads the chart with the price in large type, a 24h change pill, and a meta
  // line — "0.0222866 XLM per VELO · 1D High 0.0239707 XLM · Low 0.021825 XLM". The design ships all three
  // (`.price-display .big`, `.change-pill`, `.meta`) holding Aptos mock behind `:not(.lxp)` gates, so
  // they were invisible here rather than wrong. Filled and released.
  function paintChartHead(pts) {
    var pd = $('.price-display');
    var d = window.__lxnAssetData, a = window.__lxnAssetRef;
    if (!pd || !d || !a || d.price == null) return;
    var usd = CH_VIEW.vs === 'USD';
    var priceTxt = usd ? (d.usd != null ? money(d.usd) : '—') : (xrpPx(d.price) + ' NEAR');

    var big = pd.querySelector('.big');
    if (big) { plain(big, priceTxt); big.classList.add('lxp'); }

    // THE PILL FOLLOWS THE CHART TAB (RAZA 2026-10-17: "if we change the tab to 1W, or 1M, or 1Y, it
    // should also change the percentage tag color based on the tab... Right now it only shows 24h").
    // It read d.p24 whatever was on screen, so a 1Y chart climbing all year could sit under a red
    // "▼ 2.51% (24h)" — a true number answering a question nobody asked.
    //
    // DERIVED FROM THE PLOTTED POINTS, not from another field, for every range except 1D. `pts` is
    // the exact series drawn beneath this pill, so the figure and the line can never disagree — and
    // there is no API field for 1M or 1Y to disagree with in the first place. 1D keeps `p24` because
    // that is the authoritative 24h move the rest of the page shows, and a chart window that starts
    // a few minutes either side of midnight-24h would otherwise print a second, slightly different
    // opinion of the same thing.
    var PILL_TAG = { '1D': '24h', '1W': '7d', '1M': '30d', '1Y': '1y', 'ALL': 'all' };
    var pill = pd.querySelector('.change-pill');
    if (pill) {
      var lbl = String(CH_VIEW.label || '1D').toUpperCase();
      var pct = null, tag = PILL_TAG[lbl] || lbl.toLowerCase();
      if (lbl === '1D') {
        pct = usd ? d.d24 : d.d24n;
      } else if (pts && pts.length > 1) {
        // First and last CLOSE that are real numbers. A gap at either end is skipped rather than
        // read as a price, which would otherwise show a 100% move against a zero.
        var firstC = null, lastC = null;
        for (var pi = 0; pi < pts.length; pi++) {
          var cv = Number(pts[pi][1]);
          if (!isFinite(cv) || cv <= 0) continue;
          if (firstC === null) firstC = cv;
          lastC = cv;
        }
        if (firstC > 0 && lastC > 0) pct = ((lastC - firstC) / firstC) * 100;
      }
      if (pct != null && isFinite(pct)) {
        plain(pill, (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(2) + '% (' + tag + ')');
        pill.className = 'change-pill lxp ' + (pct >= 0 ? 'up' : 'down');
      }
    }

    var meta = pd.querySelector('.meta');
    if (meta && !(pts && pts.length)) {
      meta.textContent = '';
      meta.appendChild(el('span', 'lx-pairpx', priceTxt + ' per ' + a.code));
    }
    if (meta && pts && pts.length) {
      var hi = null, lo = null;
      for (var i = 0; i < pts.length; i++) {
        var h = (isFinite(pts[i][2]) && pts[i][2] > 0) ? pts[i][2] : pts[i][1];
        var l = (isFinite(pts[i][3]) && pts[i][3] > 0) ? pts[i][3] : pts[i][1];
        if (hi == null || h > hi) hi = h;
        if (lo == null || l < lo) lo = l;
      }
      // High / Low sit beside the headline on one line, so they get the same ladder: six decimals
      // here is what made the strip read "H 59,245.0942 L 58,385.195" and run out of room.
      var U = function (v) { return usd ? ('$' + xrpPx(v)) : (xrpPx(v) + ' NEAR'); };
      meta.textContent = '';
      meta.appendChild(el('span', 'lx-pairpx', priceTxt + ' per ' + a.code + ' · '));
      meta.appendChild(document.createTextNode(CH_VIEW.label + ' High '));
      var bh = el('b', 'mono lxp', U(hi)); bh.style.color = 'var(--text)'; bh.setAttribute('data-logoed', '1');
      meta.appendChild(bh);
      meta.appendChild(document.createTextNode(' · Low '));
      var bl = el('b', 'mono lxp', U(lo)); bl.style.color = 'var(--text)'; bl.setAttribute('data-logoed', '1');
      meta.appendChild(bl);
    }
  }

  // Stellar's two trays, in the controls row ahead of the line/candle toggle — the same classes
  // (`.lxda-metric`, `.lxda-denom`) its stylesheet already dresses. data-logo on each keeps the logo
  // engine from emptying "$" and "XRP".
  function chartControls(asset) {
    var row = $('.chart-controls');
    if (!row) return;
    if (!$('.lxda-metric', row)) {
      var before = row.querySelector('.chart-tools:not(.lxda-metric):not(.lxda-denom):not(.lxda-snap)') || null;
      var g = el('div', 'chart-tools lxda-metric');
      g.setAttribute('data-logo', '');
      g.innerHTML = '<button type="button" data-metric="price" data-logo="">Price</button>'
        + '<button type="button" data-metric="mcap" data-logo="" title="Market cap = price x supply">MCap</button>';
      var dn = el('div', 'chart-tools lxda-denom');
      dn.setAttribute('data-logo', '');
      dn.innerHTML = '<button type="button" data-cdn="usd" data-logo="">$</button>'
        + '<button type="button" data-cdn="xrp" data-logo="">NEAR</button>';
      row.insertBefore(g, before);
      row.insertBefore(dn, before);
    }
    if (!window.__lxnChartCtl) {
      window.__lxnChartCtl = 1;
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var m = t.closest('[data-metric]'), dv = t.closest('[data-cdn]');
        if (!m && !dv) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (m) {
          if (m.disabled) return;
          CH_VIEW.metric = m.getAttribute('data-metric') === 'mcap' ? 'mcap' : 'price';
        }
        if (dv) CH_VIEW.vs = dv.getAttribute('data-cdn') === 'usd' ? 'USD' : 'NEAR';
        loadChart(asset, CH_VIEW.label);
      }, true);
    }
    syncChartControls();
  }

  function syncChartControls() {
    var d = window.__lxnAssetData;
    // ISSUED, not circulating -- the same supply the stat box above shows and the same one the market
    // cap box is now multiplied from. The MCap series and the MCap figure have to agree, or hovering
    // the chart contradicts the box beside it.
    CH_VIEW.supply = (d && d.supply > 0) ? +d.supply : 0;          // the contract's total supply
    $$('.lxda-metric button[data-metric]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-metric') === CH_VIEW.metric);
      if (b.getAttribute('data-metric') === 'mcap') {
        b.disabled = !(CH_VIEW.supply > 0);
        b.title = CH_VIEW.supply > 0 ? 'Market cap = price x supply' : 'Supply not known yet';
      }
    });
    $$('.lxda-denom button[data-cdn]').forEach(function (b) {
      b.classList.toggle('active', (b.getAttribute('data-cdn') === 'usd') === (CH_VIEW.vs === 'USD'));
    });
    $$('.timeframes button[data-period]').forEach(function (b) {
      b.classList.toggle('active', String(b.getAttribute('data-period') || '').toUpperCase() === CH_VIEW.label);
    });
  }

  // ---- where the series comes from ----------------------------------------------------------------
  //
  // CURATED WITH A COINGECKO ID: market_chart (USD), re-priced in NEAR by dividing by NEAR's own series
  // at the nearest timestamp -- the same method the Trade table's 7D column uses (browser/trade.js).
  // CoinGecko gives prices, not candles, so each range is bucketed into ~120 candles from the points
  // that fall inside each bucket. It carries no per-candle volume, so none is drawn.
  //
  // ANY OTHER TOKEN: GeckoTerminal OHLCV on the token's largest pool against wNEAR, asked for in the
  // quote token (currency=token), which IS NEAR -- real candles with real volume. The dollar view asks
  // the same pool in USD.
  //
  // Neither: no series. The chart stays the design's empty box and the price-change cells em-dash.
  //
  // Both providers answer 429 to Cloudflare, so the PAGE asks them, once per range, and keeps each
  // answer in localStorage (5 minutes for a day, longer for longer ranges). A refused call is retried
  // twice with a pause, then the chart is left empty -- a failure is never cached.
  var CH_SRC = {
    '1D':   { days: 1,   ttl: 300000,  tf: 'minute', agg: 15, limit: 96 },
    '1W':   { days: 7,   ttl: 900000,  tf: 'hour',   agg: 1,  limit: 168 },
    '1M':   { days: 30,  ttl: 1800000, tf: 'hour',   agg: 4,  limit: 180 },
    '1Y':   { days: 365, ttl: 3600000, tf: 'day',    agg: 1,  limit: 365 },
    'PERF': { days: 365, ttl: 3600000, tf: 'day',    agg: 1,  limit: 200 },
  };
  var SERIES_INFLIGHT = {};

  function cacheGet(key, ttl) {
    try {
      var c = JSON.parse(localStorage.getItem(key) || 'null');
      if (c && c.v && Date.now() - c.ts < ttl) return c.v;
    } catch (e) {}
    return null;
  }
  function cachePut(key, v) {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v: v })); } catch (e) {}
  }
  // One request per URL at a time: the perf row and the chart both want NEAR's series.
  function getJsonOnce(key, url, ttl, pick) {
    var hit = cacheGet(key, ttl);
    if (hit) return Promise.resolve(hit);
    if (SERIES_INFLIGHT[key]) return SERIES_INFLIGHT[key];
    var p = fetch(url)
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) {
        var v = pick(j);
        if (!v || !v.length) throw new Error('empty');
        cachePut(key, v);
        return v;
      });
    SERIES_INFLIGHT[key] = p;
    var clear = function () { delete SERIES_INFLIGHT[key]; };
    p.then(clear, clear);
    return p;
  }

  function cgSeries(cg, days, ttl) {
    return getJsonOnce('lumos.nearCg.v1.' + cg + '.' + days,
      'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(cg) + '/market_chart?vs_currency=usd&days=' + days,
      ttl, function (j) {
        return ((j && j.prices) || []).filter(function (q) { return q && q[1] > 0; })
          .map(function (q) { return [Math.round(q[0]), +(+q[1]).toPrecision(8)]; });
      });
  }

  // [t, close, high, low, open, volume, usdClose] -- the shape drawChart and the hover read.
  function bucketise(tok, near, days) {
    if (!tok || tok.length < 2) return [];
    var pts = [];
    var j = 0;
    for (var i = 0; i < tok.length; i++) {
      var t = tok[i][0], u = tok[i][1], v = u;
      if (near) {
        while (j < near.length - 1 && Math.abs(near[j + 1][0] - t) <= Math.abs(near[j][0] - t)) j++;
        if (!near[j] || !(near[j][1] > 0) || Math.abs(near[j][0] - t) > Math.max(3600000, days * 86400000 / 100)) continue;
        v = u / near[j][1];
      }
      pts.push([t, v, u]);
    }
    if (pts.length < 2) return [];
    var t0 = pts[0][0], span = pts[pts.length - 1][0] - t0, size = Math.max(1, span / 120), out = [], cur = null;
    for (var k = 0; k < pts.length; k++) {
      var b = Math.min(119, Math.floor((pts[k][0] - t0) / size)), x = pts[k][1];
      if (!cur || cur.b !== b) {
        if (cur) out.push([cur.t, cur.c, cur.h, cur.l, cur.o, NaN, cur.u]);
        cur = { b: b, t: pts[k][0], o: x, h: x, l: x, c: x, u: pts[k][2] };
      } else {
        if (x > cur.h) cur.h = x;
        if (x < cur.l) cur.l = x;
        cur.c = x; cur.u = pts[k][2];
      }
    }
    if (cur) out.push([cur.t, cur.c, cur.h, cur.l, cur.o, NaN, cur.u]);
    // Each candle opens where the previous one closed, as a traded candle would.
    for (var m = 1; m < out.length; m++) {
      out[m][4] = out[m - 1][1];
      if (out[m][4] > out[m][2]) out[m][2] = out[m][4];
      if (out[m][4] < out[m][3]) out[m][3] = out[m][4];
    }
    return out;
  }

  // The token's largest pool against wNEAR, from the pools the token payload already carries.
  function gtPool(d) {
    var ps = (d && d.pools) || [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p && p.id && ((p.base && p.base.i === WNEAR) || (p.quote && p.quote.i === WNEAR))) return p;
    }
    return null;
  }

  function gtSeries(d, R, vs) {
    var pool = gtPool(d);
    if (!pool) return Promise.reject(new Error('no wNEAR pool'));
    var cur = vs === 'USD' ? 'usd' : 'token';
    var key = 'lumos.nearGt.v1.' + pool.id + '.' + d.i + '.' + R.tf + R.agg + '.' + R.limit + '.' + cur;
    var url = 'https://api.geckoterminal.com/api/v2/networks/near/pools/' + encodeURIComponent(pool.id)
      + '/ohlcv/' + R.tf + '?aggregate=' + R.agg + '&limit=' + R.limit + '&currency=' + cur
      + '&token=' + encodeURIComponent(d.i);
    return getJsonOnce(key, url, R.ttl, function (j) {
      var list = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
      // GeckoTerminal: [seconds, open, high, low, close, volume], newest first.
      return list.filter(function (c) { return c && c[4] > 0; })
        .map(function (c) { return [c[0] * 1000, +c[4], +c[2], +c[3], +c[1], +c[5], null]; })
        .sort(function (a, b) { return a[0] - b[0]; });
    });
  }

  function seriesFor(label, vs) {
    var d = window.__lxnAssetData, R = CH_SRC[label] || CH_SRC['1D'];
    if (!d) return Promise.reject(new Error('no token'));
    if (d.i === WNEAR && vs !== 'USD') return Promise.reject(new Error('NEAR in NEAR'));
    if (d.cg) {
      var jobs = [cgSeries(d.cg, R.days, R.ttl)];
      if (vs !== 'USD') jobs.push(cgSeries('near', R.days, R.ttl));
      return Promise.all(jobs).then(function (r) {
        var pts = bucketise(r[0], vs === 'USD' ? null : r[1], R.days);
        if (pts.length < 2) throw new Error('short');
        return pts;
      }).catch(function (e) {
        // COINGECKO'S FREE TIER IS PER VISITOR IP AND SMALL: a few token pages in a minute (each asks
        // for the token's and NEAR's series) and it answers 429 -- without CORS headers, so the page
        // only sees "Failed to fetch". Measured 2026-10-21 on the third reload. GeckoTerminal has its
        // own, larger allowance and real candles, so a refused CoinGecko call falls back to the token's
        // wNEAR pool there rather than leaving the chart empty.
        if (!gtPool(d)) throw e;
        return gtSeries(d, R, vs).then(function (pts) { if (pts.length < 2) throw new Error('short'); return pts; });
      });
    }
    return gtSeries(d, R, vs).then(function (pts) { if (pts.length < 2) throw new Error('short'); return pts; });
  }

  // 1h, in NEAR terms, from the last hour of the 1D series -- whichever unit is on screen.
  function noteHour(pts, vs) {
    if (PERF.h1 !== 'pending') return;
    var take = function (p) {
      var last = p[p.length - 1], cut = last[0] - 3600000, base = null;
      for (var i = p.length - 1; i >= 0; i--) { if (p[i][0] <= cut) { base = p[i]; break; } }
      LONG['1h'] = (base && base[1] > 0) ? (last[1] - base[1]) / base[1] * 100 : null;
      PERF.h1 = 'done';
      paintPerf(LASTD);
    };
    if (vs !== 'USD') take(pts);
    else seriesFor('1D', 'NEAR').then(take, function () { PERF.h1 = 'done'; paintPerf(LASTD); });
  }

  function loadChart(asset, label, attempt) {
    var c = chartSvg();
    if (!c) return;
    CH_VIEW.label = String(label || CH_VIEW.label || '1D').toUpperCase();
    syncChartControls();
    var gen = ++chGen;
    var want = CH_VIEW.label, vs = CH_VIEW.vs;
    seriesFor(want, vs)
      .then(function (pts) {
        if (gen !== chGen) return;                       // a later range or unit button won
        drawChart(pts); paintOhlcStrip(pts); paintChartHead(pts); fitChartHeight();
        if (want === '1D') noteHour(pts, vs);
      })
      .catch(function (e) {
        if (gen !== chGen) return;
        var hopeless = /no wNEAR pool|NEAR in NEAR|no token|short|empty/.test(String((e && e.message) || ''));
        if (hopeless || (attempt || 0) >= 2) {
          if (want === '1D' && PERF.h1 === 'pending') { PERF.h1 = 'done'; paintPerf(LASTD); }
          return;
        }
        setTimeout(function () {
          if (gen !== chGen) return;
          chGen--;                                         // the retry keeps this click's generation
          loadChart(asset, label, (attempt || 0) + 1);
        }, 1500 * ((attempt || 0) + 1));
      });
  }

  // The O/H/L/C/Δ/Vol strip above the chart, for the range CURRENTLY PLOTTED — so it moves with the
  // 1D/1W/1M/1Y buttons instead of being a fixed 24h figure that contradicts the chart beside it.
  //
  // Only H and L are visible on desktop; O, C, Δ and Vol belong to the phone layout, which is
  // exactly why they went unnoticed. See [[lumoscore-hidden-mock-sweep]] — a desktop-only check
  // cannot see them.
  //
  // Each value falls back to the close when its index is missing (a cached short response, or a
  // candle the upstream returned with nulls), so the figures are always within the real range even
  // if a stale colo is still serving two-element points.
  function paintOhlcStrip(pts) {
    var hi = null, lo = null, vol = 0, haveVol = false;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var h = (isFinite(p[2]) && p[2] > 0) ? p[2] : p[1];
      var l = (isFinite(p[3]) && p[3] > 0) ? p[3] : p[1];
      if (hi == null || h > hi) hi = h;
      if (lo == null || l < lo) lo = l;
      if (isFinite(p[5]) && p[5] > 0) { vol += p[5]; haveVol = true; }
    }
    if (hi == null || lo == null) return;

    var first = pts[0], last = pts[pts.length - 1];
    var open = (isFinite(first[4]) && first[4] > 0) ? first[4] : first[1];
    var close = last[1];
    var delta = (open > 0) ? ((close - open) / open * 100) : null;

    var inUsd = CH_VIEW.vs === 'USD';
    // BARE FIGURES, as lumoscore.com prints them — "H 0.001899", no "XLM" after (RAZA 2026-09-15). The unit
    // is already on the chart and in the price line above it; only the $ view keeps its sign.
    var P5 = function (v) { return (inUsd ? '$' : '') + xrp(v, 5); };
    var VAL = {
      'O': P5(open),
      'H': P5(hi),
      'L': P5(lo),
      'C': P5(close),
      'Δ': (delta == null) ? '—' : ((delta >= 0 ? '+' : '') + delta.toFixed(2) + '%'),
      'VOL': haveVol ? amount(vol) : '—',                     // in the chart's unit, GeckoTerminal candles only
    };

    // The value is the row's other child — the one that is not the `.k` label.
    $$('.pair').forEach(function (row) {
      var k = row.querySelector('.k');
      if (!k) return;
      var which = (k.textContent || '').trim().toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(VAL, which)) return;
      var v = null;
      [].forEach.call(row.children, function (ch) { if (ch !== k) v = ch; });
      if (!v) return;
      plain(v, VAL[which]);
      try { v.classList.add('lxp'); } catch (e) {}
      if (which === 'Δ' && delta != null) {
        row.classList.remove('up', 'down');
        row.classList.add(delta >= 0 ? 'up' : 'down');
      }
    });
  }

  function wireChartRanges(asset) {
    if (window.__lxnDxaRanges) return;
    window.__lxnDxaRanges = 1;
    var btns = $$('button, .tf-btn, .range-btn').filter(function (b) {
      return /^(1D|1W|1M|1Y|ALL)$/i.test((b.textContent || '').trim());
    });
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (o) { o.classList.toggle('active', o === b); });
        loadChart(asset, (b.textContent || '').trim());
      });
    });
  }

  // ---- Exchanges, Holders: no NEAR source yet ------------------------------------------------------
  //
  // The design renders fifteen Aptos trades into the Exchanges tab on load and on every visit to it, and
  // fifty EVM "holders" whenever the Holders tab opens. Phase 1 has no NEAR trade feed or holder list,
  // so both tabs show the design's OWN empty state -- .dxa-empty-state / .mdxa-empty-state, which the
  // design styles and its tab script already removes on every switch -- and the exchanges table, its
  // size filters and its footer are hidden the way the design hides them for a tab without rows.
  //
  // Driven by a MutationObserver on the panel rather than timers after a click: observer callbacks run
  // before the next paint, so the design's mock is replaced in the same frame it was written and is
  // never on screen.
  var EMPTY_ICON = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle>'
    + '<line x1="8" y1="12" x2="16" y2="12"></line></svg>';
  function emptyState(cls, title, text) {
    var box = el('div', cls);
    box.setAttribute('data-logoed', '1');
    box.setAttribute('data-lxn', '1');
    box.innerHTML = EMPTY_ICON;
    box.appendChild(el('h4', null, title));
    box.appendChild(el('p', null, text));
    return box;
  }
  var DONE = false;                                  // the token payload has settled, either way
  function panelEl() { return document.getElementById('dxaPanel') || document.getElementById('mdxaPanel'); }
  function activeTab() {
    var t = document.querySelector('.tabs-bar .tab.active');
    return t ? (t.getAttribute('data-tab') || 'exchanges') : 'exchanges';
  }
  function hideEl(n) { if (n && n.style.display !== 'none') n.style.display = 'none'; }

  function syncPanel() {
    var panel = panelEl();
    if (!panel) return;
    var phone = panel.id === 'mdxaPanel';
    var pre = phone ? 'mdxa' : 'dxa';
    if (activeTab() === 'exchanges' && !panel.querySelector('.' + pre + '-tab-extra')) {
      hideEl(phone ? document.getElementById('mdxaExList') : panel.querySelector('.ex-table'));
      hideEl(document.getElementById(phone ? 'mdxaPanelFilters' : 'dxaPanelFilters'));
      hideEl(panel.querySelector('.panel-foot'));
      if (!panel.querySelector('.' + pre + '-empty-state[data-lxn]')) {
        panel.appendChild(emptyState(pre + '-empty-state', 'No exchanges yet',
          'Trade history for NEAR tokens is not available yet.'));
      }
    }
    var hl = panel.querySelector('.' + pre + '-tab-extra.' + pre + '-holders:not(.lxda)');
    if (hl) {
      hl.innerHTML = '';
      hl.appendChild(emptyState(pre + '-empty-state', 'No holder data yet',
        'Holder lists for NEAR tokens are not available yet.'));
      hl.classList.add('lxda');
    }
    var pl = panel.querySelector('.' + pre + '-tab-extra.' + pre + '-pools:not(.lxda)');
    if (pl && DONE) {
      if (window.__lxnAssetData) paintPools(window.__lxnAssetData, pl);
      else {
        pl.innerHTML = '';
        pl.appendChild(emptyState(pre + '-empty-state', 'Pools unavailable', 'Pool data could not be loaded just now.'));
        pl.classList.add('lxda');
      }
    }
  }

  function watchPanel() {
    var panel = panelEl();
    if (!panel || panel.__lxnWatch) return;
    syncPanel();
    if (!window.MutationObserver) return;
    panel.__lxnWatch = new MutationObserver(syncPanel);
    panel.__lxnWatch.observe(panel, { childList: true, subtree: true });
  }

  // ---- Holders and Pools tabs ---------------------------------------------------------------------
  //
  // Both shipped as visible mock on a page about one XRP Ledger token:
  //   Holders — fifty rows of EVM wallets, "0x00…c3a1  3.14M  12.800%", with "Holders 12,408 /
  //             Top 10 hold 38.4% / Top 50 hold 67.2%" invented above them.
  //   Pools   — seven APTOS pools, "USDC / APT $4.85M 24.8%", "USDC / CELL", each with a live-looking
  //             "Add liquidity →", under four fabricated summary stats.
  // Neither was gated, so unlike the Exchanges tab these were not blank — they were wrong, and one
  // click away.
  //
  // Repainted on every tab click, not once: the design's own tab script rebuilds the holders table
  // when that tab is selected, so a single pass would be overwritten the moment someone switched away
  // and back. Same second-writer shape as the market table on /trade/xrpl.
  // `[class*="dxa-hl-stat"]` matches the phone's `.mdxa-hl-stat` too. The desktop-only selector is
  // why the mobile tabs kept "Holders 12,408 / Top 10 38.4%" against a real 22,008 / 20.8%.
  function statCells(root) { return $$('[class*="dxa-hl-stat"]', root || document); }

  function statByLabel(root, re) {
    var cells = statCells(root);
    for (var i = 0; i < cells.length; i++) {
      if (re.test((cells[i].textContent || '').trim())) return cells[i];
    }
    return null;
  }

  // ALL matching cells, not the first. Desktop and mobile each ship their own stat head and both are
  // in the DOM at once, so writing only the first left whichever layout came second on its mock.
  function setHlStat(re, value) {
    var cells = statCells(document);
    for (var i = 0; i < cells.length; i++) {
      if (!re.test((cells[i].textContent || '').trim())) continue;
      var v = cells[i].querySelector('.val') || cells[i].querySelector('.v') || cells[i].lastElementChild;
      if (!v || v === cells[i].firstElementChild) continue;
      v.textContent = value;
      v.classList.add('lxp');                            // the value gate, same family as the perf row
    }
  }

  // A COUNT THAT ARRIVES BEFORE ITS TAB IS BUILT USED TO BE THROWN AWAY (RAZA 2026-10-17:
  // "sometimes the count for Exchanges, Holders and Pools don't appear until i refresh").
  //
  // This was a single attempt against a DOM that may not exist yet: the design builds the tab bar
  // itself, and the three painters here fire whenever their data lands. Win the race and the number
  // is written; lose it -- a fast API answer, a slow render, any reload where the order flips -- and
  // the loop found no tabs, returned, and nothing ever asked again. Hence "until i refresh": the
  // refresh was not fixing anything, it was re-rolling the race.
  //
  // So every value is REMEMBERED and re-applied until it lands. An observer catches the tab bar the
  // moment the design inserts it, and a bounded timer covers the case where the bar is replaced
  // wholesale rather than mutated. Both stop as soon as nothing is pending, so a page that wins the
  // race first time does no extra work at all.
  var PENDING_COUNTS = [];

  function applyTabCount(re, value) {
    var tabs = $$('.tabs-bar .tab');
    for (var i = 0; i < tabs.length; i++) {
      if (!re.test(tabs[i].textContent || '')) continue;
      var c = tabs[i].querySelector('.count') || tabs[i].querySelector('span:last-child');
      if (!c) return false;                       // the tab exists but its slot does not, yet
      c.textContent = value;
      c.classList.add('lxp');
      return true;
    }
    return false;
  }

  function flushTabCounts() {
    if (!PENDING_COUNTS.length) return;
    PENDING_COUNTS = PENDING_COUNTS.filter(function (p) { return !applyTabCount(p.re, p.value); });
  }

  function setTabCount(re, value) {
    // The newest value for a tab replaces any older one still waiting, so a retry can never write a
    // figure that has already been superseded.
    PENDING_COUNTS = PENDING_COUNTS.filter(function (p) { return String(p.re) !== String(re); });
    if (applyTabCount(re, value)) return;
    PENDING_COUNTS.push({ re: re, value: value });
    if (!setTabCount._wired) {
      setTabCount._wired = 1;
      try {
        new MutationObserver(flushTabCounts).observe(document.body, { childList: true, subtree: true });
      } catch (e) {}
      var n = 0, iv = setInterval(function () {
        flushTabCounts();
        if (++n > 40 || !PENDING_COUNTS.length) clearInterval(iv);
      }, 300);
    }
  }

  // ---- Pools, from the token payload ------------------------------------------------------------
  //
  // Every pair DexScreener knows for the token, largest first (the payload carries up to 25 and the
  // full count). Four columns as on Stellar's Pools tab, with the design's own 24h volume in place of
  // Stellar's LP holders, which NEAR has no source for: Pool, TVL, 24h volume, Pool share. The share
  // is each pool's part of the listed pools' combined TVL. Rows do not navigate: NEAR has no pool page
  // yet, and sending a row click off-site would be a behaviour the design does not have.
  function money0(v) { return (v == null || !isFinite(v)) ? '—' : usdCompact(v); }

  // The two pair marks. The design's slots carry "$" / "★" glyphs on a gradient; each is cleared and
  // given the token's logo, or initials drawn in an svg (an svg child keeps the logo healer off).
  function poolIcon(slot, logo, sym) {
    if (!slot) return;
    slot.setAttribute('data-lxc', '');
    slot.setAttribute('data-logoed', '1');
    slot.style.background = 'rgba(255,255,255,.10)';
    slot.style.overflow = 'hidden';
    slot.textContent = '';
    var initials = function () {
      slot.innerHTML = '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true"><text x="16" y="17"'
        + ' text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="800" fill="currentColor"></text></svg>';
      slot.querySelector('text').textContent = String(sym || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    };
    if (/^(data:image\/|https:\/\/|\/assets\/)/i.test(logo || '')) {
      var im = document.createElement('img');
      im.alt = '';
      im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
      im.onerror = initials;
      im.src = logo;
      slot.appendChild(im);
    } else {
      initials();
    }
  }

  function poolCounts(d) {
    var pools = d.pools || [];
    var n = d.poolCount != null ? +d.poolCount : pools.length;
    var more = n > pools.length ? '+' : '';
    var tvl = 0, vol = 0;
    pools.forEach(function (p) { tvl += +p.liqUsd || 0; vol += +p.volUsd || 0; });
    setTabCount(/pools/i, String(n));
    setHlStat(/^(active\s+)?pools/i, String(n));
    setHlStat(/^(combined\s+)?tvl/i, money0(tvl) + more);
    setHlStat(/^24h vol/i, money0(vol) + more);
    return tvl;
  }

  function paintPools(d, extra) {
    if (!extra || extra.classList.contains('lxda')) return;
    var pools = d.pools || [];
    var tvl = poolCounts(d);
    var logos = d.logos || {};
    // The design's fourth stat (Avg APR) has no NEAR source and Stellar's tab has no fourth stat.
    statCells(extra).forEach(function (cell) {
      if (/^avg apr/i.test((cell.textContent || '').trim()) && cell.parentNode) cell.parentNode.removeChild(cell);
    });
    var body = extra.querySelector('tbody') || extra.querySelector('.mdxa-pl-list');
    var template = body && body.children.length ? body.children[0].cloneNode(true) : null;
    if (body && template) {
      var table = body.closest ? body.closest('table') : null;
      if (table) {
        var WANT = ['Pool', 'TVL', '24h volume', 'Pool share'];
        [].slice.call(table.querySelectorAll('thead th')).forEach(function (th, k) {
          if (k < WANT.length) plain(th, WANT[k]);
          else if (th.parentNode) th.parentNode.removeChild(th);
        });
      }
      body.innerHTML = '';
      pools.forEach(function (p) {
        var tr = template.cloneNode(true), td = tr.children;
        var nameEl = tr.querySelector('[class*="dxa-pl-name"]');
        if (nameEl) nameEl.textContent = p.pair;
        var slots = tr.querySelectorAll('.dxa-pl-ico, .mdxa-pl-ico');
        // wNEAR carries no logo in its own metadata; it is NEAR, so it wears NEAR's mark.
        poolIcon(slots[0], logos[p.base.i] || (p.base.i === WNEAR ? NEAR_LOGO : ''), p.base.s);
        poolIcon(slots[1], logos[p.quote.i] || (p.quote.i === WNEAR ? NEAR_LOGO : ''), p.quote.s);
        var icos = tr.querySelector('.dxa-pl-icos');
        if (icos) icos.setAttribute('data-paired', '1');      // the healer's own "done" marker
        var share = (tvl > 0 && p.liqUsd != null) ? ((p.liqUsd / tvl) * 100).toFixed(1) + '%' : '—';
        var mTvl = tr.querySelector('.mdxa-pl-tvl');
        if (mTvl) {
          mTvl.textContent = money0(p.liqUsd);
          var mApr = tr.querySelector('.mdxa-pl-apr');
          // "44.9% share", never a bare "44.9%": see the XRPL note on the logo healer eating this cell.
          if (mApr) { plain(mApr, share === '—' ? '—' : (share + ' share')); mApr.className = 'mdxa-pl-apr'; }
          var pill = tr.querySelector('.net-pill');
          if (pill) plain(pill, 'NEAR Protocol');
        } else {
          if (td[1]) { td[1].className = 'mono'; td[1].textContent = money0(p.liqUsd); }
          if (td[2]) { td[2].className = 'mono'; td[2].textContent = money0(p.volUsd); }
          if (td[3]) { td[3].className = 'mono'; td[3].textContent = share; }
          while (tr.children.length > 4) tr.removeChild(tr.lastElementChild);
          tr.className = 'dxa-pl-row';
        }
        tr.setAttribute('data-lxpool', p.id);
        body.appendChild(tr);
      });
      if (!pools.length) {
        var none = emptyState(/mdxa/.test(extra.className) ? 'mdxa-empty-state' : 'dxa-empty-state',
          'No pools found', 'No pool lists this token on NEAR right now.');
        (table || body).parentNode.insertBefore(none, table || body);
        hideEl(table || body);
      }
    }
    extra.classList.add('lxda');
  }

  // ---- identity ---------------------------------------------------------------------------------
  // ---- copying the issuer ---------------------------------------------------------------------------
  //
  // THE CHIP HELD THE ADDRESS AND NOTHING COPIED IT. `data-copy` is filled in below, but the handler
  // that reads it lived in Stellar's `lx-dxadata`, which this build strips whole — so a click did
  // nothing and said nothing (RAZA 2026-09-15). lumoscore.com copies on a click anywhere on the chip
  // and shows its bottom-centre "Copied to clipboard" toast.
  //
  // The toast is Stellar's own `.lx-ctoast` — class names and styling taken from `lx-chipcopy`, which
  // produces the one in RAZA's screenshot — so it is the same element, not a lookalike. Window capture,
  // because the design routes clicks on this card through handlers of its own.
  function copyToast(msg) {
    if (!document.getElementById('lx-copytoast-css')) {
      var st = document.createElement('style');
      st.id = 'lx-copytoast-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16);animation:lxCtIn .25s ease}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}'
        + '@keyframes lxCtIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast';
    t.innerHTML = '<span class="ci"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span></span>';
    t.lastChild.textContent = msg;
    stack.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s ease,transform .25s ease';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 1800);
  }

  // PUBLISHED, so the swap and limit-order layers can use the same one (RAZA 2026-10-06: "When buying
  // / selling asset on Trade-asset page, its not showing the message at the bottom like it does on
  // Stellar" — lumoscore.com answers a filled swap with "✓ Sold 1.1541 XLM" bottom-centre).
  //
  // Those layers are separate emitted scripts with their own scopes, so the only way to share this is
  // through window — and sharing it is better than a third and fourth copy of the same twenty lines,
  // which is how four of them already exist elsewhere in this build. createpool.js and pooldetail.js
  // already look for `window.lxToast` first and fall back to their own; this is what they were looking
  // for. Assigned rather than defined here, so there is still exactly one implementation.
  if (!window.lxToast) window.lxToast = function (msg) { try { copyToast(msg); } catch (e) {} };

  function wireIssuerCopy() {
    if (window.__lxnIssuerCopy) return;
    window.__lxnIssuerCopy = 1;
    window.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('.addr[data-copy]') : null;
      if (!chip || !chip.closest('.item, .asset-meta, .asset-id')) return;
      var text = chip.getAttribute('data-copy') || '';
      if (!isId(text)) return;                                // only ever a NEAR contract id, never mock
      e.preventDefault();
      e.stopImmediatePropagation();
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
        else fallback();
      } catch (err) { fallback(); }
      copyToast('Copied to clipboard');
    }, true);
  }

  function paintHeader(asset, d) {
    var h1 = $('h1.asset-name') || $('.asset-name');
    if (h1) {
      h1.textContent = asset.code;
      // THE CURATED TICK: membership of LumosCore's curated NEAR list (the payload's own flag), the
      // same rule the Trade table ticks its rows by. Not "verified by the issuer" -- NEAR has no issuer
      // verification -- so the tooltip says what it actually means.
      if (d && d.curated && !h1.querySelector('.lx-vtick')) {
        var vt = el('span', 'lx-vtick');
        vt.title = 'Curated on LumosCore';
        vt.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:9px;'
          + 'border-radius:50%;background:#2fb46a;color:#fff;vertical-align:middle;flex:none';
        vt.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        h1.appendChild(vt);
      }
    }
    // The design's second label (hidden by its own CSS on these builds) still names a mock ticker.
    $$('.asset-ticker').forEach(function (t) { plain(t, asset.code); });

    try {
      document.title = asset.code + ' price, pools and holders on NEAR | LumosCore';
    } catch (e) {}

    // THE CONTRACT CHIP, where the XRPL page shows the issuer. The label says Contract, the text is the
    // contract id (shortened when it is a 64-hex implicit account), and data-copy holds the whole id.
    var addrEl = $('.item .addr') || $('.asset-meta .addr') || $('.asset-id .addr');
    if (addrEl) {
      addrEl.setAttribute('data-copy', asset.id);
      addrEl.setAttribute('data-copy-label', asset.code + ' contract');
      addrEl.setAttribute('title', asset.id);
      var tag = addrEl.parentNode && addrEl.parentNode.querySelector('.label-tag');
      if (tag) plain(tag, 'Contract');
      var addrTxt = ' ' + shortId(asset.id) + ' ';
      var wrote = false;
      [].forEach.call(addrEl.childNodes, function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = addrTxt; wrote = true; }
      });
      if (!wrote) addrEl.insertBefore(document.createTextNode(addrTxt), addrEl.querySelector('.copy-i'));
      // THE PADLOCK. Green only when the contract is known to be immutable, red when it is known not to
      // be (a full-access key can redeploy it), hidden when that cannot be told -- and zero keys alone
      // cannot tell it, because a contract with no keys may still mint (see /lxapi/neartoken).
      // The phone's chip carries the same two icons with no class: the lock is the first svg, the copy
      // icon the second.
      var svgs = addrEl.querySelectorAll('svg');
      var lock = addrEl.querySelector('.lock-i') || (svgs.length > 1 ? svgs[0] : null);
      if (lock) {
        var lk = d && d.lock ? d.lock.locked : null;
        lock.style.display = lk == null ? 'none' : '';
        lock.style.color = lk === true ? 'var(--green)' : 'var(--red,#ff5b5b)';
        lock.setAttribute('aria-label', lk === true ? 'Contract cannot be changed' : 'Contract can be upgraded by its owner');
      }
      wireIssuerCopy();
    }

    // No home-domain source on NEAR: the design's "circle.com" pill is hidden rather than guessed.
    var web = $('.website');
    if (web) {
      web.style.display = 'none';
      if (web.tagName === 'A') web.setAttribute('href', '#');
    }

    paintLogo(asset, d);
  }

  // THE TOKEN'S LOGO WAS A BLANK GREY SQUARE ON EVERY PAGE.
  //
  // The design ships `<div class="asset-logo" data-lxc=""></div>` — an empty 64px box whose only
  // fill was a hardcoded USDC-blue gradient in CSS. `data-lxc` is the logo painter's OPT-OUT marker
  // (the same one `.lxad-logo` uses to defend itself), so the healer that fills every other icon on
  // the site skips this element BY DESIGN — and the design's own filler was never carried into the
  // fork. Nothing painted it, nothing errored, and the box measured a healthy 64x64 the whole time.
  //
  // The id is xrpl.to's md5, which /lxapi/xrpltoken already returns; `iss`+`cur` is the fallback for
  // the first paint, before that response lands (the endpoint derives the same md5 server-side).
  // Either way it goes through /lxapi/xrplthumb — the thumbnail endpoint needs the API key, and the
  // key must not reach the browser. See [[lumoscore-xrpl-wallet-logos]].
  function paintLogo(asset, d) {
    var box = $('.asset-logo');
    if (!box || box.getAttribute('data-lxlogo') === asset.id) return;
    var src = (d && /^(data:image\/|https:\/\/)/i.test(d.logo || '')) ? d.logo : '';
    var initials = function () {
      box.innerHTML = '';
      box.textContent = String(asset.code || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      box.style.backgroundImage = 'none';
      box.style.backgroundColor = 'rgba(255,255,255,.10)';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.fontWeight = '800';
      box.style.fontSize = '18px';
      box.style.color = '#fff';
      box.setAttribute('data-logoed', '1');      // three characters in a small box: the healer's shape
    };
    box.setAttribute('data-lxlogo', asset.id);
    if (!src) { initials(); return; }
    var img = document.createElement('img');
    img.alt = ''; img.width = 64; img.height = 64;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
    img.onerror = initials;
    box.innerHTML = '';
    // Also the box's background: the review dialog reads the page token's mark off it.
    box.style.backgroundImage = 'url("' + src.replace(/"/g, '%22') + '")';
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    box.appendChild(img);
    img.src = src;
  }

  function shortAddr(a) {
    return (a && a.length > 14) ? (a.slice(0, 6) + '…' + a.slice(-4)) : (a || '');
  }

  // THE TRADE PANEL WAS NAMING THE WRONG TOKEN ENTIRELY. On the RLUSD page it read "Buy USDC" /
  // "Sell USDC", with "APT" on the pay side and "USDC" on the receive side, beside a holder filter
  // offering "10+ XLM / 100+ XLM / 1000+ XLM" and a pair label reading "LUMOS / XLM".
  //
  // Every one of those is the design's mock, and every one is a different chain's asset. The left of
  // the page was correct — real price, real order book, real stats — which is what made this easy to
  // walk past: the panel people actually trade in was the part still describing Aptos and Stellar.
  //
  // These are LABELS, not data: the panel's behaviour is unchanged, it is told which token it is on.
  function paintLabels(asset) {
    var code = asset.code;
    var d = window.__lxnAssetData;
    var tokLogo = (d && /^(data:image\/|https:\/\/)/i.test(d.logo || '')) ? d.logo.replace(/"/g, '%22') : '';

    $$('[class*="dxa-side-btn"]').forEach(function (b) {
      var sell = b.classList.contains('sell');
      // The limit pane's toggle reads a bare Buy / Sell in the design; only the swap pane names the token.
      var inSwap = !!(b.closest && b.closest('.dxa-pane-swap, .mdxa-pane-swap'));
      var t = inSwap ? ((sell ? 'Sell ' : 'Buy ') + code) : (sell ? 'Sell' : 'Buy');
      if (b.textContent.trim() !== t) b.textContent = t;
    });

    // Swap chips: pay side and receive side flip with Buy/Sell -- buying spends NEAR to get the token.
    var swaps = $$('.dxa-pane-swap, .mdxa-pane-swap');
    swaps.forEach(function (pane) {
      var sellActive = !!pane.querySelector('[class*="dxa-side-btn"].sell.active');
      var order = sellActive ? [code, 'NEAR'] : ['NEAR', code];
      $$('[class*="dxa-trade-asset"]', pane).forEach(function (c, i) {
        if (i > 1) return;
        chipTo(c, order[i], order[i] === 'NEAR' ? NEAR_LOGO : tokLogo);
      });
    });
    // Limit chips: limit price in NEAR, amount in the token, total in NEAR (the phone has no total row
    // in the design; lx-mobtrade adds one and it is named the same way).
    $$('.dxa-pane-limit, .mdxa-pane-limit').forEach(function (pane) {
      var units = ['NEAR', code, 'NEAR'];
      $$('[class*="dxa-trade-field"]', pane).forEach(function (f, i) {
        var c = f.querySelector('[class*="dxa-trade-asset"]');
        if (c && units[i]) chipTo(c, units[i], units[i] === 'NEAR' ? NEAR_LOGO : tokLogo);
      });
    });

    // Holder-size filters are denominated in the native unit (hidden while there are no trades).
    $$('.chip').forEach(function (c) {
      var t = (c.textContent || '');
      if (/\bXLM\b/.test(t)) c.textContent = t.replace(/\bXLM\b/g, 'NEAR');
    });
  }

  // One chip, either layout. The phone draws its chips in CSS (lx-mobtrade stamps data-lxmt-code="XLM"
  // and an XLM mark through ::after / ::before); data-lxxc and --lxx-logo are the two hooks the head
  // stylesheet of this layer lets win over that, the same pair the XRPL limit layer uses.
  function chipTo(c, unit, logo) {
    try { c.setAttribute('data-logoed', '1'); c.removeAttribute('data-logo'); c.style.background = ''; } catch (e) {}
    if (/(^|\s)mdxa-/.test(c.className)) {
      if (c.textContent.trim() !== unit) c.textContent = unit;
      c.setAttribute('data-lxxc', unit);
      c.style.setProperty('--lxx-logo', logo ? 'url("' + logo + '")' : 'none');
      return;
    }
    var inSwap = !!(c.closest && c.closest('.dxa-pane-swap'));
    if (!inSwap) {
      // The desktop limit chips are bare text in the design. An empty data-logo child is the logo
      // engine's own escape, so a four-letter "NEAR" is not taken for a ticker slot.
      if ((c.__lxnUnit || '') === unit) return;
      c.__lxnUnit = unit;
      c.textContent = unit;
      var esc = document.createElement('span');
      esc.setAttribute('data-logo', '');
      esc.style.display = 'none';
      c.appendChild(esc);
      return;
    }
    c.__lxnChip = { code: unit, logo: logo || '' };
    paintSwapChip(c);
    if (!c.__lxnChipObs && window.MutationObserver) {
      var n = 0;
      c.__lxnChipObs = new MutationObserver(function () {
        if (n > 30) return;
        var ok = c.querySelector('.dxa-trade-ic') && !c.style.backgroundImage;
        if (!ok) { n++; paintSwapChip(c); }
      });
      c.__lxnChipObs.observe(c, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }
  }

  function paintSwapChip(c) {
    var s = c.__lxnChip;
    if (!s) return;
    c.style.background = '';
    c.removeAttribute('data-logo');
    c.setAttribute('data-logoed', '1');
    c.textContent = '';
    var ic = el('span', 'dxa-trade-ic');
    ic.setAttribute('data-logoed', '1');
    ic.setAttribute('data-lxfixed', '1');
    // The container's logo engine skips an element that holds a [data-logo] child; with none, it took the chip's
    // " ATOM " for a ticker slot, stamped data-logo="ATOM" and redrew it forever as a generic 18x13 mark. An empty
    // value names no logo, so the engine never paints the mark itself (the snapshot button uses the same escape).
    ic.setAttribute('data-logo', '');
    ic.style.cssText = (s.logo ? 'background:url("' + s.logo + '") center center / cover no-repeat transparent;'
      : 'background:rgba(255,255,255,.12);') + 'box-shadow:none;border-radius:50%';   // cover: a padded logo read as a dot
    // The review dialog (lx-feemodal) reads a leg's mark from --lxtic first (RAZA 2026-09-15: "There's no logo showing up for
    // ATOM when im buying it (review step)").
    if (s.logo) ic.style.setProperty('--lxtic', 'url("' + s.logo + '")');
    c.appendChild(ic);
    c.appendChild(document.createTextNode(' ' + s.code + ' '));
  }

  // The Buy/Sell toggle is the design's own, so the chips are re-labelled whenever it changes rather
  // than only on load — otherwise switching to Sell leaves the pay side still saying XRP.
  function watchSide(asset) {
    if (window.__lxnSideWatch) return;
    window.__lxnSideWatch = 1;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[class*="dxa-side-btn"]');
      if (!b) return;
      setTimeout(function () { paintLabels(asset); }, 0);   // after the design flips .active
    }, true);
  }

  // No NEAR order book yet: the headings name this page's units and the spread is an em dash.
  function paintBookHead(asset) {
    $$('.dxa-ob-head, .mdxa-ob-head').forEach(function (h) {
      var sp = h.querySelectorAll('span');
      if (sp[0]) plain(sp[0], 'Price (NEAR)');
      if (sp[1]) plain(sp[1], (h.className.indexOf('mdxa') >= 0 ? 'Amt (' : 'Amount (') + asset.code + ')');
      if (sp[2]) plain(sp[2], 'Depth (NEAR)');
    });
    $$('.dxa-ob-spread, .mdxa-ob-spread').forEach(function (s2) {
      var sp = s2.querySelectorAll('span');
      if (sp[1]) plain(sp[1], '—');
      if (sp[2]) plain(sp[2], '');
    });
  }

  function note(text) {
    var a = $('#dxaObAsks') || $('#mdxaObAsks');
    var b = $('#dxaObBids') || $('#mdxaObBids');
    [a, b].forEach(function (n, i) {
      if (!n) return;
      n.innerHTML = '';
      n.classList.add('lxda');
      if (i) return;                                     // said once, in the asks panel
      var d = el('div', 'dxa-ob-row', text);
      d.setAttribute('data-logoed', '1');
      d.style.cssText = 'opacity:.65;justify-content:center;grid-template-columns:1fr;text-align:center';
      n.appendChild(d);
    });
  }

  // THE SWAP PANEL IS THE DESIGN'S, AND NOTHING IN THIS LAYER EVER WIRED IT.
  //
  // What it was showing, live, under an XRP Ledger heading — every value the template's Aptos mock:
  //     Rate          1 APT = 0.23659 USDC
  //     Min received  23.541 USDC
  //     Network fee   0.00001 APT
  // with the pay and receive boxes pre-filled 100 and 23.659. A trading panel quoting a rate for
  // the wrong chain, from numbers nobody computed, is the worst thing that was left on this page:
  // it does not look like placeholder text.
  //
  // Treated the same way as Create Pool, on RAZA's call: state what we actually know, em-dash what
  // we do not, empty the invented amounts, and disable the action with a label that says why.
  // Building a real quote — pricing against the order book, slippage, price impact — is a feature,
  // and this build has never round-tripped a signature.
  //
  // Deliberately NOT touched: "Slippage tolerance" is a user setting rather than a quote, and the
  // trading-fee row is owned by the fee layer and already reads correctly.
  function setSumRow(label, value) {
    var rows = $$('.dxa-tsum-row, .mdxa-tsum');
    for (var i = 0; i < rows.length; i++) {
      var kids = rows[i].children;
      if (kids.length < 2) continue;
      if ((kids[0].textContent || '').trim().toLowerCase() !== label) continue;
      var v = kids[kids.length - 1];
      v.textContent = value;
      v.classList.add('lxp');
    }
  }

  // The panel's figures are the design's Aptos mock -- "Balance: 1,250 APT", "1 APT = 0.23659 USDC",
  // "Min received 23.541 USDC", "Network fee 0.00001 APT", inputs pre-filled 100 / 23.659. Nothing on
  // NEAR quotes or executes a trade yet, so: what is known is stated (the rate and the market price),
  // everything else is an em dash, the invented amounts are emptied, and the action buttons are
  // disabled with a label that says why. User settings (slippage, expiry) are left as the design has
  // them. Swap and limit execution are the next phase.
  function paintPanel(asset) {
    var d = window.__lxnAssetData;
    var p = d && d.price != null && isFinite(d.price) ? +d.price : null;
    $$('[class*="dxa-trade-frow"]').forEach(function (row) {
      var k = row.children[0], v = row.children[row.children.length - 1];
      if (!k || !v || k === v) return;
      var key = (k.textContent || '').trim().toLowerCase(), phone = /mdxa-/.test(row.className);
      var txt = null;
      if (/^you pay/.test(key)) txt = (phone ? 'Bal: ' : 'Balance: ') + '—';
      else if (/^you receive/.test(key) || /^total/.test(key)) txt = '';
      else if (/^limit price/.test(key)) txt = (phone ? 'Mkt: ' : 'Market: ') + (p != null ? xrp(p) : '—');
      else if (/^amount/.test(key)) txt = (phone ? 'Avail: ' : 'Available: ') + '—';
      if (txt == null) return;
      plain(v, txt);
      v.classList.add('lxp');
    });
    $$('[class*="dxa-trade-ir"] input').forEach(function (inp) {
      if (inp.__lxnCleared) return;
      inp.__lxnCleared = 1;
      inp.value = '';
      if (!inp.placeholder) inp.placeholder = '0.00';
    });
    setSumRow('rate', p != null ? ('1 ' + asset.code + ' = ' + xrp(p) + ' NEAR') : '—');
    ['price impact', 'min received', 'network fee', 'filled when'].forEach(function (k) { setSumRow(k, '—'); });
    $$('.dxa-tsum-row .mono, .mdxa-tsum .mono').forEach(function (v) { v.classList.add('lxp'); });
    $$('.dxa-trade-cta, .mdxa-trade-cta').forEach(function (b) {
      var limit = !!(b.closest && b.closest('.dxa-pane-limit, .mdxa-pane-limit'));
      var t = limit ? 'Limit orders on NEAR are coming soon' : 'Swaps on NEAR are coming soon';
      // lx-gate swaps this button to "Connect wallet" while no wallet is connected and, on connect,
      // RESTORES what it saved in data-lxorig / data-lxdis -- which it saved before this ran, i.e. the
      // design's enabled "Place Buy Order", whose click lx-feemodal turns into Stellar's review dialog.
      // Writing both attributes means the restore lands on this disabled label instead.
      b.setAttribute('data-lxorig', t);
      b.setAttribute('data-lxdis', '1');
      if ((b.textContent || '').trim() === 'Connect wallet') return;      // the gate owns it until connect
      if (b.textContent !== t) b.textContent = t;
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      b.style.opacity = '.55';
      b.style.cursor = 'not-allowed';
    });
  }

  // TWO BLOCKS THAT EXIST ONLY ON THE PHONE, and neither was ever painted.
  //
  // Found by re-checking today's trade-asset work at 375px rather than trusting the desktop pass:
  //
  //   * `.ohlc-strip` — "O 4.55 APT  H 4.62 APT  L 4.54 APT  C 4.60 APT". Four fabricated prices in
  //     another chain's asset, across the top of the chart. There is no desktop equivalent, which is
  //     exactly why it survived.
  //   * `.asset-description` — 251 characters describing USD Coin and Circle, shown on the RLUSD
  //     page. Not merely the wrong chain: the wrong company's prose under someone else's token.
  //
  // Both are BLANKED rather than invented. /lxapi/xrpltoken carries no open/close and no description
  // — the fields simply are not in the payload — so there is nothing honest to put there. An em dash
  // says "not known"; leaving the design's text says something false and specific.
  function paintMobileOnly() {
    // The strip ships "O 4.55 APT  H 4.62 APT  L 4.54 APT  C 4.60 APT" — another chain's asset,
    // four fabricated prices. Dashed here so that is never what a reader sees, then filled with the
    // real O/H/L/C/Δ/Vol by paintOhlcStrip() as soon as the chart's candles land. If the chart feed
    // fails, the dashes are the correct final state and stay.
    var strip = $('.ohlc-strip');
    if (strip) {
      $$('.v', strip).forEach(function (v) { v.textContent = '—'; });
    }

  }

  // THE DESCRIPTION SLOT, AND WHY IT IS USUALLY EMPTY.
  //
  // `.asset-description` ships with 251 characters about USD Coin and Circle — the wrong company's
  // prose under someone else's token — so it cannot simply be left alone. It used to be deleted
  // outright. It is now filled when, and only when, we actually know the token.
  //
  // TWO SOURCES, IN THIS ORDER:
  //
  //   1. `__lxTokenRegistry[CODE-ISSUER].desc` — our own launchpad's mints, where the creator wrote
  //      the text through our form. We control it, so it wins.
  //   2. /lxapi/xrplmeta — XRPLMeta, the XRP Ledger's metadata service, which aggregates the
  //      issuer-published metadata and has descriptions for blue-chips and meme tokens alike.
  //
  // This used to remove the paragraph outright, on the conclusion that no description source
  // existed. Two of the three facts behind that were right — /lxapi/xrpltoken carries no
  // description (130+ fields, none of them one), and ripple.com publishes no [[TOKENS]] block in
  // its `xrp-ledger.toml` — but the conclusion was wrong: XRPLMeta is exactly the service that
  // aggregates what those two checks were looking for. See [[lumoscore-asset-descriptions]].
  //
  // HIDDEN FIRST, NOT REMOVED. The paragraph ships with 251 characters about USD Coin and Circle,
  // so it cannot be left visible for the length of a fetch — but removing it means there is nothing
  // left to fill. So it is hidden immediately and then either filled or removed, which shows the
  // mock to nobody and still leaves no empty gap for a token that has no description.
  //
  // The text is ATTACKER-CONTROLLED — anyone can issue a token and publish metadata for it — so it
  // goes in through plain(), which is textContent, never innerHTML. The edge caps and normalises it.
  // No description source on NEAR yet (token metadata carries none), so every token gets Stellar's
  // generic line in NEAR words rather than the design's 251 characters about Circle.
  function paintDescription() {
    var desc = $('.asset-description');
    if (!desc) return;
    var a = window.__lxnAssetRef || null;
    if (!a) { if (desc.parentNode) desc.parentNode.removeChild(desc); return; }
    var d = window.__lxnAssetData;
    var nm = d && d.name && d.name.toLowerCase() !== String(a.code).toLowerCase() ? (' (' + d.name + ')') : '';
    plain(desc, a.code + nm + ' is a token on NEAR Protocol. Its price, 24h volume and pools come from '
      + 'Rhea Finance and DexScreener, and its supply is read from the token contract itself.');
    desc.style.display = '';
  }

  function load() {
    var asks = $('#dxaObAsks') || $('#mdxaObAsks');
    if (!asks) return;                                  // not this page

    var root = document.documentElement;
    var asset = fromUrl();
    window.__lxnAssetRef = asset;
    lift();
    note('No order book for NEAR tokens yet.');
    watchPanel();
    paintMobileOnly();
    // The structural gates (the exchanges panel and its footer) lift now: watchPanel has already
    // replaced what they were hiding.
    root.classList.add('lxn-dxa');

    var finish = function (d) {
      if (asset && d && d.ok && d.symbol) asset.code = d.symbol;
      window.__lxnAssetData = d && d.ok ? d : null;
      DONE = true;
      if (asset) {
        paintHeader(asset, window.__lxnAssetData);
        paintBookHead(asset);
        paintLabels(asset);
        watchSide(asset);
        paintPanel(asset);
        paintDescription();
      }
      paintStats(window.__lxnAssetData);
      if (asset) liftIdentity();                          // no token in the URL: the mock header stays gated
      // Identity-bearing gates (trade-panel labels, chips) lift only now, with the token's own words in.
      root.classList.add('lxn-dxa-id');
      setTabCount(/exchanges/i, '—');
      setTabCount(/holders/i, '—');
      syncPanel();
      if (!window.__lxnAssetData) { setTabCount(/pools/i, '—'); PERF.h1 = PERF.long = 'done'; paintPerf(null); return; }
      paintPerf(window.__lxnAssetData);
      paintChartHead(null);                               // price + 24h pill now; the range line with the chart
      // lx-mobtrade adds the phone's limit Total row on its own timer; name its chip once it exists.
      [1000, 2500].forEach(function (ms) { setTimeout(function () { paintLabels(asset); }, ms); });
      try { window.dispatchEvent(new CustomEvent('lxn:assetdata')); } catch (e) {}
      chartControls(asset);
      loadChart(asset, '1D');
      wireChartRanges(asset);
      loadLongPerf(asset);
      poolCounts(window.__lxnAssetData);
      syncPanel();
    };

    if (!asset) { window.__lxnAssetMiss = 'nottoken'; finish(null); return; }

    fetch('/lxapi/neartoken?i=' + encodeURIComponent(asset.id))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          // The 24h change in NEAR terms, for the NEAR-denominated headline and price-change row: the
          // payload's change is in dollars, NEAR's own move is divided out (as on the Trade table).
          d.d24n = (d.d24 != null && d.near24 != null) ? ((1 + d.d24 / 100) / (1 + d.near24 / 100) - 1) * 100 : null;
          if (d.i === WNEAR) d.d24n = 0;
        }
        window.__lxnAssetMiss = (d && d.ok) ? (d.price == null ? 'none' : null) : ((d && d.none) ? 'nottoken' : 'down');
        finish(d);
      })
      .catch(function () { window.__lxnAssetMiss = 'down'; finish(null); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxnAssetReload = load;
})();
