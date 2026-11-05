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
//             plus the concentrated-liquidity contract's metadata pool_count. Network-wide, as Stellar's
//             Pools pill is every pool on its ledger -- not the curated pools /lxapi/nearpools lists. Both
//             counts include empty pools, as Stellar's does.
//
// NOT READ FROM NEARBLOCKS HERE (RAZA 2026-11-05: "Why are network stats taking so long to load"). NearBlocks refuses
// Cloudflare's IPs with 429, so reading it on a cache miss came back empty and left all three pills waiting; a Worker
// is refused the same. So: accounts and assets are baked at build time (_tools/_nearnetbake.js), pools come live from
// workers/near-pool-indexer netJob, which keeps them in D1, and this Function makes one small call. If the indexer
// ever does get a NearBlocks answer, its newer figure wins.
//
// Cached 10 minutes, the last good answer kept a week, failures never cached.
import { NET } from './_nearnetbaked.js';

const TTL = 600, KEEP = 604800, VER = 'v2';
const IDX = 'https://near-pool-indexer.usa282.workers.dev/netstats';
// Older than this, a figure is marked stale: the tooltip says when it was read. A build's bake counts as current
// for a fortnight: an account total moves by a fraction of a percent in that time.
const OLD_MS = 14 * 86400000;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 300 : maxAge),
    'access-control-allow-origin': '*' } });
}

export async function build() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  let j;
  try {
    const r = await fetch(IDX, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('indexer ' + r.status);
    j = await r.json();
  } finally { clearTimeout(t); }
  if (!j || !j.ok || !(j.pools > 0)) throw new Error('indexer: pools not read yet');
  const live = j.accounts > 0 && j.atA > NET.at, liveF = j.assets > 0 && j.atF > NET.at;
  const at = Math.min(live ? j.atA : NET.at, liveF ? j.atF : NET.at, j.atP);
  const body = { ok: true, src: 'NearBlocks, Rhea Finance', at, assets: liveF ? j.assets : NET.assets, accounts: live ? j.accounts : NET.accounts,
    pools: j.pools, poolsClassic: j.poolsClassic, poolsDcl: j.poolsDcl, active: live ? j.active : NET.active, day: live ? j.day : NET.day };
  if (Date.now() - at > OLD_MS) body.stale = true;
  return body;
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
