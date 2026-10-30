// GET /lxapi/nearholders?i=<token contract>  — a NEAR token's largest holders, for the Trade-Asset page's
// Holders tab (RAZA 2026-10-29: "for all near assets, why aren't the recent activity and holders showing").
//
//   holders  the 100 largest accounts, largest first: { a: account id, raw: balance in the token's smallest
//            unit, as a string }. The page scales it by the token's decimals and its supply, 50 a page.
//   count    every account holding the token, or null when no source has a figure.
//
// TWO SOURCES, AND WHY THE LIST IS NOT NEARBLOCKS'. NearBlocks ranks holders, but its ranking is stale: on
// 2026-10-29 its USDC #1 (5c33c6...57d2, "4.56M") held 3 USDC on chain, and binancecold3.near -- 39.7M, half
// the supply, read back by ft_balance_of -- was not in its list at all. FastNEAR's /v1/ft/<id>/top matched
// the chain on every row checked, and also covers tokens NearBlocks has never indexed (HOOT: NearBlocks "0").
// So the LIST is FastNEAR's; the COUNT, which FastNEAR does not publish, is NearBlocks' -- and a "0" from it
// beside a non-empty list is an unindexed token, returned as null rather than printed as zero holders.
//
// Cached at the edge 30 minutes, the last good answer kept a week, a failure NEVER cached.
const TTL = 1800, KEEP = 604800, VER = 'v2';
const TOP = 'https://api.fastnear.com/v1/ft/';
const COUNT = 'https://api.nearblocks.io/v1/fts/';

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 300 : maxAge),
    'access-control-allow-origin': '*' } });
}
async function getJson(u) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
    if (!r.ok) throw new Error(u.split('/')[2] + ' ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// A NEAR account id: 2-64 chars of lowercase letters, digits, - _ . (implicit accounts are 64 hex).
export function validId(id) { return /^[a-z0-9._-]{2,64}$/.test(id) && !/\.\.|^\.|\.$/.test(id); }

export async function build(id, get) {
  get = get || getJson;
  const [top, c] = await Promise.all([
    get(TOP + encodeURIComponent(id) + '/top'),
    get(COUNT + encodeURIComponent(id) + '/holders/count').catch(() => null),
  ]);
  if (!top || !Array.isArray(top.accounts)) throw new Error('fastnear: no list');
  const holders = top.accounts
    .filter((x) => x && validId(String(x.account_id || '')) && /^\d+$/.test(String(x.balance || '')) && String(x.balance) !== '0')
    .map((x) => ({ a: String(x.account_id), raw: String(x.balance) }));
  const n = Number((((c && c.holders) || [])[0] || {}).count);
  const count = isFinite(n) && n > 0 ? n : null;
  return { ok: true, src: 'FastNEAR (list), NearBlocks (count)', at: Date.now(), i: id, count, holders };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const id = String(url.searchParams.get('i') || '').trim().toLowerCase();
  if (!validId(id)) return json({ ok: false, error: 'bad token id' }, 0);
  const cache = caches.default;
  const base = 'https://lumoscore.internal/lxapi/nearholders/' + VER + '/' + encodeURIComponent(id);
  const fresh = new Request(base + '/fresh'), kept = new Request(base + '/kept');
  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json());
  try {
    const body = await build(id);
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    context.waitUntil(Promise.all([put(fresh, TTL), put(kept, KEEP)]));
    return json(body);
  } catch (e) {
    const old = await cache.match(kept);
    if (!old) return json({ ok: false, error: 'holders unavailable', why: String((e && e.message) || e).slice(0, 200) }, 0);
    return json(Object.assign(await old.json(), { stale: true }), 60);
  }
}
