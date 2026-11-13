// GET /lxapi/neartoken?i=<contract id> — one NEAR token, for the Trade-Asset page (/trade/near/<id>).
//
// WHERE EACH FIGURE COMES FROM, and why it is that source:
//   * price, 24h change, 24h volume, liquidity, trades — for a token the market table lists, the
//     table's OWN row (marketBody from nearmarket.js, same cache entry). The page one click away from
//     a row must not quote a different number for the same token; reading the row is the only way to
//     guarantee that, and it costs the upstreams nothing when the table is warm.
//     For any other token, the same rule the table applies, on this token's own pairs: its busiest
//     DexScreener pair gives volume / liquidity / trades and the change (only when the token is that
//     pair's base, or the quote of a wNEAR pair — see nearmarket.js), and its USD price.
//   * symbol, name, decimals, icon, total supply — the token contract itself (ft_metadata,
//     ft_total_supply), over NEAR RPC. The contract is the authority on what it is called and how
//     many exist; a listing site is not.
//   * pools — every pair DexScreener knows for the token (token-pairs/v1), largest first.
//   * lock — how many FULL-ACCESS keys the contract account holds. A key can redeploy the contract,
//     so keys > 0 means the code can change: locked:false. Zero keys means nobody can redeploy, but it
//     does NOT mean supply is fixed — a contract with no keys can still mint if its code lets it, and
//     that cannot be read from here. So zero keys is locked:null ("can't tell"), never true.
//
// NOT GECKOTERMINAL OR COINGECKO: both answer 429 to Cloudflare's shared egress (measured 2026-10-21).
// The page asks them itself, from the visitor's connection, for the chart.
//
// CACHING follows nearmarket: two minutes fresh per token, the last good answer kept a day and served
// marked stale when a refresh fails, and a failure is NEVER stored. A PARTIAL answer (one source
// refused) is served but not stored either: caching it would show "no supply" for two minutes on the
// strength of one dropped request.
//
// Subrequests per miss: market (0 when warm, 4 cold) + 1 DexScreener + 3 RPC = at most 8.
import { CURATED } from './_nearcurated.js';
import { marketBody } from './nearmarket.js';
import { ownPools, ownLiquidity } from './_nearownpools.js';

const TTL = 120;
const KEEP = 86400;
const WNEAR = 'wrap.near';
const RPC = 'https://free.rpc.fastnear.com';
const PAIRS = 'https://api.dexscreener.com/token-pairs/v1/near/';
const VER = 'v10';  // v10: its order-book pool first, the baked classic one only without it (2026-11-13); v9: baked classic pool
// earlier: v2: web, x, desc; v3: curated logo first (2026-10-29); v5: own pools; v6: their count (2026-11-04); v7: 30 pools (2026-11-05); v8: DCL pool (2026-11-12)
const DCL = 'dclv2.ref-labs.near', DCL_FEES = [100, 400, 2000, 10000];
const INTEAR = 'https://prices.intear.tech/token?token_id=';

// NEAR account-id rules (nomicon): 2-64 chars, lowercase alphanumerics separated by single - _ or .,
// no leading/trailing separator. Implicit accounts (64 hex) and eth-implicit (0x + 40 hex) satisfy
// the same pattern, so one test covers all three.
const ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function json(body, status, maxAge) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 30 : maxAge),
    'access-control-allow-origin': '*' } });
}

