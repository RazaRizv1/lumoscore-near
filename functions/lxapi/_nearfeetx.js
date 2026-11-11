// THE FEE ACCOUNT'S TRANSACTIONS, read once and shared: every LumosCore write on NEAR (a swap, a limit order, a bridge)
// pays its fee to fees-lumoscore.near in the user's own transaction, so that account's transactions ARE the platform's
// activity. FastNEAR's transaction index lists them (the account appears in their arguments). Used by
// /lxapi/nearbridgetx (the Bridge page's list) and /lxapi/nearactivity (the Dashboard's Platform Activity).
//
//   feeIndex(cache)     the account's transactions, newest first: { h, ok, height }. The index call is shared between the
//                       two Functions through the edge cache for 30 s; a failed call throws and is never cached.
//   decodeNew(cache, name, list, decode, perRun)
//                       one decoded map per caller (`name`), kept a week in ONE cache entry: hash -> what decode() made
//                       of the transaction, or 0 for "read, nothing of ours". Only hashes not yet in it are fetched,
//                       five a call, at most perRun a request. save() writes it back when anything changed.
//   post, signed        FastNEAR's POST API, and a transaction's signed actions with a relayed (meta) transaction
//                       unwrapped to the account that really acted.
export const FEE = 'fees-lumoscore.near';
export const WNEAR = 'wrap.near';
const FTX = 'https://tx.main.fastnear.com/v0/';
const IDX_TTL = 30, MAP_TTL = 604800, MAP_MAX = 400;

export async function post(path, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(FTX + path, { method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('fastnear ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export function signed(T) {
  const tx = T.transaction || {};
  let who = tx.signer_id || '', to = tx.receiver_id || '', acts = tx.actions || [];
  if (acts.length === 1 && acts[0] && acts[0].Delegate) {
    const da = acts[0].Delegate.delegate_action || {};
    who = da.sender_id || who; to = da.receiver_id || to; acts = da.actions || [];
  }
  const calls = acts.map((a) => {
    const f = a && a.FunctionCall;
    if (!f) return null;
    let args = null;
    try { args = JSON.parse(atob(f.args || '')); } catch (e) {}
    return { m: f.method_name, args, dep: String(f.deposit || '0') };
  }).filter(Boolean);
  const ts = Math.floor(Number((T.execution_outcome && T.execution_outcome.block_timestamp) || 0) / 1e6);
  return { hash: tx.hash || '', who, to, calls, ts };
}

export async function feeIndex(cache) {
  const key = new Request('https://lumoscore.internal/lxapi/nearfeetx/v1/index');
  const hit = await cache.match(key);
  if (hit) { try { return await hit.json(); } catch (e) {} }
  const j = await post('account', { account_id: FEE });
  if (!j || !Array.isArray(j.account_txs)) throw new Error('fastnear: no index');
  const list = j.account_txs.filter((x) => x && x.transaction_hash)
    .map((x) => ({ h: x.transaction_hash, ok: x.is_success !== false, height: Number(x.tx_block_height) || 0 }))
    .sort((a, b) => b.height - a.height);
  await cache.put(key, new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + IDX_TTL } }));
  return list;
}

export async function decodeNew(cache, name, list, decode, perRun) {
  const key = new Request('https://lumoscore.internal/lxapi/nearfeetx/v1/map/' + name);
  let map = {};
  const hit = await cache.match(key);
  if (hit) { try { map = (await hit.json()) || {}; } catch (e) { map = {}; } }
  const todo = list.map((x) => x.h).filter((h) => !(h in map)).slice(0, perRun || 30);
  const batches = [];
  for (let i = 0; i < todo.length; i += 5) batches.push(todo.slice(i, i + 5));
  const got = await Promise.all(batches.map((b) => post('transactions', { tx_hashes: b }).catch(() => null)));
  let changed = 0;
  got.forEach((g) => {
    ((g && g.transactions) || []).forEach((T) => {
      const h = T && T.transaction && T.transaction.hash;
      if (!h) return;
      map[h] = decode(T) || 0;
      changed++;
    });
  });
  return {
    map,
    touch() { changed++; },
    async save() {
      if (!changed) return;
      const ks = Object.keys(map);
      if (ks.length > MAP_MAX) ks.slice(0, ks.length - MAP_MAX).forEach((k) => { delete map[k]; });
      await cache.put(key, new Response(JSON.stringify(map), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + MAP_TTL } }));
    },
  };
}
