// NEAR pool indexer -- every Rhea Finance pool's swaps, deposits and withdrawals, read off the chain.
//
// WHY THIS EXISTS (RAZA 2026-10-30: "come on, do something. it must show the pool trxs"). The pool page's
// transactions came from GeckoTerminal, which does not track Rhea's 3- and 4-token stable pools at all; Rhea's
// own indexer stopped serving the public in December 2024 (its app now signs every call with a key built into
// its frontend, an access gate we do not get around). Everything needed is on chain: each Rhea swap names its
// pool in its arguments ("pool_id":1910) and logs the amounts ("Swapped 1727246 zec.omft.near for 5000377…
// wrap.near"); deposits and withdrawals log theirs too.
//
// HOW -- FREE, in two passes (RAZA 2026-10-30: "isnt there any way to do it for free?"):
//   1. EVERY block: the RPC method EXPERIMENTAL_changes on a free endpoint (dRPC answered 120 of 120 calls from a
//      Worker in 13 s, measured), asking only for Rhea's storage keys that begin 0x00 -- the pools vector: key =
//      0x00 + the pool id as a little-endian u64 (block 222288403: a swap on pool 6065 changed 00b1170000000000).
//      So it names exactly the pools a block touched, whatever shard or route the call came by -- but not what
//      came out: amounts and success live only in execution logs. (A chunk() was tried first and is wrong for
//      this: it lists transactions by SIGNER's shard and receipts LEAVING a shard, so most Rhea calls are not in
//      Rhea's own chunk.)
//   2. ONLY those blocks (~6 a minute): neardata.xyz's shard file, which carries the execution outcomes and logs,
//      parsed by rowsOf(). neardata rate-limits a Worker to ~28 reads a minute, far above this.
// TRIED FIRST: neardata for every block (~100 a minute; it allowed ~28) and NEAR Lake on S3 (works, but needs a
// paid AWS account). Both readers are kept in history; this one costs nothing.
//   * FORWARD  the blocks after the last one read, up to the chain head;
//   * BACKFILL once caught up, newest first, until BACKFILL_DAYS before the first run.
// A receipt usually executes in the block whose chunk carries it; under congestion it can wait, so a block with
// a pool action whose outcome is not in its own shard file is looked for in the next few.
//
// READ. GET /pool?id=<pool id>[&limit=N][&kind=swap|add|remove] -> the pool's latest rows, newest first, and
// the time span the index covers, so the page can say what it does and does not know. CORS open.
//
// Block times: a shard chunk carries none, so each run reads the header of its range's low end and the
// chain head and interpolates (NEAR makes ~1 block a second, steadily; the error is seconds).

const REF = 'v2.ref-finance.near';
const RPCS = ['https://near.drpc.org', 'https://free.rpc.fastnear.com'];
const ND = 'https://mainnet.neardata.xyz/v0';
const FWD = 1200, BACK = 2400, BACKFILL_DAYS = 3, KEEP_DAYS = 30, CONC = 8;
const RUN_MS = 45000;                       // a cron every minute must be done before the next run starts
// WHAT IS WORTH A NEARDATA READ (RAZA 2026-10-30: "why only so few? It needs to be just like other pool pages").
// Reading every block that touched any pool spent neardata's ~28 reads a minute on two-token swaps GeckoTerminal
// already lists, and left the backfill crawling. Only two things are fetched now:
//   * a DEPOSIT or WITHDRAWAL in any pool: an LP's share balance changed -- Rhea key 0x02 + u32 pool id +
//     borsh account (Rhea's own account there is its fee share, which every swap moves, so it does not count);
//   * any action in a pool of MORE THAN TWO tokens, whose swaps nothing else publishes.
// That is a few blocks an hour, so the run is bounded by the free RPC (8 in parallel), not by neardata.
const UA = { 'user-agent': 'LumosCore NEAR pool indexer (+https://lumoscore.com)' };
const pause = (ms) => new Promise((go) => setTimeout(go, ms));

