// LUMOSCORE'S OWN POOLS, read from the chain (RAZA 2026-11-04: LUMOS's Trade page read "No market data for this
// token" and its swap found no route, with LUMOS/wNEAR 9001 holding 2,268 LUMOS + 0.3 wNEAR).
//
// Rhea's indexer lists pools and prices tokens only once a pool is big or old enough for it, and LUMOS's first pool
// was neither. A curated token can name its pool (`pool`, baked by _tools/bake_curated.js from _tools/near-lumos.js);
// that pool is then read from v2.ref-finance.near itself and joins Rhea's list wherever the list lacks it, and a
// token Rhea has no price for is priced by it: a classic pool's spot price, its wNEAR reserve over its token reserve.
// Rhea's own price always wins when it has one.
import { CURATED } from './_nearcurated.js';

const WNEAR = 'wrap.near';
const RPCS = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
const TTL = 60;

async function view(account, method, args, ms) {
  for (const u of RPCS) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms || 5000);
      const r = await fetch(u, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final',
          account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) });
      clearTimeout(tm);
      const j = await r.json();
      if (!j || !j.result || !j.result.result) continue;
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    } catch (e) {}
  }
  return null;
}

// A classic pool on v2.ref-finance.near.
export async function getPool(id, ms) {
  const p = await view('v2.ref-finance.near', 'get_pool', { pool_id: Number(id) }, ms);
  return (p && Array.isArray(p.token_account_ids)) ? Object.assign({ id: String(id) }, p) : null;
}

// A concentrated-liquidity pool on dclv2.ref-labs.near ("x|y|fee"), in the classic shape: its two tokens and the
// amounts it holds (total_x / total_y, the contract's own totals of each token in the pool).
export async function getDclPool(id, ms) {
  const p = await view('dclv2.ref-labs.near', 'get_pool', { pool_id: String(id) }, ms);
  if (!p || !p.token_x || !p.token_y || p.total_x == null || p.total_y == null) return null;
  return { id: String(id), pool_kind: 'DCL', token_account_ids: [p.token_x, p.token_y], amounts: [String(p.total_x), String(p.total_y)],
    point: p.current_point != null && isFinite(+p.current_point) ? +p.current_point : null };   // raw price of x in y = 1.0001^point
}

// The pools, in list-top-pools' shape (id, pool_kind, token_account_ids, amounts, total_fee, shares_total_supply).
// Cached a minute; a failed read is left out, never cached.
export async function ownPools(context) {
  const want = CURATED.filter((c) => c.pool != null && /^\d{1,7}$/.test(String(c.pool)));
  if (!want.length) return [];
  const key = new Request('https://lumoscore.internal/lxapi/nearownpools/v1/' + want.map((c) => c.pool).join('-'));
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const got = (await Promise.all(want.map((c) => getPool(c.pool)))).filter(Boolean);
  if (got.length === want.length && context && context.waitUntil) {
    context.waitUntil(caches.default.put(key, new Response(JSON.stringify(got), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + TTL } })));
  }
  return got;
}

// Prices the tokens of these pools that `prices` (list-token-price's shape: { id: { price, decimal } }) lacks, in
// place. Only a classic two-token pool against wNEAR with both reserves non-zero prices anything.
export function ownPrices(pools, prices) {
  const nearUsd = +((prices[WNEAR] || {}).price || 0);
  if (!(nearUsd > 0)) return;
  for (const p of pools) {
    const ids = p.token_account_ids || [];
    if (ids.length !== 2 || p.pool_kind !== 'SIMPLE_POOL') continue;
    const wi = ids.indexOf(WNEAR), ti = 1 - wi;
    if (wi < 0) continue;
    const t = ids[ti], c = CURATED.find((x) => x.i === t);
    if (!c || c.d == null || +((prices[t] || {}).price || 0) > 0) continue;
    const w = Number((p.amounts || [])[wi]) / 1e24, a = Number((p.amounts || [])[ti]) / Math.pow(10, c.d);
    if (!(w > 0) || !(a > 0)) continue;
    prices[t] = { price: String(w / a * nearUsd), decimal: c.d, symbol: c.s, own: String(p.id) };
  }
}

// Each such token's liquidity in NEAR: its own pool's wNEAR side, doubled (a classic pool holds equal value on each side).
export function ownLiquidity(pools) {
  const out = {};
  for (const p of pools) {
    const ids = p.token_account_ids || [], wi = ids.indexOf(WNEAR);
    if (ids.length !== 2 || wi < 0) continue;
    out[ids[1 - wi]] = Number((p.amounts || [])[wi]) / 1e24 * 2;
  }
  return out;
}
