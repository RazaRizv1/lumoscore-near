// GET /lxapi/nearstats — network-wide NEAR figures for the Dashboard's Network Stats strip.
//
//   assets    every fungible token NearBlocks indexes on NEAR (v1/fts/count). Network-wide, as Stellar's
//             Assets pill is every asset on its ledger -- NOT the curated Trade list, which is a
//             LumosCore choice and was what this pill showed before (71). RAZA 2026-10-29.
//   accounts  every account ever created on NEAR, net of deleted ones: the sum of NearBlocks' daily
//             new_accounts minus deleted_accounts since genesis. Stellar's Accounts pill is the same
//             running total ("every account ever funded").
//   active    accounts that signed a transaction on the last full UTC day (`day`), for the tooltip.
//   pools     every pool on Rhea Finance, NEAR's main exchange: the classic contract's get_number_of_pools
//             plus the concentrated-liquidity contract's metadata pool_count (8,991 + 6,267 on 2026-10-29).
//             Network-wide, as Stellar's Pools pill is every pool on its ledger -- not the 182 curated
//             pools /lxapi/nearpools lists. Both counts include empty pools, as Stellar's does.
//
// WHY THIS RUNS AT THE EDGE. The only NearBlocks answer that carries account counts is v1/charts, the
// whole daily history since 2020: 1.5 MB, 3.5 s. Every visitor fetching that is out of the question, and
// so is JSON.parse here -- 10.6 ms measured, over this plan's 10 ms CPU. The three fields are read with
// indexOf instead (2.6-5.6 ms measured on the real 2,290-row body), once per cache window.
//
// Cached like nearpools: versioned key, 6 hours fresh (the account figures move once a day), last good
// kept a week, failures never cached. NearBlocks' free tier is a few calls a minute per IP.
const TTL = 21600, KEEP = 604800, VER = 'v1';
const CHARTS = 'https://api.nearblocks.io/v1/charts';
const FTS = 'https://api.nearblocks.io/v1/fts/count';
const RPCS = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
const REF = 'v2.ref-finance.near', DCL = 'dclv2.ref-labs.near';

// A view call, trying each RPC in turn. Returns the parsed JSON result.
async function view(account, method, get) {
  let last;
  for (const u of RPCS) {
    try {
      const t = await get(u, 6000, { jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function',
        finality: 'final', account_id: account, method_name: method, args_base64: 'e30=' } });
      const j = JSON.parse(t);
      if (!j.result || !Array.isArray(j.result.result)) throw new Error(method + ': ' + JSON.stringify(j.error || j.result || {}).slice(0, 120));
      return JSON.parse(String.fromCharCode.apply(null, j.result.result));
    } catch (e) { last = e; }
  }
  throw last;
}

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 300 : maxAge),
    'access-control-allow-origin': '*' } });
}
async function getText(u, ms, post) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 8000);
  try {
    const r = await fetch(u, { signal: ctl.signal, method: post ? 'POST' : 'GET', body: post ? JSON.stringify(post) : undefined,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
    if (!r.ok) throw new Error(u.split('?')[0] + ' ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// Sum every "<key>":"<digits>" in the body. Exported for the build-time check.
export function sumField(t, key) {
  const A = '"' + key + '":"';
  let n = 0, i = 0, rows = 0;
  for (;;) {
    i = t.indexOf(A, i);
    if (i < 0) break;
    i += A.length;
    const v = parseInt(t.slice(i, t.indexOf('"', i)), 10);
    if (isFinite(v)) { n += v; rows++; }
  }
  return { n, rows };
}
function lastField(t, key) {
  const A = '"' + key + '":"';
  const i = t.lastIndexOf(A);
  if (i < 0) return null;
  const v = parseInt(t.slice(i + A.length, t.indexOf('"', i + A.length)), 10);
  return isFinite(v) ? v : null;
}
function lastDate(t) {
  const A = '"date":"';
  const i = t.lastIndexOf(A);
  return i < 0 ? null : t.slice(i + A.length, i + A.length + 10);
}

export async function build(get) {
  get = get || getText;
  const [charts, fts, classic, dcl] = await Promise.all([get(CHARTS, 9000), get(FTS, 6000),
    view(REF, 'get_number_of_pools', get), view(DCL, 'get_metadata', get)]);
  const pc = Number(classic), pd = Number((dcl || {}).pool_count);
  if (!(pc > 0) || !(pd > 0)) throw new Error('rhea pool counts: ' + pc + ' / ' + pd);
  const made = sumField(charts, 'new_accounts'), gone = sumField(charts, 'deleted_accounts');
  // A history that stops short is a truncated body or a changed shape, not a small network.
  if (made.rows < 2000 || !(made.n > 1e8)) throw new Error('nearblocks charts: ' + made.rows + ' rows');
  const accounts = made.n - gone.n;
  const f = JSON.parse(fts);
  const assets = Number((((f && f.tokens) || [])[0] || {}).count);
  if (!(assets > 0)) throw new Error('nearblocks fts/count: no count');
  return { ok: true, src: 'NearBlocks, Rhea Finance', at: Date.now(), assets, accounts,
    pools: pc + pd, poolsClassic: pc, poolsDcl: pd,
    active: lastField(charts, 'active_accounts'), day: lastDate(charts) };
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/nearstats/' + VER + '/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearstats/' + VER + '/kept');
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
    if (!old) return json({ ok: false, error: 'network stats unavailable', why: String((e && e.message) || e).slice(0, 200) }, 0);
    return json(Object.assign(await old.json(), { stale: true }), 60);
  }
}