async function rpc(method, params, k) {
  k = k || 0;
  const r = await fetch(RPCS[k % RPCS.length], { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, UA),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if ((r.status === 429 || r.status >= 500) && k < 3) { await pause(400 * (k + 1)); return rpc(method, params, k + 1); }
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(method + ' ' + r.status);
  if (j.error) {
    const name = (j.error.cause && j.error.cause.name) || j.error.name || '';
    // A height with no block (skipped) or no chunk for the shard is an answer, not a fault.
    if (/UNKNOWN_BLOCK|UNKNOWN_CHUNK|NOT_SYNCED_YET/.test(name) && (method === 'chunk' || method === 'EXPERIMENTAL_changes')) return null;
    if (k < 2) { await pause(300); return rpc(method, params, k + 1); }
    throw new Error(method + ': ' + name);
  }
  return j.result;
}
async function nd(path, k) {
  k = k || 0;
  const r = await fetch(ND + path, { headers: UA, redirect: 'follow' });
  if (r.status === 429 && k < 4) { await pause(1000 * (k + 1)); return nd(path, k + 1); }
  if (!r.ok) throw new Error('neardata ' + r.status);
  const t = await r.text();
  return t === 'null' ? null : JSON.parse(t);
}

// ---- parsing one receipt into rows -------------------------------------------------------------------
const b64 = (s) => { try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))); } catch (e) { return null; } };
const ok = (st) => !!(st && (st.SuccessValue !== undefined || st.SuccessReceiptId !== undefined));
// Token ids end at a space or a comma: the line can go on ("…factory.bridge.near, total fee …").
const SWAPPED = /^Swapped (\d+) ([^\s,]+) for (\d+) ([^\s,]+)/;
// "Liquidity added ["1000 a.near", "2000 b.near"], minted 123 shares" / "123 shares of liquidity removed: receive back [...]"
function pairs(text) { return [...String(text).matchAll(/"(\d+) ([^"\s]+)"/g)].map((m) => ({ t: m[2], a: m[1] })); }

export function rowsOf(ro, block, ts) {
  const rc = ro && ro.receipt;
  if (!rc || rc.receiver_id !== REF) return [];
  const out = ro.execution_outcome && ro.execution_outcome.outcome;
  if (!out || !ok(out.status)) return [];
  const logs = out.logs || [];
  const rows = [];
  const base = { block, ts, tx: ro.tx_hash || '', rid: rc.receipt_id };
  const acts = ((rc.receipt && rc.receipt.Action) || {}).actions || [];
  acts.forEach((a, ai) => {
    const f = a.FunctionCall;
    if (!f) return;
    const m = f.method_name, args = b64(f.args) || {};
    let actions = null, who = rc.predecessor_id;
    if (m === 'swap' || m === 'swap_by_output' || m === 'execute_actions') actions = args.actions;
    else if (m === 'ft_on_transfer') {
      who = args.sender_id || who;
      let msg = null; try { msg = args.msg ? JSON.parse(args.msg) : null; } catch (e) { msg = null; }
      actions = msg && msg.actions;
    }
    if (Array.isArray(actions) && actions.length) {
      const sw = logs.map((l) => SWAPPED.exec(l)).filter(Boolean);
      actions.forEach((x, k) => {
        if (!x || x.pool_id == null) return;
        // Paired in order (one "Swapped" line per action); a hop whose line is missing is left out rather
        // than shown with amounts from another hop.
        const s = sw[k];
        if (!s) return;
        rows.push(Object.assign({}, base, { id: rc.receipt_id + ':' + ai + ':' + k, pool: +x.pool_id, kind: 'swap', who,
          ta: s[2], aa: s[1], tb: s[4], ab: s[3], extra: '' }));
      });
      return;
    }
    // Two log shapes: a classic pool says "Liquidity added ["1000 a.near", …], minted N shares" / "N shares of
    // liquidity removed: receive back [...]"; a stable pool says "Mint N shares for <acct>, fee is …" / "Burn N
    // shares …" and names no tokens -- then the call's own amounts stand (in the pool's token order; exact for
    // add_stable_liquidity and remove_liquidity_by_tokens, minimums for a stable remove_liquidity, which is
    // flagged so the page can say so).
    const all = logs.join('\n');
    if (m === 'add_liquidity' || m === 'add_stable_liquidity') {
      const l = logs.find((x) => /^Liquidity added/.test(x)) || '';
      const sh = (/minted (\d+) shares/.exec(l) || /Mint (\d+) shares/.exec(all) || [])[1] || '';
      const tk = pairs(l);
      rows.push(Object.assign({}, base, { id: rc.receipt_id + ':' + ai, pool: +args.pool_id, kind: 'add', who,
        ta: '', aa: '', tb: '', ab: '', extra: JSON.stringify({ shares: sh, tokens: tk, amounts: tk.length ? null : (args.amounts || null) }) }));
      return;
    }
    if (m === 'remove_liquidity' || m === 'remove_liquidity_by_tokens') {
      const l = logs.find((x) => /shares of liquidity removed/.test(x)) || '';
      const sh = (/^(\d+) shares/.exec(l) || /Burn (\d+) shares/.exec(all) || [])[1] || String(args.shares || args.max_burn_shares || '');
      const tk = pairs(l);
      const amts = tk.length ? null : (args.amounts || args.min_amounts || null);
      rows.push(Object.assign({}, base, { id: rc.receipt_id + ':' + ai, pool: +args.pool_id, kind: 'remove', who,
        ta: '', aa: '', tb: '', ab: '', extra: JSON.stringify({ shares: sh, tokens: tk, amounts: amts, atLeast: !tk.length && !args.amounts }) }));
    }
  });
  return rows.filter((r) => Number.isInteger(r.pool) && r.pool >= 0);
}

// ---- the chain -------------------------------------------------------------------------------------
// What a block did to Rhea's storage: the pools it changed (key 0x00 + LE u64 pool id) and whether any LP's share
// balance moved (key 0x02 + LE u32 pool id + borsh account; Rhea's own fee account excepted).
const REF_BYTES = new TextEncoder().encode(REF);
export async function storageTouched(h) {
  const r = await rpc('EXPERIMENTAL_changes', { block_id: h, changes_type: 'data_changes', account_ids: [REF], key_prefix_base64: '' });
  const pools = {}; let lp = false;
  for (const c of (r && r.changes) || []) {
    const k = Uint8Array.from(atob((c.change && c.change.key_base64) || ''), (x) => x.charCodeAt(0));
    if (k.length === 9 && k[0] === 0) { let id = 0; for (let b = 8; b >= 1; b--) id = id * 256 + k[b]; pools[id] = 1; continue; }
    if (k[0] === 2 && k.length > 9) {
      const n = k[5] | (k[6] << 8) | (k[7] << 16) | (k[8] << 24);
      const acct = k.slice(9, 9 + n);
      const isRef = acct.length === REF_BYTES.length && acct.every((x, i) => x === REF_BYTES[i]);
      if (!isRef) lp = true;
    }
  }
  return { pools: Object.keys(pools).map(Number), lp };
}
// How many tokens a pool holds, asked once per pool per isolate.
const NTOK = new Map();
export async function tokenCount(id) {
  if (NTOK.has(id)) return NTOK.get(id);
  const p = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: REF, method_name: 'get_pool',
    args_base64: btoa(JSON.stringify({ pool_id: id })) }).catch(() => null);
  let n = 2;
  try { n = JSON.parse(new TextDecoder().decode(new Uint8Array(p.result))).token_account_ids.length; } catch (e) {}
  NTOK.set(id, n);
  return n;
}
async function blockAt(h) {
  try { const b = await rpc('block', { block_id: h }); return b && b.header ? { h: b.header.height, ts: Math.floor(Number(b.header.timestamp_nanosec || b.header.timestamp) / 1e6) } : null; }
  catch (e) { return null; }
}
async function findShard(h) {
  for (let k = 0; k < 10; k++) {
    const b = await nd('/block/' + (h - k)).catch(() => null);
    for (const sh of (b && b.shards) || []) for (const ro of sh.receipt_execution_outcomes || []) if (ro.receipt && ro.receipt.receiver_id === REF) return sh.shard_id;
  }
  return null;
}
async function pmap(list, fn, deadline) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, async () => {
    while (i < list.length && Date.now() < deadline) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}
