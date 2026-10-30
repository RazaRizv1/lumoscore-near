// NEAR pool indexer -- every Rhea Finance pool's swaps, deposits and withdrawals, read off the chain.
//
// WHY THIS EXISTS (RAZA 2026-10-30: "come on, do something. it must show the pool trxs"). The pool page's
// transactions came from GeckoTerminal, which does not track Rhea's 3- and 4-token stable pools at all; Rhea's
// own indexer stopped serving the public in December 2024 (its app now signs every call with a key built into
// its frontend, an access gate we do not get around). Everything needed is on chain: each Rhea swap names its
// pool in its arguments ("pool_id":1910) and logs the amounts ("Swapped 1727246 zec.omft.near for 5000377…
// wrap.near"); deposits and withdrawals log theirs too.
//
// HOW. A cron, every minute, reads the chunk of the shard v2.ref-finance.near lives on (FastNEAR's free
// neardata archive, /v0/block/<h>/shard/<id>: ~8 KB a block against ~156 KB for the whole block), for
//   * FORWARD  the blocks since the last run (up to FWD a run), and
//   * BACKFILL BACK blocks further into the past each run, until BACKFILL_DAYS before the first run.
// Each successful receipt to Rhea becomes rows in D1 (table txs). The shard is found once from a full block
// and found again if the shard stops showing Rhea for a whole run (NEAR resharding moves accounts).
//
// READ. GET /pool?id=<pool id>[&limit=N][&kind=swap|add|remove] -> the pool's latest rows, newest first, and
// the time span the index covers, so the page can say what it does and does not know. CORS open.
//
// Block times: a shard chunk carries none, so each run reads the header of its range's low end and the
// chain head and interpolates (NEAR makes ~1 block a second, steadily; the error is seconds).

const ND = 'https://mainnet.neardata.xyz/v0';
const REF = 'v2.ref-finance.near';
// NEARDATA RATE-LIMITS BY IP, and a Worker's outbound address is shared with every other Cloudflare tenant
// (measured on the first runs: 429 on 88 of 120 reads at 8 in parallel). So: few in parallel, a 429 waits and
// asks again, and the backfill only runs once the chain head is caught up.
const FWD = 200, BACK = 200, BACKFILL_DAYS = 3, KEEP_DAYS = 30, CONC = 2;
const UA = { 'user-agent': 'LumosCore NEAR pool indexer (+https://lumoscore.com)' };
const pause = (ms) => new Promise((go) => setTimeout(go, ms));

async function getJson(u, tries) {
  tries = tries || 0;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  let r;
  try {
    r = await fetch(u, { headers: UA, redirect: 'follow', signal: ctl.signal });
    if (r.status === 429 && tries < 4) {
      clearTimeout(t);
      const ra = parseFloat(r.headers.get('retry-after') || '') || 0;
      await pause(Math.min(8000, ra > 0 ? ra * 1000 : 800 * Math.pow(2, tries)));
      return getJson(u, tries + 1);
    }
    if (!r.ok) throw new Error(u.split('/v0/')[1] + ' ' + r.status);
    const s = await r.text();
    return s === 'null' ? null : JSON.parse(s);
  } finally { clearTimeout(t); }
}

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

// ---- the chain ---------------------------------------------------------------------------------------
async function headTs(h) {
  for (let k = 0; k < 5; k++) {
    const b = await getJson(ND + '/block/' + (h + k) + '/headers').catch(() => null);
    if (b && b.header) return { h: h + k, ts: Math.floor(Number(b.header.timestamp_nanosec || b.header.timestamp) / 1e6) };
  }
  return null;
}
async function findShard(h) {
  for (let k = 0; k < 10; k++) {
    const b = await getJson(ND + '/block/' + (h - k)).catch(() => null);
    if (!b) continue;
    for (const sh of b.shards || []) for (const ro of sh.receipt_execution_outcomes || []) {
      if (ro.receipt && ro.receipt.receiver_id === REF) return sh.shard_id;
    }
  }
  return null;
}
// A CRON THAT RUNS EVERY MINUTE GETS ABOUT 30 SECONDS. A run that overstays is cut off before it saves, so
// every read is done against a deadline: blocks are read in the given order, nothing new starts after it, and
// the caller moves its cursor only across the unbroken run of blocks that were read, from the start of the list.
async function pmap(list, fn, deadline) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, async () => {
    while (i < list.length && Date.now() < deadline) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}
