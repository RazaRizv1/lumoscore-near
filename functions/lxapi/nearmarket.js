// GET /lxapi/nearmarket — the NEAR market table: one row per curated token, priced in NEAR.
//
// WHY AT THE EDGE. The figures come from two places a browser should not call per page view:
//   * Rhea Finance's indexer (list-token-price) — USD prices for every token, wNEAR included.
//   * DexScreener (tokens/v1, 30 tokens a call) — each token's MAIN pair: 24h volume, trades, liquidity
//     and price change. Three calls cover the list.
// So the edge asks once, caches the answer for two minutes, and every visitor reads the cache.
//
// NOT GECKOTERMINAL, though the curation script uses it: from Cloudflare's servers it answers 429 to the
// very first call (measured on staging 2026-10-21 — shared egress IPs), so a Function cannot rely on it.
// And not DexScreener's all-pairs endpoint: it is one call per token, 65 calls a refresh, over the 50
// subrequests a Function may make on this plan.
//
// NEVER A FAILURE CACHED AS AN ANSWER: a failed refresh serves the last good answer (marked stale),
// and only says ok:false when there has never been one. An empty table and "could not ask" are
// different statements and the client is told which.
//
// Row shape matches the XRPL fork's /lxapi/xrpltokens, so the ported trade layer reads it unchanged:
//   i  contract id      n  symbol        nm name          logo  data:/https: url or ''
//   p  price in NEAR    d  24h change %  v  24h volume NEAR   t  liquidity NEAR   x  24h trades
//   hi / lo  day range (not available from these sources: null)    vf  1 = curated    st 1 = stablecoin
//   dc decimals (the wallet turns raw balances into amounts with it, and Send builds exact amounts)
// Volume, trades and liquidity are the token's MAIN pair's — the same thing Stellar's table shows (an
// asset against its main market), not a sum over every pool. 24h change is reported only when the token
// is the BASE of that pair, since that is the side the change describes; otherwise null, not a guess.
import { CURATED } from './_nearcurated.js';
import { ownPools, ownPrices, ownLiquidity } from './_nearownpools.js';

const TTL = 120;                        // seconds a fresh answer is served from cache
const KEEP = 86400;                     // seconds the last good answer survives as a fallback
const WNEAR = 'wrap.near';
const PRICES = 'https://indexer.ref.finance/list-token-price';
const PAIRS = 'https://api.dexscreener.com/tokens/v1/near/';
// DAY HIGH / LOW AND THE 7D TREND are NOT built here. Their only usable source is CoinGecko's 7-day
// hourly series, and CoinGecko answers 429 to Cloudflare (measured on staging 2026-10-21, as it does for
// Stellar's xlm.js). So each row carries its CoinGecko id (cg) and the PAGE asks CoinGecko once from the
// visitor's own connection — the precedent Stellar's asset pages set — see loadHist in browser/trade.js.
// Rhea's token-price-report was checked and rejected: it had RHEA flat at half its traded price.

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