// Reads the heights given, in order. Rows come only from the leading unbroken run of heights that were read
// in full, and done says how many: the caller's cursor moves no further.
async function scan(hs, shard, t0, t1, deadline) {
  const at = (h) => (t1.h === t0.h ? t1.ts : Math.round(t0.ts + (t1.ts - t0.ts) * (h - t0.h) / (t1.h - t0.h)));
  const why = {}; let hits = 0;
  const note = (e) => { const k = String((e && e.message) || e).slice(0, 60); why[k] = (why[k] || 0) + 1; };
  const per = await pmap(hs, async (h) => {
    let st;
    try { st = await storageTouched(h); } catch (e) { note(e); return null; }
    if (!st.pools.length) return [];
    let want = st.lp;
    if (!want) for (const p of st.pools) { if ((await tokenCount(p)) > 2) { want = true; break; } }
    if (!want) return [];
    hits++;
    // The outcomes are in this block's shard file: a pool's storage changes in the block whose chunk ran it.
    const rows = [];
    try {
      const f = await nd('/block/' + h + '/shard/' + shard);
      for (const ro of (f && f.receipt_execution_outcomes) || []) rows.push(...rowsOf(ro, h, at(h)));
    } catch (e) { note(e); return null; }
    return rows;
  }, deadline);
  let done = 0;
  while (done < per.length && per[done] != null) done++;
  return { rows: per.slice(0, done).flat(), done, hits, why, failed: per.filter((x) => x === null).length };
}

