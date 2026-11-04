// GET /lxapi/nearlps?pool=<Rhea pool id>  — a pool's largest liquidity providers, read from the chain
// (RAZA 2026-10-30: "why arent liq pool participants shown on Pools-pool page", then "Verify on-chain").
//
// NO SOURCE LISTS THEM, AND THE ONE THAT TRIES IS STALE. v2.ref-finance.near keeps shares in a lookup map:
// it answers "how many shares does X hold" (get_pool_shares) but cannot enumerate X. Rhea's data service
// does publish a per-pool list (/api/pool/<id>/lp), but every pool's record says updatedAt 2026-02-02 and the
// holders it names add up to 54% of pool 79 and under 2% of pool 1910 today. Printed as-is it would show
// February's holders with February's shares as the present.
//
// SO THE LIST IS ONLY A CANDIDATE LIST, and every figure is the chain's:
//   candidates  the largest accounts in Rhea's LP list + the largest stakers in its farm list for this
//               pool (/api/seedv2/v2.ref-finance.near@<id>/accounts) -- LP shares staked in Rhea's farm are
//               held by boostfarm.ref-labs.near, not the person, so a big farmer is invisible to the first.
//   per account get_pool_shares (held directly; shadow-staked shares stay here and count once) plus
//               boostfarm get_farmer_seed free_amount + locked_amount (staked). The farm contract itself is
//               never a provider: its balance IS those stakes.
//   share       of the pool's current shares_total_supply (get_pool).
// What this cannot see: someone who joined after February and never staked. The page says "largest known".
//
// Cached at the edge 6 hours, the last good answer kept a week, a failure never cached.
const TTL = 21600, KEEP = 604800, VER = 'v2';   // v2: indexer candidates (2026-11-04); v1 answers cached an empty list for new pools
const DS = 'https://api.data-service.ref.finance';
const IDX = 'https://near-pool-indexer.usa282.workers.dev';
const EX = 'v2.ref-finance.near';
const FARM = 'boostfarm.ref-labs.near';
const RPCS = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
const PER_LIST = 30, MAX_CAND = 50, RETURN = 40, CONC = 6;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 300 : maxAge),
    'access-control-allow-origin': '*' } });
}
async function getJson(u, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 10000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
    if (!r.ok) throw new Error(u.split('/')[2] + ' ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
// A view call, tried on one RPC and then the other (both are free tiers shared with every Cloudflare tenant).
let turn = 0;
async function view(account, method, args) {
  const first = turn++ % RPCS.length;
  let last;
  for (let k = 0; k < RPCS.length; k++) {
    const url = RPCS[(first + k) % RPCS.length];
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function',
          finality: 'final', account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) });
      const j = await r.json();
      if (j.error) throw new Error(method + ': ' + JSON.stringify(j.error).slice(0, 120));
      if (!j.result || !Array.isArray(j.result.result)) throw new Error(method + ': ' + String((j.result && j.result.error) || 'no result').slice(0, 120));
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    } catch (e) { last = e; } finally { clearTimeout(t); }
  }
  throw last;
}
function validId(id) { return /^[a-z0-9._-]{2,64}$/.test(id) && !/\.\.|^\.|\.$/.test(id); }
const big = (s) => { try { return BigInt(String(s == null ? '0' : s).split('.')[0] || '0'); } catch (e) { return 0n; } };

async function pool(n, fn) {
  const out = new Array(n.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, n.length) }, async () => {
    while (i < n.length) { const k = i++; out[k] = await fn(n[k]); }
  }));
  return out;
}

