// The LUMOS token page under /lumos/near.
//
// LUMOS IS ON NEAR (_tools/near-lumos.js, minted 2026-11-04), so this page is NEAR's own (RAZA 2026-11-07, tickets 270-273):
//   * strips Stellar's lx-ltdata (price, holders and pools from Horizon, a Stellar signer behind Swap) and injects
//     lx-nearlumospage: the swap engine (nearswap.js, as _nearwallet injects it), browser/nearlumospage.js, swapmodal.js,
//     in that order, because the page file names the default To that swapmodal.js reads when it boots;
//   * writes NEAR's copy into the markup, where search engines and hidden markup see it: title, description, pill,
//     contract, utility cards, supply, FAQ and its JSON-LD, the two dialogs;
//   * blanks the design's mock figures and mock rows, leaving one neutral row as the template the layer clones. The
//     .lxlt gates in lx-lt-css still hold a figure back until the layer has one.
//
// Idempotent: our blocks are stripped by id first, and every rule matches only the design's text or an already-blank value.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const { NEAR_LUMOS, NEAR_LUMOS_POOL } = require(__dirname + '/near-lumos.js');
const B = String.fromCharCode(92);
if (!NEAR_LUMOS) { console.error('  near-lumos.js: this page needs the NEAR contract — aborting'); process.exit(1); }

