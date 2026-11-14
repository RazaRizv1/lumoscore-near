// Share cards (og:image) for NEAR's section pages: /trade/near, /pools/near, /bridge/near, /rewards/near,
// /lumos/near and /launchpad/near (RAZA 2026-11-14: "check SEO, GEO, AEO for NEAR ... do the same").
//
// Stellar's _tools/_ogsection.js draws these for Stellar and the XRP Ledger (trade-xrpl.png, pools-xrpl.png...)
// and every NEAR page fell back to the general card. This draws NEAR's with THE SAME KIT, required read-only
// from the Stellar repo, so the cards cannot drift from the others in layout, type or colour. Nothing in
// C:\LumosCore is written.
//
// The kit knows two chain marks (Stellar, XRPL). NEAR's is added to its table at run time, in this process
// only: the NEAR "N", drawn as a vector so it scales like the other two.
//
// Output: assets/og/s/<name>.png in this repo; extract_site.js copies assets/ into dist, and the combine's
// chains/near.js points SECTION_CARD at them and refuses to build if one is missing.
//
// FIXED tiles, as Stellar's: majors that stay majors, all curated, so a shared link keeps its picture.
// No prices, no APRs, no counts that move: a build-time image would keep quoting the old figure.
//
//   node _tools/_nearogcards.js
const fs = require('fs');
const path = require('path');
const STELLAR = 'C:/LumosCore';
const K = require(STELLAR + '/_tools/_ogkit.js');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'og', 's');

// The NEAR mark, in a 24-unit box; bb is its real extent, which is what the kit scales by.
K.CHAIN.NEAR = {
  label: 'NEAR',
  bb: [2.4, 2.84, 19.2, 18.34],
  d: 'M17.8 3.06l-4.04 6c-.28.4.26.89.64.55l3.98-3.45c.1-.09.25-.02.25.12v10.8c0 .14-.18.2-.27.1L6.32 3.57A2.07 2.07 0 0 0 4.75 2.84h-.31C3.33 2.84 2.4 3.76 2.4 4.9v14.2c0 1.13.93 2.06 2.07 2.06.72 0 1.39-.37 1.76-.99l4.04-6c.28-.4-.26-.89-.64-.55L5.65 17.07c-.1.09-.25.02-.25-.12V6.18c0-.15.18-.21.27-.1l12.02 14.37c.39.47.97.73 1.57.73h.32c1.14 0 2.06-.92 2.06-2.06V4.9c0-1.14-.93-2.06-2.07-2.06-.72 0-1.39.37-1.77.99z',
};

const CURATED = require('./nearcurated.generated.json').tokens || [];
function curatedLogo(id) {
  const t = CURATED.find((x) => x && x.i === id);
  return t && typeof t.logo === 'string' && t.logo.indexOf('data:image/') === 0 ? t.logo : '';
}
function stellarAsset(rel) {
  const p = path.join(STELLAR, 'dist', 'assets', rel);
  if (!fs.existsSync(p)) return '';
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}

// The same two panels _ogsection.js uses: one centred logo, or a grid of tiles / chain marks.
function panelSingle(uri) {
  const IX = K.PX + K.PAD, IY = K.PY + K.PAD, IR = Math.round(K.INNER * 0.25);
  return {
    defs: '<clipPath id="one"><rect x="' + IX + '" y="' + IY + '" width="' + K.INNER + '" height="' + K.INNER + '" rx="' + IR + '"/></clipPath>',
    svg: '<image x="' + IX + '" y="' + IY + '" width="' + K.INNER + '" height="' + K.INNER + '" href="' + uri
      + '" clip-path="url(#one)" preserveAspectRatio="xMidYMid meet"/>',
  };
}
// One NEAR mark, centred in the panel (the launchpad, and the fallback when tiles are missing).
function panelMark() {
  const GAP = 14, CELL = Math.round((K.INNER - GAP) / 2);
  const x = K.PX + K.PAD + (K.INNER - CELL) / 2, y = K.PY + K.PAD + (K.INNER - CELL) / 2, C = K.CHAIN.NEAR;
  const h = Math.round(CELL * 0.46);
  return {
    defs: '',
    svg: '<rect x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL + '" rx="' + Math.round(CELL * 0.27)
      + '" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>'
      + K.chainMark('NEAR', x + CELL / 2 - (C.bb[2] * (h / C.bb[3])) / 2, y + CELL / 2, h, K.INK).svg,
  };
}
function panelGrid(items, kind) {
  const GAP = 14, CELL = Math.round((K.INNER - GAP) / 2);
  const slots = kind === 'pair'
    ? [[0, (K.INNER - CELL) / 2], [CELL + GAP, (K.INNER - CELL) / 2]]
    : [[0, 0], [CELL + GAP, 0], [0, CELL + GAP], [CELL + GAP, CELL + GAP]];
  let svg = '', defs = '';
  items.slice(0, slots.length).forEach((it, i) => {
    const cx = K.PX + K.PAD + slots[i][0], cy = K.PY + K.PAD + slots[i][1];
    svg += '<rect x="' + cx + '" y="' + cy + '" width="' + CELL + '" height="' + CELL + '" rx="' + Math.round(CELL * 0.27)
      + '" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>';
    if (!it) return;
    if (it.chain) {
      const h = Math.round(CELL * 0.46), C = K.CHAIN[it.chain];
      svg += K.chainMark(it.chain, cx + CELL / 2 - (C.bb[2] * (h / C.bb[3])) / 2, cy + CELL / 2, h, K.INK).svg;
      return;
    }
    const p = 14, s = CELL - p * 2, id = 'g' + i;
    defs += '<clipPath id="' + id + '"><rect x="' + (cx + p) + '" y="' + (cy + p) + '" width="' + s + '" height="' + s + '" rx="' + Math.round(s * 0.28) + '"/></clipPath>';
    svg += '<image x="' + (cx + p) + '" y="' + (cy + p) + '" width="' + s + '" height="' + s + '" href="' + it.uri
      + '" clip-path="url(#' + id + ')" preserveAspectRatio="xMidYMid meet"/>';
  });
  return { svg, defs };
}