async function getJson(u, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  try {
    const r = await fetch(u, Object.assign({ signal: ctl.signal }, opts || {}, {
      headers: Object.assign({ accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' }, (opts || {}).headers || {}) }));
    if (!r.ok) throw new Error(u.split('?')[0] + ' ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// A view call. Resolves { ok:true, v } with the decoded JSON result, { ok:false, none:true } when the
// chain answered that the account or method does not exist (a definitive "no"), or { ok:false } when
// the call itself failed (an outage — which must not be reported as "not a token").
async function view(account, method, args) {
  try {
    const j = await getJson(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: {
        request_type: 'call_function', finality: 'final', account_id: account, method_name: method,
        args_base64: args ? btoa(JSON.stringify(args)) : 'e30=' } }) }, 5000);
    if (j.error || (j.result && j.result.error)) {
      const why = JSON.stringify(j.error || j.result.error);
      return { ok: false, none: /UNKNOWN_ACCOUNT|MethodNotFound|CodeDoesNotExist|does not exist|NO_CONTRACT_CODE/i.test(why) };
    }
    const bytes = (j.result && j.result.result) || [];
    return { ok: true, v: JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) };
  } catch (e) { return { ok: false }; }
}

async function fullAccessKeys(account) {
  try {
    const j = await getJson(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: {
        request_type: 'view_access_key_list', finality: 'final', account_id: account } }) }, 5000);
    if (j.error || !j.result || !Array.isArray(j.result.keys)) return null;
    return j.result.keys.filter((k) => k && k.access_key && k.access_key.permission === 'FullAccess').length;
  } catch (e) { return null; }
}

// Only an image a browser cannot be talked into running script from: a data: image or https url.
function safeLogo(u) {
  u = String(u || '');
  if (u.length > 200000) return '';
  return /^(data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]|https:\/\/)/i.test(u) ? u : '';
}

// A link for an href: https only, no credentials, no quotes or whitespace.
function safeHref(u) {
  u = String(u || '').trim();
  if (!/^https:\/\/[^\s"'<>@]+$/i.test(u) || u.length > 300) return '';
  try { return new URL(u).protocol === 'https:' ? u : ''; } catch (e) { return ''; }
}
function xHref(u) {
  const m = String(u || '').trim().match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i);
  return m ? 'https://x.com/' + m[1] : '';
}

// ONE ASSET, ONE DESCRIPTION, whichever network it is on (RAZA 2026-10-29: "The Text below the Asset
// name should be the same if one asset [is] available on multiple networks"). Keyed by the NEAR
// contract of the issuer's own deployment -- never by symbol, which anyone can copy. The text is the
// issuer's own, as Stellar's page prints it from the issuer's stellar.toml.
const DESC = {
  // Circle's native USDC on NEAR (Stellar: GA5Z...KZVN, desc from circle.com's stellar.toml).
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': 'USDC is a fully collateralized US Dollar stablecoin.',
  // LumosCore's own token: the description its NEP-148 reference publishes (assets/tokens/lumos-near.json).
  'lumos.lumoscore.near': 'The native token of LumosCore, a multichain platform for token launches, DEX trading, liquidity and '
    + 'cross-chain transfers. LUMOS carries reduced trading fees for holders and is distributed to liquidity providers.',
};

// Plain text, bounded: names and symbols are whatever the contract's deployer chose.
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max || 64);
}

// Decimal string / 10^decimals without losing the integer part to float rounding first.
function scaled(raw, decimals) {
  const s = String(raw || '').replace(/^"|"$/g, '');
  if (!/^\d+$/.test(s)) return null;
  const d = Math.max(0, Math.min(40, +decimals || 0));
  const whole = s.length > d ? s.slice(0, s.length - d) : '0';
  const frac = (s.length > d ? s.slice(s.length - d) : s.padStart(d, '0')).slice(0, 12);
  const v = Number(whole + (frac ? '.' + frac : ''));
  return isFinite(v) ? v : null;
}

function usdOf(p, id) {
  // DexScreener's priceUsd is the BASE token's; a quote token's is base USD / (base in quote).
  const pu = +p.priceUsd, pn = +p.priceNative;
  if (String((p.baseToken || {}).address) === id) return pu > 0 ? pu : null;
  return (pu > 0 && pn > 0) ? pu / pn : null;
}