// Reads the given heights of the shard, in order. Returns rows from the leading unbroken run only, and how
// many heights that run covers (done).
async function scan(hs, shard, t0, t1, deadline) {
  const at = (h) => (t1.h === t0.h ? t1.ts : Math.round(t0.ts + (t1.ts - t0.ts) * (h - t0.h) / (t1.h - t0.h)));
  let sawRef = false; const why = {};
  const per = await pmap(hs, async (h) => {
    let c;
    try { c = await getJson(ND + '/block/' + h + '/shard/' + shard); } catch (e) {
      const k = String((e && e.message) || e).replace(/^block\/\d+\/shard\/\d+ /, '');
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
  return { rows: per.slice(0, done).flat(), done, sawRef, why, failed: per.filter((x, k) => k < per.length && x === null).length };
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
  // Under a minute, so one run is done before the next begins (deployed crons get far more than the
  // local preview's 30 s; measured at 20 s a run could not keep up with the chain).
  const deadline = Date.now() + 50000;
  const last = await getJson(ND + '/last_block/final');
  const head = last.block.header.height;
  const headT = { h: head, ts: Math.floor(Number(last.block.header.timestamp_nanosec || last.block.header.timestamp) / 1e6) };
  const m = await meta(db);
  let shard = m.shard != null ? +m.shard : await findShard(head);
  if (shard == null) throw new Error('could not find the shard of ' + REF);
  const stmts = [setMeta(db, 'shard', shard)];
  let fwd = m.fwd != null ? +m.fwd : head - 1;
  let back = m.back != null ? +m.back : head;
  const start = m.start != null ? +m.start : head;
  const startTs = m.startTs != null ? +m.startTs : headT.ts;
  if (m.start == null) stmts.push(setMeta(db, 'start', start), setMeta(db, 'startTs', startTs));
  const report = { head, shard, fwd: 0, back: 0, rows: 0, failed: 0 };

  // FORWARD
  if (head > fwd) {
    const lo = fwd + 1, hi = Math.min(head, fwd + FWD);
    const t0 = (await headTs(lo)) || headT;
    const hs = []; for (let h = lo; h <= hi; h++) hs.push(h);
    const r = await scan(hs, shard, t0, headT, deadline);
    if (!r.sawRef && r.done > 50) {                        // the shard may have moved
      const s2 = await findShard(head);
      if (s2 != null && s2 !== shard) { stmts.push(setMeta(db, 'shard', s2)); await db.batch(stmts); return Object.assign(report, { reshard: s2 }); }
    }
    await save(db, r.rows);
    // Only across what was read without a gap; the rest is read again next run (rows are keyed, so a re-read
    // is harmless).
    if (r.done) { fwd = lo + r.done - 1; stmts.push(setMeta(db, 'fwd', fwd)); }
    report.fwd = r.done; report.rows += r.rows.length; report.failed += r.failed; report.why = r.why;
  }
  // BACKFILL, down to BACKFILL_DAYS before the first run
  const floorTs = startTs - BACKFILL_DAYS * 86400000;
  const doneBack = m.backDone === '1';
  if (!doneBack && fwd >= head - 10 && Date.now() < deadline - 3000) {   // the present first; history when caught up
    const hi = back - 1, lo = Math.max(0, back - BACK);
    const t0 = await headTs(lo), t1 = await headTs(hi);
    if (t0 && t1) {
      const hs = []; for (let h = hi; h >= lo; h--) hs.push(h);             // newest first, so the cursor walks down
      const r = await scan(hs, shard, t0, t1, deadline);
      await save(db, r.rows);
      if (r.done) {
        back = hi - r.done + 1;
        const bt = Math.round(t0.ts + (t1.ts - t0.ts) * (back - t0.h) / Math.max(1, t1.h - t0.h));
        stmts.push(setMeta(db, 'back', back), setMeta(db, 'backTs', bt));
        if (bt <= floorTs) stmts.push(setMeta(db, 'backDone', '1'));
      }
      report.back = r.done; report.rows += r.rows.length; report.failed += r.failed; report.bwhy = r.why;
    }
  }
  // Pruning, about once an hour
  if (fwd % 3000 < FWD) stmts.push(db.prepare('DELETE FROM txs WHERE ts < ?1').bind(Date.now() - KEEP_DAYS * 86400000));
  await db.batch(stmts);
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
