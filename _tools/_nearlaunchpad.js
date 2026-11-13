// The NEAR Launchpad: strip Stellar's issuance layer and wire the NEAR one.
//
// `lx-lp-js` (~69KB) is Stellar MAINNET issuance: horizon.stellar.org, the Stellar network passphrase, and
// the Stellar fee collector GAMZFXIJ…. It came across with the frozen Stellar build onto pages that now say
// NEAR. The XRPL fork found the same layer and removed it first (_xrplaunchpad.js); the same reasoning
// holds here: a launchpad that cannot launch yet is strictly better than one that launches on the wrong
// chain. `lx-lpticker` is the same layer's ticker helper and reads __lxLP, gone with it.
//
// What replaces it (one block, id lx-nearlaunchpad), ported from the XRPL launchpad:
//   browser/nearlaunch.js   form rules (NEAR's ticker rule, the factory's reserved names, a taken-name
//                           check), the draft, the icon (kept under the factory's 16 KB on-chain limit),
//                           the cost panel priced in NEAR, the review paint and the confirm paint
//   browser/nearmint.js     the launch: factory.create_token, then a Rhea [token, wrap.near] pool and its
//                           starting liquidity, three wallet approvals, resumable if the pool step fails
// Until the factory account (lumoscore.near) answers get_config unpaused, "Confirm & Launch" stays
// disabled as "Launching on NEAR is coming soon": the gate lives in nearmint.js and asks on every visit.
//
// Also here, all exact-string and all idempotent:
//   * a head stylesheet (lx-nearlaunchpad-css) holding the design's Aptos mock values hidden until the
//     layer has written real ones (cost cells, the review's rows and wallet panel, the confirm cards, the
//     launch button until its label is decided) -- a <style> in <head> is parsed before first paint
//   * the mint-cost FAQ answer and the FAQPage ld+json rebuilt from the prices in nearlaunch.js
//   * Project Type removed from the markup (removed on Stellar; the XRPL fork did the same)
//   * the ticker hint and the wrong-chain launch copy (Stellar network, Stellar wallet, APT liquidity)
//
// Idempotent: our blocks are removed by id first; replaced strings no longer match on a second run.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearlaunchpad';
const CSS_ID = 'lx-nearlaunchpad-css';

