// GET /lxapi/neartrades — trades in the past 24 hours across NEAR's exchange, for the Dashboard's
// Network Stats strip. RAZA 2026-10-29: "make Trades count every trade on NEAR, not just LumosCore's
// listed tokens" -- the pill used to sum the main market of each of the 71 curated tokens.
//
// WHAT IT COUNTS. Every Rhea Finance pool (classic and concentrated-liquidity) that DexScreener lists
// among the top pairs of fourteen hub tokens, deduplicated by pair, buys + sells over 24h. Rhea is
// NEAR's exchange; NEAR Intents is not counted, because its swaps are cross-chain settlements --
// LumosCore offers it as a BRIDGE route, and USDT -> TRX is not a trade on NEAR.
//
// WHY HUBS AND NOT EVERY POOL. No source publishes a network-wide count: Rhea's indexer has no trade
// field, NearBlocks has none, and GeckoTerminal both refuses Cloudflare and rate-limits a browser after
// ~5 calls. DexScreener answers Cloudflare, but asks for pools by id, and ranking Rhea's 2,465 classic
// pools means scanning an 888 KB list (68 ms measured -- over this plan's 10 ms CPU). Measured
// 2026-10-29: these 14 hubs found 48,463 trades in 192 pairs for 3 ms of CPU; adding the top 450 classic
// pools by TVL on top reached 49,245. So this is ~98% of the total and slightly UNDER it, never over --
// the tooltip says "most-traded pools".
//
// Its own Function rather than a field of /lxapi/nearstats: that one already spends ~5 ms reading
// NearBlocks' history, and a cold cache would run both in one request.
//
// Cached 10 minutes (a rolling 24h figure), last good kept a day, failures never cached.
const TTL = 600, KEEP = 86400, VER = 'v1';
const PAIRS = 'https://api.dexscreener.com/token-pairs/v1/near/';
const HUBS = [
  'wrap.near',                                                          // wNEAR
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',   // USDC
  'usdt.tether-token.near',                                             // USDt
  'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near',       // USDC.e
  'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near',       // USDT.e
  'token.rhealab.near',                                                 // RHEA
  'token.v2.ref-finance.near',                                          // REF
  'meta-pool.near',                                                     // stNEAR
  'linear-protocol.near',                                               // LiNEAR
  'zec.omft.near',                                                      // ZEC
  '2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near',       // WBTC
  'nbtc.bridge.near',                                                   // nBTC
  'blackdragon.tkn.near',                                               // BLACKDRAGON
  'token.lonkingnearbackto2024.near',                                   // LONK
];

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 120 : maxAge),
    'access-control-allow-origin': '*' } });
}
async function getJson(u, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
    if (!r.ok) throw new Error('dexscreener ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function build(get) {
  get = get || getJson;
  const got = await Promise.all(HUBS.map((h) => get(PAIRS + h, 6000).catch(() => null)));
  const answered = got.filter((g) => Array.isArray(g)).length;
  // wNEAR alone carries ~89% of the figure; without it, or with most hubs silent, the sum is not a
  // smaller network, it is a failed read.
  if (!Array.isArray(got[0]) || answered < Math.ceil(HUBS.length * 0.75)) throw new Error('dexscreener: ' + answered + '/' + HUBS.length + ' hubs answered');
  const seen = new Map();
  for (const list of got) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (!p || p.dexId !== 'rhea-finance' || seen.has(p.pairAddress)) continue;
      const t = (p.txns || {}).h24 || {};
      seen.set(p.pairAddress, (Number(t.buys) || 0) + (Number(t.sells) || 0));
    }
  }
  let trades = 0;
  for (const v of seen.values()) trades += v;
  if (!(trades > 0)) throw new Error('dexscreener: no trades');
  return { ok: true, src: 'DexScreener (Rhea Finance)', at: Date.now(), trades, pairs: seen.size, hubs: answered };
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/neartrades/' + VER + '/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/neartrades/' + VER + '/kept');
  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json());
  try {
    const body = await build();
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    context.waitUntil(Promise.all([put(fresh, TTL), put(kept, KEEP)]));
    return json(body);
  } catch (e) {
    const old = await cache.match(kept);
    if (!old) return json({ ok: false, error: 'trade count unavailable', why: String((e && e.message) || e).slice(0, 200) }, 0);
    return json(Object.assign(await old.json(), { stale: true }), 60);
  }
}
