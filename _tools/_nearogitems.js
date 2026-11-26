// Share cards (og:image) for ONE NEAR token and ONE NEAR pool -- what Stellar's _ogcards.js / _ogpools.js and
// _ogxrpl.js draw for their chains (RAZA 2026-11-14: "create the previews for near in same style / design as
// stellar and xrpl"). Until now every NEAR token page shared trade-near.png and every pool page pools-near.png.
//
// THE SAME KIT, required read-only from the Stellar repo (C:\LumosCore\_tools\_ogkit.js), so a NEAR card cannot
// drift from the others in layout, type or colour. Nothing in C:\LumosCore is written. NEAR's chain mark is
// added to the kit's table at run time, exactly as _nearogcards.js does.
//
// A BOUNDED SET, for XRPL's reason: a token's name and icon are its deployer's to choose, so cards are drawn
// only for the curated roster (_tools/nearcurated.generated.json -- 24h volume x liquidity) and for the pools
// the sitemap lists (_tools/nearpoolheads.generated.json). Everything else keeps the section card.
//
//   token: [NEAR | ✓ Listed asset | contract]  SYMBOL  "Trade on LumosCore"  Price · Pools · Holders
//          "Listed asset", XRPL's wording, not "Curated": the roster says "not yet reviewed by a person".
//          The CONTRACT is the third segment for the reason the XRPL card carries the issuer address --
//          a symbol can be copied, a contract id cannot.
//   pool:  [NEAR | Liquidity pool]  A / B  "Provide liquidity on LumosCore"  Reserves · Activity · Participants
//
// wNEAR has no card of its own (the token pages skip wrap.near), and LUMOS keeps lumos-near.png.
//
// Output: assets/og/n/t-<contract>.png and assets/og/n/p-<pool id>.png. extract_site.js copies assets/ into
// dist; the combine's chains/near.js lists this folder and points each page at its card.
//
//   node _tools/_nearogitems.js
const fs = require('fs');
const path = require('path');
const STELLAR = 'C:/LumosCore';
const K = require(STELLAR + '/_tools/_ogkit.js');

const OUT = path.join(__dirname, '..', 'assets', 'og', 'n');
const LUMOS = 'lumos.lumoscore.near';
const ID_RE = /^[a-z0-9._-]{2,64}$/;

K.CHAIN.NEAR = K.CHAIN.NEAR || {
  label: 'NEAR',
  bb: [2.4, 2.84, 19.2, 18.34],
  d: 'M17.8 3.06l-4.04 6c-.28.4.26.89.64.55l3.98-3.45c.1-.09.25-.02.25.12v10.8c0 .14-.18.2-.27.1L6.32 3.57A2.07 2.07 0 0 0 4.75 2.84h-.31C3.33 2.84 2.4 3.76 2.4 4.9v14.2c0 1.13.93 2.06 2.07 2.06.72 0 1.39-.37 1.76-.99l4.04-6c.28-.4-.26-.89-.64-.55L5.65 17.07c-.1.09-.25.02-.25-.12V6.18c0-.15.18-.21.27-.1l12.02 14.37c.39.47.97.73 1.57.73h.32c1.14 0 2.06-.92 2.06-2.06V4.9c0-1.14-.93-2.06-2.07-2.06-.72 0-1.39.37-1.77.99z',
};