// ---- storage -----------------------------------------------------------------------------------------
async function meta(db) {
  const r = await db.prepare('SELECT k, v FROM meta').all();
  const m = {}; for (const x of r.results || []) m[x.k] = x.v; return m;
}
function setMeta(db, k, v) { return db.prepare('INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)); }
async function save(db, rows) {
  const ins = db.prepare('INSERT OR IGNORE INTO txs (id, pool, kind, block, ts, tx, who, ta, aa, tb, ab, extra) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)');
  for (let k = 0; k < rows.length; k += 80) {
    await db.batch(rows.slice(k, k + 80).map((r) => ins.bind(r.id, r.pool, r.kind, r.block, r.ts, r.tx, r.who || '', r.ta, r.aa, r.tb, r.ab, r.extra)));
  }
}

async function run(env) {
  const db = env.DB;
  const deadline = Date.now() + RUN_MS;
  const m = await meta(db);
  const fin = await rpc('block', { finality: 'final' });
  const head = fin.header.height;
  const headT = { h: head, ts: Math.floor(Number(fin.header.timestamp_nanosec || fin.header.timestamp) / 1e6) };
  // FIRST RUN of this reader: start at the head.
  if (m.source !== 'rpc') {
    await db.batch([setMeta(db, 'source', 'rpc'), setMeta(db, 'fwd', head - 1), setMeta(db, 'back', head),
      setMeta(db, 'start', head), setMeta(db, 'startTs', headT.ts), setMeta(db, 'backDone', '0'),
      setMeta(db, 'backTs', headT.ts)]);
    return { init: head };
  }
  let shard = m.shard != null ? +m.shard : await findShard(head);
  if (shard == null) throw new Error('no shard holds ' + REF);
  const stmts = [setMeta(db, 'shard', shard)];
  let fwd = +m.fwd, back = +m.back;
  const report = { head, lag: head - fwd, fwd: 0, back: 0, rows: 0, hits: 0, failed: 0 };

  // FORWARD
  if (head > fwd) {
    const lo = fwd + 1, hi = Math.min(head, fwd + FWD);
    const hs = []; for (let h = lo; h <= hi; h++) hs.push(h);
    const t0 = (await blockAt(lo)) || { h: lo, ts: headT.ts - (head - lo) * 600 };
    const r = await scan(hs, shard, t0, headT, deadline);
    await save(db, r.rows);
    if (r.done) { fwd = lo + r.done - 1; stmts.push(setMeta(db, 'fwd', fwd)); }
    report.fwd = r.done; report.rows += r.rows.length; report.hits += r.hits; report.failed += r.failed; report.why = r.why;
    // Resharding moves accounts between shards: many blocks read and not one Rhea action is the sign.
    if (r.done > 300 && !r.hits) {
      const s2 = await findShard(head);
      if (s2 != null && s2 !== shard) stmts.push(setMeta(db, 'shard', s2));
    }
  }
  // BACKFILL, newest first, only when caught up
  const floorTs = (+m.startTs || headT.ts) - BACKFILL_DAYS * 86400000;
  if (m.backDone !== '1' && head - fwd < 30 && Date.now() < deadline - 8000) {
    const hi = back - 1, lo = Math.max(0, back - BACK);
    const hs = []; for (let h = hi; h >= lo; h--) hs.push(h);
    const t1 = await blockAt(hi), t0 = await blockAt(lo);
    if (t0 && t1) {
      const r = await scan(hs, shard, t0, t1, deadline);
      await save(db, r.rows);
      if (r.done) {
        back = hi - r.done + 1;
        const bt = Math.round(t0.ts + (t1.ts - t0.ts) * (back - t0.h) / Math.max(1, t1.h - t0.h));
        stmts.push(setMeta(db, 'back', back), setMeta(db, 'backTs', bt));
        if (bt <= floorTs) stmts.push(setMeta(db, 'backDone', '1'));
      }
      report.back = r.done; report.rows += r.rows.length; report.hits += r.hits; report.failed += r.failed; report.bwhy = r.why;
    }
  }
  if (fwd % 3000 < FWD) stmts.push(db.prepare('DELETE FROM txs WHERE ts < ?1').bind(Date.now() - KEEP_DAYS * 86400000));
  await db.batch(stmts);
  return report;
}

// ---- hourly prices -------------------------------------------------------------------------------------
// The Trade page's day high/low and 7-day curve come from CoinGecko, which lists 39 of the 73 curated NEAR
// tokens (RAZA 2026-10-30: "why for some assets ... the last 2 columns are not showing details"). Stellar draws
// those columns from its own chain's prices; this is NEAR's equivalent: once an hour, Rhea's price list (one
// call, reachable from Cloudflare) for the tokens a page has asked about -- not all 4,600 it prices. A failed
// read leaves the hour unmarked, so the next minute's run tries again.
const PRICE_LIST = 'https://indexer.ref.finance/list-token-price';
const WNEAR = 'wrap.near';                        // every series is re-priced in NEAR against this one
const WATCH_MAX = 300, PX_KEEP_H = 8 * 24, WATCH_KEEP_H = 14 * 24;
const hourOf = (ms) => Math.floor(ms / 3600000);
const TOKEN_ID = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
async function snapPrices(env) {
  const db = env.DB, h = hourOf(Date.now());
  const done = await db.prepare("SELECT v FROM meta WHERE k = 'pxh'").first();
  if (done && +done.v === h) return { px: 'already' };
  const w = await db.prepare('SELECT t FROM pxwatch WHERE seen >= ?1').bind(h - WATCH_KEEP_H).all();
  const ids = new Set((w.results || []).map((r) => r.t));
  ids.add(WNEAR);
  const r = await fetch(PRICE_LIST, { headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
  if (!r.ok) throw new Error('rhea prices ' + r.status);
  const list = await r.json();
  const st = [];
  for (const t of ids) {
    const v = Number((list[t] || {}).price);
    if (v > 0 && isFinite(v)) st.push(db.prepare('INSERT OR REPLACE INTO px (t, h, usd) VALUES (?1, ?2, ?3)').bind(t, h, v));
  }
  if (!st.length) throw new Error('rhea prices: none of the watched tokens priced');
  st.push(db.prepare('DELETE FROM px WHERE h < ?1').bind(h - PX_KEEP_H));
  st.push(db.prepare('DELETE FROM pxwatch WHERE seen < ?1').bind(h - WATCH_KEEP_H));
  st.push(setMeta(db, 'pxh', h));
  await db.batch(st);
  return { px: st.length - 3 };
}
// GET /prices?ids=a,b,...  -> { ok, near: [[hour, usd]...], tok: { id: [[hour, usd]...] } }, the last 7 days.
// Asking registers the ids for the hourly snapshot (up to WATCH_MAX tokens in all).
async function prices(url, env) {
  const db = env.DB, h = hourOf(Date.now());
  const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',').map((s) => s.trim().toLowerCase())
    .filter((s) => TOKEN_ID.test(s)))].slice(0, 60);
  if (!ids.length) return json({ ok: false, error: 'no ids' }, 0);
  const have = await db.prepare('SELECT COUNT(*) AS n FROM pxwatch').first();
  const room = Math.max(0, WATCH_MAX - ((have && have.n) || 0));
  const known = await db.prepare('SELECT t FROM pxwatch WHERE t IN (' + ids.map((_, i) => '?' + (i + 1)).join(',') + ')').bind(...ids).all();
  const isKnown = new Set((known.results || []).map((r) => r.t));
  const add = ids.filter((t) => !isKnown.has(t)).slice(0, room);
  const touch = ids.filter((t) => isKnown.has(t)).concat(add);
  if (touch.length) await db.batch(touch.map((t) => db.prepare('INSERT INTO pxwatch (t, seen) VALUES (?1, ?2) ON CONFLICT(t) DO UPDATE SET seen = ?2').bind(t, h)));
  const all = ids.concat([WNEAR]);
  const q = await db.prepare('SELECT t, h, usd FROM px WHERE h >= ?1 AND t IN (' + all.map((_, i) => '?' + (i + 2)).join(',') + ') ORDER BY t, h')
    .bind(h - 7 * 24, ...all).all();
  const tok = {};
  for (const x of q.results || []) (tok[x.t] = tok[x.t] || []).push([x.h, x.usd]);
  const near = tok[WNEAR] || [];
  if (ids.indexOf(WNEAR) < 0) delete tok[WNEAR];
  return json({ ok: true, h, near, tok }, 300);
}

// ---- read --------------------------------------------------------------------------------------------
function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 30 : maxAge), 'access-control-allow-origin': '*' } });
}
async function read(url, env) {
  const id = url.searchParams.get('id');
  if (!/^\d{1,7}$/.test(id || '')) return json({ ok: false, error: 'bad pool id' }, 0);
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
  const kind = url.searchParams.get('kind');
  const q = /^(swap|add|remove)$/.test(kind || '')
    ? env.DB.prepare('SELECT * FROM txs WHERE pool = ?1 AND kind = ?2 ORDER BY block DESC, id DESC LIMIT ?3').bind(+id, kind, limit)
    : env.DB.prepare('SELECT * FROM txs WHERE pool = ?1 ORDER BY block DESC, id DESC LIMIT ?2').bind(+id, limit);
  const [r, m] = await Promise.all([q.all(), meta(env.DB)]);
  const rows = (r.results || []).map((x) => ({ kind: x.kind, block: x.block, t: x.ts, tx: x.tx, who: x.who,
    ta: x.ta, aa: x.aa, tb: x.tb, ab: x.ab, extra: x.extra ? JSON.parse(x.extra) : null }));
  return json({ ok: true, pool: +id, rows,
    // What the index covers: from the oldest block read to the newest. Anything older is not "no activity".
    from: m.backTs ? +m.backTs : (m.startTs ? +m.startTs : null), upTo: m.fwd ? +m.fwd : null,
    backfilling: m.backDone !== '1' });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(snapPrices(env).then((r) => console.log('prices', JSON.stringify(r)), (e) => console.error('price snapshot failed', e && e.message)));
    ctx.waitUntil(run(env).then((r) => console.log('indexed', JSON.stringify(r)), (e) => console.error('index run failed', e && e.message)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
    if (url.pathname === '/pool') {
      try { return await read(url, env); } catch (e) { return json({ ok: false, error: 'read failed' }, 0); }
    }
    if (url.pathname === '/prices') {
      try { return await prices(url, env); } catch (e) { return json({ ok: false, error: 'read failed' }, 0); }
    }
    if (url.pathname === '/status') {
      const m = await meta(env.DB);
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM txs').first();
      return json({ ok: true, meta: m, rows: n && n.n }, 0);
    }
    return json({ ok: false, error: 'not found' }, 0);
  },
};