const launchSrc = fs.readFileSync(__dirname + '/browser/nearlaunch.js', 'utf8');
const mintSrc = fs.readFileSync(__dirname + '/browser/nearmint.js', 'utf8');
for (const [n, src] of [['nearlaunch.js', launchSrc], ['nearmint.js', mintSrc]]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  browser/' + n + ' contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + launchSrc + '\n' + mintSrc + '\n</' + 'script>';

// ---- prices: parsed from the browser source, so the FAQ cannot quote what the page does not charge ----
const usdMatch = launchSrc.match(/var USD = \{ create: ([\d.]+), liq: ([\d.]+) \}/);
if (!usdMatch) { console.error('  ! could not read `var USD = { create, liq }` from browser/nearlaunch.js — aborting'); process.exit(1); }
// TEST PRICING GUARD: a reduced price shipped by accident would charge cents for a $5 service with
// nothing on the page to say so. Shouts on every build until the real numbers are back.
if (usdMatch[1] !== '5' || usdMatch[2] !== '5') {
  console.warn('  ⚠ TEST PRICING ACTIVE: create $' + usdMatch[1] + ' / liquidity $' + usdMatch[2]
    + ' — restore { create: 5, liq: 5 } in _tools/browser/nearlaunch.js before release');
}
const money = (n) => '$' + (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(2));
// A flat $25, as on Stellar (RAZA 2026-11-04): $5 creation, $10 for liquidity, $10 for the pool and network. The
// pool opens with $5 of NEAR (usdMatch[2]) and $5 worth of the new token; the rest is LumosCore's. Worded so it does
// not suggest the whole $10 goes into the pool. browser/nearlaunch.js USD_POOL / USD_LIQ_LINE set the $10 lines.
const COST_A = 'A flat $25: ' + money(usdMatch[1]) + ' to create the token, $10 for liquidity and $10 for the pool and network, '
  + 'paid in NEAR at the live rate. Your pool opens with ' + money(usdMatch[2]) + ' in NEAR and ' + money(usdMatch[2])
  + ' worth of your new token, and the exact total is shown before you sign.';

// #costTotal too: the phone's sticky summary bar carries the total as div.val#costTotal, outside both rules, so its
// mock ("≈ $25") showed until the real figure replaced it (monitor bot, Launchpad mobile, since 2026-10-28).
const CSS_ALL = 'html:not(.lxn-costready) .cost-row .v,html:not(.lxn-costready) .cost-total .v,'
  + 'html:not(.lxn-costready) #costTotal{visibility:hidden}'
  // RAZA 2026-11-03: 'Liq. pool & network' wrapped its dollar figure under the NEAR one. Kept on one line, as Stellar's.
  + '.cost-row .v,.cost-total .v{white-space:nowrap}';
const CSS_REVIEW = [
  CSS_ALL,
  'html:not(.lxn-lprev) .hero-card .hero-icon,html:not(.lxn-lprev) .hero-name,html:not(.lxn-lprev) .hero-ticker,'
    + 'html:not(.lxn-lprev) .hero-desc,html:not(.lxn-lprev) .detail-card .detail-row .v,'
    + 'html:not(.lxn-lprev) .wallet-info .addr,html:not(.lxn-lprev) .wallet-info .av,'
    + 'html:not(.lxn-lprev) .wallet-info .balance .val{visibility:hidden}',
  'html:not(.lxn-lpgate) .actions-row .btn-primary,html:not(.lxn-lpgate) .bottom-bar .btn-primary{visibility:hidden}',
].join('\n');
const CSS_CONFIRM = 'html:not(.lxn-lpconf) .success-hero,html:not(.lxn-lpconf) .result-card,'
  + 'html:not(.lxn-lpconf) .timeline-card,html:not(.lxn-lpconf) .tx-card,html:not(.lxn-lpconf) .primary-cta{visibility:hidden}';
for (const c of [CSS_ALL, CSS_REVIEW, CSS_CONFIRM]) if (c.indexOf(B) >= 0) { console.error('  stylesheet carries a backslash — aborting'); process.exit(1); }

// Exact strings only. Each is launch copy that names the wrong chain or rule; nothing here is a regex
// over "Stellar".
const COPY = [
  // RAZA 2026-11-03: the header reads like Stellar's. NOT "a flat $25": NEAR charges $5 + $10 + the storage NEAR
  // itself asks for, about $22 at the time of writing, and the cost panel prints the real figure.
  ['<h1>Launch <span class="hl">Your Token</span></h1>', '<h1>Launch a Token on <span class="hl">NEAR</span></h1>'],
  ['<p>Before creating a token, familiarize yourself with <a class="ui-link" href="#">how it works</a>.</p>',
    '<p>Issue a NEAR token for a flat $25 in NEAR, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>'],
  ['<h1 class="page-title">Launch <span class="hl">Your Token</span></h1>', '<h1 class="page-title">Launch a Token on <span class="hl">NEAR</span></h1>'],
  ['<p class="page-sub">Familiarize yourself with <a href="#">how it works</a> before creating.</p>',
    '<p class="page-sub">Issue a NEAR token for a flat $25 in NEAR, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>'],
  // The containers keep the previous run's subtitle (2026-11-03, before the How it works link): bring it forward.
  ['<p>Issue a NEAR token for $15 in NEAR plus network storage, with its first liquidity pool included.</p>', '<p>Issue a NEAR token for a flat $25 in NEAR, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>'],
  ['<p class="page-sub">Issue a NEAR token for $15 in NEAR plus network storage, with its first liquidity pool included.</p>', '<p class="page-sub">Issue a NEAR token for a flat $25 in NEAR, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>'],
  // The flat $25 (RAZA 2026-11-04): pages built before it carry the $15 line; bring it forward.
  ['<p>Issue a NEAR token for $15 in NEAR plus network storage, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>', '<p>Issue a NEAR token for a flat $25 in NEAR, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>'],
  ['<p class="page-sub">Issue a NEAR token for $15 in NEAR plus network storage, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>', '<p class="page-sub">Issue a NEAR token for a flat $25 in NEAR, with its first liquidity pool included. <a class="ui-link" href="#" data-lxlhiw>How it works</a>.</p>'],
  // The base this fork copies still carries an earlier run's ticker line; Stellar's words again (see nearlaunch.js).
  ['2-12 letters or digits, starting with a letter', '2-6 uppercase letters'],
  ['Once your token is minted on the Stellar network,', 'Once your token is minted on NEAR,'],
  ['Your token is now live on the Stellar network and listed on the LumosCore DEX.', 'Your token is now live on NEAR and listed on the LumosCore DEX.'],
  ['View on Stellar Explorer', 'View on NEAR Explorer'],
  ['Approved with Stellar wallet', 'Approved with NEAR wallet'],
  ['Asset issued on Stellar', 'Token created on NEAR'],
  ['Create another token on Stellar', 'Create another token on NEAR'],
  ['Connected · Stellar', 'Connected · NEAR'],
  ['Add extra APT to the initial liquidity pool', 'Add extra NEAR to the initial liquidity pool'],
  ['Add extra APT to your initial liquidity pool', 'Add extra NEAR to your initial liquidity pool'],
  ['Extra APT Liquidity', 'Extra NEAR Liquidity'],
  ['<span class="input-suffix">APT</span>', '<span class="input-suffix">NEAR</span>'],
  ['<div class="k">Extra APT</div>', '<div class="k">Extra NEAR</div>'],
];

// Remove the block that CONTAINS `needle`, from the nearest enclosing `openTag` before it to its matching
// close (the XRPL launchpad's helper, unchanged).
function removeBlockContaining(html, needle, openTag, tagName) {
  const at = html.indexOf(needle);
  if (at < 0) return { html: html, removed: 0 };
  const start = html.lastIndexOf(openTag, at);
  if (start < 0) return { html: html, removed: 0 };
  const re = new RegExp('</?' + (tagName || 'div') + '\\b[^>]*>', 'gi');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += (m[0][1] === '/') ? -1 : 1;
    if (depth === 0) {
      const end = m.index + m[0].length;
      if (html.slice(start, end).indexOf(needle) < 0) return { html: html, removed: 0 };
      return { html: html.slice(0, start) + html.slice(end), removed: 1 };
    }
  }
  return { html: html, removed: 0 };
}
function stripStyle(h, id) {
  const open = '<style id="' + id + '">', close = '</style>';
  for (;;) {
    const i = h.indexOf(open);
    if (i < 0) return h;
    const j = h.indexOf(close, i);
    if (j < 0) throw new Error('style id="' + id + '" has no closing tag');
    h = h.slice(0, i) + h.slice(j + close.length);
  }
}

