// GET /lxapi/nearftmeta?ids=<contract>,<contract>,...   (at most 40)
//
// Token NAMES for the NEAR Wallet and Account pages -- symbol, decimals, name -- for tokens the curated list does not
// carry (N21, RAZA 2026-11-20). Each browser used to ask every token's own contract for ft_metadata over FastNEAR's
// free RPC, three at a time, retrying a 429 twice: 222 calls and 72 refusals for one cold Wallet load of root.near
// (179 tokens, 156 uncurated), and the per-IP limit then refused the account read itself ("NEAR RPC busy (429)").
//
// A token's metadata does not change, so it is asked of the chain ONCE, by whichever request first needs it, and kept
// in D1 (ADMIN_DB, table nearftmeta: production binding only -- staging has none and asks the chain every time). One
// D1 read answers a whole page's list. Icons are not kept (one data: icon can be 50KB); the page never used them here.
//
// Answer: { ok, meta: { <id>: {s, d, n} | {x:1} }, missing: [ids not answered this time] }. {x:1} is the chain's own
// answer that the contract is not a token -- kept, it is a fact. A token the chain could not be asked about (a 429, a
// timeout) is in `missing` and is NOT kept: the page lists it under its contract and the next visit asks again.
const RPCS = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
const MAX_IDS = 40, MAX_ASK = 20, PAR = 4, TIMEOUT_MS = 5000;   // 20 x 2 RPCs = 40 < the free plan's 50 subrequests
const ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': maxAge ? 'public, max-age=' + maxAge : 'no-store',
    'access-control-allow-origin': '*' } });
}
function clean(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').slice(0, 24); }

let ready = false;
async function table(db) {
  if (ready) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS nearftmeta (id TEXT PRIMARY KEY, v TEXT NOT NULL, ts INTEGER NOT NULL)').run();
  ready = true;
}

// One contract's ft_metadata. Resolves {s,d,n}, {x:1} when the chain says it is not a token, or null when it could
// not be asked (refused, slow, unreachable) -- the second RPC is tried before giving up.
async function ask(id) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'lx', method: 'query', params: {
    request_type: 'call_function', finality: 'final', account_id: id, method_name: 'ft_metadata', args_base64: 'e30=' } });
  for (const rpc of RPCS) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctl.signal });
      if (r.status === 429 || r.status >= 500) continue;
      const j = await r.json();
      if (j && j.error) {
        // Only "this account does not exist" is a fact about the token. An internal error or a timeout is the node's
        // trouble, not an answer -- try the other RPC, and keep nothing if neither answers.
        const cause = String((j.error.cause && j.error.cause.name) || '');
        if (cause === 'UNKNOWN_ACCOUNT') return { x: 1 };
        continue;
      }
      if (j && j.result && j.result.error) return { x: 1 };
      const bytes = new Uint8Array((j && j.result && j.result.result) || []);
      const m = bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : null;
      if (!m || m.decimals == null || !isFinite(+m.decimals)) return { x: 1 };
      return { s: clean(m.symbol) || '?', d: +m.decimals, n: clean(m.name) };
    } catch (e) {
      // aborted or unreachable: try the other RPC
    } finally { clearTimeout(t); }
  }
  return null;
}

export async function onRequestGet({ request, env, waitUntil }) {
  const raw = new URL(request.url).searchParams.get('ids') || '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => ID_RE.test(s)))].slice(0, MAX_IDS);
  if (!ids.length) return json({ ok: false, error: 'no ids', meta: {}, missing: [] });

  const meta = {};
  const db = env && env.ADMIN_DB;
  if (db) {
    try {
      await table(db);
      const q = 'SELECT id, v FROM nearftmeta WHERE id IN (' + ids.map((_, i) => '?' + (i + 1)).join(',') + ')';
      const rs = await db.prepare(q).bind(...ids).all();
      for (const r of (rs && rs.results) || []) { try { meta[r.id] = JSON.parse(r.v); } catch (e) {} }
    } catch (e) { /* the store is a shortcut, never a requirement */ }
  }

  // The rest from the chain, a few at a time, at most MAX_ASK per request (the free plan's 50 subrequests).
  const todo = ids.filter((id) => !meta[id]).slice(0, MAX_ASK), got = [];
  for (let i = 0; i < todo.length; i += PAR) {
    const part = todo.slice(i, i + PAR);
    const ans = await Promise.all(part.map(ask));
    part.forEach((id, k) => { if (ans[k]) { meta[id] = ans[k]; got.push(id); } });
  }
  if (db && got.length) {
    const now = Date.now();
    waitUntil(db.batch(got.map((id) => db.prepare('INSERT INTO nearftmeta (id, v, ts) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING')
      .bind(id, JSON.stringify(meta[id]), now))).catch(() => {}));
  }
  const missing = ids.filter((id) => !meta[id]);
  // Complete answers are facts the browser may keep for a day; a partial one is not cached at all.
  return json({ ok: true, meta, missing }, missing.length ? 0 : 86400);
}