(async () => {
  if (!K.hasFont()) { console.error('near og cards: missing ' + K.FONT + ' — nothing written'); process.exit(1); }
  const tile = (uri) => (uri ? { uri } : null);
  const tokens = [
    '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', // USDC
    'usdt.tether-token.near',                                           // USDt
    'zec.omft.near',                                                    // ZEC
    'token.rhealab.near',                                               // RHEA
  ].map((id) => tile(curatedLogo(id)));
  const bridge = ['ethereum.png', 'solana.png', 'bitcoin.png', 'base.png'].map((n) => tile(stellarAsset('networks/' + n)));
  const lumos = stellarAsset('tokens/lumos.png');
  if (!lumos) { console.error('near og cards: LUMOS logo missing from ' + STELLAR + '/dist/assets/tokens'); process.exit(1); }
  const okT = tokens.filter(Boolean).length, okB = bridge.filter(Boolean).length;
  const row = K.metaRow([{ chain: 'NEAR' }]).svg;

  const CARDS = [
    ['trade-near', { row, headline: 'NEAR DEX', accent: 'Trade on LumosCore',
      features: 'Swaps · Limit orders · Best-price routing',
      grid: okT === 4 ? panelGrid(tokens, 'quad') : panelMark() }],
    ['pools-near', { row, headline: 'NEAR Pools', accent: 'Provide liquidity, earn fees',
      features: 'Create · Add · Withdraw',
      grid: okT === 4 ? panelGrid(tokens, 'quad') : panelMark() }],
    ['bridge-near', { row, headline: 'NEAR Bridge', accent: 'Bridge on LumosCore',
      features: 'NEAR Intents · Omni Bridge · Wormhole',
      grid: okB === 4 ? panelGrid(bridge, 'quad') : panelMark() }],
    ['rewards-near', { row, headline: 'LUMOS Rewards', accent: 'Hold or provide liquidity',
      features: 'Paid from the treasury each round', grid: panelSingle(lumos) }],
    ['lumos-near', { row: K.metaRow([{ chain: 'NEAR' }, { check: 'LumosCore token' }, { text: 'lumoscore.com' }]).svg,
      headline: 'LUMOS', accent: 'Trade on LumosCore', features: 'Price · Supply · Holders', grid: panelSingle(lumos) }],
    ['launchpad-near', { row, headline: 'NEAR Launchpad', accent: 'Launch a token, no code',
      features: 'Fixed supply · First pool included', grid: panelMark() }],
  ];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (const [name, c] of CARDS) {
    const png = K.render(K.shell({ defs: c.grid.defs, row: c.row, headline: c.headline, accent: c.accent,
      features: c.features, panel: c.grid.svg }));
    const dst = path.join(OUT_DIR, name + '.png');
    if (fs.existsSync(dst) && Buffer.compare(png, fs.readFileSync(dst)) === 0) continue;
    fs.writeFileSync(dst, png); n++;
    console.log('  ' + name.padEnd(16) + png.length + ' bytes');
  }
  console.log('near og cards: ' + n + ' written of ' + CARDS.length + ' (token tiles ' + okT + '/4, bridge tiles ' + okB + '/4) -> assets/og/s/');
})();
