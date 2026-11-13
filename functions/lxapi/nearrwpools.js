// GET /lxapi/nearrwpools — the pools the LUMOS reward programmes cover on NEAR, for the Pools page's Rewarded tab.
//   { ok, at, pools: [{ code, i, id }] }   programme order: the native LUMOS/wNEAR pool first, then the ten.
//
// RAZA 2026-11-13: "Replicate ... Rewarded Pools tab". The programme names PAIRS, not pool ids: LUMOS against
// wNEAR (Native LP) and against each of the ten Ecosystem assets RAZA chose (ticket 270; the same ten, in the same
// order, as browser/nearlumospage.js and the rewards page). Which pool carries a pair is read from the chain.
//
// WHY NOT /lxapi/nearpools. Its list is Rhea's top-pools feed, which leaves small and new pools out: LUMOS/ZEC 9017,
// made today with ~$2.5 in it, is not there, and a curated token names only ONE own pool (LUMOS: 9001). So this
// reads v2.ref-finance.near itself. Every LUMOS pool is 9001 or later -- LUMOS was minted 2026-11-04 and 9001 was its
// first pool -- so get_pools from 9001 to get_number_of_pools covers them all in a call or two.
//
// One pool per pair: a two-token classic pool holding LUMOS and that asset, the one with the most LUMOS in it when a
// pair has several (anyone can open a duplicate). A pair nobody has created yet is simply absent: it pays nothing
// and claims nothing. The page reads each pool through /lxapi/nearpools?id=, so this tab and All Pools describe a pool
// the same way. Cached five minutes; a failure is a 200 { ok:false }, never cached, never "no pools".
const RPCS = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
const REF = 'v2.ref-finance.near', LUMOS = 'lumos.lumoscore.near', FIRST = 9001, PAGE = 100;
const VER = 'v1', TTL = 300;
export const RW = [
  { code: 'NEAR', i: 'wrap.near' },
  { code: 'USDC', i: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' },
  { code: 'USDt', i: 'usdt.tether-token.near' },
  { code: 'QTC', i: 'qtc.omft.near' },
  { code: 'ZEC', i: 'zec.omft.near' },
  { code: 'BATMAN', i: 'batman-4.nearlytrade.near' },
  { code: 'RHEA', i: 'token.rhealab.near' },
  { code: 'NEARLY', i: 'nearly-993927.nearlytrade.near' },
  { code: 'HOOT', i: 'hoot-8ecf65.launchpad.justhoot.near' },
  { code: 'rNEAR', i: 'lst.rhealab.near' },
  { code: 'USDT.e', i: 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near' },
];

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + maxAge, 'access-control-allow-origin': '*' } });
}
async function view(method, args) {
  let last;
  for (const u of RPCS) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(u, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final',
          account_id: REF, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) });
      clearTimeout(tm);
      const j = await r.json();
      if (!j || !j.result || !j.result.result) throw new Error(method + ': ' + String((j && j.error && j.error.message) || 'no result'));
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    } catch (e) { last = e; }
  }
  throw last;
}
function big(v) { try { return BigInt(String(v)); } catch (e) { return 0n; } }

async function build() {
  const n = Number(await view('get_number_of_pools', {}));
  if (!(n > FIRST)) throw new Error('pool count unread');
  const want = {};
  RW.forEach((r) => { want[r.i] = r; });
  const best = {};                                       // asset id -> { id, lumos }
  for (let from = FIRST; from < n; from += PAGE) {
    const list = await view('get_pools', { from_index: from, limit: PAGE });
    if (!Array.isArray(list)) throw new Error('get_pools: not a list');
    list.forEach((p, k) => {
      const ids = (p && p.token_account_ids) || [];
      if (!p || p.pool_kind !== 'SIMPLE_POOL' || ids.length !== 2) return;
      const li = ids.indexOf(LUMOS);
      if (li < 0) return;
      const other = ids[1 - li];
      if (!want[other]) return;
      const lumos = big((p.amounts || [])[li]);
      if (!(lumos > 0n)) return;                         // an emptied pool holds nothing to reward
      if (!best[other] || lumos > best[other].lumos) best[other] = { id: String(from + k), lumos };
    });
  }
  return { ok: true, at: Date.now(), pools: RW.filter((r) => best[r.i]).map((r) => ({ code: r.code, i: r.i, id: best[r.i].id })) };
}

export async function onRequestGet() {
  const cache = caches.default;
  const key = new Request('https://lumoscore.internal/lxapi/nearrwpools/' + VER);
  const hit = await cache.match(key);
  if (hit) return json(await hit.json(), 60);
  try {
    const body = await build();
    await cache.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + TTL } }));
    return json(body, 60);
  } catch (e) {
    return json({ ok: false, error: 'rewarded pools unread', why: String((e && e.message) || e).slice(0, 160) }, 0);
  }
}
