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
    // The ORDER BOOK is no longer lifted here: it now holds real rows (or a note) only once the DCL / pool
    // read answers, and lifting it early showed the design's Aptos ladder ("4.243612 · 497.15") for the
    // ~1s that read takes. paintBook() and note() lift it, each in the same statement as its content.

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
      '1h': LONG['1h'], '24h': (d && d.d24n != null) ? d.d24n : LONG['24h'], '7d': LONG['7d'],
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
    // History that STARTS within the 3-day tolerance above (HOOT's begins 30 days back to the day) measures
    // from its first close, rather than the window being declared too long for a series that covers it.
    if (!base) base = pts[0];
    if (!base || !(base[1] > 0)) return null;
    return (last[1] - base[1]) / base[1] * 100;
  }

  // 7d / 1m / 3m / 6m from ONE daily series in NEAR terms (a year from CoinGecko, or 200 days of
  // GeckoTerminal day candles), never three calls. A series too short for a window leaves it an em dash.
  // Retried like the chart: a refused feed is a busy minute, not a token without a history.
  function loadLongPerf(asset, attempt) {
    if (!$$('[class*="dxa-perf-cell"]').length) return;   // both layouts — see paintPerf
    var at = attempt || 0;
    seriesFor('PERF', 'NEAR')
      .then(function (pts) {
        // A series that starts at the pool's own first deposit (idxSeries) holds the token's whole market, so a
        // window longer than its life measures from that opening price rather than em-dashing: there is no older
        // price the box could be missing (RAZA 2026-11-05: "lumos isnt showing its chart and neither the %change
        // boxes"). Any other short series keeps the rule above.
        var over = function (days) {
          var v = changeOver(pts, days), f = pts[0][4], l = pts[pts.length - 1][1];            // f: the first candle's OPEN
          return (v == null && pts.born && f > 0) ? (l - f) / f * 100 : v;
        };
        LONG['7d'] = over(7);
        LONG['1m'] = over(30);
        LONG['3m'] = over(90);
        LONG['6m'] = over(180);
        PERF.long = 'done'; paintPerf(LASTD);
      }, function (e) {
        var hopeless = /no wNEAR pool|NEAR in NEAR|no token|short|empty/.test(String((e && e.message) || ''));
        if (!hopeless && at < CH_RETRY.length - 1) { setTimeout(function () { loadLongPerf(asset, at + 1); }, CH_RETRY[at + 1]); return; }
        PERF.long = 'done'; paintPerf(LASTD);
      });
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
    // Stellar's wording and shape (RAZA 2026-10-29): the figure alone, "<CODE> issued" beneath it -- the
    // token's code is already in that line, so no unit beside the number.
    var supplyCell = function () {
      setCell('supply', (d && d.supply != null) ? statAmt(d.supply) : null, '',
        (d && d.symbol) ? (d.symbol + ' issued') : '');
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

  // STELLAR'S CHART, GEOMETRY AND ALL (RAZA 2026-10-29: "The volume bars in the graph & time is not appearing on
  // Near ... not even appearing when clicking on 1W, 1M or 1Y"). Same 900x380 plot as lumoscore.com's Stellar
  // page: price on top, a volume band under it (22% of the plot, 12 units of gap), the dates as an HTML row
  // under the bars, the price axis as HTML in a right gutter sized in PIXELS, and Stellar's gridlines behind
  // it. Labels are HTML rather than <text> because the svg is preserveAspectRatio="none": glyphs inside it
  // were squashed by whatever the width/height ratio happened to be. The CSS for all of it (.lxda-cdates,
  // .lxda-cprices, .lxda-cgrid, .lxda-cunit) is Stellar's, already on this page.
  //
  // X is TIME, not the point's index: GeckoTerminal leaves out a candle nobody traded in, and spacing by index
  // would draw a quiet night as if it were a busy hour.
  function axisLbl(t, span) {
    var d = new Date(t), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (span <= 172800000) return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00';
    if (span <= 10368000000) return mo[d.getMonth()] + ' ' + d.getDate();
    return mo[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
  }
  function drawChart(pts) {
    var c = chartSvg();
    if (!c || !c.svg || !pts || pts.length < 2) return;
    lastRawPts = pts;
    var pc = c.host;

    // MCap is the same series times ISSUED supply — the figure the supply and market-cap boxes use.
    var K = (CH_VIEW.metric === 'mcap' && CH_VIEW.supply > 0) ? CH_VIEW.supply : 1;
    if (K !== 1) pts = pts.map(function (p) { return [p[0], p[1] * K, p[2] * K, p[3] * K, p[4] * K, p[5], p[6] != null ? p[6] * K : null, p[7], p[8]]; });

    var W = 900, HT = 380, PADL = 14, PADT = 16, PADB = 28, n = pts.length;
    var pw = pc.getBoundingClientRect().width || 622, PADR = Math.min(W * 0.25, Math.round(900 * 70 / pw));
    var iw = W - PADL - PADR, ih = HT - PADT - PADB;
    var volH = Math.round(ih * 0.22), gap = 12, priceH = ih - volH - gap;
    var L = PADL, R = PADL + iw, B = PADT + priceH;

    var lo = pts[0][1], hi = pts[0][1];
    for (var i = 1; i < n; i++) {
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
    var t0 = pts[0][0], t1 = pts[n - 1][0];
    if (FIT.t1 && FIT.t0 <= t0 && FIT.t1 >= t1) { t0 = FIT.t0; t1 = FIT.t1; }  // the range's own window
    var tspan = (t1 - t0) || 1;
    // One candle's width of the window, so bars never overlap however the trades cluster.
    var slot = FIT.bucket > 0 ? iw * FIT.bucket / tspan : iw / n;
    var y = function (v) { return span > 0 ? B - ((v - lo) / span) * priceH : PADT + priceH / 2; };
    var xAt = function (t) { return L + ((t - t0) / tspan) * iw; };

    // GREEN OR RED BY DIRECTION, first close against last over the span on screen — Stellar's rule since
    // 2026-10-16 (the history of this line, removed and brought back, is in the XRPL fork's dexasset.js).
    var xUp = +pts[n - 1][1] >= +pts[0][1];
    var xHex = xUp ? '#35c07f' : '#ff5b5b';
    var xVar = xUp ? 'var(--green,#35c07f)' : 'var(--red,#ff5b5b)';
    var s = '<defs><linearGradient id="dxaAreaGrad" x1="0" x2="0" y1="0" y2="1">'
      + '<stop offset="0%" stop-color="' + xHex + '" style="stop-color:' + xVar + '" stop-opacity="0.20"></stop>'
      + '<stop offset="100%" stop-color="' + xHex + '" style="stop-color:' + xVar + '" stop-opacity="0"></stop></linearGradient></defs>';

    // Volume, square-root scaled as Stellar's (DEX volume is long-tailed: linear, most bars round to nothing),
    // green when that close is at or above the one before it. Only GeckoTerminal candles carry a volume.
    var vmax = 0;
    for (var vi = 0; vi < n; vi++) { var vv0 = +pts[vi][5] || 0; if (vv0 > vmax) vmax = vv0; }
    if (vmax > 0) {
      var bw = Math.max(1, Math.min(14, slot * 0.62)), vroot = Math.sqrt(vmax), vtop = B + gap;
      for (var bi = 0; bi < n; bi++) {
        var bv = +pts[bi][5] || 0;
        if (!(bv > 0)) continue;
        var bh = Math.max(3, (Math.sqrt(bv) / vroot) * volH);
        var upv = CH_VIEW.type === 'candle' ? (pts[bi][1] >= (isFinite(pts[bi][4]) && pts[bi][4] > 0 ? pts[bi][4] : pts[bi][1]))
          : (bi === 0 || pts[bi][1] >= pts[bi - 1][1]);
        s += '<rect class="lxda-vol" x="' + (xAt(pts[bi][0]) - bw / 2).toFixed(1) + '" y="' + (vtop + volH - bh).toFixed(1)
          + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (upv ? '#22c55e' : '#ff5b5b')
          + '" fill-opacity="0.5"></rect>';
      }
    }

    if (CH_VIEW.type === 'candle') {
      // Candles are [t, close, high, low, open, volume]; a candle missing its open opens at the close before it.
      var cdw = Math.max(1.4, Math.min(12, slot * 0.6));
      for (var cdi = 0; cdi < n; cdi++) {
        var cdp = pts[cdi], cdx = xAt(cdp[0]);
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
      var line = '';
      for (var j = 0; j < n; j++) line += (j ? ' L' : 'M') + xAt(pts[j][0]).toFixed(1) + ' ' + y(pts[j][1]).toFixed(1);
      // The area closes on the bottom of the PRICE band, so the fill does not pour down through the bars.
      s += '<path d="' + line + ' L' + R.toFixed(1) + ' ' + B.toFixed(1) + ' L' + L + ' ' + B.toFixed(1) + ' Z" fill="url(#dxaAreaGrad)" class="lxda-area"></path>'
        + '<path d="' + line + '" fill="none" stroke="' + xHex + '" style="stroke:' + xVar + '" stroke-width="2.5"'
        + ' stroke-linecap="round" stroke-linejoin="round" class="lxda-line"></path>';
    }

    c.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + HT);
    c.svg.setAttribute('preserveAspectRatio', 'none');
    c.svg.innerHTML = s;

    // The date row: five labels evenly over the span, the last one "Now", as on Stellar.
    var dr = pc.querySelector('.lxda-cdates');
    if (!dr) { dr = el('div', 'lxda-cdates'); dr.setAttribute('data-logoed', '1'); pc.appendChild(dr); }
    var dh = '';
    for (var qi = 0; qi < 5; qi++) dh += '<span>' + (qi === 4 ? 'Now' : axisLbl(t0 + tspan * qi / 4, tspan)) + '</span>';
    dr.innerHTML = dh;

    // The price axis and its gridlines share one band, the PRICE band, so neither can label the bars.
    var topPct = (PADT / HT * 100).toFixed(3) + '%', botPct = ((HT - B) / HT * 100).toFixed(3) + '%';
    var gr = pc.querySelector('.lxda-cgrid');
    if (!gr) { gr = el('div', 'lxda-cgrid'); pc.insertBefore(gr, pc.firstChild); }
    gr.style.top = topPct; gr.style.bottom = botPct;
    gr.style.display = span > 0 ? '' : 'none';
    var pr = pc.querySelector('.lxda-cprices');
    if (!pr) { pr = el('div', 'lxda-cprices'); pr.setAttribute('data-logoed', '1'); pc.appendChild(pr); }
    pr.style.top = topPct; pr.style.bottom = botPct;
    var ax = function (v) { return (CH_VIEW.vs === 'USD' ? '$' : '') + (K !== 1 ? amount(v) : xrp(v, 5)); };
    var ph = '';
    if (span > 0) for (var g = 0; g < 5; g++) ph += '<span style="top:' + (g * 25) + '%">' + ax(hi - span * g / 4) + '</span>';
    pr.innerHTML = ph;
    var un = pc.querySelector('.lxda-cunit');
    if (!un) { un = el('div', 'lxda-cunit'); un.setAttribute('data-logoed', '1'); pc.appendChild(un); }
    var uw = (CH_VIEW.vs === 'USD' ? 'USD' : 'NEAR');
    if (K !== 1) uw = 'MCAP · ' + uw;
    if (un.textContent !== uw) un.textContent = uw;

    // Only now is the gate lifted: the box stays hidden while it holds the design's Aptos prices,
    // and opens the moment it holds this token's own.
    pc.classList.add('lxda');
    loadCounts(FIT.bucket, t0);
    wireChartHover(pc, { pts: pts, L: L, R: R, t0: t0, tspan: tspan, y: y, K: K, bucket: FIT.bucket, vol: vmax > 0 || pts[0][8] != null });
    watchChartWidth();
  }
  // The right gutter is sized in pixels, so a new width redraws rather than stretches.
  var cwSeen = 0, cwTimer = null;
  function watchChartWidth() {
    if (window.__lxnChartW) return;
    window.__lxnChartW = 1;
    window.addEventListener('resize', function () {
      clearTimeout(cwTimer);
      cwTimer = setTimeout(function () {
        var c = chartSvg(); if (!c || !lastRawPts) return;
        var w = Math.round(c.host.getBoundingClientRect().width || 0);
        if (!w || w === cwSeen) return;
        cwSeen = w;
        drawChart(lastRawPts);
      }, 180);
    }, { passive: true });
  }

  // THE HOVER READOUT (RAZA 2026-09-15: "where's the chart hover that we also have on Stellar"). Stellar's own
  // elements — .lxda-chtip / .lxda-chdot / .lxda-chvl, styled by the inherited sheet — with the date, the
  // price in the chart's unit and dollars beneath it, and that bucket's volume in dollars.
  // Stellar's readout date, in 24-hour time (RAZA 2026-10-29: "the time format above the price should be of
  // 24hr format instead of AM-PM"): "Oct 28, 16:45" wherever a point is shorter than a day -- 1D (15 min),
  // 1W (1 h) and 1M (4 h; RAZA 2026-11-01 hovered 1M and saw no time) -- and "Oct 28" on 1Y's daily points.
  function tipDate(ms) {
    var d = new Date(ms), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (!isFinite(d.getTime())) return '';
    var two = function (v) { return (v < 10 ? '0' : '') + v; };
    var hm = (CH_VIEW.label === '1D' || CH_VIEW.label === '1W' || CH_VIEW.label === '1M') ? (', ' + two(d.getHours()) + ':' + two(d.getMinutes())) : '';
    return mo[d.getMonth()] + ' ' + d.getDate() + hm;
  }
  function usdCompact(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return v >= 0.01 ? ('$' + v.toFixed(2)) : '<$0.01';
  }
  function tradesIn(t, bucket) {
    if (!TR.ts || !(bucket > 0) || t < TR.from) return null;           // not known, which is not "none"
    var n = 0;
    for (var i = 0; i < TR.ts.length; i++) if (TR.ts[i] >= t && TR.ts[i] < t + bucket) n++;
    return n;
  }
  // THE TRADES ROW, ON EVERY RANGE (RAZA 2026-11-05: "Cross-Timeframe Parity", Stellar's readout has it on all of
  // them; the row used to appear only on a chart the trades feed covered end to end, which on NEAR meant 1D).
  // WHAT THE SERIES CARRIES: GeckoTerminal's candle is [time, open, high, low, close, volume] -- no trade count --
  // and no free NEAR source counts the trades of a past candle. So, in order:
  //   * a point from the pool indexer carries its own exact count (p[8]);
  //   * a candle inside the recent-trades feed is counted from that feed, exact;
  //   * an older candle has no trade count anywhere free (GeckoTerminal's candles carry volume only), so it reads "—"
  //     unless it had no volume, which is a true 0. Dividing volume by a mean trade size would print an invented figure.
  // THE RECORD THE INDEXER KEEPS (RAZA 2026-11-06: "Yes, record them"): trades per 5 minutes from DexScreener, summed to
  // this chart's candle. It begins when a pool was first sampled, so an older candle stays "—"; after that a candle with
  // no row is a true 0. Asked once per pool and candle size, and a failed ask is not stored.
  // WHY IT READ "—" ON EVERY RANGE (RAZA 2026-11-07: "displays a dash placeholder ... across all timeframe selections").
  // The candle length was guessed from the gaps between points, so CoinGecko's closing point (seconds from the one
  // before) or a quiet pool's gaps gave a length the record could not answer: under 5 minutes it was never asked at all.
  // It is now each series' real candle (fitWindow), and a candle the record's clock does not line up with is summed from
  // the 5-minute windows it covers. A candle reads a number only when EVERY window in it was sampled (RAZA 2026-11-07:
  // "Aggregate correctly"): one that began before the record, or holds a window the sampler could not read (DexScreener
  // refused 46% of them: 154 of 286 on USDC's busiest pool), would be a partial sum, not the count, so it is a dash.
  // since and gaps come from the indexer; an older indexer sends no gaps, and with no coverage nothing is a count.
  // TC_KEEP: the indexer drops windows after 32 days, so an older shorter candle with no row is unknown, not 0. A day
  // outlives that in the indexer's daily rollup, and its gaps say which days were complete.
  var TC = { key: '', c: null, since: 0, ask: 0, gaps: null }, TC_EVEN = [300000, 900000, 3600000, 14400000, 86400000], TC_KEEP = 32 * 86400000;
  function loadCounts(bucket, t0, again) {
    var d = window.__lxnAssetData, pool = d && gtPool(d);
    if (!pool || !pool.id || !(bucket > 0)) return;
    var ask = TC_EVEN.indexOf(bucket) >= 0 ? bucket : 300000, key = pool.id + '|' + ask;
    if (TC.key === key) return;
    TC = { key: key, c: null, since: 0, ask: ask, gaps: null };
    var failed = function () {
      if (TC.key !== key) return;
      TC.key = '';
      if (!again) setTimeout(function () { loadCounts(bucket, t0, 1); }, 4000);
    };
    fetch(IDX + '/tradecounts?pool=' + encodeURIComponent(pool.id) + '&bucket=' + ask + '&from=' + Math.floor(t0 || 0))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (TC.key !== key) return;
        if (!j || !j.ok) { failed(); return; }
        if (!Array.isArray(j.gaps)) { TC.c = {}; TC.since = Infinity; return; }
        var gs = {};
        j.gaps.forEach(function (g) { gs[g] = 1; });
        TC.c = j.c || {}; TC.since = +j.since || Infinity; TC.gaps = gs;
      }).catch(failed);
  }
  // The windows that start inside [t, t + bucket): one on a candle the record lines up with, each window in one candle.
  function recordedIn(t, bucket) {
    if (!TC.c || !TC.gaps || !(bucket > 0) || t < TC.since || (TC.ask < 86400000 && t < Date.now() - TC_KEEP)) return null;
    var b = TC.ask, n = 0;
    for (var k = Math.ceil(t / b) * b; k < t + bucket; k += b) {
      if (TC.gaps[k]) return null;
      n += +TC.c[k] || 0;
    }
    return n;
  }
  function tradesTxt(p, S, inUsd, usdPerNear) {
    if (p[8] != null) return Number(p[8]).toLocaleString('en-US');
    var n = tradesIn(p[0], S.bucket);
    if (n != null) return n.toLocaleString('en-US');
    var rec = recordedIn(p[0], S.bucket);
    if (rec != null) return rec.toLocaleString('en-US');
    var v = +p[5];
    // RAZA 2026-11-07: a candle before the record began can never be known, so it has no Trades row rather than a dash.
    return (isFinite(v) && !(v > 0)) ? '0' : null;
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
      // The dollar line is the point's OWN dollar price (CoinGecko's, or the pool's dollar candle), and is
      // left out when the point has none -- never today's NEAR rate applied to a past price.
      var pu = (p[6] != null && isFinite(p[6])) ? p[6] : null;
      var sub = (!inUsd && pu != null) ? (mcap ? usdCompact(pu) : ('$' + xrp(pu, 6))) : '';
      // Per-candle volume exists only on GeckoTerminal candles (in the chart's unit). CoinGecko's
      // volume is a rolling 24h total, not a candle's, so its points carry none and no row is shown.
      var volUsd = inUsd ? ((isFinite(p[5]) && p[5] > 0) ? +p[5] : 0)
        : ((p[7] != null && isFinite(p[7]) && p[7] > 0) ? +p[7] : ((isFinite(p[5]) && p[5] > 0) ? +p[5] * usdPerXrp : 0));
      tip.textContent = '';
      tip.appendChild(tipEl('d', tipDate(p[0])));
      tip.appendChild(tipEl('l', mcap ? 'Market cap' : 'Price'));
      tip.appendChild(tipEl('p', head));
      if (sub) tip.appendChild(tipEl('v', sub));
      // ONE READOUT SHAPE ON EVERY POINT (RAZA 2026-11-01: "it shows 2 different types of hovers ... make it just
      // like Stellar"). A quiet stretch is drawn with flat points that carry no candle, and those used to drop
      // the Volume and Trades rows. Where the series has per-candle volume at all, every point now has both:
      // a quiet point reads $0 and 0 trades (Trades: see below).
      if (S.vol) {
        var row = el('div', 'lxrow');
        row.appendChild(tipEl('l', 'Volume'));
        row.appendChild(tipEl('p', usdCompact(volUsd)));
        tip.appendChild(row);
      }
      // Trades in this candle (RAZA 2026-11-01: "I don't see the number of trades"), Stellar's row under Volume.
      var trTxt = tradesTxt(p, S, inUsd, usdPerXrp);
      if (trTxt != null) {
        var trow = el('div', 'lxrow');
        trow.appendChild(tipEl('l', 'Trades'));
        trow.appendChild(tipEl('p', trTxt));
        tip.appendChild(trow);
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
      if (lbl === '1D') pct = usd ? d.d24 : d.d24n;
      // A token only its own pool prices has no 24h figure in the payload; the plotted series answers.
      if (pct == null && pts && pts.length > 1) {
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
  // A TOKEN WITH A DEEP wNEAR POOL (since 2026-10-29, every one): GeckoTerminal OHLCV on its busiest deep
  // pool against wNEAR (gtPool), asked for in the quote token (currency=token), which IS NEAR -- real
  // candles with real per-candle volume, in NEAR. The dollar view asks the same pool in USD.
  //
  // FALLBACK, a curated token with a CoinGecko id: market_chart (USD), re-priced in NEAR by dividing by
  // NEAR's own series at the nearest timestamp -- the same method the Trade table's 7D column uses
  // (browser/trade.js). CoinGecko gives prices, not candles, so each range is bucketed into ~120 candles
  // from the points that fall inside each bucket. It carries no per-candle volume, so no bars are drawn.
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
    // The same request as 1Y on purpose: one call (and one cache entry) serves the chart's year and the
    // 7d/1m/3m/6m cells, which keeps a page inside GeckoTerminal's per-visitor allowance.
    'PERF': { days: 365, ttl: 3600000, tf: 'day',    agg: 1,  limit: 365 },
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
    out.bucketMs = Math.round(size);
    out.bucketMs = Math.round(size);
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

  // THE TOKEN'S BUSIEST DEEP POOL AGAINST wNEAR, from the pools the token payload already carries. Busiest,
  // because the volume bars are that pool's trading: USDC's deepest wNEAR pool (refv1-4512, $2.2M) trades
  // $0.2M a day while the concentrated-liquidity one beside it trades $2.9M. DEEP first, because Rhea lets
  // anyone open a duplicate pool at any fee, and a 7-cent pool can print any price it likes -- only pools
  // with the curation floor of $25K liquidity may be picked, and the deepest is the fallback.
  function gtPool(d) {
    var ps = (d && d.pools) || [], best = null, first = null;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!p || !p.id || !((p.base && p.base.i === WNEAR) || (p.quote && p.quote.i === WNEAR))) continue;
      if (!first) first = p;                                     // the list is liquidity-ranked
      if ((+p.liqUsd || 0) >= 25000 && (!best || (+p.volUsd || 0) > (+best.volUsd || 0))) best = p;
    }
    return best || first;
  }

  // In NEAR, the same pool's DOLLAR candles ride along so the readout's dollar line and volume are each
  // candle's own, not today's NEAR rate applied to last week (which put USDC at $1.027). Matched by candle
  // time; if the dollar call fails the NEAR chart still draws and the readout simply omits the dollar line.
  // ONE GeckoTerminal CALL PER RANGE, NOT TWO (RAZA 2026-10-30: "For some assets, its taking forever to load
  // the recent trades"). The readout's dollar figures used to come from a second, dollar-denominated request
  // on the same pool, which doubled what each page spent of GeckoTerminal's per-visitor allowance -- browsing a
  // few tokens ran it out, and the trades list waited behind it. They now come from NEAR's own dollar history
  // (CoinGecko), which is the same for every token, so one cached copy serves the whole visit. A candle with no
  // NEAR price near it simply has no dollar line.
  function gtSeries(d, R, vs, label) {
    if (vs === 'USD') return gtOne(d, R, 'USD');
    if (label === 'PERF') return gtOne(d, R, 'NEAR');               // the change cells read closes only
    return Promise.all([gtOne(d, R, 'NEAR'), cgSeries('near', R.days, R.ttl).catch(function () { return null; })]).then(function (r) {
      var pts = r[0], near = r[1];
      if (!near || !near.length) return pts;
      var j = 0, tol = Math.max(3600000, R.days * 86400000 / 100);
      return pts.map(function (p) {
        while (j < near.length - 1 && Math.abs(near[j + 1][0] - p[0]) <= Math.abs(near[j][0] - p[0])) j++;
        var u = near[j];
        if (!u || !(u[1] > 0) || Math.abs(u[0] - p[0]) > tol) return p;
        return [p[0], p[1], p[2], p[3], p[4], p[5], p[1] * u[1], (p[5] > 0 ? p[5] * u[1] : 0)];
      });
    });
  }
  function gtOne(d, R, vs) {
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
      // GeckoTerminal can list the same candle twice (seen on UWON's hourly series); one per time.
      var seen = {};
      return list.filter(function (c) { if (!c || !(c[4] > 0) || seen[c[0]]) return false; seen[c[0]] = 1; return true; })
        .map(function (c) { return [c[0] * 1000, +c[4], +c[2], +c[3], +c[1], +c[5], null]; })
        .sort(function (a, b) { return a[0] - b[0]; });
    });
  }
  // A GeckoTerminal candle's length is the one that was asked for, whatever gaps a quiet pool leaves between candles.
  function gtCandle(R) { return R.agg * (R.tf === 'day' ? 86400000 : (R.tf === 'hour' ? 3600000 : 60000)); }

  // ---- a pool GeckoTerminal has never heard of ------------------------------------------------------------
  //
  // RAZA 2026-11-05: "Its already been a day and lumos isnt showing its chart and neither the %change boxes", and
  // "why aren't the recent trxs showing up". GeckoTerminal answers 404 for LUMOS/wNEAR 9001 and DexScreener has no
  // trades for it, so the only record of that pool's market is the pool indexer (workers/near-pool-indexer): its
  // deposits, and every swap of LumosCore's own pools from 2026-11-05 on. The chart, the change boxes and Recent
  // Exchanges are built from those rows. Opening price: the first deposit's own amounts. After that, each swap's
  // amounts. Then flat to now at the current price: a flat line is correct when nobody has traded.
  //
  // A 404 sends this visit's later requests for that pool straight here (GT_NONE) -- in memory only, so the next
  // visit asks GeckoTerminal again and the page moves to real candles the day it lists the pool. An indexer that
  // fails to answer is never kept: the chart's retry asks again.
  var IDX = 'https://near-pool-indexer.usa282.workers.dev', IDX_ASK = {}, GT_NONE = {};
  function poolNo(pool) {
    var m = /^refv1-([0-9]+)/.exec(String((pool && pool.id) || ''));
    return m ? m[1] : null;
  }
  function idxRows(no) {
    var c = IDX_ASK[no];
    if (c && Date.now() - c.at < 60000) return c.p;
    var p = fetch(IDX + '/pool?id=' + no + '&limit=500')
      .then(function (r) { if (!r.ok) throw new Error('indexer ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.ok || !Array.isArray(j.rows)) throw new Error('indexer down'); return j; });
    IDX_ASK[no] = { at: Date.now(), p: p };
    p.catch(function () { delete IDX_ASK[no]; });
    return p;
  }
  // The pool's price moments, oldest first: { t, px, near, n } and, for a swap, the trade's own fields. Only this
  // token against wNEAR: a swap between two other tokens of a stable pool says nothing about this price.
  function idxTicks(j, d) {
    var dec = +d.decimals, rows = (j.rows || []).slice().sort(function (a, b) { return a.t - b.t; }), out = [], born = false;
    var raw = function (v, places) { var n = Number(v); return n > 0 ? n / Math.pow(10, places) : 0; };
    rows.forEach(function (r) {
      if (r.kind === 'add' && !out.length) {
        var tk = (r.extra && r.extra.tokens) || [], a = null, b = null;
        tk.forEach(function (x) { if (x.t === d.i) a = raw(x.a, dec); if (x.t === WNEAR) b = raw(x.a, 24); });
        if (a > 0 && b > 0) { out.push({ t: r.t, px: b / a, near: 0, n: 0 }); born = true; }
        return;
      }
      if (r.kind !== 'swap') return;
      var buy = r.tb === d.i && r.ta === WNEAR, sell = r.ta === d.i && r.tb === WNEAR;
      if (!buy && !sell) return;
      var amt = raw(buy ? r.ab : r.aa, dec), near = raw(buy ? r.aa : r.ab, 24);
      if (!(amt > 0) || !(near > 0)) return;
      out.push({ t: r.t, px: near / amt, near: near, n: 1, amt: amt, side: buy ? 'buy' : 'sell', addr: String(r.who || ''), tx: String(r.tx || '') });
    });
    // 500 rows is the indexer's page: a pool past it has lost its first deposit off the end.
    return { ticks: out, born: born && rows.length < 500 };
  }
  // [t, close, high, low, open, volume, usdClose, usdVolume, trades]: gtOne's shape with gtSeries' dollar fields, and
  // the one thing a GeckoTerminal candle does not have, its trade count.
  function idxSeries(d, pool, R, vs, label) {
    var no = poolNo(pool);
    if (!no) return Promise.reject(new Error('404'));
    if (d.decimals == null) return Promise.reject(new Error('no token decimals'));
    var wantUsd = !(label === 'PERF' && vs !== 'USD');
    return Promise.all([idxRows(no), wantUsd ? cgSeries('near', R.days, R.ttl).catch(function () { return null; }) : null]).then(function (r) {
      var T = idxTicks(r[0], d), ticks = T.ticks, near = r[1];
      if (!ticks.length) throw new Error('404');                 // nothing recorded: no history, as GeckoTerminal said
      var size = (R.tf === 'minute' ? 60000 : R.tf === 'hour' ? 3600000 : 86400000) * R.agg;
      var tol = Math.max(3600000, R.days * 86400000 / 100), at = 0;
      var rate = function (t) {
        if (!near || !near.length) return null;
        while (at < near.length - 1 && Math.abs(near[at + 1][0] - t) <= Math.abs(near[at][0] - t)) at++;
        return (near[at][1] > 0 && Math.abs(near[at][0] - t) <= tol) ? near[at][1] : null;
      };
      var point = function (c) {
        var u = rate(c.t), m = vs === 'USD' ? (u || +d.nearUsd || 0) : 1;
        if (!(m > 0)) throw new Error('no NEAR price');
        return [c.t, c.c * m, c.h * m, c.l * m, c.o * m, c.v * m, u ? c.c * u : null, u ? c.v * u : 0, c.n];
      };
      var out = [], cur = null;
      ticks.forEach(function (k) {
        var b = Math.floor(k.t / size) * size;
        if (!cur || cur.t !== b) {
          if (cur) out.push(point(cur));
          var o = cur ? cur.c : k.px;
          cur = { t: b, o: o, h: Math.max(o, k.px), l: Math.min(o, k.px), c: k.px, v: 0, n: 0 };
        }
        cur.h = Math.max(cur.h, k.px); cur.l = Math.min(cur.l, k.px); cur.c = k.px;
        cur.v += k.near; cur.n += k.n;
      });
      out.push(point(cur));
      var now = Date.now(), px = d.price > 0 ? +d.price : cur.c;
      if (now > cur.t) out.push(point({ t: now, o: cur.c, h: Math.max(cur.c, px), l: Math.min(cur.c, px), c: px, v: 0, n: 0 }));
      out.bucketMs = size;
      out.born = T.born;
      return out;
    });
  }

  function seriesFor(label, vs) {
    var d = window.__lxnAssetData, R = CH_SRC[label] || CH_SRC['1D'];
    if (!d) return Promise.reject(new Error('no token'));
    if (d.i === WNEAR && vs !== 'USD') return Promise.reject(new Error('NEAR in NEAR'));
    var pool = gtPool(d);
    if (pool && GT_NONE[pool.id]) return idxSeries(d, pool, R, vs, label);
    return feedSeries(d, R, label, vs).catch(function (e) {
      if (!pool || !/^404$/.test(String((e && e.message) || ''))) throw e;
      GT_NONE[pool.id] = 1;
      return idxSeries(d, pool, R, vs, label);
    });
  }
  function feedSeries(d, R, label, vs) {
    // REAL CANDLES FIRST, now that the chart draws Stellar's volume band (RAZA 2026-10-29). GeckoTerminal's
    // candles carry each bucket's volume; CoinGecko's points carry only a rolling 24h total, so a curated
    // token charted from CoinGecko -- USDC among them -- had no bars at all, on any range. CoinGecko stays
    // as the fallback when the pool series cannot be had (the chart then draws without bars).
    if (d.cg && gtPool(d)) {
      var gt = function () { return gtSeries(d, R, vs, label).then(function (pts) { if (pts.length < 2) throw new Error('short'); return pts; }); };
      // A refused GeckoTerminal call is usually its per-minute allowance: one retry after a pause, before
      // settling for CoinGecko's line, which has no volume bars.
      return gt().catch(function () { return new Promise(function (res) { setTimeout(res, 2500); }).then(gt); })
        .catch(function () {
          var jobs = [cgSeries(d.cg, R.days, R.ttl)];
          if (vs !== 'USD') jobs.push(cgSeries('near', R.days, R.ttl));
          return Promise.all(jobs).then(function (r) {
            var pts = bucketise(r[0], vs === 'USD' ? null : r[1], R.days);
            if (pts.length < 2) throw new Error('short');
            pts.stopgap = 1;                                     // chartUpgrade: real candles replace it when they come
            return pts;
          });
        });
    }
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
        return gtSeries(d, R, vs, label).then(function (pts) { if (pts.length < 2) throw new Error('short'); return pts; });
      });
    }
    return gtSeries(d, R, vs, label).then(function (pts) { if (pts.length < 2) throw new Error('short'); return pts; });
  }

  // 1h, in NEAR terms, from the last hour of the 1D series -- whichever unit is on screen.
  function noteHour(pts, vs) {
    if (PERF.h1 !== 'pending') return;
    var take = function (p) {
      var last = p[p.length - 1], cut = last[0] - 3600000, base = null;
      for (var i = p.length - 1; i >= 0; i--) { if (p[i][0] <= cut) { base = p[i]; break; } }
      if (!base && p.born) base = p[0];                        // younger than the hour: since its opening price
      LONG['1h'] = (base && base[1] > 0) ? (last[1] - base[1]) / base[1] * 100 : null;
      LONG['24h'] = changeOver(p, 1);                          // read only when the payload has no 24h figure
      PERF.h1 = 'done';
      paintPerf(LASTD);
    };
    if (vs !== 'USD') take(pts);
    else seriesFor('1D', 'NEAR').then(take, function () { PERF.h1 = 'done'; paintPerf(LASTD); });
  }

  // EACH RANGE SHOWS ITS OWN WINDOW (RAZA 2026-10-29: "why are the volume bars merging into each other").
  // GeckoTerminal returns the last N candles that HAD a trade, not the last N periods: for a quiet token
  // the "1D" request (96 x 15 min) reached back to Oct 26, and the bars, sized as if 96 candles shared the
  // width evenly, piled into each other wherever the trades clustered. So the series is cut to the range
  // (the last 24h for 1D), opened at the price carried in from before it, a quiet stretch is drawn flat
  // (no trade, no move) rather than as a diagonal, and the line runs on to now. The candle length is kept
  // on FIT so drawChart can size a bar to one candle of the window.
  var FIT = { t0: 0, t1: 0, bucket: 0 };
  function fitWindow(pts, label) {
    var R = CH_SRC[label] || CH_SRC['1D'];
    if (!pts || pts.length < 2) return pts;
    var diffs = [];
    for (var i = 1; i < pts.length; i++) { var df = pts[i][0] - pts[i - 1][0]; if (df > 0) diffs.push(df); }
    diffs.sort(function (a, b) { return a - b; });
    var win = R.days * 86400000;
    // The indexer's series knows its candle; its closing "now" point would otherwise pass for a one-minute candle.
    // Volume on a point (a number, NaN on CoinGecko's) marks GeckoTerminal's candles, whose length is known too.
    var bucket = pts.bucketMs || (isFinite(pts[0][5]) ? gtCandle(R) : Math.max(60000, Math.min(win / 20, diffs[0] || 60000)));
    var end = Math.max(Date.now(), pts[pts.length - 1][0]), start = end - win;
    var prev = null, inside = [];
    for (var k = 0; k < pts.length; k++) { if (pts[k][0] < start) prev = pts[k]; else inside.push(pts[k]); }
    // A flat point in a series that carries volume is a true quiet stretch; in one without (CoinGecko's) it says nothing.
    var quiet = (isFinite(pts[0][5]) || pts[0][8] != null) ? 0 : NaN;
    var flat = function (t, p) { return [t, p[1], p[1], p[1], p[1], quiet, p[6], quiet, p[8] != null ? 0 : undefined]; };
    var seq = prev ? [flat(start, prev)].concat(inside) : inside;
    if (seq.length < 2) { FIT = { t0: pts[0][0], t1: pts[pts.length - 1][0], bucket: bucket }; return pts; }
    var out = [seq[0]];
    for (var j = 1; j < seq.length; j++) {
      var a = out[out.length - 1], b = seq[j];
      if (b[0] - a[0] > 1.5 * bucket) out.push(flat(b[0] - bucket, a));
      out.push(b);
    }
    var last = out[out.length - 1];
    if (end - last[0] > 1.5 * bucket) out.push(flat(end, last));
    FIT = { t0: prev ? start : out[0][0], t1: end, bucket: bucket };
    out.born = pts.born;
    return out;
  }

  // AN EMPTY CHART SAYS WHY (RAZA 2026-10-29, on USDt: "WHy aren't details for this token showing?"). The
  // price feeds are asked by the visitor's own browser, and both allow only a few calls a minute per
  // visitor: after a few token pages they refuse, and the chart used to give up after 4.5 seconds and sit
  // as an empty box. It now keeps trying past the feeds' one-minute window, and says so while it does.
  var CH_RETRY = [2500, 15000, 30000, 60000];
  function chartNote(text) {
    var c = chartSvg();
    if (!c) return;
    var n = c.host.querySelector('.lxn-chnote');
    if (!text) { if (n) n.parentNode.removeChild(n); return; }
    if (!n) {
      n = el('div', 'lxn-chnote');
      n.setAttribute('data-logoed', '1');
      n.setAttribute('role', 'status');
      n.style.cssText = 'position:absolute;left:0;right:0;top:42%;text-align:center;z-index:3;pointer-events:none;'
        + 'font:600 13px/1.5 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft,#8a8fa3)';
      try { if (getComputedStyle(c.host).position === 'static') c.host.style.position = 'relative'; } catch (e) {}
      c.host.appendChild(n);
    }
    if (n.textContent !== text) n.textContent = text;
  }

  // WHEN THE FEEDS REFUSE (RAZA 2026-11-06, FRAX: "Why isnt the chart of this trade-asset page loading"). GeckoTerminal
  // and CoinGecko are asked by the visitor's own browser and allow a few calls a minute per IP, so a few token pages in a
  // row leave the chart waiting on "busy". The pool indexer keeps every curated token's hourly price in its own database,
  // so 1D and 1W draw from that at once, and the retries carry on: a real answer still replaces it. Asking also registers
  // the token for those snapshots.
  function pxSeries(d, days, vs) {
    return fetch(IDX + '/prices?ids=' + encodeURIComponent(d.i)).then(function (r) { return r.json(); }).then(function (j) {
      var tok = (j && j.ok && j.tok && j.tok[d.i]) || [], near = {}, from = Date.now() - days * 86400000, out = [];
      ((j && j.near) || []).forEach(function (x) { near[x[0]] = x[1]; });
      tok.forEach(function (x) {
        var t = x[0] * 3600000, n = near[x[0]], v = vs === 'USD' ? x[1] : (n > 0 ? x[1] / n : 0);
        if (t >= from && v > 0) out.push([t, v, v, v, v, NaN, x[1]]);
      });
      return out;
    });
  }
  // THE VOLUME ROW AND BARS COME BACK (RAZA 2026-11-07, Oct 20 on 1M: Price, then Trades, no Volume). A refused
  // GeckoTerminal call leaves CoinGecko's line, which has no candle volume to bind, and it used to stay that way until
  // the reader changed range. Asked twice more, quietly; the chart is redrawn only if this range is still on screen.
  function chartUpgrade(want, vs, gen, at) {
    if (at >= 2) return;
    setTimeout(function () {
      var d = window.__lxnAssetData;
      if (gen !== chGen || !d) return;
      gtSeries(d, CH_SRC[want] || CH_SRC['1D'], vs, want).then(function (pts) {
        if (gen !== chGen || pts.length < 2) return;
        pts = fitWindow(pts, want);
        drawChart(pts); paintOhlcStrip(pts); paintChartHead(pts); fitChartHeight();
      }, function () { chartUpgrade(want, vs, gen, at + 1); });
    }, [20000, 60000][at]);
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
        if (pts.stopgap) chartUpgrade(want, vs, gen, 0);
        pts = fitWindow(pts, want);
        chartNote('');
        drawChart(pts); paintOhlcStrip(pts); paintChartHead(pts); fitChartHeight();
        if (want === '1D') noteHour(pts, vs);
      })
      .catch(function (e) {
        if (gen !== chGen) return;
        // A 404 is GeckoTerminal saying it has never seen the pool (RAZA 2026-11-04: LUMOS/wNEAR 9001, hours old,
        // read "The price feed is busy — retrying…"). Retrying cannot change that, so it is said once, plainly.
        var unknown = /^404$/.test(String((e && e.message) || ''));
        var hopeless = unknown || /no wNEAR pool|NEAR in NEAR|no token|short|empty/.test(String((e && e.message) || ''));
        var at = attempt || 0;
        if (hopeless || at >= CH_RETRY.length) {
          if (want === '1D' && PERF.h1 === 'pending') { PERF.h1 = 'done'; paintPerf(LASTD); }
          if (unknown && !lastRawPts) chartNote("No price history yet. This token's pool is too new for the chart's price feed.");
          if (!hopeless && !lastRawPts) chartNote('The price feed did not answer. Reload the page to try again.');
          return;
        }
        if (!lastRawPts && at === 0 && (want === '1D' || want === '1W')) {
          pxSeries(window.__lxnAssetData || {}, want === '1D' ? 1 : 7, vs).then(function (pts) {
            if (gen !== chGen || lastRawPts || pts.length < 2) return;
            pts = fitWindow(pts, want);
            chartNote('');
            drawChart(pts); paintOhlcStrip(pts); paintChartHead(pts); fitChartHeight();
          }).catch(function () {});
        }
        if (!lastRawPts && at >= 1) chartNote('The price feed is busy — retrying…');
        setTimeout(function () {
          if (gen !== chGen) return;
          chGen--;                                         // the retry keeps this click's generation
          loadChart(asset, label, at + 1);
        }, CH_RETRY[at]);
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

  // ---- Recent Exchanges and Holders (RAZA 2026-10-29: "for all near assets, why aren't the recent activity
  // and holders showing") ---------------------------------------------------------------------------------
  //
  // RECENT EXCHANGES: the token's busiest deep pool against wNEAR (gtPool -- the same pool the chart draws),
  // its latest trades from GeckoTerminal: up to 300, newest first, each with the trading account, the side,
  // both amounts and the transaction. Asked by the page, as the chart is (GeckoTerminal refuses Cloudflare),
  // kept a minute, retried on the chart's schedule. ONE POOL, said in the footer: a trade routed through
  // another pool is not in this list, as a Stellar trade on another order book is not in Stellar's.
  //
  // HOLDERS: /lxapi/nearholders, the 100 largest accounts as the chain holds them now (FastNEAR -- NearBlocks'
  // own ranking turned out to be stale, see that Function), 50 a page; the total count from NearBlocks where
  // it has one. The share of supply is against the contract's own total supply, the figure the Supply box
  // shows.
  //
  // Both draw Stellar's markup (its stylesheet is on this page), on desktop and phone alike.
  var EXPL_TX = 'https://nearblocks.io/txns/', EXPL_ACCT = 'https://nearblocks.io/address/';
  var XPO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  var ACCT_RE = /^[a-z0-9._-]{2,64}$/;
  function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // A 5x5 mirrored identicon from the account id (the one search.js draws), so each wallet has its own mark.
  function identSvg(addr, size) {
    var pal = ['#6f5ded', '#ef4444', '#22c55e', '#a855f7', '#06b6d4', '#f59e0b', '#ec4899', '#84cc16', '#ff894c', '#0ea5e9', '#14b8a6', '#facc15'];
    var h = 2166136261, i;
    addr = String(addr || '');
    for (i = 0; i < addr.length; i++) { h ^= addr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var bg = pal[h % pal.length], fg = pal[(h >>> 7) % pal.length];
    if (fg === bg) fg = pal[(h % pal.length + 5) % pal.length];
    var c = size / 5, rects = '', bits = h;
    function rect(x, y) { return '<rect x="' + (x * c).toFixed(2) + '" y="' + (y * c).toFixed(2) + '" width="' + c.toFixed(2) + '" height="' + c.toFixed(2) + '" fill="' + fg + '"></rect>'; }
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 3; x++) {
        bits = Math.imul(bits ^ (x * 7 + y * 13 + 1), 2654435761) >>> 0;
        if ((bits >>> 13) & 1) { rects += rect(x, y); if (x < 2) rects += rect(4 - x, y); }
      }
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="border-radius:50%;background:' + bg
      + ';display:block;flex:none" xmlns="http://www.w3.org/2000/svg">' + rects + '</svg>';
  }
  function shortAcct(a) { a = String(a || ''); return a.length > 20 ? (a.slice(0, 6) + '…' + a.slice(-4)) : a; }
  // Stellar's short form, which RAZA asked the XRPL page to match (2026-10-17): "now", "3m", "2h" -- the
  // heading already says these are recent, and "ago" on every row is what wrapped the phone's amount column.
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }
  function wallet(a, size) {
    return '<a class="lx-acct wallet-cell" href="/account/near/' + encodeURIComponent(a) + '">' + identSvg(a, size)
      + '<span class="mono wa">' + escH(shortAcct(a)) + '</span></a>';
  }

  // ---- trades ----
  var TR = { rows: null, err: false, none: false, page: 1, min: 0, pool: null, at: 0, mine: false };
  function myAcct() { try { return (window.lxn && window.lxn.account && window.lxn.account()) || ''; } catch (e) { return ''; } }

  // MY TRADES, at the right end of the tab row as on Stellar and XRPL (RAZA 2026-10-30: "where's my trades on
  // right side"). A filter on Recent Exchanges, as Stellar's is. ITS REACH IS THE FEED'S: the latest trades on
  // the token's main pool -- no free NEAR source lists one account's swaps (NearBlocks' per-account token
  // history came back empty for an account trading that minute, 2026-10-30) -- so the panel names that range
  // instead of implying a full history.
  function myTradesBtn() {
    var bar = document.querySelector('.tabs-bar');
    if (!bar) return;
    var b = bar.querySelector('.lx-mytrades');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'lx-mytrades';
      b.setAttribute('data-logoed', '1');
      b.innerHTML = '<span class="lx-mtlabel">My Trades</span>';
      b.style.cssText = 'margin-left:auto;background:none;border:0;padding:6px 2px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer';
      bar.appendChild(b);
      if (getComputedStyle(bar).display === 'flex') bar.style.alignItems = 'center';
    }
    // Literal colours with !important, as Stellar's: the tab bar colours its buttons with an !important rule.
    var l = b.querySelector('.lx-mtlabel') || b;
    l.style.setProperty('color', TR.mine ? '#ea6a2c' : '#8a8fa3', 'important');
    l.style.setProperty('text-decoration', TR.mine ? 'underline' : 'none', 'important');
  }
  var TR_PER = 50;
  // The mean trade size in NEAR, for the readout on a candle older than the feed (tradesTxt).
  function trMean(rows) {
    var sum = 0, n = 0;
    (rows || []).forEach(function (r) { if (r.near > 0) { sum += r.near; n++; } });
    return n ? sum / n : 0;
  }
  // Recent Exchanges from the pool indexer's swap rows, in paintTrades' row shape (see idxSeries).
  function idxTrades(pool, attempt) {
    var d = window.__lxnAssetData, no = poolNo(pool), at = attempt || 0;
    if (!no) { TR.rows = []; TR.at = Date.now(); syncPanel(); chainTrades(0); return; }
    idxRows(no).then(function (j) {
      var out = idxTicks(j, d).ticks.filter(function (k) { return k.n > 0 && ACCT_RE.test(k.addr); }).map(function (k) {
        return { addr: k.addr, side: k.side, amt: k.amt, near: k.near, px: k.px, t: k.t,
          hash: /^[A-Za-z0-9]{20,64}$/.test(k.tx) ? k.tx : '' };
      }).reverse();
      TR.rows = out; TR.mean = trMean(out);
      TR.ts = null; TR.err = false; TR.at = Date.now();
      syncPanel();
      if (!out.length) chainTrades(0);
    }, function () {
      if (at >= CH_RETRY.length) { TR.err = true; syncPanel(); }
      if (at < 12) setTimeout(function () { idxTrades(pool, at + 1); }, at < CH_RETRY.length ? CH_RETRY[at] : 60000);
    });
  }
  // THE CHAIN'S OWN RECORD, WHEN THE FEED HAS NOTHING (RAZA 2026-11-12, HNEAR: "No trades in the recent window").
  // GeckoTerminal sends a pool's last 24 hours only, so a token that last traded a week ago read as never traded.
  // /lxapi/neartokentrades reads the token's swaps from the chain, newest first, in this table's row shape. Asked only
  // when the feed answered with none (or does not know the pool, or there is no wNEAR pool): busy tokens keep the feed.
  // A partial answer is shown and asked again a little later; a failure is retried a few times, never read as "none".
  function chainTrades(attempt) {
    var d = window.__lxnAssetData, at = attempt || 0;
    if (!d || !d.i) return;
    if (!at) { if (TR.chainAsked === d.i) return; TR.chainAsked = d.i; }
    var want = d.i;
    fetch('/lxapi/neartokentrades?i=' + encodeURIComponent(want)).then(function (r) { return r.json(); }).then(function (j) {
      var d2 = window.__lxnAssetData;
      if (!d2 || d2.i !== want) return;
      if (!j || !j.ok || !Array.isArray(j.rows)) throw new Error('chain trades');
      if (TR.rows && TR.rows.length && !TR.chain) return;   // the feed answered with rows: they stand
      TR.chain = true;
      if (j.rows.length || !TR.rows || !TR.rows.length) {
        TR.rows = j.rows; TR.mean = trMean(j.rows);
        if (j.rows.length) TR.none = false;
      }
      TR.err = false; TR.at = Date.now();
      syncPanel();
      if (j.partial && at < 8) setTimeout(function () { chainTrades(at + 1); }, 2500);
    }).catch(function () {
      if (at < 3) setTimeout(function () { chainTrades(at + 1); }, [3000, 10000, 30000][at]);
    });
  }
  function loadTrades(attempt) {
    var d = window.__lxnAssetData, pool = gtPool(d);
    if (!pool) { TR.none = true; TR.rows = []; syncPanel(); chainTrades(0); return; }
    TR.pool = pool;
    var at = attempt || 0;
    if (!at && d && d.curated === false) chainTrades(0);
    if (GT_NONE[pool.id]) { idxTrades(pool, at); return; }
    // v2: the first element is { meta: 1, ts, from } for the chart readout's trade count (below).
    getJsonOnce('lumos.nearGtTr.v2.' + pool.id, 'https://api.geckoterminal.com/api/v2/networks/near/pools/'
      + encodeURIComponent(pool.id) + '/trades', 60000, function (j) {
      var out = [], ts = [], list = (j && j.data) || [];
      list.forEach(function (x) {
        var a = x && x.attributes;
        if (!a) return;
        var buy = a.to_token_address === d.i, sell = a.from_token_address === d.i;
        if (!buy && !sell) return;
        var amt = +(buy ? a.to_token_amount : a.from_token_amount), nearAmt = +(buy ? a.from_token_amount : a.to_token_amount);
        var addr = String(a.tx_from_address || ''), t = Date.parse(a.block_timestamp || '');
        if (isFinite(t)) ts.push(t);                          // every trade counts, listed or not
        if (!(amt > 0) || !(nearAmt > 0) || !isFinite(t) || !ACCT_RE.test(addr)) return;
        out.push({ addr: addr, side: buy ? 'buy' : 'sell', amt: amt, near: nearAmt, px: nearAmt / amt, t: t,
          hash: /^[A-Za-z0-9]{20,64}$/.test(a.tx_hash || '') ? a.tx_hash : '' });
      });
      out.sort(function (p, q) { return q.t - p.t; });
      // WHAT THE COUNT COVERS. GeckoTerminal sends the pool's last 24 hours of trades, capped at 300: under the
      // cap that is the whole day, at the cap only back to the oldest one sent. A candle starting before that
      // gets no Trades row, because a partial count would read as a quiet hour.
      var from = list.length >= 300 ? Math.min.apply(null, ts.length ? ts : [Date.now()]) : Date.now() - 86400000;
      return [{ meta: 1, ts: ts, from: from }].concat(out);  // never empty: an empty pool is an answer, not a failure
    }).then(function (rows) {
      var m = rows[0] && rows[0].meta ? rows[0] : null;         // slice, not shift: the array is shared
      TR.ts = m ? m.ts : null; TR.from = m ? m.from : 0;
      var feed = m ? rows.slice(1) : rows;
      // An empty day on the feed never wipes rows the chain already sent.
      if (feed.length || !(TR.chain && TR.rows && TR.rows.length)) { TR.rows = feed; if (feed.length) TR.chain = false; }
      TR.mean = trMean(TR.rows);
      TR.err = false; TR.at = Date.now();
      syncPanel();
      if (!TR.rows.length) chainTrades(0);                    // a quiet day on the feed: the chain's older trades
    }, function (e) {
      // GeckoTerminal has never seen this pool, which waiting cannot change: the indexer's swap rows instead.
      if (/^404$/.test(String((e && e.message) || ''))) { GT_NONE[pool.id] = 1; idxTrades(pool, 0); return; }
      // A refusal is GeckoTerminal's per-minute allowance, so keep asking -- every minute once the quick
      // retries are spent -- and say so in the table only after those, rather than giving up for good.
      if (at >= CH_RETRY.length) { TR.err = true; syncPanel(); }
      if (at < 12) setTimeout(function () { loadTrades(at + 1); }, at < CH_RETRY.length ? CH_RETRY[at] : 60000);
    });
  }
  // ---- My Trades, from the wallet's own activity (browser/nearcore.js) --------------------------------------
  // Swaps in or out of this token among the account's latest transactions, whichever pool or route they took.
  // The other side is usually NEAR (or wNEAR); when it is another token the price column has no NEAR figure,
  // and the row says what was swapped instead of inventing one.
  var MINE = { who: '', rows: null, busy: false, err: false, at: 0 };
  function loadMine() {
    var me = myAcct(), C = window.lxnCore, d = window.__lxnAssetData;
    if (!me || !C || !C.activityData || !C.entriesOf || !d || MINE.busy) return;
    if (MINE.who !== me) MINE = { who: me, rows: null, busy: false, err: false, at: 0 };
    MINE.busy = true;
    C.activityData(me).then(function (data) {
      var out = [];
      C.entriesOf(me, data).forEach(function (en) {
        if (en.kind !== 'swap' || !en.give || !en.get || en.ok === false) return;
        var buy = en.get.c === d.i, sell = en.give.c === d.i;
        if (!buy && !sell) return;
        var mine = buy ? en.get : en.give, oth = buy ? en.give : en.get;
        var amt = Number(mine.v);
        if (!(amt > 0)) return;
        var isNear = oth.c === 'near' || oth.c === WNEAR, ov = Number(oth.v);
        out.push({ addr: me, side: buy ? 'buy' : 'sell', amt: amt, t: en.ts, hash: en.h || '',
          near: isNear && ov > 0 ? ov : null, px: isNear && ov > 0 ? ov / amt : null,
          oth: isNear ? null : { v: ov > 0 ? ov : null, s: oth.s || '' } });
      });
      out.sort(function (a, b) { return b.t - a.t; });
      if (MINE.who !== me) return;
      MINE.rows = out; MINE.err = false; MINE.busy = false; MINE.at = Date.now();
      syncPanel();
    }, function () {
      if (MINE.who !== me) return;
      MINE.busy = false; MINE.err = true; MINE.at = Date.now();
      syncPanel();
    });
  }
  function pxTxt(r) { return r.px != null ? (xrp(r.px) + ' NEAR') : '—'; }
  function otherSide(r) {
    if (r.near != null) return amount(r.near) + ' NEAR';
    if (r.oth) return (r.oth.v != null ? amount(r.oth.v) + ' ' : '') + escH(r.oth.s);
    return '—';
  }
  function paintTrades(panel, phone) {
    var tb = phone ? document.getElementById('mdxaExList') : document.getElementById('dxaExTable');
    var filt = document.getElementById(phone ? 'mdxaPanelFilters' : 'dxaPanelFilters');
    var foot = phone ? null : panel.querySelector('.panel-foot');
    var empty = panel.querySelector('.' + (phone ? 'mdxa' : 'dxa') + '-empty-state[data-lxn]');
    var holder = phone ? tb : (tb && tb.closest('table'));
    // While the trades load, the panel looks as Stellar's and XRPL's do: the table and its headings, with the
    // design's sample rows held invisible by the shared :not(.lxda) gate -- no "Loading" banner. A token with
    // no NEAR pool, or a feed that keeps refusing, says so in one quiet row of that same table.
    if (!tb) return;
    if (empty) empty.parentNode.removeChild(empty);
    var show = function (n) { if (n && n.style.display === 'none') n.style.display = ''; };
    show(holder);
    var pgv = foot && foot.querySelector('.pgn');
    var msg = TR.none ? 'This token has no pool against NEAR, so there are no trades to show.'
      : (TR.err && !TR.rows) ? 'Recent trades could not be loaded right now. Trying again…' : null;
    if (!TR.rows && !msg) {
      show(filt); show(foot);
      tb.classList.remove('lxda');
      tb.__lxnSig = null;
      var inf0 = document.getElementById('dxaPanelInfo');
      if (inf0 && inf0.textContent !== '') inf0.textContent = '';    // not the design's "Showing 15 of 2,142"
      if (pgv && pgv.style.visibility !== 'hidden') pgv.style.visibility = 'hidden';
      return;
    }
    if (msg) {
      hideEl(filt); hideEl(foot);
      var ms = 'msg|' + msg;
      if (tb.__lxnSig === ms && tb.querySelector('[data-lxda]')) return;
      tb.__lxnSig = ms;
      tb.innerHTML = phone
        ? '<div class="lxda-ex-empty" data-lxda="1" style="text-align:center;padding:26px 12px;color:var(--text-soft,#8a8fa3);font-size:13.5px">' + msg + '</div>'
        : '<tr class="lxda-ex-empty" data-lxda="1"><td colspan="6" style="text-align:center;padding:26px 12px;color:var(--text-soft,#8a8fa3);font-size:13.5px">' + msg + '</td></tr>';
      tb.classList.add('lxda');
      return;
    }
    show(filt); show(foot);
    if (pgv && pgv.style.visibility) pgv.style.visibility = '';
    var me = TR.mine ? myAcct() : '';
    // MY TRADES READ THE WALLET'S OWN SWAPS, not the pool's public feed filtered by address (RAZA 2026-11-04:
    // his QTC swap never showed). The feed is ONE pool's trades, and a swap routed through another pool -- his
    // went through a different QTC pool -- was never in it. loadMine() reads his own activity instead.
    if (TR.mine && me && (MINE.who !== me || !MINE.rows)) loadMine();
    var src = TR.mine ? ((me && MINE.who === me && MINE.rows) || []) : TR.rows;
    var all = src.filter(function (r) { return (r.near == null || r.near >= TR.min) && (!TR.mine || (me && r.addr === me)); });
    var pages = Math.max(1, Math.ceil(all.length / TR_PER));
    if (TR.page > pages) TR.page = pages;
    var from = (TR.page - 1) * TR_PER, rows = all.slice(from, from + TR_PER);
    var c = (window.__lxnAssetData && window.__lxnAssetData.symbol) || '';
    var sig = TR.at + '|' + TR.min + '|' + TR.page + '|' + rows.length + '|' + (phone ? 1 : 0) + '|' + (TR.mine ? 'm' + me + MINE.at : '');
    if (tb.__lxnSig === sig && tb.querySelector('[data-lxda]')) return;
    tb.__lxnSig = sig;
    var span = TR.rows.length ? ago(TR.rows[TR.rows.length - 1].t) : '';
    if (span === 'now') span = '';
    if (!rows.length) {
      var none = TR.mine
        ? (!me ? 'Connect a wallet to see your own trades in this asset.'
          : !MINE.rows ? (MINE.err ? 'Your trades could not be read right now. Try again in a moment.' : 'Reading your trades…')
          : 'No trades from this wallet in this asset.')                   // Stellar's line (RAZA 2026-11-03)
        : TR.min > 0 ? ('No trades of ' + TR.min.toLocaleString('en-US') + '+ NEAR among the latest ' + TR.rows.length + '.') : (TR.chain ? 'No trades found for this asset.' : 'No trades in the recent window.');   // Stellar's line; the chain's record has no window
      tb.innerHTML = phone
        ? '<div class="lxda-ex-empty" data-lxda="1" style="text-align:center;padding:26px 12px;color:var(--text-soft,#8a8fa3);font-size:13.5px">' + none + '</div>'
        : '<tr class="lxda-ex-empty" data-lxda="1"><td colspan="6" style="text-align:center;padding:26px 12px;color:var(--text-soft,#8a8fa3);font-size:13.5px">' + none + '</td></tr>';
    } else if (phone) {
      tb.innerHTML = rows.map(function (r) {
        var oth = otherSide(r);
        var flow = r.side === 'buy' ? (oth + ' → ' + amount(r.amt) + ' ' + escH(c)) : (amount(r.amt) + ' ' + escH(c) + ' → ' + oth);
        return '<div class="ex-row" data-lxda="1"><span class="ex-ident">' + identSvg(r.addr, 28) + '</span>'
          + '<div class="ex-meta"><div class="nm mono"><a class="lx-acct" href="/account/near/' + encodeURIComponent(r.addr) + '">' + escH(shortAcct(r.addr)) + '</a></div>'
          + '<div class="ex-sub"><span class="type-badge ' + r.side + '">' + (r.side === 'buy' ? '▲ Buy' : '▼ Sell') + '</span></div></div>'
          + '<div class="ex-num">' + pxTxt(r) + '<span class="sub">' + flow + '</span></div>'
          + '<div class="ex-time">' + ago(r.t) + '</div>'
          + (r.hash ? '<a class="row-link lxda-exlink" href="' + EXPL_TX + r.hash + '" target="_blank" rel="noopener nofollow" aria-label="View this trade on NearBlocks">' + XPO + '</a>' : '<span></span>')
          + '</div>';
      }).join('');
    } else {
      tb.innerHTML = rows.map(function (r) {
        return '<tr data-lxda="1"><td>' + wallet(r.addr, 26) + '</td>'
          + '<td><span class="type-badge ' + r.side + '">' + (r.side === 'buy' ? '▲ Buy' : '▼ Sell') + '</span></td>'
          + '<td><span class="mono">' + pxTxt(r) + '</span></td>'
          + '<td><span class="mono">' + amount(r.amt) + ' ' + escH(c) + '</span><span class="lx-extot">' + otherSide(r) + '</span></td>'
          + '<td><span class="time">' + ago(r.t) + '</span></td>'
          + '<td style="text-align:right">' + (r.hash ? '<a class="row-link" href="' + EXPL_TX + r.hash + '" target="_blank" rel="noopener nofollow" aria-label="View this trade on NearBlocks">' + XPO + '</a>' : '') + '</td></tr>';
      }).join('');
    }
    tb.classList.add('lxda');
    try { tb.setAttribute('data-logoed', '1'); } catch (e) {}
    // Stellar's header sits over its cells: Time is right-aligned like the times under it (RAZA 2026-11-03).
    var thT = !phone && tb.closest && tb.closest('table') && tb.closest('table').querySelectorAll('thead th')[4];
    if (thT && thT.style.textAlign !== 'right') thT.style.textAlign = 'right';
    var info = document.getElementById('dxaPanelInfo');
    if (info) {
      var it = (TR.mine ? 'Your trades · ' : '') + (all.length ? ('Showing ' + (from + 1) + '–' + (from + rows.length) + ' of ' + all.length + ' recent trades') : 'Showing 0 recent trades');
      // Stellar's line and nothing after it (RAZA 2026-11-03): the filter, pool and time span were dropped.
      if (info.textContent !== it) info.textContent = it;
    }
    var pg = foot && foot.querySelector('.pgn');
    // One page needs no pager (RAZA 2026-11-03: a lone "1" under "Showing 1–3 of 3").
    if (pg) { var pdv = pages > 1 ? '' : 'none'; if (pg.style.display !== pdv) pg.style.display = pdv; }
    if (pg) {
      var ps = TR.page + '/' + pages;
      if (pg.getAttribute('data-lxnpg') !== ps) {
        pg.setAttribute('data-lxnpg', ps);
        pg.innerHTML = '<button type="button" data-lxpg="prev"' + (TR.page <= 1 ? ' disabled' : '') + '>‹</button>'
          + '<button type="button" class="active">' + TR.page + '</button>'
          + '<button type="button" data-lxpg="next"' + (TR.page >= pages ? ' disabled' : '') + '>›</button>';
      }
    }
  }

  // ---- holders ----
  var HL = { list: null, count: null, page: 1, err: false, busy: false };
  function loadHolders(attempt) {
    var a = window.__lxnAssetRef;
    if (!a || HL.busy || HL.list) return;
    HL.busy = true;
    fetch('/lxapi/nearholders?i=' + encodeURIComponent(a.id))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        HL.busy = false;
        if (!j || !j.ok) throw new Error('down');
        HL.list = j.holders || [];
        HL.count = j.count != null ? Number(j.count) : null;
        HL.countAt = j.countAt || null;                   // set when the figure is the build's, not live
        HL.countMin = j.countMin > 0 ? Number(j.countMin) : null;   // "at least": the list is full, no total known
        setTabCount(/holders/i, HL.count != null ? HL.count.toLocaleString('en-US') : HL.countMin ? (HL.countMin + '+') : '—');
        HL.err = false;
        syncPanel();
        // The edge could not reach NearBlocks for the count (it allows a few calls a minute per address, and
        // Cloudflare's is shared). The visitor's own browser has its own allowance: ask once from here.
        if (j.countUnread) {
          fetch('https://api.nearblocks.io/v1/fts/' + encodeURIComponent(a.id) + '/holders/count')
            .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
            .then(function (c) {
              var n = Number((((c && c.holders) || [])[0] || {}).count);
              if (!(n > 0)) return;
              HL.count = n; HL.countAt = null;
              setTabCount(/holders/i, n.toLocaleString('en-US'));
              syncPanel();
            })
            .catch(function () {});
        }
      })
      .catch(function () {
        HL.busy = false;
        var at = attempt || 0;
        if (at < 2) { setTimeout(function () { loadHolders(at + 1); }, CH_RETRY[at + 1]); return; }
        HL.err = true; setTabCount(/holders/i, '—');
        syncPanel();
      });
  }
  function asOf() {
    if (!HL.countAt) return '';
    var d = new Date(HL.countAt + 'T00:00:00Z');
    return isFinite(d.getTime()) ? ', as of ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate() : '';
  }
  function paintHolders(extra, phone) {
    var d = window.__lxnAssetData, dec = d && d.decimals != null ? +d.decimals : null, sup = d && d.supply > 0 ? +d.supply : 0;
    var pre = phone ? 'mdxa' : 'dxa';
    var all = HL.list, list = all ? all.slice((HL.page - 1) * 50, HL.page * 50) : null;
    var state = (HL.err && !all) ? 'err' : (!all || dec == null) ? 'load' : !all.length ? 'none' : 'ok';
    var sig = state + '|' + HL.page + '|' + (all ? all.length : 0) + '|' + HL.count + '|' + HL.countAt;
    if (extra.__lxnSig === sig && extra.classList.contains('lxda')) return;
    extra.__lxnSig = sig;
    extra.classList.add('lxda');
    if (state !== 'ok') {
      extra.innerHTML = '';
      var m = state === 'none' ? ['No holders found', 'No account holds a balance of this token.']
        : state === 'err' ? ['Holders unavailable', 'The holder list could not be loaded just now. Reload the page to try again.']
        : ['Loading holders…', ''];
      extra.appendChild(emptyState(pre + '-empty-state', m[0], m[1]));
      if (state === 'load' && !HL.busy) loadHolders();
      return;
    }
    var scale = Math.pow(10, dec);
    var rows = list.map(function (h) { return { a: h.a, bal: Number(h.raw) / scale }; });
    var t10 = 0, t50 = 0;
    all.forEach(function (h, i) { var b = Number(h.raw) / scale; if (i < 10) t10 += b; if (i < 50) t50 += b; });
    var pct = function (v) { return sup > 0 ? Math.min(100, v / sup * 100) : null; };
    var share = function (v) { var p = pct(v); return p == null ? '—' : (p >= 0.001 ? p.toFixed(3) : '<0.001') + '%'; };
    var top = function (v) { var p = pct(v); return p == null ? '—' : p.toFixed(1) + '%'; };
    var base = (HL.page - 1) * 50;
    var count = HL.count != null ? Number(HL.count) : null;
    var more = base + 50 < all.length;
    var stat = function (lbl, val) { return '<div class="' + pre + '-hl-stat"><span class="lbl">' + lbl + '</span><span class="val mono lxp">' + val + '</span></div>'; };
    var h = '<div class="' + pre + '-hl-head">' + stat('Holders', count != null ? count.toLocaleString('en-US') : HL.countMin ? (HL.countMin + '+') : '—')
      + stat(phone ? 'Top 10' : 'Top 10 hold', top(t10)) + stat(phone ? 'Top 50' : 'Top 50 hold', top(t50)) + '</div>';
    if (phone) {
      h += '<div class="mdxa-hl-list" data-lxbuilt="p' + HL.page + '">' + rows.map(function (r, i) {
        return '<div class="mdxa-hl-row lxda-hlrow"><span class="mdxa-hl-rank">#' + (base + i + 1) + '</span>'
          + '<span class="mdxa-hl-ident">' + identSvg(r.a, 28) + '</span>'
          + '<div class="mdxa-hl-meta"><div class="mdxa-hl-addr mono"><a class="lx-acct" href="/account/near/' + encodeURIComponent(r.a) + '">' + escH(shortAcct(r.a)) + '</a></div></div>'
          + '<div class="mdxa-hl-vals"><div class="mdxa-hl-bal mono">' + statAmt(r.bal) + '</div><div class="mdxa-hl-pct mono">' + share(r.bal) + '</div></div>'
          + '<a class="mdxa-hl-explorer lxda-hlx" href="' + EXPL_ACCT + encodeURIComponent(r.a) + '" target="_blank" rel="noopener nofollow" aria-label="View on NearBlocks" title="View on NearBlocks">' + XPO + '</a></div>';
      }).join('') + '</div>';
    } else {
      h += '<table class="ex-table dxa-hl-table"><thead><tr><th>#</th><th>Wallet</th><th>Balance</th><th>% supply</th><th style="text-align:right">Explorer</th></tr></thead>'
        + '<tbody data-lxbuilt="p' + HL.page + '">' + rows.map(function (r, i) {
          return '<tr><td class="dxa-hl-rank">' + (base + i + 1) + '</td><td><div class="lxda-hcell">' + wallet(r.a, 24) + '</div></td>'
            + '<td class="mono">' + statAmt(r.bal) + '</td><td class="mono">' + share(r.bal) + '</td>'
            + '<td style="text-align:right"><a class="dxa-hl-explorer" href="' + EXPL_ACCT + encodeURIComponent(r.a) + '" target="_blank" rel="noopener nofollow" aria-label="View on NearBlocks">' + XPO + '</a></td></tr>';
        }).join('') + '</tbody></table>';
    }
    // Stellar's line (RAZA 2026-11-03): "Showing 1–50 of 614,847 holders". The list itself is the largest 100,
    // so Next stops there; the total is every holder, or "100+" where no count exists. One page, no pager.
    var tot = count != null ? count.toLocaleString('en-US') : HL.countMin ? (HL.countMin + '+') : String(all.length);
    h += '<div class="' + pre + '-hl-pgn"><div class="info lxp">Showing ' + (base + 1) + '–' + (base + rows.length) + ' of '
      + tot + ' holders</div><div class="pgn"' + (HL.page <= 1 && !more ? ' style="display:none"' : '') + '>'
      + '<button type="button" data-lxhp="prev"' + (HL.page <= 1 ? ' disabled' : '') + '>‹ Prev</button>'
      + '<button type="button" data-lxhp="next"' + (more ? '' : ' disabled') + '>Next ›</button></div></div>';
    extra.innerHTML = h;
    try { extra.setAttribute('data-logoed', '1'); } catch (e) {}
  }

  // Filter chips, the exchanges pager and the holders pager. Window capture, as on Stellar: the design's own
  // handlers repaint their mock rows on these clicks otherwise.
  if (!window.__lxnPanelClicks) {
    window.__lxnPanelClicks = 1;
    window.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var chip = t.closest('#dxaPanelFilters .chip, #mdxaPanelFilters .chip');
      var pgb = t.closest('[data-lxpg]'), hpb = t.closest('[data-lxhp]'), mtb = t.closest('.lx-mytrades');
      var plb = t.closest('.lx-pl-prev, .lx-pl-next'), prw = t.closest('[data-lxhref]');
      if (!chip && !pgb && !hpb && !mtb && !plb && !prw) return;
      e.preventDefault(); e.stopImmediatePropagation();
      // Here at window capture because the design's __lumosNav claims any row click and resolves it to a Stellar
      // route. A row with an empty href is a pair held only in concentrated-liquidity pools, which have no pool page yet.
      if (prw) {
        var hr = prw.getAttribute('data-lxhref');
        if (hr) { if (e.ctrlKey || e.metaKey) window.open(hr, '_blank', 'noopener'); else window.location.href = hr; }
        return;
      }
      if (plb) {
        PL.page += plb.classList.contains('lx-pl-next') ? 1 : -1;
        var plx = plb.closest('.dxa-pools, .mdxa-pools');
        if (plx) poolsPage(plx);
        return;
      }
      if (mtb) {
        TR.mine = !TR.mine; TR.page = 1;
        myTradesBtn();
        // A filter on the Exchanges panel: take the reader there (the design owns the tab switch).
        var ex = [].filter.call(document.querySelectorAll('.tabs-bar .tab'), function (x) { return /exchanges/i.test(x.textContent || ''); })[0];
        if (TR.mine && ex && !ex.classList.contains('active')) { try { ex.click(); } catch (er) {} }
      } else if (chip) {
        [].forEach.call(chip.parentNode.querySelectorAll('.chip'), function (o) { o.classList.toggle('active', o === chip); });
        TR.min = parseFloat(chip.getAttribute('data-min-xlm')) || 0; TR.page = 1;
      } else if (pgb) {
        if (pgb.disabled) return;
        TR.page += pgb.getAttribute('data-lxpg') === 'next' ? 1 : -1;
      } else {
        if (hpb.disabled) return;
        HL.page = Math.max(1, HL.page + (hpb.getAttribute('data-lxhp') === 'next' ? 1 : -1));
      }
      syncPanel();
    }, true);
  }

  function syncPanel() {
    var panel = panelEl();
    if (!panel) return;
    var phone = panel.id === 'mdxaPanel';
    var pre = phone ? 'mdxa' : 'dxa';
    myTradesBtn();
    // No count on Exchanges, as on Stellar -- and the design writes its mock "2,142" back on every tab switch.
    [].forEach.call(document.querySelectorAll('.tabs-bar .tab'), function (x) {
      var cn = /exchanges/i.test(x.textContent || '') && x.querySelector('.count');
      if (cn && cn.style.display !== 'none') cn.style.display = 'none';
    });
    if (activeTab() === 'exchanges' && !panel.querySelector('.' + pre + '-tab-extra')) paintTrades(panel, phone);
    var hl = panel.querySelector('.' + pre + '-tab-extra.' + pre + '-holders');
    if (hl) paintHolders(hl, phone);
    var pl = panel.querySelector('.' + pre + '-tab-extra.' + pre + '-pools:not(.lxda)');
    if (pl && DONE) {
      if (window.__lxnAssetData) { if (PL.list) paintPools(window.__lxnAssetData, pl); }
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

  // ---- Pools ------------------------------------------------------------------------------------------
  //
  // STELLAR'S TAB (RAZA 2026-11-05): Active pools, Combined TVL and LP positions over the table; Pool, TVL, LP
  // holders, Pool share in it; 25 rows a page with Stellar's footer; each row opens that pool's page. EVERY POOL OF
  // THE TOKEN, "fetching all 22 pools for AURORA": /lxapi/nearpools?q=<contract>&full=1 lists them, and the token
  // payload adds what that list cannot hold -- its concentrated-liquidity pools, and a pool too new for it.
  //
  // ACTIVE MEANS HOLDING LIQUIDITY, the rule the baked counts use (_tools/_nearpoolcounts.js): a pool with a zero
  // reserve is left out, a reserve we could not size (null) is not zero and stays. The tab, the card and the table
  // all read this one list's length, so they cannot disagree; the baked count is no longer shown.
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

  function poolHref(id, syms) {
    var slug = (syms || []).map(function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); })
      .filter(Boolean).join('-').slice(0, 60).replace(/-+$/, '');
    return '/pools/near/' + (slug || 'pool') + '/' + encodeURIComponent(id);
  }

  var PL = { i: '', list: null, rows: null, err: false, page: 1 }, PL_PER = 25;

  // One row: { name, href, key, ico:[{logo,s},{logo,s}], liqUsd, lps }. This token first, as Stellar's "LMX / eLMNR".
  function poolRow(d, id, tokens, liqUsd, lps, href) {
    var own = tokens.filter(function (t) { return t.i === d.i; }), rest = tokens.filter(function (t) { return t.i !== d.i; });
    var ts = own.concat(rest), logos = d.logos || {};
    var ico = ts.slice(0, 2).map(function (t) {
      // wNEAR carries no logo in its own metadata; it is NEAR, so it wears NEAR's mark.
      return { s: t.s, logo: t.logo || logos[t.i] || (t.i === d.i ? d.logo : '') || (t.i === WNEAR ? NEAR_LOGO : '') };
    });
    return { id: id, name: ts.map(function (t) { return t.s; }).join(' / '), ico: ico, liqUsd: liqUsd, lps: lps,
      key: ts.map(function (t) { return t.i; }).sort().join('|'),
      href: href ? poolHref(id, ts.map(function (t) { return t.s; })) : '' };
  }
  function mergePools(d, j) {
    var usd = (j && j.usd > 0) ? +j.usd : (+d.nearUsd || 0), seen = {}, out = [];
    ((j && j.rows) || []).forEach(function (r) {
      var ts = (r && r.tokens) || [];
      // q is a search, so a same-named token's pools can come back with it: only pools really holding this contract.
      if (!ts.some(function (t) { return t.i === d.i; })) return;
      seen[r.id] = 1;
      if (ts.some(function (t) { return t.v === 0; })) return;
      out.push(poolRow(d, r.id, ts, (r.liq != null && usd > 0) ? r.liq * usd : null, r.lps, true));
    });
    (d.pools || []).forEach(function (p) {
      if (!p || !p.id || !(+p.liqUsd > 0 || +p.liq > 0)) return;
      var no = poolNo(p), key = no || p.id;                     // refv1-4179:3 is one pair of pool 4179
      if (seen[key]) return;
      seen[key] = 1;
      out.push(poolRow(d, key, [p.base, p.quote], +p.liqUsd > 0 ? +p.liqUsd : null, null, !!no));
    });
    return out.sort(function (a, b) { return (b.liqUsd || 0) - (a.liqUsd || 0); });
  }
  // ONE ROW PER PAIR (RAZA 2026-11-07: "Identical token pair pools ... are repeated multiple times"). A pair's row is its
  // deepest pool, with that pool's own figures and link; the tab count and the summary stay over every pool. A
  // concentrated-liquidity pool has no pool page, so a pair that also has a classic pool leads with its deepest classic
  // one, and only a pair with nothing else is a row without a link. Those rows read a dash under LP holders: such a
  // pool's positions are listed per account on chain, never per pool, so no free source can count them.
  function pairRows(list) {
    var at = {}, out = [];
    list.forEach(function (p) {
      var k = 'k:' + p.key, g = at[k];
      if (!g) { at[k] = { lead: p }; out.push(k); return; }
      if (!g.lead.href && p.href) g.lead = p;
    });
    return out.map(function (k) { return at[k].lead; })
      .sort(function (a, b) { return (b.liqUsd || 0) - (a.liqUsd || 0); });
  }
  function poolCounts() {
    setTabCount(/pools/i, PL.list ? PL.list.length.toLocaleString('en-US') : '—');
  }
  function poolsReady() {
    PL.rows = pairRows(PL.list || []);
    poolCounts();
    // A tab already painted from the payload's rows is repainted from the fuller list.
    $$('.dxa-tab-extra.dxa-pools, .mdxa-tab-extra.mdxa-pools').forEach(function (n) { n.classList.remove('lxda'); });
    syncPanel();
  }
  // Participants of the pools the live list did not answer for: the indexer's own count, deepest pools first, 600 to a
  // call (its limit) and three calls at most, which covers every token but wNEAR. Asking also queues them there. Only a
  // classic pool has a number for an id. A pool it has no count for stays a dash; nothing is invented.
  function holders(d) {
    var ids = (PL.list || []).filter(function (p) { return p.lps == null && /^[0-9]+$/.test(String(p.id)); }).map(function (p) { return p.id; });
    var parts = [0, 600, 1200].filter(function (at) { return at < ids.length; });
    return Promise.all(parts.map(function (at) {
      return fetch(IDX + '/lps?ids=' + ids.slice(at, at + 600).join(',')).then(function (r) { return r.json(); }).then(function (x) {
        if (!x || !x.ok || PL.i !== d.i) return;
        (PL.list || []).forEach(function (p) { var v = x.c[p.id]; if (v) p.lps = v[0]; });
        poolsReady();
      }).catch(function () {});
    }));
  }
  function loadPools(attempt) {
    var d = window.__lxnAssetData, at = attempt || 0;
    if (!d) return;
    if (PL.i !== d.i) PL = { i: d.i, list: null, rows: null, err: false, page: 1 };
    // The whole-chain list baked for this token (_tools/_nearpoolcounts.js): the live answer holds ~2,500 of ~9,000
    // pools, so USDC read 52 where its count says 394. Absent for a token outside the curated list.
    var baked = fetch('/assets/tokenpools/' + encodeURIComponent(d.i) + '.json')
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([fetch('/lxapi/nearpools?q=' + encodeURIComponent(d.i) + '&full=1').then(function (r) { return r.json(); }), baked])
      .then(function (a) {
        var j = a[0];
        if (!j || !j.ok) throw new Error('down');
        (a[1] || []).forEach(function (b) {
          if ((j.rows || []).some(function (r) { return String(r.id) === b[0]; })) return;
          j.rows.push({ id: b[0], liq: b[1], lps: null, tokens: b[2].map(function (t) { return { i: t[0], s: t[1], logo: t[0] === WNEAR ? '' : IDX + '/icon?v=2&t=' + encodeURIComponent(t[0]) }; }) });
        });
        PL.list = mergePools(d, j); PL.err = false;
        poolsReady();
        return holders(d);
      })
      .catch(function () {
        // The payload's rows stand in meanwhile; a refused call is never taken to mean the token has no pools.
        if (!PL.list) { PL.list = mergePools(d, null); PL.err = true; poolsReady(); }
        if (at < 2) setTimeout(function () { loadPools(at + 1); }, CH_RETRY[at + 1]);
      });
  }

  function lpTxt(p) {
    return p.lps == null ? '—' : Number(p.lps).toLocaleString('en-US');
  }
  function shareTxt(p, tvl) {
    if (!(tvl > 0) || p.liqUsd == null) return '—';
    var v = p.liqUsd / tvl * 100;
    return (v >= 0.1 ? v.toFixed(1) : '<0.1') + '%';
  }
  // data-logo="" and data-logoed on every short cell: "TVL" and a count of 12 are what the logo healer eats.
  function paintPools(d, extra) {
    if (!extra || extra.classList.contains('lxda')) return;
    var phone = extra.className.indexOf('mdxa') >= 0, pre = phone ? 'mdxa' : 'dxa', list = PL.list;
    extra.classList.add('lxda');
    extra.setAttribute('data-logoed', '1');
    extra.innerHTML = '';
    if (!list.length) {
      extra.appendChild(PL.err ? emptyState(pre + '-empty-state', 'Pools unavailable', 'Pool data could not be loaded just now.')
        : emptyState(pre + '-empty-state', 'No pools found', 'No pool lists this token on NEAR right now.'));
      return;
    }
    var tvl = 0, lps = 0, some = false;
    list.forEach(function (p) {
      tvl += +p.liqUsd || 0;
      if (p.lps == null) return;
      lps += +p.lps; some = true;
    });
    extra.__lxnTvl = tvl;
    // RAZA 2026-11-07: "only the exact integer count (e.g., "495" instead of "~495+")": the pools with a known count.
    var lpsTxt = some ? lps.toLocaleString('en-US') : '—';
    var stat = function (lbl, val) {
      return '<div class="' + pre + '-hl-stat"><span class="lbl">' + lbl + '</span><span class="val mono lxp" data-logoed="1" data-logo="">' + escH(val) + '</span></div>';
    };
    var head = stat('Active pools', list.length.toLocaleString('en-US')) + stat('Combined TVL', money0(tvl)) + stat('LP positions', lpsTxt);
    var th = function (t) { return '<th data-logoed="1" data-logo="">' + t + '</th>'; };
    extra.innerHTML = phone
      ? '<div class="mdxa-pl-head">' + head + '</div><div class="mdxa-pl-list"></div><div class="lx-pl-foot"></div>'
      : '<div class="dxa-pl-head">' + head + '</div><table class="ex-table"><thead><tr>' + th('Pool') + th('TVL') + th('LP holders') + th('Pool share')
        + '</tr></thead><tbody></tbody></table><div class="lx-pl-foot"></div>';
    poolsPage(extra);
  }
  // Rows and footer for the current page: Stellar's poolsPaint.
  function poolsPage(extra) {
    var phone = extra.className.indexOf('mdxa') >= 0, list = PL.rows || [], tvl = extra.__lxnTvl;
    var body = extra.querySelector(phone ? '.mdxa-pl-list' : 'tbody'), foot = extra.querySelector('.lx-pl-foot');
    if (!body || !foot) return;
    var pages = Math.max(1, Math.ceil(list.length / PL_PER));
    if (PL.page > pages) PL.page = pages;
    if (PL.page < 1) PL.page = 1;
    var start = (PL.page - 1) * PL_PER, end = Math.min(start + PL_PER, list.length), top = list.slice(start, end);
    var ICOS = '<span class="dxa-pl-icos" data-paired="1"><span class="dxa-pl-ico"></span><span class="dxa-pl-ico"></span></span>';
    body.innerHTML = top.map(function (p) {
      var name = escH(p.name), hf = escH(p.href), liq = money0(p.liqUsd), share = shareTxt(p, tvl);
      if (phone) {
        var tag = p.href ? 'a' : 'div';
        return '<' + tag + ' class="mdxa-pl-row"' + (p.href ? ' href="' + hf + '"' : '') + ' data-lxhref="' + hf + '" data-logoed="1">'
          + '<div class="mdxa-pl-l">' + ICOS + '<div><div class="mdxa-pl-name">' + name + '</div>'
          + '<div class="mdxa-pl-net mdxa-pl-lp">' + lpTxt(p) + ' LP holders</div></div></div>'
          + '<div class="mdxa-pl-r"><div class="mdxa-pl-tvl mono">' + liq + '</div>'
          + '<div class="mdxa-pl-apr apr-low">' + (share === '—' ? share : share + ' share') + '</div></div></' + tag + '>';
      }
      var cell = function (t) { return '<td class="mono" data-logoed="1" data-logo="">' + t + '</td>'; };
      return '<tr class="dxa-pl-row" data-lxhref="' + hf + '"' + (p.href ? '' : ' style="cursor:default"') + '><td><div class="dxa-pl-pair">' + ICOS
        + '<span class="dxa-pl-name">' + (p.href ? '<a href="' + hf + '" style="color:inherit;text-decoration:none">' + name + '</a>' : name) + '</span></div></td>'
        + cell(liq) + cell(lpTxt(p)) + cell(escH(share)) + '</tr>';
    }).join('');
    [].forEach.call(body.children, function (row, k) {
      var slots = row.querySelectorAll('.dxa-pl-ico'), ico = top[k].ico;
      poolIcon(slots[0], ico[0] && ico[0].logo, ico[0] && ico[0].s);
      poolIcon(slots[1], ico[1] && ico[1].logo, ico[1] && ico[1].s);
    });
    // One page needs no pager, as on Stellar.
    foot.style.display = pages > 1 ? '' : 'none';
    foot.innerHTML = '<span class="info lxp">Showing ' + (start + 1).toLocaleString('en-US') + '–' + end.toLocaleString('en-US') + ' of '
      + list.length.toLocaleString('en-US') + ' pools</span><span class="pc"><button type="button" class="lx-pl-prev"' + (PL.page <= 1 ? ' disabled' : '') + '>‹ Prev</button>'
      + '<span class="pmid">Page ' + PL.page + ' of ' + pages + '</span>'
      + '<button type="button" class="lx-pl-next"' + (PL.page >= pages ? ' disabled' : '') + '>Next ›</button></span>';
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
      copyToast('Issuer address copied');
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

    // THE ISSUER CHIP. The text is the token's contract id (shortened when it is a 64-hex implicit
    // account) and data-copy holds the whole id. The label reads Issuer, as on Stellar (RAZA 2026-10-29:
    // "Update the text Contract to Issuer") -- on NEAR the contract IS what issues the token.
    var addrEl = $('.item .addr') || $('.asset-meta .addr') || $('.asset-id .addr');
    if (addrEl) {
      addrEl.setAttribute('data-copy', asset.id);
      addrEl.setAttribute('data-copy-label', asset.code + ' contract');
      addrEl.setAttribute('title', asset.id);
      var tag = addrEl.parentNode && addrEl.parentNode.querySelector('.label-tag');
      if (tag) plain(tag, 'Issuer');
      var addrTxt = ' ' + shortId(asset.id) + ' ';
      var wrote = false;
      [].forEach.call(addrEl.childNodes, function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = addrTxt; wrote = true; }
      });
      if (!wrote) addrEl.insertBefore(document.createTextNode(addrTxt), addrEl.querySelector('.copy-i'));
      // THE PADLOCK. Green only when the contract is known to be immutable, red when it is known not to
      // be (a full-access key can redeploy it). Zero keys is GREY: the code cannot be replaced, but that
      // alone does not fix the supply -- the code itself may still mint (see /lxapi/neartoken). RAZA
      // 2026-10-29 asked for that case to be shown and said, not hidden. Hidden only when the key count
      // itself could not be read.
      // The phone's chip carries the same two icons with no class: the lock is the first svg, the copy
      // icon the second.
      var svgs = addrEl.querySelectorAll('svg');
      var lock = addrEl.querySelector('.lock-i') || (svgs.length > 1 ? svgs[0] : null);
      if (lock) {
        var lk = d && d.lock ? d.lock.locked : null;
        var noKeys = !!(d && d.lock && d.lock.keys === 0);
        var tip = lk === true ? 'Contract cannot be changed'
          : lk === false ? 'Contract can be upgraded by its owner'
          : noKeys ? 'Code can\u2019t be changed; whether more can be minted is up to the contract' : '';
        lock.style.display = tip ? '' : 'none';
        lock.style.color = lk === true ? 'var(--green)' : lk === false ? 'var(--red,#ff5b5b)' : 'var(--text-soft,#8a8fa3)';
        lock.setAttribute('aria-label', tip);
        // A title on the svg itself, so hovering anywhere on the lock says it.
        var tt = lock.querySelector('title');
        if (!tt) { tt = document.createElementNS('http://www.w3.org/2000/svg', 'title'); lock.insertBefore(tt, lock.firstChild); }
        tt.textContent = tip;
      }
      wireIssuerCopy();
    }

    paintLinks(d);

    paintLogo(asset, d);
  }

  // THE ISSUER'S SITE AND X ACCOUNT beside the address, as Stellar shows them (RAZA 2026-10-29). Stellar
  // reads them from the issuer's stellar.toml; NEAR has no such record, so /lxapi/neartoken carries them
  // from the token's CoinGecko entry (curated tokens, baked by _tools/_nearlinks.js) or its DexScreener
  // profile. The same two elements Stellar uses (.website pill, a.lx-soc), so its stylesheet -- already on
  // this page -- styles them, including hiding the X mark on a phone. No link known: the pill stays hidden
  // rather than showing the design's "circle.com" on someone else's token.
  var X_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.5l-5.1-6.7L5.8 22H2.7l7.6-8.7L1.2 2h6.7l4.6 6.1L18.9 2Zm-1.1 18h1.7L7.4 3.8H5.6L17.8 20Z"></path></svg>';
  function paintLinks(d) {
    var site = (d && /^https:\/\//i.test(d.web || '')) ? d.web : '';
    var xu = (d && /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(d.x || '')) ? d.x : '';
    $$('.website').forEach(function (web) {
      if (!site) {
        web.style.display = 'none';
        if (web.tagName === 'A') web.setAttribute('href', '#');
        return;
      }
      var host = site.replace(/^https:\/\//i, '').replace(/^www\./i, '').split(/[\/?#]/)[0];
      if (web.tagName === 'A') {
        web.setAttribute('href', site);
        web.setAttribute('target', '_blank');
        web.setAttribute('rel', 'noopener nofollow');
      }
      web.setAttribute('data-lxfixed', '1');
      web.setAttribute('data-lx-noswap', '');
      web.setAttribute('data-tooltip', 'Visit website');
      var done = false;
      [].forEach.call(web.childNodes, function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) { if (!done) { n.nodeValue = ' ' + host + ' '; done = true; } else n.nodeValue = ''; }
      });
      if (!done) web.appendChild(document.createTextNode(' ' + host + ' '));
      web.style.display = '';
    });
    var row = $('.asset-meta-row') || $('.asset-meta');
    if (!row) return;
    $$('.lx-soc', row).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    if (!xu) return;
    var a = document.createElement('a');
    a.className = 'lx-soc';
    a.href = xu; a.target = '_blank'; a.rel = 'noopener nofollow';
    a.title = 'X'; a.setAttribute('aria-label', 'X');
    a.setAttribute('data-lxc', ''); a.setAttribute('data-lx-noswap', '');
    a.innerHTML = X_SVG;
    row.appendChild(a);
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
    var src = (d && /^(data:image\/|https:\/\/|\/assets\/)/i.test(d.logo || '')) ? d.logo : '';
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
    // Spaces encoded too: an inline SVG logo carries them ("<?xml version=..."), and the review popup
    // (lx-feemodal) strips every space out of the url it copies -- which turned USDC's mark into a broken
    // image there (RAZA 2026-10-29: "The logo for the asset I receive is not appearing").
    var tokLogo = (d && /^(data:image\/|https:\/\/|\/assets\/)/i.test(d.logo || '')) ? d.logo.replace(/"/g, '%22').replace(/\s/g, '%20') : '';

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
      // THE DESKTOP LIMIT CHIPS ARE LOGOS, as on Stellar (RAZA 2026-10-29: "The logo isn't appearing besides
      // the limit price & amount"). Stellar's own hooks: data-lxic names the unit and --lxtic carries the
      // mark, which its stylesheet paints through ::before over a transparent label. The unit stays in the
      // element as text (invisible) and in the title, so it is still read out and still on hover. A token with
      // no logo keeps the text label rather than an empty circle.
      if ((c.__lxnUnit || '') === unit + '|' + (logo ? 1 : 0)) return;
      c.__lxnUnit = unit + '|' + (logo ? 1 : 0);
      c.textContent = unit;
      c.title = unit;
      var esc = document.createElement('span');
      esc.setAttribute('data-logo', '');                          // the logo engine's escape: not a ticker slot
      esc.style.display = 'none';
      c.appendChild(esc);
      if (logo) {
        c.setAttribute('data-lxic', unit);
        c.style.setProperty('--lxtic', 'url("' + logo + '")');
      } else {
        c.removeAttribute('data-lxic');
        c.style.removeProperty('--lxtic');
      }
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

  // The headings name this page's units; the spread is the top ask less the top bid, as XRPL prints it.
  function paintBookHead(asset, b) {
    $$('.dxa-ob-head, .mdxa-ob-head').forEach(function (h) {
      var sp = h.querySelectorAll('span');
      if (sp[0]) plain(sp[0], 'Price (NEAR)');
      if (sp[1]) plain(sp[1], (h.className.indexOf('mdxa') >= 0 ? 'Amt (' : 'Amount (') + asset.code + ')');
      if (sp[2]) plain(sp[2], 'Depth (NEAR)');
    });
    var ask = b && b.asks[0] ? b.asks[0].px : null, bid = b && b.bids[0] ? b.bids[0].px : null;
    $$('.dxa-ob-spread, .mdxa-ob-spread').forEach(function (s2) {
      var sp = s2.querySelectorAll('span');
      if (ask && bid) {
        var diff = ask - bid, mid = (ask + bid) / 2;
        if (sp[1]) plain(sp[1], xrpPx(diff) + ' NEAR');
        if (sp[2]) plain(sp[2], '(' + (diff / mid * 100).toFixed(2) + '%)');
      } else {
        if (sp[1]) plain(sp[1], '—');
        if (sp[2]) plain(sp[2], '');
      }
    });
  }

  // ---- THE ORDER BOOK ------------------------------------------------------------------------------
  // A token with a Rhea DCL pool against wNEAR: its resting limit orders plus the pool's concentrated
  // liquidity, bucketed by window.lxnDcl.book (browser/neardcl.js) -- one get_marketdepth call.
  // A token without one: the curve of its largest classic Rhea pool against wNEAR (x*y=k, SIMPLE_POOL
  // only -- a stable or rated pool is not that curve, and gets the empty state instead). Levels every
  // 0.5% from the pool's price with the pool's fee included, so each row reads "this much moves the price
  // this far". Rows: price in NEAR, amount in the token, depth the running total in NEAR.
  // Refreshed every 30s while the page is visible: one call per refresh, never a burst.
  var REFV1 = 'v2.ref-finance.near';
  function curveBook(asset, dec) {
    var S = window.lxnSwap;
    if (!S) return Promise.resolve(null);
    return S.pools().then(function (rows) {
      var best = null;
      rows.forEach(function (r) {
        var ids = (r.tokens || []).map(function (t) { return t.i; });
        if (ids.length !== 2 || ids.indexOf(asset.id) < 0 || ids.indexOf(WNEAR) < 0) return;
        if (r.kind && r.kind !== 'SIMPLE_POOL') return;
        if (!best || (r.liq || 0) > (best.liq || 0)) best = r;
      });
      if (!best) return null;
      return S.callView(REFV1, 'get_pool', { pool_id: +best.id }).then(function (pl) {
        if (!pl || pl.pool_kind !== 'SIMPLE_POOL') return null;
        var ti = pl.token_account_ids.indexOf(asset.id), ni = pl.token_account_ids.indexOf(WNEAR);
        if (ti < 0 || ni < 0) return null;
        var x = Number(pl.amounts[ti]) / Math.pow(10, dec), y = Number(pl.amounts[ni]) / 1e24;
        if (!(x > 0) || !(y > 0)) return null;
        var k = x * y, p0 = y / x, f = (+pl.total_fee || 0) / 10000, asks = [], bids = [], ra = 0, rb = 0;
        for (var i = 1; i <= 16; i++) {
          var pu = p0 * (1 + 0.005 * i), pu0 = p0 * (1 + 0.005 * (i - 1));
          var ta = Math.sqrt(k / pu0) - Math.sqrt(k / pu);           // token the pool gives up
          var pxa = pu / (1 - f);
          ra += ta * pxa;
          asks.push({ px: pxa, amt: ta, sum: ra });
          var pd = p0 * (1 - 0.005 * i), pd0 = p0 * (1 - 0.005 * (i - 1));
          var tb = Math.sqrt(k / pd) - Math.sqrt(k / pd0);           // token the pool takes in
          var pxb = pd * (1 - f);
          rb += tb * pxb;
          bids.push({ px: pxb, amt: tb, sum: rb });
        }
        return { asks: asks, bids: bids, curve: best.id, price: p0, fee: f };
      });
    });
  }
  function readBook(asset, d) {
    var dec = d && d.decimals != null ? +d.decimals : null;
    var D = window.lxnDcl;
    if (!D || dec == null) return Promise.resolve(null);
    // BOTH VENUES, ONE BOOK (RAZA 2026-11-03: RHEA showed one ask and "No bids"). A token's DCL pool can be nearly
    // empty while its classic pool holds the real liquidity, and Rhea routes a trade through either, so the book is
    // the two merged by price: each level is liquidity that is really there, on whichever venue holds it.
    var dclP = D.poolFor(asset.id).then(function (pool) { return pool ? D.book(pool, dec, { rows: 16, depth: 40 }) : null; });
    var curP = curveBook(asset, dec).catch(function () { return null; });
    return Promise.all([dclP, curP]).then(function (r) { return mergeBooks(r[0], r[1]); });
  }
  function mergeBooks(a, b) {
    if (!a || !b) return a || b;
    var run = function (list, desc) {
      list.sort(function (x, y) { return desc ? y.px - x.px : x.px - y.px; });
      list = list.slice(0, 16);
      var t = 0;
      return list.map(function (x) { t += x.amt * x.px; return { px: x.px, amt: x.amt, sum: t }; });
    };
    var out = {};
    for (var k in a) out[k] = a[k];
    out.asks = run(a.asks.concat(b.asks), false);
    out.bids = run(a.bids.concat(b.bids), true);
    out.curve = b.curve;
    out.bestAsk = out.asks.length ? out.asks[0].px : null;
    out.bestBid = out.bids.length ? out.bids[0].px : null;
    return out;
  }
  // The best ask sits at the bottom of its panel, so the panel opens scrolled there (XRPL, RAZA
  // 2026-10-17); re-pinned when the Orderbook tab reveals it, since a hidden panel has no height.
  function pinAsks(node) {
    if (!node) return;
    var go = function () { if (!node.__lxAway) node.scrollTop = node.scrollHeight; };
    go();
    [0, 60, 250, 700].forEach(function (ms) { setTimeout(go, ms); });
    if (node.__lxPin) return;
    node.__lxPin = 1;
    node.addEventListener('scroll', function () {
      node.__lxAway = (node.scrollHeight - node.clientHeight - node.scrollTop) > 8;
    }, { passive: true });
    try { new ResizeObserver(go).observe(node); } catch (e) {}
    if (!window.__lxObTabPin) {
      window.__lxObTabPin = 1;
      window.addEventListener('click', function (e) {
        var t = e.target && e.target.closest && e.target.closest('.dxa-trade-tab,.mdxa-trade-tab');
        if (!t) return;
        [0, 60, 250, 700].forEach(function (ms) {
          setTimeout(function () { pinAsks(document.getElementById('dxaObAsks') || document.getElementById('mdxaObAsks')); }, ms);
        });
      }, true);
    }
  }
  function paintBook(node, list, side) {
    if (!node) return;
    node.innerHTML = '';
    node.classList.add('lxda');
    if (!list.length) {
      var none = el('div', 'dxa-ob-row', 'No ' + (side === 'ask' ? 'asks' : 'bids') + ' on this book.');
      none.setAttribute('data-logoed', '1');
      none.style.cssText = 'opacity:.6;justify-content:center;grid-template-columns:1fr;text-align:center';
      node.appendChild(none);
      return;
    }
    var max = list[list.length - 1].sum || 1;
    // Asks read from the spread outward: the cheapest sits at the bottom of the red block.
    var seq = side === 'ask' ? list.slice().reverse() : list;
    for (var i = 0; i < seq.length; i++) {
      var r = seq[i];
      var row = el('div', 'dxa-ob-row mdxa-ob-row ' + side);
      row.setAttribute('data-logoed', '1');
      row.appendChild(el('span', 'px', xrpPx(r.px)));
      row.appendChild(el('span', 'am', amount(r.amt)));
      row.appendChild(el('span', 'sm', amount(r.sum)));
      var bar = el('span', 'bar');
      bar.style.width = Math.max(1, Math.round((r.sum / max) * 100)) + '%';
      row.appendChild(bar);
      node.appendChild(row);
    }
    if (side === 'ask') pinAsks(node);
  }
  var BOOKT = null;
  function loadBook(asset, d) {
    if (!asset) return;
    window.__lxnBookReload = function () {
      return readBook(asset, window.__lxnAssetData || d).then(function (b) {
        if (!b) {
          window.__lxnBook = null;
          note('No pool against NEAR for this token, so there is no order book.');
          paintBookHead(asset, null);
          return;
        }
        window.__lxnBook = b;
        paintBook($('#dxaObAsks') || $('#mdxaObAsks'), b.asks, 'ask');
        paintBook($('#dxaObBids') || $('#mdxaObBids'), b.bids, 'bid');
        paintBookHead(asset, b);
        try { window.dispatchEvent(new CustomEvent('lxn:book')); } catch (e) {}
      });
    };
    var run = function () {
      window.__lxnBookReload().catch(function () {
        if (!window.__lxnBook) note('Could not read the order book right now.');
      });
    };
    run();
    clearInterval(BOOKT);
    BOOKT = setInterval(function () { if (document.visibilityState === 'visible') run(); }, 30000);
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
  // Once browser/dxaswap.js has booted it owns the swap pane's figures; a later repaint here (a reload of the
  // page data) must not put em dashes back over a live quote.
  function swapOwned(n) {
    try { return !!(window.__lxnDxaSwapState && window.__lxnDxaSwapState().booted && n.closest('.dxa-pane-swap, .mdxa-pane-swap')); }
    catch (e) { return false; }
  }
  function setSumRow(label, value) {
    var rows = $$('.dxa-tsum-row, .mdxa-tsum');
    for (var i = 0; i < rows.length; i++) {
      var kids = rows[i].children;
      if (swapOwned(rows[i])) continue;
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
      if (!k || !v || k === v || swapOwned(row)) return;
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
    // Empty, with no "0.00" placeholder either, and no rate until an amount is typed: Stellar's swap and
    // limit panes start blank (RAZA 2026-10-29: "Keep the rate hidden and 0.00 shouldn't be appearing").
    $$('[class*="dxa-trade-ir"] input').forEach(function (inp) {
      if (inp.__lxnCleared) return;
      inp.__lxnCleared = 1;
      inp.value = '';
      if (inp.placeholder === '0.00') inp.placeholder = '';
    });
    setSumRow('rate', '—');
    ['price impact', 'min received', 'network fee', 'filled when'].forEach(function (k) { setSumRow(k, '—'); });
    $$('.dxa-tsum-row .mono, .mdxa-tsum .mono').forEach(function (v) { v.classList.add('lxp'); });
    $$('.dxa-trade-cta, .mdxa-trade-cta').forEach(function (b) {
      var limit = !!(b.closest && b.closest('.dxa-pane-limit, .mdxa-pane-limit'));
      // The swap button belongs to browser/dxaswap.js (window.lxnSwap) whenever it is on the page.
      if (!limit && window.lxnSwap) return;
      if (limit && window.lxnDcl) return;                 // browser/dxalimit.js owns the limit button
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
  // NEAR token metadata carries no description, so a token gets Stellar's generic line in NEAR words --
  // unless it is an asset LumosCore also lists on another network, which keeps that network's text
  // (/lxapi/neartoken `desc`; RAZA 2026-10-29: USDC reads the same on NEAR as on Stellar).
  function paintDescription() {
    var desc = $('.asset-description');
    if (!desc) return;
    var a = window.__lxnAssetRef || null;
    if (!a) { if (desc.parentNode) desc.parentNode.removeChild(desc); return; }
    var d = window.__lxnAssetData;
    var nm = d && d.name && d.name.toLowerCase() !== String(a.code).toLowerCase() ? (' (' + d.name + ')') : '';
    // A token priced from its concentrated-liquidity pool (neartoken src 'dcl', RAZA 2026-11-12) says where each figure
    // comes from: the pool itself on chain, and Intear's index for what the chain does not keep.
    var srcLine = (d && d.src === 'dcl')
      ? ' Its price and liquidity are read on chain from its NEAR order-book pool' + (d.srcExtra === 'intear' ? '; 24h change and volume come from Intear’s price index' : '')
        + ', and its supply from the token contract itself.'
      : ' Its price, 24h volume and pools come from NEAR’s on-chain pools and DexScreener, and its supply is read from the token contract itself.';
    plain(desc, (d && d.desc) ? d.desc : (a.code + nm + ' is a token on NEAR Protocol.' + srcLine));
    // Stellar's settled state: two lines at most, and no 24px held under it for a "Show more" control.
    // Without these the pre-script rule kept that space reserved for good, so NEAR's header stood 22px
    // taller than Stellar's for the same one-line USDC text.
    desc.classList.add('lx-clamp', 'lx-descready');
    desc.style.display = '';
  }

  function load() {
    var asks = $('#dxaObAsks') || $('#mdxaObAsks');
    if (!asks) return;                                  // not this page

    var root = document.documentElement;
    var asset = fromUrl();
    window.__lxnAssetRef = asset;
    lift();
    if (!asset) note('No order book for this page.');
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
      // Stellar shows no count on Exchanges; Holders gets NearBlocks' figure once it lands.
      (function () {
        var et = [].filter.call(document.querySelectorAll('.tabs-bar .tab'), function (t) { return /exchanges/i.test(t.textContent || ''); })[0];
        var ec = et && et.querySelector('.count');
        if (ec) ec.style.display = 'none';
      })();
      setTabCount(/holders/i, '—');
      syncPanel();
      if (!window.__lxnAssetData) {
        TR.err = true; HL.err = true; syncPanel();
        setTabCount(/pools/i, '—'); PERF.h1 = PERF.long = 'done'; paintPerf(null);
        if (asset) note('Could not read the order book right now.');
        return;
      }
      paintPerf(window.__lxnAssetData);
      paintChartHead(null);                               // price + 24h pill now; the range line with the chart
      // lx-mobtrade adds the phone's limit Total row on its own timer; name its chip once it exists.
      [1000, 2500].forEach(function (ms) { setTimeout(function () { paintLabels(asset); }, ms); });
      try { window.dispatchEvent(new CustomEvent('lxn:assetdata')); } catch (e) {}
      chartControls(asset);
      loadChart(asset, '1D');
      wireChartRanges(asset);
      loadLongPerf(asset);
      loadPools();
      syncPanel();
      loadBook(asset, window.__lxnAssetData);
      loadTrades();
      loadHolders();
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
