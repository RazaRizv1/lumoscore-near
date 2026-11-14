// NEAR titles and meta descriptions. Ported from C:\LumosCore-XRPL\_tools\_xrplseo.js.
//
// The containers arrived carrying Stellar's copy: /trade/near told search engines and the browser tab
// "Trade on the Stellar DEX". Titles and descriptions are what gets indexed and what a tab shows, so
// they are the first copy that has to be right.
//
// WRITTEN OUT, NOT FIND-AND-REPLACED, for the reason the XRPL file gives: a regex over "Stellar" makes
// sentences that are false rather than renamed. NEAR has no ledger order book (trading routes through
// Rhea Finance), no trustlines (it has storage registration), and LUMOS is not minted on NEAR yet.
//
// DELIBERATELY ABSENT, so their Stellar copy stays visible and fixable rather than confidently wrong:
//   lumoscore-lumos-token, lumoscore-rewards   LUMOS is not on NEAR yet (deferred until it is minted)
//   lumoscore-mcp                              there is no NEAR MCP server
//   lumoscore-list-token                       the listing fee on NEAR is not decided
//   lumoscore-landing                          dropped by the combine; the landing page is Stellar's
//   the docs and blog                          their descriptions must match their bodies, which are
//                                              rewritten as each feature lands
// Every string names no figure that is not decided (no launch cost, no wallet count).
//
// Idempotent: it writes exact values, so re-running changes nothing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// base page name (without -dark/-light/-mobile) -> [title, description]
const SEO = {
  'lumoscore-home': [
    'Dashboard — Your NEAR Portfolio | LumosCore',
    'Your NEAR balances, tokens, pool positions and recent activity in one place, priced live. '
      + 'Connect HOT, Meteor or NEAR Mobile.',
  ],
  'lumoscore-wallet': [
    'NEAR Wallet — Balances, Send and Receive | LumosCore',
    'View your NEAR and token balances, send and receive, and swap on NEAR. Non-custodial — you sign every transaction yourself.',
  ],
  // The bridge: NEAR Intents, plus Omni Bridge and Wormhole since 2026-10-30. Thirty-five is the
  // destination count CHAINS in functions/lxapi/nearoneclick.js offers (the other two reach a subset of
  // those), and the page's runtime title restates it.
  'lumoscore-bridge': [
    'Bridge from NEAR to 35 Networks | LumosCore',
    'Bridge NEAR, USDC, USDT and other NEAR tokens to Bitcoin, Ethereum, Solana and 30+ more networks with '
      + 'NEAR Intents, Omni Bridge or Wormhole — the destination chain’s own token, or the token itself.',
  ],
  'lumoscore-dex': [
    'Trade on NEAR — Swap and Limit Orders | LumosCore',
    'Swap NEAR tokens at the best on-chain price and place limit orders, with live prices.',
  ],
  'lumoscore-dex-asset': [
    'NEAR Token — Price, Order Book, Holders | LumosCore',
    'Live price, order book, holders and pools for a NEAR token, with swap and limit orders on the same page.',
  ],
  'lumoscore-amm': [
    'NEAR Liquidity Pools — TVL, Volume, Fees | LumosCore',
    'Browse NEAR liquidity pools with live total value locked, 24h volume and fees. Add or withdraw liquidity and track your positions.',
  ],
  'lumoscore-amm-pool': [
    'NEAR Pool — Liquidity, Volume and Fees | LumosCore',
    'Pool composition, TVL, volume and fees for a NEAR liquidity pool, with add and withdraw on the same page.',
  ],
  'lumoscore-account': [
    'NEAR Account — Balances, Tokens and Activity | LumosCore',
    'Look up any NEAR account: balances, tokens, pool positions and transaction history, read live from the chain.',
  ],
  'lumoscore-launch-token': [
    'Launch a Token on NEAR — No Code Required | LumosCore',
    'Create your own fixed-supply token on NEAR in minutes. Set the name, supply and logo from the browser — no code to write.',
  ],
  'lumoscore-launch-review': [
    'Review Your Token — NEAR Launchpad | LumosCore',
    'Check the name, supply and logo of your token before it is created on NEAR.',
  ],
  'lumoscore-launch-confirm': [
    'Token Launched — NEAR Launchpad | LumosCore',
    'Your token is live on NEAR. Share it, add liquidity, or trade it straight away.',
  ],
  // Rewards on NEAR exist now (RAZA 2026-11-14, "do the same for NEAR"): the served description still said
  // "across Stellar liquidity positions". Rounds start 1 December 2026; no amounts here (they are the page's).
  'lumoscore-rewards': [
    'LUMOS Rewards on NEAR | LumosCore',
    'Three LUMOS reward programmes on NEAR, starting 1 December 2026: provide liquidity to a rewarded pool or '
      + 'hold LUMOS to take a share of each round. Check your eligibility and estimated rewards.',
  ],
  'lumoscore-signin': [
    'Connect a Wallet | LumosCore',
    'Connect a NEAR wallet to trade, pool and launch tokens. LumosCore never holds your keys.',
  ],
};

const BASE = (k) => k.replace(/-(dark|light|mobile)\.html$/, '').replace(/\.html$/, '');

function setTitle(html, title) {
  const m = /<title>[\s\S]*?<\/title>/.exec(html);
  if (!m) return { html, ok: false };
  return { html: html.replace(m[0], '<title>' + title + '</title>'), ok: true };
}

function setDesc(html, desc) {
  // name="description" only. og: and twitter: descriptions are injected at the edge from this one.
  const re = /<meta[^>]*name=["']description["'][^>]*>/i;
  const m = re.exec(html);
  if (!m) return { html, ok: false };
  return { html: html.replace(m[0], '<meta name="description" content="' + desc.replace(/"/g, '&quot;') + '">'), ok: true };
}

// Must mirror SITEMAP_SKIP in extract_site.js: the gated app pages, signin, and the launch wizard's
// mid-flow steps. Writes the exact value in BOTH directions, so a page moving in or out is corrected.
const NOINDEX = new Set([
  'lumoscore-home', 'lumoscore-wallet',
  // Someone else's wallet: platform-wide privacy call (RAZA, 2026-10-31), same as Stellar and XRPL.
  'lumoscore-account',
  'lumoscore-signin', 'lumoscore-launch-review', 'lumoscore-launch-confirm',
]);

function setRobots(html, noindex) {
  const re = /<meta[^>]*name=["']robots["'][^>]*>/i;
  const want = noindex
    ? '<meta name="robots" content="noindex, nofollow">'
    : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">';
  const m = re.exec(html);
  if (!m) return { html, ok: false };
  if (m[0] === want) return { html, ok: false };
  return { html: html.replace(m[0], want), ok: true };
}

let files = 0, pages = 0, titles = 0, descs = 0, skipped = 0, robots = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const seo = SEO[BASE(key)];
    if (!seo) { skipped++; continue; }
    let html = json[key];
    const t = setTitle(html, seo[0]); html = t.html; if (t.ok) titles++;
    const d = setDesc(html, seo[1]); html = d.html; if (d.ok) descs++;
    const r = setRobots(html, NOINDEX.has(BASE(key))); html = r.html; if (r.ok) robots++;
    json[key] = html;
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}

console.log('near seo: ' + titles + ' title(s) and ' + descs + ' description(s) written across '
  + pages + ' page key(s) in ' + files + ' container(s); ' + skipped + ' key(s) left alone');
console.log('near seo: ' + robots + ' robots tag(s) changed');