async function build(context) {
  const [prices, own] = await Promise.all([getJson(PRICES), ownPools(context).catch(() => [])]);
  // A curated token Rhea has not priced yet is priced by its own pool (_nearownpools.js: LUMOS, 2026-11-04).
  ownPrices(own, prices);
  const ownLiq = ownLiquidity(own);
  const nearUsd = +((prices[WNEAR] || {}).price || 0);
  if (!(nearUsd > 0)) throw new Error('no NEAR price');

  // Each token's main pair, 30 tokens a call. A failed batch leaves its tokens without figures (they
  // still list, priced, with em dashes) rather than failing the whole table.
  const ids = CURATED.map((c) => c.i);
  const batches = [];
  for (let k = 0; k < ids.length; k += 30) batches.push(ids.slice(k, k + 30));
  const got = await Promise.all(batches.map((b) => getJson(PAIRS + b.map(encodeURIComponent).join(','), 6000).catch(() => null)));
  if (got.every((g) => !Array.isArray(g))) throw new Error('dexscreener: no batch answered');

  const agg = {};
  for (const list of got) {
    for (const p of (Array.isArray(list) ? list : [])) {
      const base = String((p.baseToken || {}).address || ''), quote = String((p.quoteToken || {}).address || '');
      const vol = +((p.volume || {}).h24 || 0);
      const tx = (p.txns || {}).h24 || {};
      const row = { v: vol, t: +((p.liquidity || {}).usd || 0), x: (+tx.buys || 0) + (+tx.sells || 0), d: null };
      const ch = (p.priceChange || {}).h24;
      for (const id of [base, quote]) {
        if (!id || (agg[id] && agg[id].v >= vol)) continue;   // keep each token's busiest pair
        // The QUOTE of a pair whose base is wNEAR is the one quote side that is exact: the pair's
        // change is NEAR priced in the token, so the token priced in NEAR moved by its inverse
        // (USDC's main pair is wNEAR/USDC). Converted to dollars below, once NEAR's own move is known.
        const inv = (id === quote && base === WNEAR && ch != null && isFinite(+ch)) ? (100 / (100 + +ch) - 1) * 100 : null;
        agg[id] = Object.assign({}, row, { d: (id === base && ch != null && isFinite(+ch)) ? +ch : null, dNear: inv });
      }
    }
  }

  const near24 = (agg[WNEAR] || {}).d;
  for (const id in agg) {
    const a = agg[id];
    if (a.d == null && a.dNear != null && near24 != null) a.d = ((1 + a.dNear / 100) * (1 + near24 / 100) - 1) * 100;
  }

  const rows = [];
  for (const c of CURATED) {
    if (c.i === WNEAR) continue;                       // NEAR is the unit, not a row
    const usd = +((prices[c.i] || {}).price || 0);
    if (!(usd > 0)) continue;                          // no live price: not listed rather than $0
    const s = agg[c.i] || { v: 0, t: ownLiq[c.i] != null ? ownLiq[c.i] * nearUsd : 0, x: 0, d: null };
    const p = usd / nearUsd;
    rows.push({ i: c.i, n: c.s, nm: c.n, logo: c.logo || '', st: c.st ? 1 : 0, vf: 1, dc: c.d,
      p, d: s.d, v: s.v / nearUsd, t: s.t / nearUsd, x: s.x, cg: c.cg || '', w: c.w || '', hi: null, lo: null,
      hc: c.hc > 0 ? c.hc : null });   // holder count as last baked (_nearholdercounts.js), for the search rows
  }
  rows.sort((a, b) => b.v - a.v);
  return { ok: true, src: 'Rhea Finance indexer, DexScreener', usd: nearUsd,
    near24, at: Date.now(), rows };
}

// The market answer itself, cache first — exported so /lxapi/neartoken reads the SAME figures for a token
// this table lists (and the same cache entry, so a token page costs the market no extra upstream calls).
// Resolves with the body (fresh, or the last good one marked stale); throws only when there has never
// been an answer to fall back on.
export async function marketBody(context) {
  const cache = caches.default;
  // The cache outlives a deployment, so the key carries the answer's SHAPE version: a new deploy that
  // changes what a row holds must not serve the previous version's answer for two minutes. Bump it
  // whenever the row shape changes (v3: rows carry cg; history is fetched by the page; v6: own-pool prices; v7: rows carry w).
  const fresh = new Request('https://lumoscore.internal/lxapi/nearmarket/v7/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearmarket/v7/kept');

  const hit = await cache.match(fresh);
  if (hit) return await hit.json();

  try {
    const body = await build(context);
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    context.waitUntil(Promise.all([put(fresh, TTL), put(kept, KEEP)]));
    return body;
  } catch (e) {
    const old = await cache.match(kept);
    if (old) { const b = await old.json(); b.stale = true; return b; }
    throw e;
  }
}

export async function onRequestGet(context) {
  try {
    const body = await marketBody(context);
    return body.stale ? json(body, 200, 15) : json(body);
  } catch (e) {
    // The upstream's own words ride along (a status line, no secrets): "unavailable" alone sent the
    // first staging check looking in the wrong place.
    return json({ ok: false, error: 'market data unavailable', why: String((e && e.message) || e).slice(0, 200), rows: [] }, 200, 0);
  }
}