const CUR = (require('./nearcurated.generated.json').tokens || []).filter((t) => t && ID_RE.test(String(t.i || '')));
const HEADS = require('./nearpoolheads.generated.json');
const clean = (s, n) => String(s || '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// A data: URI from the roster (svg url-encoded, or base64) -> bytes -> the kit's toPng, which rasterises SVG at
// a usable density and gives a dark-on-transparent mark a white tile, as every Stellar and XRPL card gets.
async function logoOf(uri) {
  if (typeof uri !== 'string' || uri.indexOf('data:image/') !== 0) return '';
  const c = uri.indexOf(',');
  if (c < 0) return '';
  const meta = uri.slice(0, c), body = uri.slice(c + 1);
  let buf;
  try { buf = /;base64$/i.test(meta) ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8'); }
  catch (e) { return ''; }
  if (!buf.length || buf.length > 2 * 1024 * 1024) return '';
  return await K.toPng(buf);
}
// A token whose roster entry has no inline logo (QTC, SOL, WETH...), or a pool side off the roster (SKYWARD,
// LONK...), takes the logo the site's own token page draws: /lxapi/neartoken?i=<contract>, which already applies
// _tools/nearlogos.fallback.json. Paced, one retry, and every success is kept in _tools/nearoglogos.cache.json so
// a failed fetch on a later run falls back to the last good logo instead of a monogram.
const ORIGIN = 'https://lumoscore.com';
const CACHE_F = path.join(__dirname, 'nearoglogos.cache.json');
let CACHE = {};
try { CACHE = JSON.parse(fs.readFileSync(CACHE_F, 'utf8')) || {}; } catch (e) { CACHE = {}; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let API_CALLS = 0, CACHE_HITS = 0;
async function siteLogo(id) {
  for (let i = 0; i < 2; i++) {
    try {
      API_CALLS++;
      const j = await (await fetch(ORIGIN + '/lxapi/neartoken?i=' + encodeURIComponent(id))).json();
      const raw = j && j.ok !== false ? (j.logo || (j.logos && j.logos[id]) || '') : '';
      await sleep(350);
      let uri = '';
      if (raw.indexOf('data:image/') === 0) uri = await logoOf(raw);
      else if (raw.indexOf('https://') === 0) uri = await K.imageDataUri(raw);
      if (uri) { CACHE[id] = uri; return uri; }
      if (j && j.ok !== false) break;           // answered, and there is no logo: not worth a retry
    } catch (e) { await sleep(900); }
  }
  if (CACHE[id]) { CACHE_HITS++; return CACHE[id]; }
  return '';
}
const LOGO = new Map();
async function logoFor(id, inline) {
  if (LOGO.has(id)) return LOGO.get(id);
  const uri = (await logoOf(inline)) || (await siteLogo(id));
  LOGO.set(id, uri);
  return uri;
}

async function fileLogo(rel) {
  const p = path.join(STELLAR, 'dist', 'assets', rel);
  return fs.existsSync(p) ? await K.toPng(fs.readFileSync(p)) : '';
}

// The contract, shortened only when it would not fit the row: a 64-hex implicit account reads as XRPL's
// r-address does (4…4); a named account keeps its readable ends.
function shortId(id) {
  if (id.length <= 22) return id;
  if (/^[0-9a-f]{64}$/.test(id)) return id.slice(0, 4) + '…' + id.slice(-4);
  return id.slice(0, 10) + '…' + id.slice(-8);
}

// _ogpools.js's pair panel, verbatim in layout: two tiles side by side, a monogram where a logo is missing.
function pairPanel(a, b, ca, cb) {
  const GAP = 14, CELL = Math.round((K.INNER - GAP) / 2);
  const top = K.PY + K.PAD + (K.INNER - CELL) / 2;
  const slots = [K.PX + K.PAD, K.PX + K.PAD + CELL + GAP];
  const FS = Math.round(CELL * 0.372);
  let svg = '', defs = '';
  [a, b].forEach((uri, i) => {
    const cx = slots[i], r = Math.round(CELL * 0.27);
    svg += '<rect x="' + cx + '" y="' + top + '" width="' + CELL + '" height="' + CELL + '" rx="' + r
      + '" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>';
    if (!uri) {
      const code = String((i === 0 ? ca : cb) || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
      svg += K.bold(cx + CELL / 2, top + CELL / 2 + Math.round(FS * 0.357), FS, code, '#fff', 0, 1.8, 'middle');
      return;
    }
    const p = 14, s = CELL - p * 2, id = 'pp' + i;
    defs += '<clipPath id="' + id + '"><rect x="' + (cx + p) + '" y="' + (top + p) + '" width="' + s + '" height="' + s + '" rx="' + Math.round(s * 0.28) + '"/></clipPath>';
    svg += '<image x="' + (cx + p) + '" y="' + (top + p) + '" width="' + s + '" height="' + s + '" href="' + uri
      + '" clip-path="url(#' + id + ')" preserveAspectRatio="xMidYMid meet"/>';
  });
  return { svg, defs };
}

// A stable pool of three or four tokens: the same tiles in a 2x2 grid (_nearogcards.js's quad layout).
function quadPanel(logos, codes) {
  const GAP = 14, CELL = Math.round((K.INNER - GAP) / 2), FS = Math.round(CELL * 0.372);
  const slots = [[0, 0], [CELL + GAP, 0], [0, CELL + GAP], [CELL + GAP, CELL + GAP]];
  let svg = '', defs = '';
  slots.forEach((sl, i) => {
    const cx = K.PX + K.PAD + sl[0], cy = K.PY + K.PAD + sl[1], uri = logos[i];
    svg += '<rect x="' + cx + '" y="' + cy + '" width="' + CELL + '" height="' + CELL + '" rx="' + Math.round(CELL * 0.27)
      + '" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>';
    if (i >= codes.length) return;
    if (!uri) {
      const code = String(codes[i] || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
      svg += K.bold(cx + CELL / 2, cy + CELL / 2 + Math.round(FS * 0.357), FS, code, '#fff', 0, 1.8, 'middle');
      return;
    }
    const p = 14, s = CELL - p * 2, id = 'pq' + i;
    defs += '<clipPath id="' + id + '"><rect x="' + (cx + p) + '" y="' + (cy + p) + '" width="' + s + '" height="' + s + '" rx="' + Math.round(s * 0.28) + '"/></clipPath>';
    svg += '<image x="' + (cx + p) + '" y="' + (cy + p) + '" width="' + s + '" height="' + s + '" href="' + uri
      + '" clip-path="url(#' + id + ')" preserveAspectRatio="xMidYMid meet"/>';
  });
  return { svg, defs };
}

async function put(file, png, seen) {
  seen.add(path.basename(file));
  if (fs.existsSync(file) && Buffer.compare(png, fs.readFileSync(file)) === 0) return false;
  let last = '';
  for (let i = 0; i < 3; i++) {
    try { fs.writeFileSync(file, png); return true; }
    catch (e) { last = e.message; await new Promise((r) => setTimeout(r, 300)); }
  }
  throw new Error(last);
}

(async () => {
  if (!K.hasFont()) { console.error('near og items: missing ' + K.FONT + ' — nothing written'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const seen = new Set();
  let wT = 0, wP = 0, nT = 0, nP = 0;
  const monoT = [], monoP = [];

  // ---- tokens
  const sorted = CUR.slice().sort((a, b) => (Number(b.v) || 0) - (Number(a.v) || 0));
  for (const t of sorted) {
    const id = String(t.i), sym = clean(t.s, 16);
    if (!sym) continue;
    if (id === 'wrap.near' || id === LUMOS) continue;
    const logo = await logoFor(id, t.logo);
    if (!logo) monoT.push(sym);
    const png = K.render(K.assetCard({ code: sym, logo, badge: 'Listed asset', domain: shortId(id), chain: 'NEAR' }));
    if (await put(path.join(OUT, 't-' + id + '.png'), png, seen)) wT++;
    nT++;
  }
  // wNEAR and LUMOS in a pool tile: the NEAR mark and the LUMOS mark, from the Stellar build (read only).
  const nearLogo = await fileLogo('networks/near.png');
  const lumosLogo = await fileLogo('tokens/lumos.png');
  LOGO.set('wrap.near', nearLogo);
  // "aurora" is ETH on NEAR (bridged through Aurora's Rainbow Bridge) and publishes no icon: the Ethereum mark.
  const ethLogo = await fileLogo('networks/ethereum.png');
  if (ethLogo) LOGO.set('aurora', ethLogo);
  if (lumosLogo) LOGO.set(LUMOS, lumosLogo);
  const CUR_LOGO = new Map(CUR.map((t) => [String(t.i), t.logo]));
  // { pool id: [[contract, symbol], ...] } from the pool list the site ships (assets/allpools.json).
  const PT = new Map();
  try {
    for (const r of require('../assets/allpools.json')) if (Array.isArray(r) && Array.isArray(r[4])) PT.set(String(r[0]), r[4]);
  } catch (e) { console.error('near og items: assets/allpools.json unreadable — pool tiles fall back to monograms'); }

  // ---- pools
  for (const [pid, h] of Object.entries(HEADS || {})) {
    if (!/^\d{1,9}$/.test(pid) || !Array.isArray(h)) continue;
    const pair = clean(h[1], 60);
    const sides = pair.split(' / ');
    const toks = PT.get(pid) || [];
    if (sides.length < 2 || sides.length > 4) { console.error('  pool ' + pid + ': pair "' + pair + '" — skipped'); continue; }
    const logos = [];
    for (let i = 0; i < sides.length; i++) {
      const t = toks[i];
      // By position, when the pool list holds as many tokens as the pair name: both are written from the same
      // pool record, and a symbol can differ between the two (NearDOG's metadata says "neardog-0").
      const id = t && toks.length === sides.length && ID_RE.test(String(t[0])) ? String(t[0]) : '';
      logos.push(id ? await logoFor(id, CUR_LOGO.get(id)) : '');
    }
    if (logos.some((x) => !x)) monoP.push(pair);
    // 2026-11-26 redesign: the same pool card as Stellar/XRPL (K.card + K.VIS.group for 2-4 tokens).
    const png = K.render(K.card({
      eyebrow: 'Liquidity pool on NEAR',
      title: sides.join(' / '),
      sub: ['Add or withdraw liquidity', 'from your own wallet.'],
      chipList: [{ t: 'NEAR', chain: 'NEAR' }, { t: 'AMM pool' }],
      visual: K.VIS.group(logos, sides),
    }));
    if (await put(path.join(OUT, 'p-' + pid + '.png'), png, seen)) wP++;
    nP++;
  }

  // Cards for tokens or pools that left the lists go, so the page falls back to its section card as the rule says.
  let pruned = 0;
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png') && !seen.has(f)) { fs.unlinkSync(path.join(OUT, f)); pruned++; }

  try { fs.writeFileSync(CACHE_F, JSON.stringify(CACHE)); } catch (e) {}
  console.log('near og items: ' + nT + ' token card(s) (' + wT + ' changed), ' + nP + ' pool card(s) (' + wP + ' changed)'
    + (pruned ? ', pruned ' + pruned : '') + ' -> assets/og/n/ (' + API_CALLS + ' token api call(s)' + (CACHE_HITS ? ', ' + CACHE_HITS + ' logo(s) from the cache' : '') + ')'
    + (monoT.length ? '\n  token(s) with no logo, drawn as a monogram: ' + monoT.join(' ') : '')
    + (monoP.length ? '\n  pool(s) with a side drawn as a monogram: ' + monoP.join(', ') : ''));
})();