function isLaunchpad(k, h) {
  return /lumoscore-launch-(token|review|confirm)/.test(k)
    && (h.indexOf('id="lx-lp-js"') >= 0 || h.indexOf('id="tokenTicker"') >= 0 || h.indexOf('id="' + ID + '"') >= 0);
}

let pages = 0, stripped = 0, typeRemoved = 0, faqs = 0, lds = 0;
const copyHits = {};
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string' || !isLaunchpad(k, h)) continue;
    const gone = stripById(h, 'lx-lp-js');
    h = gone.html;
    stripped += gone.removed;
    h = stripById(h, 'lx-lpticker').html;
    h = stripById(h, ID).html;
    h = stripStyle(h, CSS_ID);
    if (h.indexOf('horizon.stellar.org') >= 0 && h.indexOf('Public Global Stellar Network') >= 0) {
      console.error('  ' + k + ': Stellar signing config still present after the strip — aborting');
      process.exit(1);
    }

    for (const [from, to] of COPY) {
      const n = h.split(from).length - 1;
      if (n) { h = h.split(from).join(to); copyHits[from] = (copyHits[from] || 0) + n; }
    }

    // The visible FAQ answer, then the structured data rebuilt FROM the visible answers.
    h = h.replace(
      // The old card or the accordion _nearfaqview.js renders (2026-11-13): whichever the page holds.
      /((?:<h3 class="lx-faq-q"[^>]*>\s*What does it cost to mint a token\?\s*<\/h3>|<button[^>]*class="lx-faq-q"[^>]*>\s*<span>\s*What does it cost to mint a token\?\s*<\/span>)[\s\S]{0,800}?<p class="lx-faq-a"[^>]*>)([\s\S]*?)(<\/p>)/,
      function (m0, open, body, close) {
        if (body.trim() === COST_A) return m0;
        faqs++;
        return open + COST_A + close;
      });
    const pairs = [];
    const pre = /(?:<h3 class="lx-faq-q"[^>]*>([\s\S]{0,300}?)<\/h3>|<button[^>]*class="lx-faq-q"[^>]*>\s*<span>([\s\S]{0,300}?)<\/span>)[\s\S]{0,800}?<p class="lx-faq-a"[^>]*>([\s\S]*?)<\/p>/g;
    let pm;
    while ((pm = pre.exec(h))) {
      pairs.push({
        q: (pm[1] != null ? pm[1] : pm[2]).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
        a: pm[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      });
    }
    if (pairs.length) {
      const ld = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: pairs.map(function (p) { return { '@type': 'Question', name: p.q, acceptedAnswer: { '@type': 'Answer', text: p.a } }; }),
      });
      const before = h;
      h = h.replace(/(<script type="application\/ld\+json" id="lx-faq-ld">)([\s\S]*?)(<\/script>)/,
        function (m0, open, body, close) { return open + ld + close; });
      if (h !== before) lds++;
    }

    // Project Type: gone from the Stellar site, so gone here too, from the markup on every page that has it.
    for (const [needle, tag, tagName] of [
      ['Project Type', '<div class="field">', 'div'],
      ['Project Type', '<div class="detail-row">', 'div'],
      ['<div class="preview-type-badge"', '<div class="preview-type-badge"', 'div'],
      ['<span class="hero-type-badge"', '<span class="hero-type-badge"', 'span'],
    ]) {
      for (let pass = 0; pass < 4; pass++) {
        const cut = removeBlockContaining(h, needle, tag, tagName);
        if (!cut.removed) break;
        h = cut.html;
        typeRemoved += cut.removed;
      }
    }

    const kind = /launch-review/.test(k) ? 'review' : (/launch-confirm/.test(k) ? 'confirm' : 'form');
    const css = kind === 'review' ? CSS_REVIEW : (kind === 'confirm' ? CSS_CONFIRM : CSS_ALL);
    const hi = h.indexOf('</' + 'head>');
    if (hi < 0) { console.error('  ' + k + ': no closing head — aborting'); process.exit(1); }
    h = h.slice(0, hi) + '<style id="' + CSS_ID + '">\n' + css + '\n</style>' + h.slice(hi);

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + k + ': no closing body — aborting'); process.exit(1); }
    json[k] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near launchpad: NEAR launch layer on ' + pages + ' page key(s); Stellar issuance layer stripped from '
  + stripped + '; project-type blocks removed ' + typeRemoved + '; mint-cost FAQ rewritten on ' + faqs
  + ', FAQ ld+json rebuilt on ' + lds + '; copy fixes ' + JSON.stringify(copyHits));
if (!pages) { console.error('  ! no launchpad page found'); process.exit(1); }
