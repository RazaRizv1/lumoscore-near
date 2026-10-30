// NEAR pool indexer -- every Rhea Finance pool's swaps, deposits and withdrawals, read off the chain.
//
// WHY THIS EXISTS (RAZA 2026-10-30: "come on, do something. it must show the pool trxs"). The pool page's
// transactions came from GeckoTerminal, which does not track Rhea's 3- and 4-token stable pools at all; Rhea's
// own indexer stopped serving the public in December 2024 (its app now signs every call with a key built into
// its frontend, an access gate we do not get around). Everything needed is on chain: each Rhea swap names its
// pool in its arguments ("pool_id":1910) and logs the amounts ("Swapped 1727246 zec.omft.near for 5000377…
// wrap.near"); deposits and withdrawals log theirs too.
//
// HOW. A cron, every minute, reads the file of the shard v2.ref-finance.near lives on, block by block, from
// NEAR LAKE -- NEAR's official block archive in S3 (near-lake-data-mainnet, eu-central-1, requester pays: the
// AWS account in the Worker's secrets pays the small transfer). Each block is a folder <height>/ holding
// block.json and shard_<n>.json, the same IndexerShard shape neardata serves. FIRST TRIED neardata.xyz itself
// (free): it rate-limits by IP, Workers share outbound IPs, and runs got ~28 reads a minute against ~100 NEAR
// blocks a minute. S3 has no such limit.
//   * FORWARD  the blocks after the last one read (listed from S3, so skipped heights cost nothing), and
//   * BACKFILL further into the past each run, once FORWARD is caught up, until BACKFILL_DAYS before the
//     first run.
// Each successful receipt to Rhea becomes rows in D1 (table txs). The shard is found once by reading a block's
// shard files, and found again if Rhea stops appearing in it for a whole run (NEAR resharding moves accounts).
//
// READ. GET /pool?id=<pool id>[&limit=N][&kind=swap|add|remove] -> the pool's latest rows, newest first, and
// the time span the index covers, so the page can say what it does and does not know. CORS open.
//
// Block times: a shard chunk carries none, so each run reads the header of its range's low end and the
// chain head and interpolates (NEAR makes ~1 block a second, steadily; the error is seconds).

import { lakeJson, lakeHeights, pad } from './s3.js';

const REF = 'v2.ref-finance.near';
const FWD = 400, BACK = 400, BACKFILL_DAYS = 3, KEEP_DAYS = 30, CONC = 12;
// A cron every minute must be done before the next run starts.
const RUN_MS = 45000;

// ---- parsing one receipt into rows -------------------------------------------------------------------
const b64 = (s) => { try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))); } catch (e) { return null; } };
const ok = (st) => !!(st && (st.SuccessValue !== undefined || st.SuccessReceiptId !== undefined));
const SWAPPED = /^Swapped (\d+) (\S+) for (\d+) (\S+)/;
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
    if (m === 'add_liquidity' || m === 'add_stable_liquidity') {
      const l = logs.find((x) => /^Liquidity added/.test(x)) || '';
      const sh = (/minted (\d+) shares/.exec(l) || [])[1] || '';
      rows.push(Object.assign({}, base, { id: rc.receipt_id + ':' + ai, pool: +args.pool_id, kind: 'add', who,
        ta: '', aa: '', tb: '', ab: '', extra: JSON.stringify({ shares: sh, tokens: pairs(l) }) }));
      return;
    }
    if (m === 'remove_liquidity' || m === 'remove_liquidity_by_tokens') {
      const l = logs.find((x) => /shares of liquidity removed/.test(x)) || '';
      const sh = (/^(\d+) shares/.exec(l) || [])[1] || String(args.shares || '');
      rows.push(Object.assign({}, base, { id: rc.receipt_id + ':' + ai, pool: +args.pool_id, kind: 'remove', who,
        ta: '', aa: '', tb: '', ab: '', extra: JSON.stringify({ shares: sh, tokens: pairs(l) }) }));
    }
  });
  return rows.filter((r) => Number.isInteger(r.pool) && r.pool >= 0);
}

