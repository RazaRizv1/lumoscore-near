// POST /lxapi/nearact { who, h } — records that a NEAR pool deposit or withdrawal was made THROUGH LumosCore, for the
// Dashboard's Platform Activity (read back by /lxapi/nearactivity, never served on its own).
//
// WHY (RAZA 2026-11-13: "when i created pool for LUMOS and ZEC, why isnt it shown on dashboard platform activity"). The
// feed is built from transactions that pay LumosCore's fee, and adding or removing liquidity is free: nothing on chain
// ties it to us. Stellar met the same wall and answered it with /lxapi/act -- only the platform knows what the platform
// did -- so this is that precedent for NEAR. The site posts the hash after the wallet returns it.
//
// WHAT IS KEPT: the hash, the account, a time, and the token amounts the pool itself logged ("Liquidity added
// ["1000 a.near", ...]" / "N shares of liquidity removed: receive back [...]"). All of it is public on chain already.
// No IP, no user agent, no page. Stellar's table lives in the admin database; this is a short list under its own key in
// CONTENT_KV (the newest 60), so no schema change and nothing mixed into Stellar's rows.
//
// UNAUTHENTICATED, LIKE STELLAR'S -- AND CHECKED HARDER. Before anything is kept, the chain is asked: the transaction
// must exist, have been signed by `who`, have succeeded, and carry a deposit or withdrawal log from the classic pools
// contract. A stranger can therefore record only a REAL pool transaction signed by its real account. That still is not
// proof it went through LumosCore (nothing can be), which is the same limit Stellar's endpoint states.
// A failure is a 200 { ok:false }: the page fires and forgets, and a refused write never changes what it does.
const RPC = 'https://free.rpc.fastnear.com';
const REF = 'v2.ref-finance.near';
const KEY = 'near:act:v1', MAX = 60;
const ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

function json(body) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
    'access-control-allow-origin': '*' } });
}
function okStatus(s) { return !!s && (s.SuccessValue !== undefined || s.SuccessReceiptId !== undefined); }
// "Liquidity added ["1000 a.near", "2000 b.near"], minted 123 shares" -> [[raw, token], ...] (the indexer's reading)
function pairs(text) { return [...String(text).matchAll(/"(\d+) ([^"\s]+)"/g)].map((m) => [m[1], m[2]]); }

export async function readList(env) {
  const kv = env && env.CONTENT_KV;
  if (!kv) return null;
  try { const v = await kv.get(KEY, 'json'); return Array.isArray(v) ? v : []; } catch (e) { return null; }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
}

export async function onRequestPost({ request, env }) {
  const kv = env && env.CONTENT_KV;
  if (!kv) return json({ ok: false, reason: 'no store' });
  let who = '', h = '';
  try { const b = await request.json(); who = String((b && b.who) || ''); h = String((b && b.h) || ''); }
  catch (e) { return json({ ok: false, reason: 'bad body' }); }
  if (!ID_RE.test(who) || !HASH_RE.test(h)) return json({ ok: false, reason: 'bad input' });

  // The chain's word for it.
  let res;
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'EXPERIMENTAL_tx_status', params: { tx_hash: h, sender_account_id: who, wait_until: 'EXECUTED_OPTIMISTIC' } }) });
    res = (await r.json()).result;
  } catch (e) { return json({ ok: false, reason: 'unread' }); }
  if (!res || !res.transaction) return json({ ok: false, reason: 'pending' });   // the page asks again shortly
  if (res.transaction.signer_id !== who) return json({ ok: false, reason: 'not the signer' });
  let kind = '', toks = [], ts = 0;
  for (const ro of (res.receipts_outcome || [])) {
    const o = ro.outcome || {};
    if (o.executor_id !== REF || !okStatus(o.status)) continue;
    for (const l of (o.logs || [])) {
      if (/^Liquidity added \[/.test(l)) { kind = '+'; toks = pairs(l); }
      else if (/shares of liquidity removed: receive back \[/.test(l)) { kind = '-'; toks = pairs(l); }
    }
    if (kind) break;
  }
  if (!kind || !toks.length) return json({ ok: false, reason: 'not a pool deposit or withdrawal' });
  toks = toks.filter((t) => t[0] !== '0').slice(0, 4);
  // The block's own time, from the transaction's outcome (nanoseconds); now if the RPC did not say.
  try {
    const b = res.transaction_outcome && res.transaction_outcome.block_hash;
    if (b) {
      const r2 = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'block', params: { block_id: b } }) });
      const hd = ((await r2.json()).result || {}).header || {};
      const ns = String(hd.timestamp_nanosec || hd.timestamp || '');
      if (ns.length > 6) ts = +ns.slice(0, ns.length - 6);
    }
  } catch (e) {}
  if (!(ts > 0)) ts = Date.now();

  const list = (await readList(env)) || [];
  if (list.some((x) => x && x.h === h)) return json({ ok: true, dup: true });
  list.unshift({ h, who, ts, k: kind, t: toks });
  try { await kv.put(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { return json({ ok: false, reason: 'write failed' }); }
  return json({ ok: true });
}
