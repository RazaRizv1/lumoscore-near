// GET /lxapi/nearmarket — the NEAR market table: one row per curated token, priced in NEAR.
//
// WHY AT THE EDGE. The figures come from two places a browser should not call per page view:
//   * Rhea Finance's indexer (list-token-price) — USD prices for every token, wNEAR included.
//   * GeckoTerminal's Rhea pools — 24h volume, transactions, liquidity and price change. Its free API
//     allows about 30 calls a minute for EVERY caller, and answered 429 to a single probe on 2026-10-21.
// So the edge asks once, caches the answer for two minutes, and every visitor reads the cache.
//
// NEVER A FAILURE CACHED AS AN ANSWER: a failed refresh serves the last good answer (marked stale),
// and only says ok:false when there has never been one. An empty table and "could not ask" are
// different statements and the client is told which.
//
// Row shape matches the XRPL fork's /lxapi/xrpltokens, so the ported trade layer reads it unchanged:
//   i  contract id      n  symbol        nm name          logo  data:/https: url or ''
//   p  price in NEAR    d  24h change %  v  24h volume NEAR   t  liquidity NEAR   x  24h trades
//   hi / lo  day range (not available from these sources: null)    vf  1 = curated    st 1 = stablecoin
// Liquidity and volume are SUMS over every Rhea pool in GeckoTerminal's top 200 that holds the token.
// 24h change comes from the token's busiest pool where it is the BASE token, since that is the side
// GeckoTerminal reports a change for; a token seen only as the quote side gets null, not a guess.
import { CURATED } from './_nearcurated.js';

const TTL = 120;                        // seconds a fresh answer is served from cache
const KEEP = 86400;                     // seconds the last good answer survives as a fallback
const WNEAR = 'wrap.near';
const PRICES = 'https://indexer.ref.finance/list-token-price';
const POOLS = 'https://api.geckoterminal.com/api/v2/networks/near/dexes/rhea-finance/pools?sort=h24_volume_usd_desc&page=';

function json(body, status, maxAge) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 30 : maxAge),
    'access-control-allow-origin': '*' } });
}

async function getJson(u, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
    if (!r.ok) throw new Error(u + ' ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function build() {
  const prices = await getJson(PRICES);
  const nearUsd = +((prices[WNEAR] || {}).price || 0);
  if (!(nearUsd > 0)) throw new Error('no NEAR price');

  // Rhea pools, best volume first. Pages after the first may fail (GeckoTerminal pages out
  // inconsistently past 100 pools); what arrived is used.
  const pools = [];
  for (let page = 1; page <= 10; page++) {
    let j;
    try { j = await getJson(POOLS + page, 5000); } catch (e) { if (page === 1) throw e; break; }
    const rows = (j && j.data) || [];
    pools.push(...rows);
    if (rows.length < 20) break;
  }

  const agg = {};
  const at = (id) => agg[id] || (agg[id] = { v: 0, t: 0, x: 0, d: null, best: -1, near24: null });
  for (const p of pools) {
    const a = p.attributes || {};
    const vol = +((a.volume_usd || {}).h24 || 0);
    const tvl = +(a.reserve_in_usd || 0);
    const tx = (a.transactions || {}).h24 || {};
    const trades = (+tx.buys || 0) + (+tx.sells || 0);
    const base = String(((p.relationships.base_token || {}).data || {}).id || '').replace(/^near_/, '');
    const quote = String(((p.relationships.quote_token || {}).data || {}).id || '').replace(/^near_/, '');
    for (const id of [base, quote]) {
      if (!id) continue;
      const s = at(id);
      s.v += vol; s.t += tvl; s.x += trades;
    }
    const ch = (a.price_change_percentage || {}).h24;
    if (base && ch != null && isFinite(+ch) && vol > at(base).best) { at(base).best = vol; at(base).d = +ch; }
  }

  const rows = [];
  for (const c of CURATED) {
    if (c.i === WNEAR) continue;                       // NEAR is the unit, not a row
    const usd = +((prices[c.i] || {}).price || 0);
    if (!(usd > 0)) continue;                          // no live price: not listed rather than $0
    const s = agg[c.i] || { v: 0, t: 0, x: 0, d: null };
    rows.push({ i: c.i, n: c.s, nm: c.n, logo: c.logo || '', st: c.st ? 1 : 0, vf: 1,
      p: usd / nearUsd, d: s.d, v: s.v / nearUsd, t: s.t / nearUsd, x: s.x, hi: null, lo: null });
  }
  rows.sort((a, b) => b.v - a.v);
  return { ok: true, src: 'Rhea Finance indexer, GeckoTerminal', usd: nearUsd,
    near24: (agg[WNEAR] || {}).d, at: Date.now(), rows };
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/nearmarket/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearmarket/kept');

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
    if (old) { const b = await old.json(); b.stale = true; return json(b, 200, 15); }
    return json({ ok: false, error: 'market data unavailable', rows: [] }, 200, 0);
  }
}