const ID = 'lx-nearlumospage';
const src = fs.readFileSync(__dirname + '/browser/nearlumospage.js', 'utf8');
const swapEngine = require(__dirname + '/near-router.js').stamp(fs.readFileSync(__dirname + '/browser/nearswap.js', 'utf8'));
const swapModal = fs.readFileSync(__dirname + '/browser/swapmodal.js', 'utf8');
for (const x of [src, swapEngine, swapModal]) {
  if (x.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
for (const p of ["'__NEAR_LUMOS__'", "'__NEAR_LUMOS_POOL__'"]) {
  if (src.split(p).length !== 2) { console.error('  nearlumospage.js: expected one ' + p + ' — aborting'); process.exit(1); }
}
const page = src.split("'__NEAR_LUMOS__'").join("'" + NEAR_LUMOS + "'").split("'__NEAR_LUMOS_POOL__'").join(String(NEAR_LUMOS_POOL));
const SCRIPT = '<script id="' + ID + '">\n' + swapEngine + '\n' + page + '\n' + swapModal + '\n</' + 'script>';
const PAGE = /^lumoscore-lumos-token(-dark|-light|-mobile)?\.html$/;

const DEAD_HERE = ['lx-swapcalc', 'lx-qorders', 'lx-ltdata'];

// A <style> in <head>, parsed before first paint.
const CSS_ID = 'lx-nearlumospage-css';
const LOGO_CSS = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
const STYLE = '<style id="' + CSS_ID + '">'
  + '.hero-price-block:not(.lxlt) .price-native{visibility:hidden}'
  // The Swap popup's look is browser/swapmodal.js's own sheet now, so the Wallet and this page cannot differ.
  + '.pool-list .pair-icons .b,.pools .pair-icons .b{overflow:hidden}'
  + '.lxn-book{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:999px;font-size:11.5px;font-weight:700;color:var(--text-muted);background:var(--bg);border:1px solid var(--border)}'
  + '.lxn-noholders{padding:18px;color:var(--text-soft);font-size:14.5px}'
  // The phone's name for .sub carries no red of its own.
  + '.cstat .small-sub.up{color:var(--green)}.cstat .small-sub.down{color:var(--red,#e5484d)}'
  // Tickets 270 and 292: the list sits in the Ecosystem card, Stellar's own section. The card takes the band's two right
  // columns with Native and Whale stacked beside it, so ten rows do not stretch their neighbours. One column when narrow.
  + '@media(min-width:761px){.utility-grid .util-card.native,.utility-grid .util-card.whale{grid-column:1}.utility-grid .util-card.eco{grid-column:2/-1;grid-row:span 2}}'
  + '.lxn-eco-list{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(5,auto);grid-auto-flow:column;column-gap:22px;margin:6px 0 14px}'
  + '.lxn-eco-row{display:flex;align-items:center;gap:12px;padding:10px 4px;min-width:0;border-top:1px solid var(--border);text-decoration:none;color:inherit}'
  + '.lxn-eco-row:nth-child(5n+1){border-top:0}'
  + '.lxn-eco-row:hover .lxn-eco-tk{color:var(--accent,#ea6a2c)}'
  + '.lxn-eco-rk{flex:0 0 30px;font:700 12.5px/1 "JetBrains Mono",monospace;color:var(--text-soft)}'
  + '.lxn-eco-ic{flex:0 0 30px;width:30px;height:30px;border-radius:50%;overflow:hidden;background:var(--bg)}'
  + '.lxn-eco-ic img{' + LOGO_CSS + '}'
  + '.lxn-eco-tx{display:flex;flex-direction:column;gap:3px;min-width:0}'
  + '.lxn-eco-tk{display:flex;align-items:center;gap:6px;font-size:15.5px;font-weight:800;color:var(--text)}'
  // ORANGE, as Stellar's and XRPL's Ecosystem lists draw it (RAZA 2026-11-15: "why do these have green tick on near.
  // Make it orange like on XRPL and stellar"): Stellar's .lxu-eco-vt is a 15px accent disc, white 10px check.
  + '.lxn-eco-tk .lx-vtick{width:15px;height:15px;flex:0 0 15px;margin:0;border-radius:50%;background:var(--accent,#ea6a2c)!important;color:#fff!important}'
  + '.lxn-eco-tk .lx-vtick svg{width:10px;height:10px;stroke:#fff}'
  + '.lxn-eco-id{font:500 12.5px/1.2 "JetBrains Mono",monospace;color:var(--text-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  // The contract is short enough to read whole: the lock and the two buttons wrap under it on a phone.
  + '@media(max-width:1180px){.lxn-eco-list{display:block}.lxn-eco-row:nth-child(5n+1){border-top:1px solid var(--border)}.lxn-eco-row:first-child{border-top:0}}'
  // OVERLAPPING TEXT (RAZA 2026-11-15, phone): the value stayed flex:1 1 0%, squeezed to 81px, and overflow:visible drew
  // "lumos.lumoscore.near" over the lock and both buttons. It keeps its natural width now; the row already wraps, so
  // whatever no longer fits beside it moves to the next line instead of under the text.
  + '@media(max-width:760px){.addr-row .addr-value{max-width:none!important;overflow:visible!important;flex:0 0 auto!important;min-width:0}.lxn-eco-list{display:block}.lxn-eco-row:nth-child(5n+1){border-top:1px solid var(--border)}.lxn-eco-row:first-child{border-top:0}}'
  + '</style>';
// The earlier style block of this id, or the one from before the mint.
function stripStyle(h) {
  const open = '<style id="' + CSS_ID + '">';
  for (;;) { const i = h.indexOf(open); if (i < 0) return h; h = h.slice(0, i) + h.slice(h.indexOf('</style>', i) + 8); }
}

// ---- markup helpers ----------------------------------------------------------------------------------------------
// The end of the element opening at `at`, by counting its own tag: `<div` inside a `<div`.
function endOf(h, at, tag) {
  const re = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g');
  re.lastIndex = at;
  let depth = 0, m;
  while ((m = re.exec(h))) {
    depth += m[0] === '</' + tag + '>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}
// Every element whose opening text is `open`, through fn(element html, index): its return value replaces the element.
function eachEl(h, open, tag, fn) {
  let at = 0, n = 0;
  for (;;) {
    const i = h.indexOf(open, at);
    if (i < 0) return h;
    const e = endOf(h, i, tag);
    if (e < 0) return h;
    const r = fn(h.slice(i, e), n++);
    h = h.slice(0, i) + r + h.slice(e);
    at = i + r.length;
  }
}
const NEAR_IMG = '<img src="/assets/networks/near.png" alt="" style="' + LOGO_CSS + '">';
const CONTRACT = NEAR_LUMOS;
const EXPLORER = 'https://nearblocks.io/token/' + CONTRACT;

// Exact sentences: desktop, phone, dark, the FAQ and its JSON-LD all carry them the same way.
const COPY = [
  ['LUMOS is the platform token of LumosCore, issued on Stellar. It is used to reduce trading fees and to distribute liquidity and holder incentives.',
   'LUMOS is the platform token of LumosCore, issued on NEAR Protocol. It is used to reduce trading fees. Liquidity and holder incentives are not live on NEAR yet.'],
  ['LUMOS trades on the Stellar network. You can swap into it from XLM or another asset on the Trade page, using the same routing as any other Stellar asset.',
   'LUMOS trades on the NEAR network. You can swap into it from NEAR or another token on the Trade page, using the same routing as any other NEAR token.'],
  ['1 billion LUMOS · fixed supply on Stellar.', '1 billion LUMOS · fixed supply on NEAR.'],
  ['issuer key locked. Allocation is shown below.', 'and the contract has no access keys. Allocation is shown below.'],
  ['it is added, a little at a time, to LUMOS liquidity on Stellar — the LUMOS/XLM pool and the other LUMOS pairs — with a portion resting on the order book for price discovery.',
   'it is added, a little at a time, to LUMOS liquidity on NEAR — the LUMOS/NEAR pool and the other LUMOS pairs — with a portion resting on the order book for price discovery.'],
  ['<strong>LP rewards</strong> distribute over 10 years; <strong>Whale Holder rewards</strong> distribute over 2 years.',
   '<strong>LP rewards</strong> and <strong>Whale Holder rewards</strong> are not live on NEAR yet.'],
  // The fee is real on NEAR: browser/feerate.js reads the account's LUMOS, browser/nearswap.js charges what it publishes.
  ['and pay <strong>0.1%</strong> instead of 0.2% on every trade — half the platform fee, across the DEX and the AMM.',
   'and pay <strong>0.1%</strong> instead of 0.2% on every swap on NEAR — half the platform fee. Limit orders are free.'],
  ['Provide liquidity to LUMOS-paired pools and earn from the 240M LUMOS Native LP Rewards pool, distributed over 10 years.',
   'The 240M LUMOS Native LP Rewards pool is for liquidity in LUMOS-paired pools. Rewards are not live on NEAR yet.'],
  ['Pair any partner token with LUMOS in a curated pool and earn boosted rewards from the 240M Ecosystem LP pool.',
   'The 240M Ecosystem LP pool is for curated pools pairing a partner token with LUMOS. Rewards are not live on NEAR yet.'],
  ['Wallets holding 5M+ LUMOS earn from a dedicated 50M LUMOS pool, distributed over 2 years. Designed to reward long-term conviction.',
   'A dedicated 50M LUMOS pool is set aside for wallets holding 5M+ LUMOS. Rewards are not live on NEAR yet.'],
  ['<a class="u-link" href="/rewards/stellar">', '<a class="u-link" href="/rewards/near">'],
  ['<a class="u-link" href="/pools/stellar">', '<a class="u-link" href="/pools/near">'],
  // The Ecosystem LP card's link lands on the Pools page's Rewarded tab, as Stellar's _lumosutility.js and XRPL's
  // _xrpllumoslinks.js do (RAZA 2026-11-13). The whole anchor, label included, so no other /pools/near link can match.
  ['<a class="u-link" href="/pools/near">View partner pools →</a>', '<a class="u-link" href="/pools/near?tab=rewarded">View Rewarded Pools →</a>'],
  ['Initialize a new liquidity pool on Stellar AMM', 'Initialize a new liquidity pool on NEAR AMM'],
  ['~0.00001 XLM', '—'],
  ['<span>1 APT ≈ <strong>312.5 LUMOS</strong></span>', '<span>1 NEAR ≈ <strong>—</strong></span>'],
  ['APT → LUMOS (Direct)', '—'],
  ['&lt; 0.01%</strong>', '—</strong>'],
  ['<th>Network</th>', ''],
  ['<th>Incentives</th>', ''],
  ['Issuer key locked — supply is fixed', 'No access keys on the contract — supply is fixed'],
  ['data-tooltip="Copy issuer"', 'data-tooltip="Copy contract"'],
  ['aria-label="Copy issuer"', 'aria-label="Copy contract"'],
  ['<a href="#">View full holder list →</a>', '<a href="' + EXPLORER + '?tab=holders" target="_blank" rel="noopener">View full holder list →</a>'],
  ['>Combined · both chains<', '>Ranked by balance<'],
  ['>both chains<', '>Ranked by balance<'],
  ['1M+ LUMOS', '5M+ LUMOS'],
  ['Connected · Stellar', 'Connected · NEAR'],
];
// A rule that must have landed on every page, or the build stops: its text moving is how a page goes back to Stellar.
const MUST = ['issued on NEAR Protocol', 'trades on the NEAR network', 'fixed supply on NEAR.', 'LUMOS liquidity on NEAR — the LUMOS/NEAR pool', '/rewards/near', 'href="/pools/near?tab=rewarded">View Rewarded Pools'];

function nearMarkup(h, key) {
  const phone = key.indexOf('-mobile') >= 0;
  for (const [a, b] of COPY) h = h.split(a).join(b);

  // Title and description; og: and twitter: are written at the edge from this one.
  h = h.replace(/<title>[^<]*<\/title>/, '<title>LUMOS on NEAR — Price, Supply and Utility | LumosCore</title>');
  h = h.replace(/<meta[^>]*name=["']description["'][^>]*>/i, '<meta name="description" content="LUMOS is the LumosCore platform token on NEAR. See price, supply, holders and liquidity, and how holding 250,000+ LUMOS halves your trading fee.">');

  // The hero: the pill, the contract and its two actions. First the design's comment, which quotes the row's opening tag.
  h = h.replace(/<!--(?:(?!-->)[sS])*?addr-row(?:(?!-->)[sS])*?-->/g, '');
  h = h.replace(/<div class="lh-desc">[^<]*<\/div>/, '<div class="lh-desc">LumosCore\'s native utility token — powers platform fees and rewards</div>');
  h = eachEl(h, '<div class="addr-row', 'div', (el) => el
    .replace(/<div class="addr-row[^"]*">/, '<div class="addr-row lxlt">')
    .replace(/<span class="net-tag">[\s\S]*?(<span class="addr-value)/, '<span class="net-tag"><span class="b-ico" data-logoed="1" style="background:transparent">' + NEAR_IMG + '</span> NEAR</span>\n$1')
    .replace(/<span class="addr-value[^>]*>[^<]*<\/span>/, '<span class="addr-value mono" data-full="' + CONTRACT + '" title="' + CONTRACT + '">' + CONTRACT + '</span>')
    .replace(/data-copy="[^"]*"/g, 'data-copy="' + CONTRACT + '"')
    .replace(/<a class="addr-btn"[^>]*>/, '<a class="addr-btn" href="' + EXPLORER + '" target="_blank" rel="noopener" data-tooltip="View on NearBlocks" aria-label="View on NearBlocks">'));
  h = h.replace(/<div class="price-native">[^<]*<\/div>/, '<div class="price-native">≈ — NEAR</div>');
  h = h.replace(/(<(div|span) class="price">)[^<]*(<\/\2>)/, '$1—$3');
  h = h.replace(/(<(div|span) class="change">)[\s\S]*?(<\/\2>)/, '$1$3');
  h = h.replace(/\s*<div class="sub-vol">[^<]*<\/div>/, '');
  h = h.replace(/<div class="chart-legend">[\s\S]*?<\/div>/, '');

  // Four cards, as Stellar's since the fully diluted card went, blank until the layer has a figure.
  h = eachEl(h, '<div class="lh-stats', 'div', (box) => eachEl(box, '<div class="cstat', 'div', (c) => {
    if (/Fully Diluted|>\s*FDV|<\/span>\s*FDV/.test(c)) return '';
    return c.replace(' style="grid-column: 1 / -1;"', '')
      .replace(/<\/span> Pools<\/div>/, '</span> Active Pools</div>')
      .replace(/<div class="val">[^<]*<\/div>/, '<div class="val">—</div>')
      .replace(/<div class="(sub|small-sub)[^"]*">[^<]*<\/div>/, '<div class="$1"></div>');
  }));

  // The overview's chip and values.
  h = h.replace(/<div class="lt-cmp-chain">[\s\S]*?<\/div>/, '<div class="lt-cmp-chain"><span class="lt-cmp-ico" data-logoed="1" style="background:transparent">' + NEAR_IMG + '</span> NEAR</div>');
  h = h.replace(/<div class="lt-cmp-v">[\s\S]*?<\/div>/g, '<div class="lt-cmp-v">—</div>');
  h = h.replace(/View all [0-9]* ?pools →/, 'View all pools →');

  // One neutral row: the template. Its button keeps the design's arrow.
  if (!phone) {
    const a = h.indexOf('<tbody id="poolsBody">');
    if (a >= 0) {
      const b = h.indexOf('</tbody>', a);
      const btn = (/<a class="trade-btn"[\s\S]*?<\/a>/.exec(h.slice(a, b)) || [''])[0].replace(/href="[^"]*"/, 'href="/pools/near"');
      h = h.slice(0, a) + '<tbody id="poolsBody"><tr><td><div class="pair-cell"><div class="pair-icons"><div class="a"></div><div class="b"></div></div>'
        + '<div class="pair-name"></div></div></td><td><span class="num">—</span></td><td><span class="num">—</span></td><td>' + btn + '</td></tr>' + h.slice(b);
    }
  } else {
    h = eachEl(h, '<a class="pool-item"', 'a', (el, i) => (i ? '' : el
      .replace(/href="[^"]*"/, 'href="/pools/near"')
      .replace(/ data-chain="[^"]*"/, '')
      .replace(/(<div class="a"[^>]*>)[^<]*</, '$1<').replace(/(<div class="b"[^>]*>)[^<]*</, '$1<')
      .replace(/<div class="pair-name">[^<]*</, '<div class="pair-name"><')
      .replace(/<div class="meta-row">[\s\S]*?<\/div>/, '')
      .replace(/<span class="v">[^<]*</g, '<span class="v">—<')));
  }

  // Holders: no figure until the layer has one, and one neutral row.
  h = h.replace(/<div class="meta">[0-9,]+( total)?<\/div>/, '<div class="meta"></div>');
  h = h.replace(/<span class="wsize-count">[^<]*<\/span>/g, '<span class="wsize-count">—</span>');
  h = h.replace(/(<span class="fill" style=")width:[0-9]+%/g, '$1width:0%');
  h = eachEl(h, '<div class="holder-row">', 'div', (el, i) => (i ? '' : el
    .replace(/<div class="rk[^"]*">[^<]*</, '<div class="rk"><')
    .replace(/<div class="av"[^>]*>[^<]*</, '<div class="av" style="background:var(--accent)"><')
    .replace(/<div class="addr">[^<]*</, '<div class="addr">—<')
    .replace(/<div class="chain">[\s\S]*?<\/div>/, '<div class="chain">—</div>')
    .replace(/<div class="v">[^<]*</, '<div class="v">—<')
    .replace(/<div class="pct">[^<]*</, '<div class="pct">—<')));

  // NEAR has no trustlines: the design's gate goes from both dialogs. Its script finds no gate and does nothing.
  h = eachEl(h, '<div class="trustline-gate"', 'div', () => '');

  // The Swap dialog's pay chip: swapmodal.js paints it, but this is what the HTML says first.
  const sw = h.indexOf('id="modalSwap"');
  if (sw >= 0) {
    const open = h.lastIndexOf('<div', sw), end = endOf(h, open, 'div');
    h = h.slice(0, open) + h.slice(open, end).replace(/(<button class="asset-pick">[\s\S]*?<\/span>\s*)APT/, '$1NEAR') + h.slice(end);
  }

  for (const m of MUST) if (h.indexOf(m) < 0) { console.error('ABORT ' + key + ': missing after the copy rules: ' + m); process.exit(1); }
  return h;
}

let injected = 0, labels = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const key of Object.keys(json)) {
    if (!PAGE.test(key) || typeof json[key] !== 'string') continue;
    let h = stripStyle(stripById(json[key], ID).html);
    for (const id of DEAD_HERE) { const r = stripById(h, id); h = r.html; stripped += r.removed; }
    const before = h;
    h = nearMarkup(h, key);
    if (h !== before) labels++;
    const hi = h.indexOf('</' + 'head>');
    if (hi < 0) { console.error('ABORT ' + key + ': no closing head'); process.exit(1); }
    h = h.slice(0, hi) + STYLE + h.slice(hi);
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('ABORT ' + key + ': no closing body'); process.exit(1); }
    h = h.slice(0, bi) + SCRIPT + h.slice(bi);
    injected++;
    json[key] = h;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near lumos page: NEAR layer on ' + injected + ' page key(s), markup rewritten on ' + labels + ', Stellar layers stripped ' + stripped);
if (injected !== 3) { console.error('  ! expected 3 page keys (lumos-token x3), got ' + injected); process.exit(1); }