// ---- the chain (NEAR Lake) ----------------------------------------------------------------------------
async function blockTs(env, h) {
  const b = await lakeJson(env, pad(h) + '/block.json');
  return b && b.header ? Math.floor(Number(b.header.timestamp_nanosec || b.header.timestamp) / 1e6) : null;
}
// Which shard holds Rhea: read the shard files of one recent block until a Rhea receipt turns up.
async function findShard(env, h) {
  const b = await lakeJson(env, pad(h) + '/block.json');
  const n = (b && b.chunks && b.chunks.length) || 10;
  for (let s = 0; s < n; s++) {
    const c = await lakeJson(env, pad(h) + '/shard_' + s + '.json').catch(() => null);
    for (const ro of (c && c.receipt_execution_outcomes) || []) if (ro.receipt && ro.receipt.receiver_id === REF) return (c.shard_id != null ? c.shard_id : s);
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
// Reads the given heights (in the order given) of the shard. Rows come only from the leading unbroken run of
// successful reads, and done says how many heights that run covers: the caller's cursor moves no further.
async function scan(env, hs, shard, t0, t1, deadline) {
  const at = (h) => (t1.h === t0.h ? t1.ts : Math.round(t0.ts + (t1.ts - t0.ts) * (h - t0.h) / (t1.h - t0.h)));
  let sawRef = false; const why = {};
  const per = await pmap(hs, async (h) => {
    let c;
    try { c = await lakeJson(env, pad(h) + '/shard_' + shard + '.json'); } catch (e) {
      const k = String((e && e.message) || e).slice(0, 80);
      why[k] = (why[k] || 0) + 1;
      return null;
    }
    const rows = [];
    for (const ro of (c && c.receipt_execution_outcomes) || []) {
      if (ro.receipt && ro.receipt.receiver_id === REF) sawRef = true;
      rows.push(...rowsOf(ro, h, at(h)));
    }
    return rows;
  }, deadline);
  let done = 0;
  while (done < per.length && per[done] != null) done++;
  return { rows: per.slice(0, done).flat(), done, sawRef, why, failed: per.filter((x) => x === null).length };
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
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error('AWS keys are not set (wrangler secret put AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
  const db = env.DB;
  const deadline = Date.now() + RUN_MS;
  const m = await meta(db);
  let fwd = m.fwd != null ? +m.fwd : null;
  // FIRST RUN (or after the neardata attempt): start at the newest block in the lake.
  if (fwd == null || m.source !== 'lake') {
    // The newest folder: list forward from a height a little behind the last known one until the list ends.
    let probe = fwd != null ? fwd : 222280000;
    for (let k = 0; k < 40; k++) {
      const hs = await lakeHeights(env, probe, 1000);
      if (hs.length < 1000) { probe = hs.length ? hs[hs.length - 1] : probe; break; }
      probe = hs[hs.length - 1];
    }
    const ts = await blockTs(env, probe);
    const stmts = [setMeta(db, 'source', 'lake'), setMeta(db, 'fwd', probe), setMeta(db, 'back', probe + 1),
      setMeta(db, 'start', probe), setMeta(db, 'startTs', ts || Date.now()), setMeta(db, 'backDone', '0')];
    await db.batch(stmts);
    return { init: probe };
  }
  let shard = m.shard != null ? +m.shard : null;
  const report = { fwd: 0, back: 0, rows: 0, failed: 0 };
  const stmts = [];

  // FORWARD
  const hs = await lakeHeights(env, fwd, FWD);
  report.lag = hs.length;
  if (hs.length) {
    if (shard == null) { shard = await findShard(env, hs[hs.length - 1]); if (shard == null) throw new Error('no shard holds ' + REF); stmts.push(setMeta(db, 'shard', shard)); }
    const t0 = { h: hs[0], ts: await blockTs(env, hs[0]) }, t1 = { h: hs[hs.length - 1], ts: await blockTs(env, hs[hs.length - 1]) };
    const r = await scan(env, hs, shard, t0, t1, deadline);
    if (!r.sawRef && r.done > 50) {                        // the shard may have moved
      const s2 = await findShard(env, hs[hs.length - 1]);
      if (s2 != null && s2 !== shard) { await db.batch([setMeta(db, 'shard', s2)]); return Object.assign(report, { reshard: s2 }); }
    }
    await save(db, r.rows);
    if (r.done) { fwd = hs[r.done - 1]; stmts.push(setMeta(db, 'fwd', fwd)); }
    report.fwd = r.done; report.rows += r.rows.length; report.failed += r.failed; report.why = r.why;
  }

  // BACKFILL, newest first, once FORWARD has caught up
  const startTs = +m.startTs || Date.now();
  const floorTs = startTs - BACKFILL_DAYS * 86400000;
  let back = +m.back;
  if (m.backDone !== '1' && hs.length < FWD && shard != null && Date.now() < deadline - 8000) {
    const older = await lakeHeights(env, Math.max(0, back - BACK * 2), BACK * 2);
    const want = older.filter((h) => h < back).slice(-BACK).reverse();
    if (want.length) {
      const t1 = { h: want[0], ts: await blockTs(env, want[0]) }, t0 = { h: want[want.length - 1], ts: await blockTs(env, want[want.length - 1]) };
      const r = await scan(env, want, shard, t0, t1, deadline);
      await save(db, r.rows);
      if (r.done) {
        back = want[r.done - 1];
        const bt = Math.round(t0.ts + (t1.ts - t0.ts) * (back - t0.h) / Math.max(1, t1.h - t0.h));
        stmts.push(setMeta(db, 'back', back), setMeta(db, 'backTs', bt));
        if (bt <= floorTs) stmts.push(setMeta(db, 'backDone', '1'));
      }
      report.back = r.done; report.rows += r.rows.length; report.failed += r.failed; report.bwhy = r.why;
    }
  }
  if (fwd % 3000 < FWD) stmts.push(db.prepare('DELETE FROM txs WHERE ts < ?1').bind(Date.now() - KEEP_DAYS * 86400000));
  if (stmts.length) await db.batch(stmts);
  return report;
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
    ctx.waitUntil(run(env).then((r) => console.log('indexed', JSON.stringify(r)), (e) => console.error('index run failed', e && e.message)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
    if (url.pathname === '/pool') {
      try { return await read(url, env); } catch (e) { return json({ ok: false, error: 'read failed' }, 0); }
    }
    if (url.pathname === '/status') {
      const m = await meta(env.DB);
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM txs').first();
      return json({ ok: true, meta: m, rows: n && n.n }, 0);
    }
    return json({ ok: false, error: 'not found' }, 0);
  },
};