export async function build(id) {
  const seed = EX + '@' + id;
  const [p, lp, sd, ix] = await Promise.all([
    view(EX, 'get_pool', { pool_id: id }),
    getJson(DS + '/api/pool/' + id + '/lp').catch(() => null),
    getJson(DS + '/api/seedv2/' + encodeURIComponent(seed) + '/accounts').catch(() => null),
    // LumosCore's own pool indexer (workers/near-pool-indexer) records every deposit since 2026-10-29, which is
    // the part Rhea's February list cannot know: a new pool's providers (RAZA 2026-11-04, LUMOS/wNEAR 9001 read
    // "No liquidity providers found" with the treasury's deposit in it).
    getJson(IDX + '/pool?id=' + id + '&kind=add&limit=200').catch(() => null),
  ]);
  const total = big(p && p.shares_total_supply);
  if (total <= 0n) throw new Error('pool has no shares');
  // Candidates, largest first in each list. Rhea's LP list gives amounts in whole shares, the farm list in raw
  // units: only the ORDER of each is used, never the figure.
  const lpRows = ((lp && lp.pool && lp.pool.shares) || []).filter((x) => x && validId(String(x.account || '')))
    .sort((a, b) => (+b.amount || 0) - (+a.amount || 0)).slice(0, PER_LIST).map((x) => String(x.account));
  const farmRows = ((sd && sd.accounts && sd.accounts.accounts) || []).filter((x) => x && validId(String(x.account || '')))
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, PER_LIST).map((x) => String(x.account));
  const hasFarm = farmRows.length > 0;
  // Newest depositors first, once each: they are the ones neither Rhea list has.
  const ixRows = [];
  ((ix && ix.ok && ix.rows) || []).forEach((r) => { const a = String((r && r.who) || ''); if (validId(a) && ixRows.indexOf(a) < 0) ixRows.push(a); });
  const seen = {}, cand = [];
  [ixRows.slice(0, PER_LIST), lpRows, farmRows].forEach((list) => list.forEach((a) => {
    if (a === FARM || a === EX || seen[a] || cand.length >= MAX_CAND) return;
    seen[a] = 1; cand.push(a);
  }));
  let failed = 0;
  const rows = await pool(cand, async (a) => {
    try {
      const [d, f] = await Promise.all([
        view(EX, 'get_pool_shares', { pool_id: id, account_id: a }),
        hasFarm ? view(FARM, 'get_farmer_seed', { farmer_id: a, seed_id: seed }).catch(() => null) : null,
      ]);
      const direct = big(d), staked = f ? big(f.free_amount) + big(f.locked_amount) : 0n;
      return { a, direct, staked };
    } catch (e) { failed++; return null; }
  });
  // More than a third unread is not a list worth showing: it would rank whoever happened to answer.
  if (cand.length && failed * 3 > cand.length) throw new Error(failed + ' of ' + cand.length + ' reads failed');
  const providers = rows.filter((r) => r && r.direct + r.staked > 0n)
    .sort((x, y) => (y.direct + y.staked > x.direct + x.staked ? 1 : y.direct + y.staked < x.direct + x.staked ? -1 : 0))
    .slice(0, RETURN)
    .map((r) => ({ a: r.a, shares: (r.direct + r.staked).toString(), staked: r.staked.toString(),
      pct: Number((r.direct + r.staked) * 1000000n / total) / 10000 }));
  return { ok: true, pool: id, at: Date.now(), total: total.toString(), checked: cand.length, unread: failed,
    listAsOf: (lp && lp.pool && lp.pool.updatedAt) || null, providers,
    src: 'LumosCore pool indexer + Rhea data service (candidates) + v2.ref-finance.near / boostfarm.ref-labs.near (shares)' };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const raw = String(url.searchParams.get('pool') || '').trim();
  if (!/^\d{1,7}$/.test(raw)) return json({ ok: false, error: 'bad pool id' }, 0);
  const id = +raw;
  const cache = caches.default;
  const base = 'https://lumoscore.internal/lxapi/nearlps/' + VER + '/' + id;
  const fresh = new Request(base + '/fresh'), kept = new Request(base + '/kept');
  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json());
  try {
    const body = await build(id);
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    context.waitUntil(Promise.all([put(fresh, TTL), put(kept, KEEP)]));
    return json(body, 600);
  } catch (e) {
    const old = await cache.match(kept);
    if (!old) return json({ ok: false, error: 'providers unavailable', why: String((e && e.message) || e).slice(0, 200) }, 0);
    return json(Object.assign(await old.json(), { stale: true }), 60);
  }
}
