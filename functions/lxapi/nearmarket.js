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
import { nearCuratedSync } from './_netcurated.js';
import { ownPools, ownPrices, ownLiquidity, getPool, getDclPool } from './_nearownpools.js';
import { MAINPOOL } from './_nearmainpools.js';
// Our own hourly snapshots of Rhea's price list (workers/near-pool-indexer), the same series the Trade page draws its
// day high/low and 7D curve from: { ok, h, near: [[hour, usd]], tok: { id: [[hour, usd]] } }.
const HOURLY = 'https://near-pool-indexer.usa282.workers.dev/prices?ids=';

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

  const agg = {}, deep = {};
  for (const list of got) {
    for (const p of (Array.isArray(list) ? list : [])) {
      const base = String((p.baseToken || {}).address || ''), quote = String((p.quoteToken || {}).address || '');
      const vol = +((p.volume || {}).h24 || 0);
      const tx = (p.txns || {}).h24 || {};
      const row = { v: vol, t: +((p.liquidity || {}).usd || 0), x: (+tx.buys || 0) + (+tx.sells || 0), d: null };
      const ch = (p.priceChange || {}).h24;
      // THE DEEPEST wNEAR PAIR per token, its price in NEAR (see the override after the 24h loop below).
      if (base === WNEAR || quote === WNEAR) {
        const tok = base === WNEAR ? quote : base, pn = +p.priceNative, liqU = +((p.liquidity || {}).usd || 0);
        const px = base === WNEAR ? (pn > 0 ? 1 / pn : 0) : pn;
        if (tok && px > 0 && isFinite(px) && (!deep[tok] || liqU > deep[tok].liq))
          deep[tok] = { px, liq: liqU, ch: tok === base && ch != null && isFinite(+ch) ? +ch : null };
      }
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
  // A PRICE LIST THAT DISAGREES WITH THE TOKEN'S OWN DEEP POOL LOSES (RAZA 2026-11-20, NEAR LUMOS: "it says its down, but
  // then why the chart shows straight line" -> "yes, use the big pool"). Rhea's list priced LUMOS at 0.0000134 NEAR, its
  // 58-cent classic pool, while its ~$40K concentrated pool -- the one GeckoTerminal charts and the only one DexScreener
  // lists -- held 0.0001323: header and 24h move from one, chart from the other. When the deepest wNEAR pair holds at least
  // $1,000 and the list is off by more than 2x, that pool's price is the token's price, and its own 24h move (none if it has
  // none) replaces the hourly snapshots, which were priced off the same thin pool. Measured: of 49 curated tokens with both
  // prices, only LUMOS differs by more than 2x.
  const deepOver = {};
  const nearUsdNow = +((prices[WNEAR] || {}).price || 0);
  for (const id in deep) {
    const dp = deep[id], r = nearUsdNow > 0 ? +((prices[id] || {}).price || 0) / nearUsdNow : 0;
    if (!(dp.liq >= 1000) || !(r > 0) || Math.max(r, dp.px) / Math.min(r, dp.px) <= 2) continue;
    prices[id] = Object.assign({}, prices[id], { price: String(dp.px * nearUsdNow), deep: 1 });
    deepOver[id] = 1;
    if (agg[id]) { agg[id].d = dp.ch; agg[id].dNear = null; }
  }
  for (const id in agg) {
    const a = agg[id];
    if (a.d == null && a.dNear != null && near24 != null) a.d = ((1 + a.dNear / 100) * (1 + near24 / 100) - 1) * 100;
  }

  // A TOKEN DEXSCREENER HAS NEVER HEARD OF IS NOT A TOKEN NOBODY TRADES (RAZA 2026-11-14, /trade/near page 2: "the
  // values are incorrect because its just showing 0"). DexScreener indexes none of 16 curated tokens -- NearX, RIBBIT,
  // NEARAI, SPUD... -- and this used to print their volume, trades and liquidity as 0 and their change as a dash.
  //   * Liquidity: read off the token's MAIN pool on the chain (_nearmainpools.js; classic or concentrated), every
  //     side valued at Rhea's price. A side Rhea cannot price leaves the figure null, never a half-pool.
  //   * Volume and trades: no free source covers these pools, so they are null (the table's em dash), not 0.
  //   * The 24h change of ANY row still without one (these, and a token that is only ever the quote side of its main
  //     pair) comes from our hourly snapshots: its dollar price now against the same hour yesterday.
  const unseen = CURATED.filter((c) => c.i !== WNEAR && !agg[c.i] && ownLiq[c.i] == null && MAINPOOL[c.i] != null
    && +((prices[c.i] || {}).price || 0) > 0);
  const [poolsRead, hourly] = await Promise.all([
    Promise.all(unseen.map((c) => { const id = MAINPOOL[c.i]; return (typeof id === 'string' ? getDclPool(id, 3000) : getPool(id, 3000)).catch(() => null); })),
    (async () => {
      const ids = CURATED.filter((c) => c.i !== WNEAR && !(agg[c.i] && agg[c.i].d != null)).map((c) => c.i);
      if (!ids.length) return null;
      try { return await getJson(HOURLY + ids.map(encodeURIComponent).join(','), 4000); } catch (e) { return null; }
    })(),
  ]);
  // THE PRICE TOO, FROM THE POOL. Rhea's price list is FROZEN for these tokens -- RIBBIT held 2 distinct dollar prices
  // in 169 hours, DRAGON and CLAW 9 -- while NEAR moved 9% in a day; a token whose only market is a wNEAR pool cannot
  // hold its dollar price while NEAR moves, so the list is simply not refreshing them. Divided by a LIVE NEAR price,
  // that stale figure became a NEAR price that drifted with NEAR alone. The pool's own spot price is the market.
  unseen.forEach((c, k) => {
    const p = poolsRead[k];
    if (!p || c.d == null) return;
    const ids = p.token_account_ids || [], wi = ids.indexOf(WNEAR), ti = 1 - wi;
    if (ids.length !== 2 || wi < 0) return;
    let px = null;                                                   // the token's price in NEAR
    if (p.pool_kind === 'DCL' && p.point != null && Number(p.amounts[0]) > 0 && Number(p.amounts[1]) > 0) {
      const decX = ti === 0 ? c.d : 24, decY = ti === 0 ? 24 : c.d;
      const xInY = Math.pow(1.0001, p.point) * Math.pow(10, decX - decY);
      px = ti === 0 ? xInY : 1 / xInY;
    } else if (p.pool_kind === 'SIMPLE_POOL') {
      const w = Number(p.amounts[wi]) / 1e24, a = Number(p.amounts[ti]) / Math.pow(10, c.d);
      if (w > 0 && a > 0) px = w / a;
    }
    if (px > 0 && isFinite(px)) prices[c.i] = Object.assign({}, prices[c.i], { price: String(px * nearUsd), chain: 1 });
  });
  const poolLiq = {};
  unseen.forEach((c, k) => {
    const p = poolsRead[k];
    if (!p) return;
    let sum = 0;
    for (let q = 0; q < p.token_account_ids.length; q++) {
      const t = p.token_account_ids[q], pr = prices[t] || {};
      const dec = t === WNEAR ? 24 : (pr.decimal != null ? +pr.decimal : (CURATED.find((x) => x.i === t) || {}).d);
      const amt = Number((p.amounts || [])[q]) / Math.pow(10, dec);
      if (!(+pr.price > 0) || dec == null || !isFinite(amt)) return;   // an unpriced side: no figure at all
      sum += amt * +pr.price;
    }
    poolLiq[c.i] = sum;
  });
  const dayMove = {};
  if (hourly && hourly.ok && hourly.tok) {
    const nearAt = {};
    for (const x of (hourly.near || [])) if (x && x[1] > 0) nearAt[x[0]] = x[1];
    for (const id in hourly.tok) {
      const s = (hourly.tok[id] || []).filter((x) => x && x[1] > 0);
      if (s.length < 2) continue;
      const last = s[s.length - 1];
      if (last[0] < hourly.h - 3) continue;                         // stale series: say nothing
      let then = null;
      for (const x of s) if (x[0] <= last[0] - 24) then = x;        // the latest point at least a day back...
      if (!then || then[0] < last[0] - 27) continue;                // ...and not much more than a day back
      // A FROZEN SERIES SAYS NOTHING. A live price changes nearly every hour (NEAR alone moves it); one that held a
      // single value, or stepped a few times (DRAGON: 9 distinct in 169 hours), is Rhea not refreshing the token, and
      // a "change" read off it is a step in a stale list. Under 12 distinct hours in the day: no figure, the dash.
      if (new Set(s.filter((x) => x[0] >= then[0]).map((x) => x[1])).size < 12) continue;
      // In NEAR first, against the series' own NEAR price at the same two hours, then into dollars with near24 -- the
      // SAME NEAR move the page converts back with. Composing the dollar series directly mixed Rhea's hourly NEAR price
      // with DexScreener's day, and a pool nobody touched read -0.30% in NEAR instead of 0.00%.
      const nb = nearAt[last[0]], na = nearAt[then[0]];
      if (!(nb > 0) || !(na > 0) || near24 == null) continue;
      const dN = (last[1] / nb) / (then[1] / na) - 1;
      dayMove[id] = ((1 + dN) * (1 + near24 / 100) - 1) * 100;
    }
  }

  const rows = [];
  for (const c of CURATED) {
    if (c.i === WNEAR) continue;                       // NEAR is the unit, not a row
    const usd = +((prices[c.i] || {}).price || 0);
    if (!(usd > 0)) continue;                          // no live price: not listed rather than $0
    const s = Object.assign({}, agg[c.i] || { v: null, x: null, d: null,
      t: ownLiq[c.i] != null ? ownLiq[c.i] * nearUsd : (poolLiq[c.i] != null ? poolLiq[c.i] : null) });
    // A row missing its volume gets the main pool's GeckoTerminal address (gp); the PAGE asks GeckoTerminal for the
    // day's volume and trades (loadGt in browser/trade.js). Its change comes from the hourly series above, which the pool
    // indexer now prices off the token's own pool (snapPoolPrices), not off Rhea's list.
    const mp = MAINPOOL[c.i];
    const gp = s.v == null && mp != null ? (typeof mp === 'string' ? 'refv2-' + mp.split('|').join(':') : 'refv1-' + mp) : '';
    if (s.d == null && !deepOver[c.i] && dayMove[c.i] != null && isFinite(dayMove[c.i])) s.d = +dayMove[c.i].toFixed(2);
    const p = usd / nearUsd;
    rows.push({ i: c.i, n: c.s, nm: c.n, logo: c.logo || '', st: c.st ? 1 : 0, vf: 1, dc: c.d,
      p, d: s.d, v: s.v == null ? null : s.v / nearUsd, t: s.t == null ? null : s.t / nearUsd, x: s.x, cg: c.cg || '', w: c.w || '', hi: null, lo: null,
      hc: c.hc > 0 ? c.hc : null,      // holder count as last baked (_nearholdercounts.js), for the search rows
      // gp: the main pool's GeckoTerminal address, only on a row DexScreener has no figures for. The PAGE asks
      // GeckoTerminal with it from the visitor's own connection (it answers 429 to Cloudflare): trades, volume,
      // the day's range, the 24h change and the week's curve. See loadGt in browser/trade.js.
      gp });
  }
  rows.sort((a, b) => (b.v == null ? -1 : b.v) - (a.v == null ? -1 : a.v));   // unknown volume ranks after a real 0
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
  // v9: volume/trades/liquidity may be null (unknown), and a change may come from the hourly snapshots.
  const fresh = new Request('https://lumoscore.internal/lxapi/nearmarket/v14/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearmarket/v14/kept');

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
  // Admin-curated tokens (RAZA 2026-11-24, _netcurated.js) join the built-in list before anything reads it.
  await nearCuratedSync(context.env, CURATED);
  try {
    const body = await marketBody(context);
    return body.stale ? json(body, 200, 15) : json(body);
  } catch (e) {
    // The upstream's own words ride along (a status line, no secrets): "unavailable" alone sent the
    // first staging check looking in the wrong place.
    return json({ ok: false, error: 'market data unavailable', why: String((e && e.message) || e).slice(0, 200), rows: [] }, 200, 0);
  }
}
