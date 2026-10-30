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
//
// THE COUNT IS CACHED ON ITS OWN, and a refused count is not "no count" (RAZA 2026-10-30: "Why isnt the holder
// count shown on any asset?"). NearBlocks allows a few calls a minute from Cloudflare's address too, so after
// two tokens it refused -- and the first version turned that refusal into count:null and cached the whole answer
// for half an hour. Now: a count is kept 6 hours (fresh) and 30 days (fallback); a refused call serves the kept
// figure; with none, the answer says countUnread and is kept only a minute, and the page asks NearBlocks itself.
// Last of all, the count baked into the build from a paced run (_tools/_nearholdercounts.js), so a curated
// token is never "—" just because NearBlocks was busy -- with its date, as countAt.
import { CURATED } from './_nearcurated.js';
const TTL = 1800, KEEP = 604800, VER = 'v4';
const COUNT_TTL = 21600, COUNT_KEEP = 2592000;
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

// The count: a number, null when NearBlocks answered but has no figure (an unindexed token says "0"), and
// undefined when it could not be asked -- three different answers, kept apart.
export async function readCount(id, get) {
  let c;
  try { c = await (get || getJson)(COUNT + encodeURIComponent(id) + '/holders/count'); } catch (e) { return undefined; }
  const n = Number((((c && c.holders) || [])[0] || {}).count);
  return isFinite(n) && n > 0 ? n : null;
}

export async function build(id, get, count, countAt) {
  get = get || getJson;
  const top = await get(TOP + encodeURIComponent(id) + '/top');
  if (!top || !Array.isArray(top.accounts)) throw new Error('fastnear: no list');
  const holders = top.accounts
    .filter((x) => x && validId(String(x.account_id || '')) && /^\d+$/.test(String(x.balance || '')) && String(x.balance) !== '0')
    .map((x) => ({ a: String(x.account_id), raw: String(x.balance) }));
  // A LIST SHORTER THAN FastNEAR's 100 IS EVERY ACCOUNT -- so its holders are the count, exact and live, for
  // the small tokens NearBlocks has never indexed (DARK: 25). Preferred over any other figure.
  if (top.accounts.length < 100) { count = holders.length; countAt = null; }
  return { ok: true, src: 'FastNEAR (list), NearBlocks (count)', at: Date.now(), i: id,
    count: count == null ? null : count, countUnread: count === undefined, countAt: countAt || null, holders };
}

// The count through its own cache: fresh, else asked, else the kept figure, else undefined.
async function cachedCount(cache, base, id, waitUntil) {
  const fresh = new Request(base + '/count/fresh'), kept = new Request(base + '/count/kept');
  const hit = await cache.match(fresh);
  if (hit) return (await hit.json()).n;
  const n = await readCount(id);
  if (n !== undefined) {
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify({ n }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    waitUntil(Promise.all([put(fresh, COUNT_TTL), put(kept, COUNT_KEEP)]));
    return n;
  }
  const old = await cache.match(kept);
  return old ? (await old.json()).n : undefined;
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
    const wu = (p) => context.waitUntil(p);
    let n = await cachedCount(cache, base, id, wu), at = null;
    if (n === undefined) {
      const cur = CURATED.find((c) => c.i === id);
      if (cur && cur.hc > 0) { n = cur.hc; at = cur.hca || null; }
    }
    const body = await build(id, null, n, at);
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    // An answer still missing its count is kept a minute, so the next visitor asks again.
    wu(Promise.all([put(fresh, body.countUnread ? 60 : TTL), put(kept, KEEP)]));
    return json(body, body.countUnread ? 30 : 300);
  } catch (e) {
    const old = await cache.match(kept);
    if (!old) return json({ ok: false, error: 'holders unavailable', why: String((e && e.message) || e).slice(0, 200) }, 0);
    return json(Object.assign(await old.json(), { stale: true }), 60);
  }
}