// A TOKEN WHOSE ONLY MARKET IS A DCL POOL (RAZA 2026-11-12: "for every near asset which isnt curated ... it opens like
// this", every figure a dash). DexScreener and the classic pool list know nothing of Rhea's concentrated-liquidity pools,
// so GOD and ILOVEALEX read "no pool with a live price" while GOD/wNEAR at 1% holds ~1,000 NEAR. Read from the chain:
// get_pool on each fee tier against wNEAR, the deepest Running one. Its price is the pool's current point, exact; its
// liquidity is everything it holds (total_x, total_y) at that price. null when no tier holds a pool; throws when the
// chain did not answer, which is not "no pool".
async function dclMarket(id, decimals) {
  if (decimals == null || id === WNEAR) return null;
  const pair = [id, WNEAR].sort();
  const rs = await Promise.all(DCL_FEES.map((f) => view(DCL, 'get_pool', { pool_id: pair[0] + '|' + pair[1] + '|' + f })));
  if (rs.some((r) => !r.ok)) throw new Error('dcl unread');
  let best = null;
  for (const r of rs) {
    const p = r.v;
    if (!p || p.state !== 'Running' || !(BigInt(String(p.liquidity || '0')) > 0n || BigInt(String(p.total_order_x || '0')) > 0n || BigInt(String(p.total_order_y || '0')) > 0n)) continue;
    if (!best || Number(p.total_y) + Number(p.total_x) > Number(best.total_y) + Number(best.total_x)) best = p;
  }
  if (!best) return null;
  const tokIsX = best.token_x === id, decX = tokIsX ? decimals : 24, decY = tokIsX ? 24 : decimals;
  const xInY = Math.pow(1.0001, +best.current_point) * Math.pow(10, decX - decY);   // human token_x in token_y
  const price = tokIsX ? xInY : 1 / xInY;                                            // NEAR per token
  if (!(price > 0) || !isFinite(price)) return null;
  const tok = Number(tokIsX ? best.total_x : best.total_y) / Math.pow(10, decimals);
  const near = Number(tokIsX ? best.total_y : best.total_x) / 1e24;
  return { price, liq: near + tok * price, id: 'refv2-' + String(best.pool_id).split('|').join(':'), fee: +best.fee };
}
// What the chain cannot give for such a pool -- the 24h change and volume -- from Intear's price index, which the page
// names as their source. Its price is never used: the pool's own is.
async function intear(id) {
  try {
    const j = await getJson(INTEAR + encodeURIComponent(id), null, 4000);
    const now = +j.price_usd_raw, ago = +j.price_usd_raw_24h_ago, vol = +j.volume_usd_24h;
    return { d24: now > 0 && ago > 0 ? (now / ago - 1) * 100 : null, volUsd: isFinite(vol) && vol >= 0 ? vol : null };
  } catch (e) { return null; }
}

