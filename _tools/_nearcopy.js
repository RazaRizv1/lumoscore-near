// Visible Stellar wording on NEAR pages that is SHARED page furniture, not a feature's own copy.
//
// Each pair is an exact markup string with its NEAR replacement, decided one by one — the same rule as
// _nearseo.js, never a regex over "Stellar". Feature copy (trustlines and XLM reserves, the listing fee
// in XLM, the Stellar network fee lines, FAQ answers) is NOT here: it is rewritten in the workstream
// that builds the NEAR version of that feature, so no sentence ever describes a feature that does not
// exist yet. Measured before writing this: 2,133 body mentions of Stellar/XLM across 96 built pages,
// most of them feature copy.
//
// Wording mirrors the XRPL fork's for the same strings, with NEAR where it says "the XRP Ledger".
// "the NEAR DEX" is the product's own DEX on NEAR; NEAR itself has no built-in exchange, which is why
// the sub-line says "on NEAR" rather than "on NEAR's decentralized exchange".
//
// Every pair must match somewhere, or the build aborts: zero hits means the design moved and a string
// would silently stay Stellar. Idempotent: replaced text no longer matches, and a pair whose NEAR form
// is already present counts as done rather than missing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const PAIRS = [
  // The Trade page's SWAP button says "Swap" from the first paint (RAZA 2026-11-04: it read "Place Buy Order"
  // until browser/dxaswap.js took the button over, about a second, longer on a slow load). The Limit
  // pane's "Place Limit Order" button is a different string and is untouched.
  ['<button class="dxa-trade-cta">Place Buy Order</button>', '<button class="dxa-trade-cta">Swap</button>'],
  ['<button class="mdxa-trade-cta">Place Buy Order</button>', '<button class="mdxa-trade-cta">Swap</button>'],
  // The search panel's footer, on every page with the search.
  ['<span>Search assets, pools and wallets on Stellar.</span>',
   '<span>Search assets, pools and wallets on NEAR.</span>'],
  // The Trade hero.
  ['<h1>Explore the <em>Stellar</em> DEX</h1>',
   '<h1>Explore the <em>NEAR</em> DEX</h1>'],
  // The phone's Trade heading: visually hidden, read aloud and indexed (found by the 2026-10-22 phone sweep).
  ['<h1 class="page-title lx-sronly">Explore the <span class="hl">Stellar</span> DEX</h1>',
   '<h1 class="page-title lx-sronly">Explore the <span class="hl">NEAR</span> DEX</h1>'],
  ['Discover, trade, and launch tokens on Stellar\'s decentralized exchange.',
   'Discover, trade, and launch tokens on NEAR.'],
  // The Pools strapline (desktop .dex-hero-sub, phone .page-subtitle.lx-sronly). browser/pools.js also
  // rewrites it at run time; this makes the served HTML, which search engines index, say NEAR too.
  ['Provide liquidity and earn fees on Stellar\'s on-chain AMM pools.',
   'Add, remove and manage your liquidity in NEAR\'s pools.'],
  // Pages built before 2026-11-04 carry the earlier NEAR line that named Rhea (RAZA: no Rhea on our pages).
  ['Provide liquidity and earn fees on Rhea\'s pools on NEAR.', 'Add, remove and manage your liquidity in NEAR\'s pools.'],
  // Screen-reader headings (visually hidden, read aloud and indexed).
  ['<h1 class="lx-srh1">Your Stellar wallet', '<h1 class="lx-srh1">Your NEAR wallet'],
  ['<h1 class="lx-srh1">Stellar liquidity pool', '<h1 class="lx-srh1">NEAR liquidity pool'],
  // ONE LINE, as Stellar's other fee banner (RAZA 2026-11-06: "the 250K message below. on Stellar we have it in one line").
  ['</b> — 50% Discount</span>', '</b> — 50% off</span>'],
  // LIMIT ORDERS ARE FREE ON NEAR AGAIN (RAZA 2026-11-04: "lets remove fees on limit orders just like on Stellar";
  // browser/neardcl.js LIMIT_FEE_BPS = 0). From 2026-11-01 these three Stellar sentences were rewritten to say a NEAR
  // order pays the fee; the containers still carry that text, so these rules turn it back into Stellar's own words.
  ['On NEAR, a limit order pays the same fee, taken when the order is placed.',
   'Limit orders are free, because an order that may never fill should not cost you anything.'],
  ['shown on every quote. On NEAR it applies to limit orders too, taken when the order is placed.</span>',
   'shown on every quote. Limit orders are free.</span>'],
  [', and on NEAR a limit order pays it when the order is placed.', ', and limit orders are free.'],

  // ---- WHAT A CRAWLER READS (RAZA 2026-11-14: "check SEO, GEO, AEO for NEAR ... do the same for NEAR") ----------
  // Measured on production as an AI search crawler (no JavaScript): /trade/near served "How the Stellar DEX works",
  // the token pages the Freighter connect dialog, /rewards/near "Your Stellar address". XRPL's _xrplcopy2.js
  // rewrote the same dialogs for its chain; these are NEAR's. Most of them are also what a reader sees on opening
  // the dialog, which is the second reason. Mock NUMBERS are left alone, as XRPL leaves them: the layers paint real
  // ones. Left on purpose: the chooser grid's Stellar card lines (.lx-lp-meta: they describe Stellar) and the
  // Stellar-only trustline panel. (The advertising answer USED to be left as "paid in XLM or LUMOS"; RAZA 2026-11-20,
  // N1: "NEAR or LUMOS" -- see the FAQ block below.)
  //
  // The wallet menu and the connect dialog.
  ['<span class="mu-sub">Connected · Stellar</span>', '<span class="mu-sub">Connected · NEAR</span>'],
  ['<span class="lc-mfoot-attr">Powered by Freighter, Albedo, xBull and Rabet</span>',
   '<span class="lc-mfoot-attr">Powered by HOT, Meteor, NEAR Mobile and Intear</span>'],
  ['<h4 id="lcConnectingTitle">Confirming with Freighter</h4>', '<h4 id="lcConnectingTitle">Confirming with your wallet</h4>'],
  // The receive dialog.
  ['<div class="qr-label">Your Stellar address</div>', '<div class="qr-label">Your NEAR address</div>'],
  ['</strong> Only send XLM and Stellar-based assets to this address.',
   '</strong> Only send NEAR and NEAR tokens to this address.'],
  // Create pool.
  ['<div class="modal-sub">Initialize a new liquidity pool on Stellar AMM</div>',
   '<div class="modal-sub">Initialize a new liquidity pool on NEAR</div>'],
  ['<div class="modal-sub">Initialize a new pool on Stellar AMM</div>', '<div class="modal-sub">Initialize a new pool on NEAR</div>'],
  ['<div class="pair-sub">Stellar AMM utility</div>', '<div class="pair-sub">NEAR pool</div>'],
  ['<div class="pc-sub">Stellar AMM utility</div>', '<div class="pc-sub">NEAR pool</div>'],
  // THE FAQ'S PAYMENT LINES, IN NEAR'S OWN COIN (RAZA 2026-11-20, N1: advertising "NEAR or LUMOS"; listing is paid in
  // NEAR since 2026-11-17, "In their own coin" -- browser/nearlisting.js). XRPL rewrites the same sentences to XRP
  // (_xrplcopy.js). Dollar figures are left exactly as they are.
  ['paid in XLM or LUMOS.', 'paid in NEAR or LUMOS.'],
  ['Pay in XLM or LUMOS.', 'Pay in NEAR or LUMOS.'],
  ['shown to people already trading Stellar assets', 'shown to people already trading NEAR tokens'],
  ['pay $250 in XLM from your own wallet', 'pay $250 in NEAR from your own wallet'],
  ['pay $250 in XLM, refunded in full', 'pay $250 in NEAR, refunded in full'],
  ['the same amount of XLM, sent back to the account that paid it',
   'the same amount of NEAR, sent back to the account that paid it'],
  ['You pay in XLM at the live rate', 'You pay in NEAR at the live rate'],
  ['<p class="lumos-promo-sub">Pools run on Stellar\'s native AMM. Five-second finality. Penny-fraction fees.</p>',
   '<p class="lumos-promo-sub">Pools run on-chain on NEAR. Fast finality. Penny-fraction fees.</p>'],
  // The headings a crawler takes the page's subject from (XRPL: "XRP Ledger Liquidity Pools").
  ['<h1>Automated Market Maker</h1>', '<h1>NEAR Liquidity Pools</h1>'],
  ['<h1 class="page-title lx-sronly">Automated Market Maker</h1>', '<h1 class="page-title lx-sronly">NEAR Liquidity Pools</h1>'],
  ['<h1>LUMOS Rewards</h1><div class="sub">', '<h1>LUMOS Rewards on NEAR</h1><div class="sub">'],
  ['<h1 class="mob-page-title">LUMOS Rewards</h1>', '<h1 class="mob-page-title">LUMOS Rewards on NEAR</h1>'],
  // The Trade page: the mints card and the phone's promo.
  ['New Mints on Stellar', 'New Mints on NEAR'],
  ['<h2 class="lumos-promo-title">Discover early gems on Stellar.</h2>', '<h2 class="lumos-promo-title">Discover early gems on NEAR.</h2>'],
  ['<p class="lumos-promo-sub">Every trade settles peer-to-peer on Stellar. We never touch your funds',
   '<p class="lumos-promo-sub">Every trade settles on-chain on NEAR. We never touch your funds'],
  // The Trade page's "How it works?" dialog (#hiwModal). NEAR has no path payments and no anchors: step 02
  // becomes the routing a NEAR swap does get. Settlement is faster than Stellar's 3-5 seconds.
  ['<h3>How the Stellar DEX works</h3>', '<h3>How the NEAR DEX works</h3>'],
  ['<div class="hiw-h">Trade any Stellar-issued asset</div>', '<div class="hiw-h">Trade any curated NEAR token</div>'],
  ['<div class="hiw-d">Browse listings, swap with APT, or place limit orders against the on-chain Stellar DEX orderbook.',
   '<div class="hiw-d">Browse curated tokens, swap at the best on-chain price, or place limit orders on NEAR\'s on-chain order book.'],
  ['<div class="hiw-h">Smart path payments</div>', '<div class="hiw-h">Best-price routing</div>'],
  ['<div class="hiw-d">Send one asset, the recipient gets another. Stellar automatically finds the cheapest route across multiple pairs and Anchors — even for pairs without direct liquidity.</div>',
   '<div class="hiw-d">Every swap is routed across NEAR\'s pools for the best price, through an intermediate token when that pays more — even for pairs without a direct pool.</div>'],
  ['<div class="hiw-d">Issue an asset on Stellar and list it on Stellar DEX in minutes. Seed initial liquidity, add a trustline, and the market is live — no separate venue, no listing fee.</div>',
   '<div class="hiw-d">Launch a fixed-supply token on NEAR in minutes, with its first liquidity pool included, and the market is live — no separate venue, no listing fee.</div>'],
  ['assets remain yours throughout. Settlement is on-chain in 3–5 seconds.</div>',
   'assets remain yours throughout. Settlement is on-chain in a couple of seconds.</div>'],
  ['<span>Stellar DEX charges roughly 0.00001 XLM per operation as a network fee. The exchange itself takes no protocol fee and offers no maker/taker rebates — everyone trades at the same rate. LumosCore',
   '<span>NEAR charges a small network fee for each transaction, paid in NEAR and usually well under a cent. Each pool also keeps its own swap fee for its liquidity providers. LumosCore'],
  // The bridge dialogs: NEAR's routes, not Stellar's.
  ['<div class="modal-sub">Cross-chain transfers via Circle CCTP, LayerZero and NEAR Intents.</div>',
   '<div class="modal-sub">Cross-chain transfers via NEAR Intents, Omni Bridge and Wormhole.</div>'],
  ['<div class="hiw-d">Transfers route through Circle CCTP, LayerZero or NEAR Intents, so you receive the destination asset directly.</div>',
   '<div class="hiw-d">Transfers route through NEAR Intents, Omni Bridge or Wormhole, so you receive the destination asset directly.</div>'],
];

const hits = PAIRS.map(() => 0), done = PAIRS.map(() => 0);
let files = 0, pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string') continue;
    const before = h;
    PAIRS.forEach(([from, to], i) => {
      const n = h.split(from).length - 1;
      if (n) { h = h.split(from).join(to); hits[i] += n; }
      else if (h.indexOf(to) >= 0) done[i]++;
    });
    if (h !== before) { json[key] = h; pages++; }
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
const missing = PAIRS.filter((p, i) => !hits[i] && !done[i]);
if (missing.length) {
  console.error('near copy ABORT: these strings were found nowhere — did the design move?\n  '
    + missing.map((p) => p[0]).join('\n  '));
  process.exit(1);
}
console.log('near copy: ' + hits.reduce((a, b) => a + b, 0) + ' replacement(s) on ' + pages + ' page key(s) across ' + files + ' container(s)');
PAIRS.forEach((p, i) => console.log('   ' + String(hits[i]).padStart(4) + ' new, ' + String(done[i]).padStart(4) + ' already  ' + p[1].slice(0, 60)));
