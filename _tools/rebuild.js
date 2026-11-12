// The NEAR build recipe, in one place. Same shape as C:\LumosCore-XRPL\_tools\rebuild.js.
//
// Everything the fork looks like comes from Stellar's containers; everything it DOES comes from the
// transforms below, applied over them in this order.
//
//   node _tools/rebuild.js          re-run the transforms over the current containers (fast, idempotent)
//   node _tools/rebuild.js --base   re-copy the Stellar base first, then run the whole chain
//
// --base READS C:\LumosCore. It never writes there. That repo is git-connected to production, so a
// write is a deploy; this script opens it with readFileSync and nothing else.
//
// THE BASE IS STELLAR'S CURRENT CONTAINERS, not XRPL's. The XRPL fork froze Stellar at the day it was
// copied and spent weeks porting later fixes across by hand; starting from today's Stellar gives this
// fork every design fix up to now for free. It freezes from here the same way, so check the copy date
// (the containers' mtime) before concluding a Stellar layer "does not port".
//
// THE CHAIN IS NEARLY EMPTY ON PURPOSE. This is the setup step: the pages build and route under /near
// but still carry Stellar's data layers. Each NEAR transform is added here as it is written, in the
// position its comment justifies. A transform run by hand and not listed here silently disappears on
// the next --base run -- the XRPL bridge reached production that way once.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STELLAR = 'C:' + path.sep + 'LumosCore';

const CHAIN = [
  // First: every later NEAR layer asks the engine which chain the page is, and before this it
  // answered "stellar" on /near urls.
  '_nearengine',
  // Removes only Stellar layers that draw nothing (see its header for what is deliberately left).
  // Removes by id, so its position is not load-bearing.
  '_nearstripstellar', '_nearfeerate',
  // Titles/descriptions, then shared visible wording. After anything that rebuilds a page from the
  // design (nothing does yet), or that work would hand the Stellar strings back.
  '_nearseo',
  '_nearcopy',
  // NEAR wallet connect: strips Stellar's connect flow, adds near to the design's wallet table, injects
  // lx-nearconnect. After _nearengine, whose LOCAL_CHAIN/ORDER the chooser screen reads.
  '_nearconnect',
  // The header chip's wallet mark: NEAR wallet artwork, and lumos.network "near" believed before the
  // address's first letter (which read root.near as an XRPL r-address).
  '_nearwalletlogo',
  // Trade market table: strips Stellar's lx-dexmain, disables the design's sample-data renderer through
  // its own guard, drops the phone's Stellar verified-map merge, injects lx-neartrade.
  '_neartrade',
  // Trade-Asset page (/trade/near/<contract id>): strips Stellar's lx-dxadata, adds a head stylesheet that
  // gates the design's remaining Aptos mock, injects lx-neardexasset. After _neartrade, whose rows link
  // here; independent of it otherwise (different page keys).
  '_neardexasset',
  // NEAR answers for inherited FAQs, on pages whose NEAR feature exists. After every pass that rebuilds
  // a page from the design, or the Stellar answers come back with it.
  '_nearfaq',
  // Pools: strips Stellar's lx-ammdata from EVERY page key (125 of 126 carry it), injects lx-nearpools on
  // the Pools list and lx-nearcreatepool wherever the Create Pool dialog can open. After _nearfaq and every
  // pass that rebuilds a page from the design, or the Stellar layer comes back with it.
  '_nearpools',
  // The Market Overview's mock figures, blanked in markup. After _nearpools: it guards on the list ids and
  // must see the page with lx-ammdata (whose strings name the same classes) already gone.
  '_nearpoolsmock',
  // Pool detail page: injects lx-nearpooldetail where #tvlChart lives.
  '_nearpooldetail',
  // The detail page's mock pool id / price / participant pills and its /pools/stellar crumb, blanked in
  // markup. After _nearpooldetail, as on XRPL; independent of it otherwise.
  '_nearpooldetailmock',
  // Wallet page: strips Stellar's wallet, phone-wallet, claimable, open-orders, swap and fee-tier layers
  // from the wallet keys, blanks the design's mock figures, gates Open orders, injects lx-nearwallet
  // (wallet.js + prices.js + send.js). After every pass that rebuilds a page from the design.
  '_nearwallet',
  // Dashboard: strips Stellar's stats, price panel, product boxes, swap/orders and fee-tier layers from the
  // dashboard keys, fixes their Stellar markup and lx-dashqa's routes, injects lx-neardash. Independent of
  // _nearwallet (different page keys).
  '_neardash',
  // Account page: strips Stellar's lx-accdata (and lx-feerate there), injects lx-nearaccount (nearcore.js +
  // account.js), NEAR markup for the balance label, badge title and phone crumb.
  '_nearaccount',
  // Header search on every page: strips lx-searchassets and lx-spico everywhere, injects lx-nearsearch
  // wherever the panel is, retitles the panel heading. After every pass that rebuilds a page from the
  // design, or the Stellar search comes back with it.
  '_nearsearch',
  // The header wallet chip: NEAR's name and mark, and only a NEAR session counts as connected (the
  // combined site shares localStorage across chains). Patches inherited lx-whead in place.
  '_nearwhead',
  // LUMOS discount pieces hidden until LUMOS is minted on NEAR (deferred). Delete this line to turn them on.
  '_nearlumosdeferred', '_nearlaunchpad',
  // The Launchpad's How it works dialog (NEAR copy); the link is written by _nearlaunchpad.
  '_nearlaunchhiw', '_nearad', '_nearlumospage',
  // Rewards (/rewards/near): strips Stellar's lx-rewardsdata and its dead companions, NEAR copy and countdown from
  // 1 December 2026, injects lx-nearrewards. After _nearsearch (its eligibility reads window.lxnCore).
  '_nearrewards',
  // The bridge: strips Stellar's CCTP / LayerZero / Stellar-origin 1Click layers from the three bridge
  // keys, patches lx-brstep2 to NEAR, injects lx-nearnibridge (nearswap.js + nibridge.js). The build fails
  // if the page's NI_CHAIN and nearoneclick.js's CHAINS disagree.
  '_nearintents',
  // Its wording: hero line, FAQ + FAQPage ld+json, the static modal and the lx-bhiw dialog. After
  // _nearintents and every pass that rebuilds a bridge key from the design.
  '_nearbridgecopy',
  // Last until there is anything else: it only touches <a> tags pointing off-site, and any later pass
  // that rebuilds a page key from the design hands those tags back without rel="nofollow".
  '_nofollow',
];

if (process.argv.indexOf('--base') >= 0) {
  for (const dev of ['desktop', 'mobile']) {
    const from = path.join(STELLAR, 'lumoscore-aptos-' + dev + '.html');
    const to = path.join(ROOT, 'lumoscore-near-' + dev + '.html');
    if (!fs.existsSync(from)) { console.error('missing Stellar base: ' + from); process.exit(1); }
    fs.writeFileSync(to, fs.readFileSync(from));       // read-only on the Stellar side
    console.log('base  ' + dev + '  <- ' + path.basename(from));
  }
}

let failed = 0;
for (const name of CHAIN) {
  const file = path.join(__dirname, name + '.js');
  if (!fs.existsSync(file)) { console.error('SKIP  ' + name + '  (no such transform)'); failed++; continue; }
  process.stdout.write(name + '\n');
  try {
    execFileSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('FAIL  ' + name);
    failed++;
  }
}

if (failed) { console.error('\n' + failed + ' transform(s) did not complete — NOT safe to build'); process.exit(1); }
console.log('\nchain complete — now: node _tools/extract_site.js near   (subfolder build, for the combine)');