async function build(id, context) {
  const cur = CURATED.find((c) => c.i === id) || null;
  const [market, pairsRaw, meta, supplyRaw, keys, ownP] = await Promise.all([
    marketBody(context).catch(() => null),
    getJson(PAIRS + encodeURIComponent(id), null, 6000).catch(() => null),
    view(id, 'ft_metadata'),
    view(id, 'ft_total_supply'),
    fullAccessKeys(id),
    cur && cur.pool != null ? ownPools(context).catch(() => []) : [],
  ]);
  const pairs = Array.isArray(pairsRaw) ? pairsRaw : null;
  let partial = !pairs || !meta.ok || !supplyRaw.ok || keys == null;

  // A definitive "this is not a fungible-token contract" from the chain, and no market anywhere.
  if (!meta.ok && meta.none && pairs && !pairs.length) return { body: { ok: false, error: 'not a token', none: true }, store: false };
  if (!meta.ok && !pairs && !cur) throw new Error('no source answered');

  const m = meta.ok ? (meta.v || {}) : {};
  const decimals = Number.isFinite(+m.decimals) ? +m.decimals : (cur ? cur.d : null);
  const nearUsd = market && market.usd > 0 ? +market.usd : null;
  const near24 = market && market.near24 != null ? +market.near24 : null;
  const row = market && Array.isArray(market.rows) ? market.rows.find((r) => r.i === id) : null;

  // Market figures: the table's row when it has one, otherwise this token's busiest pair.
  let price = null, usd = null, d24 = null, v24 = null, liq = null, trades = null, src = null;
  if (row) {
    price = row.p; usd = nearUsd ? row.p * nearUsd : null; d24 = row.d; v24 = row.v; liq = row.t; trades = row.x;
    src = 'market';
  } else if (id === WNEAR) {
    price = 1; usd = nearUsd; d24 = near24; src = 'unit';
  }
  const own = (pairs || []).filter((p) => p && (String((p.baseToken || {}).address) === id || String((p.quoteToken || {}).address) === id));
  if (!row && own.length) {
    const main = own.slice().sort((a, b) => (+((b.volume || {}).h24) || 0) - (+((a.volume || {}).h24) || 0))[0];
    const u = usdOf(main, id);
    if (u != null && id !== WNEAR) { usd = u; price = nearUsd ? u / nearUsd : null; }
    if (nearUsd) {
      const tx = (main.txns || {}).h24 || {};
      v24 = (+((main.volume || {}).h24) || 0) / nearUsd;
      liq = (+((main.liquidity || {}).usd) || 0) / nearUsd;
      trades = (+tx.buys || 0) + (+tx.sells || 0);
    }
    const ch = (main.priceChange || {}).h24;
    const isBase = String((main.baseToken || {}).address) === id;
    if (ch != null && isFinite(+ch)) {
      if (isBase) d24 = +ch;
      else if (String((main.baseToken || {}).address) === WNEAR && near24 != null) {
        const inv = (100 / (100 + +ch) - 1) * 100;
        d24 = ((1 + inv / 100) * (1 + near24 / 100) - 1) * 100;
      }
    }
    src = 'pairs';
  }
  // No market row and no pair anywhere: the token's DCL pool against wNEAR, if it has one (see dclMarket).
  let dcl = null, extra = null;
  if (price == null && id !== WNEAR && !own.length) {
    try { [dcl, extra] = await Promise.all([dclMarket(id, decimals), intear(id)]); } catch (e) { partial = true; }
    if (dcl) {
      price = dcl.price; usd = nearUsd ? dcl.price * nearUsd : null; liq = dcl.liq; src = 'dcl';
      if (extra) { d24 = extra.d24; v24 = extra.volUsd != null && nearUsd ? extra.volUsd / nearUsd : null; }
    }
  }
  if (price == null && !partial) partial = true;

  // Identity: the contract first, then the curated list, then whatever the pair listing says.
  const p0 = own[0] || null;
  const side = p0 ? (String(p0.baseToken.address) === id ? p0.baseToken : p0.quoteToken) : {};
  const symbol = clean(m.symbol || (cur && cur.s) || side.symbol || '', 24);
  const name = clean(m.name || (cur && cur.n) || side.name || '', 80);
  // The curated list's logo FIRST: it is the contract's own icon as baked, or a vetted replacement for one
  // that cannot load (KAT's icon points at a host that no longer exists -- _tools/nearlogos.fallback.json).
  const logo = safeLogo(cur && cur.logo) || safeLogo(m.icon)
    || safeLogo(p0 && String((p0.baseToken || {}).address) === id && p0.info && p0.info.imageUrl);
  const supply = supplyRaw.ok && decimals != null ? scaled(supplyRaw.v, decimals) : null;
  // The issuer's site and X profile: baked for curated tokens (_tools/_nearlinks.js), else the token's
  // DexScreener profile.
  const prof = (own.find((p) => String((p.baseToken || {}).address) === id && p.info) || {}).info || {};
  const web = safeHref(cur && cur.w) || safeHref(((prof.websites || [])[0] || {}).url);
  const x = xHref(cur && cur.x) || xHref(((prof.socials || []).find((q) => q && q.type === 'twitter') || {}).url);

  // Pools, largest first. Logos travel once in a map rather than repeated per pool.
  const logos = {};
  const pools = own.slice().sort((a, b) => (+((b.liquidity || {}).usd) || 0) - (+((a.liquidity || {}).usd) || 0))
    .slice(0, 30).map((p) => {
      const b = p.baseToken || {}, q = p.quoteToken || {};
      for (const t of [b, q]) {
        const a = String(t.address || '');
        if (!a || logos[a] !== undefined) continue;
        const c = CURATED.find((x) => x.i === a);
        logos[a] = (a === id ? logo : '') || safeLogo(c && c.logo)
          || (a === String(b.address) ? safeLogo(p.info && p.info.imageUrl) : '');
      }
      const lu = +((p.liquidity || {}).usd) || 0, vu = +((p.volume || {}).h24) || 0;
      return {
        pair: clean(b.symbol, 24) + ' / ' + clean(q.symbol, 24),
        base: { i: String(b.address || ''), s: clean(b.symbol, 24) },
        quote: { i: String(q.address || ''), s: clean(q.symbol, 24) },
        dex: clean(p.dexId, 40),
        liqUsd: lu, volUsd: vu,
        liq: nearUsd ? lu / nearUsd : null, vol: nearUsd ? vu / nearUsd : null,
        id: clean(p.pairAddress, 200),
        url: /^https:\/\/dexscreener\.com\//.test(String(p.url || '')) ? String(p.url) : '',
      };
    });
  // The token's own pool (_nearownpools.js) when DexScreener does not list it yet: its reserves from the chain.
  for (const o of ownP) {
    const ids = o.token_account_ids || [];
    if (ids.indexOf(id) < 0 || pools.some((p) => p.id === 'refv1-' + o.id)) continue;
    const other = ids.find((t) => t !== id) || '', oc = CURATED.find((x) => x.i === other);
    const ln = ownLiquidity([o])[id];
    pools.unshift({ pair: symbol + ' / ' + (other === WNEAR ? 'wNEAR' : clean(oc && oc.s, 24)),
      base: { i: id, s: symbol }, quote: { i: other, s: other === WNEAR ? 'wNEAR' : clean(oc && oc.s, 24) },
      dex: 'ref', liqUsd: ln != null && nearUsd ? ln * nearUsd : 0, volUsd: 0, liq: ln != null ? ln : null, vol: 0,
      id: 'refv1-' + o.id, url: '' });
    if (logos[id] === undefined) logos[id] = logo;
  }
  if (dcl) {
    pools.unshift({ pair: symbol + ' / wNEAR', base: { i: id, s: symbol }, quote: { i: WNEAR, s: 'wNEAR' }, dex: 'ref-dcl',
      liqUsd: nearUsd ? dcl.liq * nearUsd : 0, volUsd: extra && extra.volUsd != null ? extra.volUsd : 0,
      liq: dcl.liq, vol: v24, id: dcl.id, url: '' });
    if (logos[id] === undefined) logos[id] = logo;
  }
  // A CURATED TOKEN WHOSE POOL NO FEED LISTS (RAZA 2026-11-13, CLAW on a phone: "Where's the graph"). Its price came
  // from the market table, so neither DexScreener nor the DCL read ran, and the page had no pool to chart: an empty box,
  // on every screen. The token's classic pools are baked per curated token (_tools/_nearpoolcounts.js,
  // /assets/tokenpools/<id>.json, served from this deploy, so no outside call); the deepest one against wNEAR joins the
  // list, and the chart and the trades read it as they read any pool.
  // THE ORDER-BOOK POOL FIRST: CLAW's baked classic pool held 0.0024 NEAR ($0.008) and its candles spiked to ~300x
  // the price, a "-99.91% (24h)" made by one dust trade; its real market is its order-book pool (about 100 NEAR deep).
  // So the order-book pool is read first, as for a token off the curated list; the classic one only when there is none.
  if (cur && id !== WNEAR && !pools.some((p) => p.base.i === WNEAR || p.quote.i === WNEAR)) {
    try {
      const d2 = await dclMarket(id, decimals);
      if (d2) {
        pools.unshift({ pair: symbol + ' / wNEAR', base: { i: id, s: symbol }, quote: { i: WNEAR, s: 'wNEAR' }, dex: 'ref-dcl',
          liqUsd: nearUsd ? d2.liq * nearUsd : 0, volUsd: 0, liq: d2.liq, vol: null, id: d2.id, url: '' });
        if (logos[id] === undefined) logos[id] = logo;
      }
    } catch (e) {}
  }
  if (cur && id !== WNEAR && !pools.some((p) => p.base.i === WNEAR || p.quote.i === WNEAR)) {
    try {
      const r = await context.env.ASSETS.fetch(new URL('/assets/tokenpools/' + encodeURIComponent(id) + '.json', context.request.url));
      const list = r.ok ? await r.json() : [];
      const best = (Array.isArray(list) ? list : []).filter((b) => b && Array.isArray(b[2]) && b[2].length === 2 && b[2].some((t) => t[0] === WNEAR))
        .sort((a, b) => (+b[1] || 0) - (+a[1] || 0))[0];
      if (best) {
        pools.push({ pair: symbol + ' / wNEAR', base: { i: id, s: symbol }, quote: { i: WNEAR, s: 'wNEAR' }, dex: 'ref',
          liqUsd: nearUsd && best[1] > 0 ? best[1] * nearUsd : 0, volUsd: 0, liq: +best[1] || null, vol: 0,
          id: 'refv1-' + String(best[0]), url: '' });
        if (logos[id] === undefined) logos[id] = logo;
      }
    } catch (e) {}
  }
  for (const k of Object.keys(logos)) if (!logos[k]) delete logos[k];

  const body = {
    ok: true, i: id, symbol, name, decimals, logo, supply,
    price, usd, nearUsd, near24, d24, v24, liquidity: liq, trades24: trades,
    // THE POOL COUNT IS RHEA'S, NOT DEXSCREENER'S (RAZA 2026-10-30: "there seems to be very few even for
    // assets like USDC"). DexScreener lists at most 30 pairs per token, so USDC read 30 while Rhea holds 394
    // live pools of it (556 counting empty ones). Curated tokens carry Rhea's counts, baked from both pool
    // contracts by _tools/_nearpoolcounts.js; any other token keeps DexScreener's figure, which the page marks
    // "30+" when it is the cap.
    // A pool read from the chain (ownPools) counts too: LUMOS read "Pools 0" above its own LUMOS/wNEAR row (2026-11-04).
    pools, poolCount: (cur && cur.pcl > 0) ? cur.pcl : Math.max(own.length, pools.length), poolTotal: (cur && cur.pc > 0) ? cur.pc : null,
    poolCapped: !(cur && cur.pcl > 0) && own.length >= 30, logos,
    curated: !!cur, cg: (cur && cur.cg) || '', web, x, desc: DESC[id] || '',
    lock: { keys, locked: keys == null ? null : (keys > 0 ? false : null) },
    // src 'dcl': price and liquidity from the DCL pool on chain; d24 and v24 from Intear (srcExtra), when it answered.
    src, srcExtra: dcl && extra ? 'intear' : '', at: Date.now(),
  };
  if (partial) body.partial = true;
  return { body, store: !partial };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const id = String(url.searchParams.get('i') || '').trim().toLowerCase();
  if (!ID_RE.test(id)) return json({ ok: false, error: 'invalid contract id' }, 400, 300);

  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/neartoken/' + VER + '/fresh/' + encodeURIComponent(id));
  const kept = new Request('https://lumoscore.internal/lxapi/neartoken/' + VER + '/kept/' + encodeURIComponent(id));

  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json());

  try {
    const { body, store } = await build(id, context);
    if (store) {
      const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
      context.waitUntil(Promise.all([put(fresh, TTL), put(kept, KEEP)]));
      return json(body);
    }
    // Not stored. A partial answer still beats an older complete one only if there is no older one.
    if (body.ok && body.partial) {
      const old = await cache.match(kept);
      if (old) { const b = await old.json(); b.stale = true; return json(b, 200, 15); }
      return json(body, 200, 15);
    }
    return json(body, 200, 60);
  } catch (e) {
    const old = await cache.match(kept);
    if (old) { const b = await old.json(); b.stale = true; return json(b, 200, 15); }
    return json({ ok: false, error: 'token data unavailable', why: String((e && e.message) || e).slice(0, 200) }, 200, 0);
  }
}
