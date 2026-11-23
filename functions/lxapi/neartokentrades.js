// GET /lxapi/neartokentrades?i=<token contract> — the token's latest swaps on Rhea, read from the chain, newest first,
// up to 50, in the row shape the Trade page's Recent Exchanges already draws (browser/dexasset.js loadTrades):
//   { addr, side: 'buy'|'sell', amt, near, px, t, hash, oth: { v, s } | null }
//
// WHY (RAZA 2026-11-12, "Yes, build it"): HNEAR's page read "No trades in the recent window". The page asks
// GeckoTerminal's /pools/<id>/trades, which only sends the last 24 hours, and HNEAR last traded on 11-05. The chain keeps
// every trade, so this reads it: FastNEAR's transaction index for the TOKEN's own account (every transaction that touched
// the token), then the transactions, decoded once and kept a week (_nearfeetx.js decodeNew, its own map per token).
//
// WHAT A TRADE IS: a successful transaction in which the token moved between the signer (a relayed one unwrapped to the
// account that really acted) and Rhea -- v2.ref-finance.near or dclv2.ref-labs.near -- and the signer ends with more or
// less of it. Amounts are the NEP-141 ft_transfer EVENTS in the receipts, not the call's arguments, because a swap can
// fill less than it asked (and refunds the rest). The other side is the signer's opposite net movement: NEAR and wNEAR
// together give the price in NEAR; another token is named, with no NEAR price. A route that merely passes through the
// token leaves the signer's balance of it unchanged and is not a trade of it.
//
// ONE POOL'S SWAPS (?pool=<Rhea pool id>, RAZA 2026-11-12: the NEAR20 / wNEAR pool page read "No swaps in this pool
// recently"). The same reading, kept to the transactions whose own swap message names that pool: a classic action's
// pool_id, or a DCL Swap's pool_ids. Asked with the pool's own token as i (not wNEAR, whose history is every pool's).
// scanned and total say how much of the token's history that covered, so the page can say what was read.
//
// BUDGET (10 ms CPU, 50 subrequests): one index call, at most PER_RUN new transactions five to a call, two or three
// ft_metadata reads. The answer is kept two minutes. A partial read lists only the unbroken run from the newest down, as
// /lxapi/nearactivity does. A failure is a 200 { ok:false }, never cached, never "no trades".
import { CURATED } from './_nearcurated.js';
import { nearCuratedSync } from './_netcurated.js';
import { WNEAR, post, decodeNew } from './_nearfeetx.js';
import { onRequestGet as nearPools } from './nearpools.js';

const RPC = 'https://free.rpc.fastnear.com';
const REF = 'v2.ref-finance.near', DCL = 'dclv2.ref-labs.near';
const VER = 'v6', TTL = 120, N = 50, NEWEST = 120, PER_RUN = 40;
const ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const CUR = {};
for (const c of CURATED) CUR[c.i] = c;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + maxAge, 'access-control-allow-origin': '*' } });
}
function big(v) { try { return BigInt(String(v)); } catch (e) { return 0n; } }
function actPair(a) { if (typeof a === 'string') return [a, {}]; const k = Object.keys(a || {})[0] || ''; return [k, a[k] || {}]; }
function okOutcome(o) { const s = o && o.status; return !!s && (s.SuccessValue !== undefined || s.SuccessReceiptId !== undefined); }
function nsMs(ts) { const s0 = String(ts || ''); return s0.length > 6 ? +s0.slice(0, s0.length - 6) : 0; }
function units(raw, dec) {
  let s = String(raw == null ? '0' : raw).replace(/^0+/, '') || '0';
  if (!/^[0-9]+$/.test(s) || dec == null) return null;
  if (dec <= 0) return +s;
  while (s.length <= dec) s = '0' + s;
  return +(s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec));
}
function cleanSym(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').slice(0, 24); }

// One transaction -> { h, who, ts, tok: signed raw of the token, oth: { c, raw } } or null when it is no trade of it.
function decoder(token) {
  return function (T) {
    const tx = T.transaction || {}, h = tx.hash || '';
    let me = tx.signer_id || '', acts = tx.actions || [];
    if (acts.length === 1 && actPair(acts[0])[0] === 'Delegate') {
      const da = actPair(acts[0])[1].delegate_action || {};
      me = da.sender_id || me; acts = da.actions || [];
    }
    // The pools this transaction's own swap messages name (classic actions' pool_id, DCL Swap's pool_ids).
    const pools = [];
    for (const a of acts) {
      const p = actPair(a), b = p[1];
      if (p[0] !== 'FunctionCall' || b.method_name !== 'ft_transfer_call') continue;
      try {
        const args = JSON.parse(atob(b.args || '')), m = JSON.parse(String((args && args.msg) || '{}'));
        for (const x of (m.actions || [])) if (x && x.pool_id != null) pools.push(String(x.pool_id));
        for (const x of ((m.Swap && m.Swap.pool_ids) || [])) pools.push(String(x));
      } catch (e) {}
    }
    const net = {}, order = [];
    let viaRhea = false, poolNear = 0n;
    const add = (c, amt) => { if (!(c in net)) { net[c] = 0n; order.push(c); } net[c] += amt; };
    // NEAR that wrap.near paid out for a near_withdraw counts as NEAR received (Rhea unwrapping a swap's output).
    const wd = {};
    for (const r of (T.receipts || [])) {
      const o = (r.execution_outcome && r.execution_outcome.outcome) || {};
      if (o.executor_id !== WNEAR || !okOutcome(o)) continue;
      for (const l of (o.logs || [])) { const w = l.split(' '); if (w.length === 5 && w[0] === 'Withdraw' && w[2] === 'NEAR') wd[w[4] + '|' + w[1]] = 1; }
    }
    for (const r of (T.receipts || [])) {
      const rr = r.receipt || {}, out = (r.execution_outcome && r.execution_outcome.outcome) || {};
      if (!okOutcome(out)) continue;
      const pre = rr.predecessor_id || '', to = rr.receiver_id || '';
      const ra = (rr.receipt && rr.receipt.Action && rr.receipt.Action.actions) || [];
      if (pre !== 'system') for (const a of ra) {
        const p = actPair(a), b = p[1];
        if (pre === me && to !== me) {
          if (p[0] === 'Transfer') add('near', -big(b.deposit));
          else if (p[0] === 'FunctionCall' && to === WNEAR && b.method_name === 'near_deposit') add('near', -big(b.deposit));
        } else if (to === me && pre !== me && p[0] === 'Transfer' && (pre === WNEAR || wd[pre + '|' + b.deposit])) add('near', big(b.deposit));
      }
      const c = out.executor_id || to;
      // A ROUTE'S POOL LEG (RAZA 2026-11-13: "this placeholder asset NEKO in recent activity"). 10 NEKO -> wNEAR -> LUMOS
      // moves no wNEAR in or out of the signer, so the row read "0.11 LUMOS / 10 NEKO" with no price. The classic pool's
      // own log names the leg that traded this token: "Swapped <a> wrap.near for <b> <token>, total fee ..". Summed
      // here, it prices the row in NEAR as the pool traded it.
      if (c === REF) for (const l of (out.logs || [])) {
        const w = l.split(',')[0].split(' ');
        if (w.length !== 6 || w[0] !== 'Swapped' || w[3] !== 'for' || !/^[0-9]+$/.test(w[1]) || !/^[0-9]+$/.test(w[4])) continue;
        if (w[2] === WNEAR && w[5] === token) poolNear += big(w[1]);
        else if (w[2] === token && w[5] === WNEAR) poolNear += big(w[4]);
      }
      for (const l of (out.logs || [])) {
        if (c === WNEAR) {
          const lw = l.split(' ');
          if (/^[0-9]+$/.test(lw[1] || '')) {
            if (lw.length === 6 && lw[0] === 'Transfer' && lw[2] === 'from' && lw[4] === 'to') {
              if (lw[5] === me && lw[3] !== me) add(c, big(lw[1]));
              else if (lw[3] === me && lw[5] !== me) add(c, -big(lw[1]));
            } else if (lw.length === 5 && lw[0] === 'Deposit' && lw[3] === 'to' && lw[4] === me) add(c, big(lw[1]));
            else if (lw.length === 5 && lw[0] === 'Withdraw' && lw[3] === 'from' && lw[4] === me) add(c, -big(lw[1]));
          }
        }
        if (l.indexOf('EVENT_JSON:') !== 0) continue;
        let ev; try { ev = JSON.parse(l.slice(11)); } catch (e) { continue; }
        if (!ev || ev.standard !== 'nep141' || ev.event !== 'ft_transfer' || !ev.data) continue;
        for (const d of [].concat(ev.data)) {
          if (!d) continue;
          const from = d.old_owner_id, dest = d.new_owner_id;
          if (c === token && ((from === me && (dest === REF || dest === DCL)) || (dest === me && (from === REF || from === DCL)))) viaRhea = true;
          if (c === WNEAR) continue;                         // counted from its plain logs above
          if (dest === me && from !== me) add(c, big(d.amount));
          else if (from === me && dest !== me) add(c, -big(d.amount));
        }
      }
    }
    if (!viaRhea || !net[token]) return null;
    const tok = net[token];
    // NEAR and wNEAR are one side; otherwise the largest opposite movement of another token.
    const nearSide = (net.near || 0n) + (net[WNEAR] || 0n);
    let oth = null;
    if (tok > 0n ? nearSide < 0n : nearSide > 0n) oth = { c: 'near', raw: String(nearSide < 0n ? -nearSide : nearSide) };
    else {
      for (const c of order) {
        if (c === token || c === 'near' || c === WNEAR) continue;
        const v = net[c];
        if (!(tok > 0n ? v < 0n : v > 0n)) continue;
        const raw = v < 0n ? -v : v;
        if (!oth || big(oth.raw) < raw) oth = { c, raw: String(raw) };
      }
    }
    // Nothing came back the other way: a limit order resting on DCL, or a transfer Rhea refunded, not a trade.
    if (!oth) return null;
    if (oth.c !== 'near' && poolNear > 0n) oth = { c: 'near', raw: String(poolNear) };
    return { h, who: me, pools, ts: nsMs((T.execution_outcome && T.execution_outcome.block_timestamp) || ''), tok: String(tok), oth };
  };
}

const META = {};
async function ftMeta(id) {
  if (id === 'near' || id === WNEAR) return { s: 'NEAR', d: 24 };
  const k = CUR[id];
  if (k && k.d != null) return { s: cleanSym(k.s) || id, d: +k.d };
  if (META[id] !== undefined) return META[id];
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: id, method_name: 'ft_metadata', args_base64: 'e30=' } }) });
    const j = await r.json();
    const m = JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    META[id] = Number.isFinite(+m.decimals) ? { s: cleanSym(m.symbol) || '?', d: +m.decimals } : null;
  } catch (e) { return null; }                               // not kept: asked again next time
  return META[id];
}

// OLDER TRADES FROM OUR OWN POOL INDEX (RAZA 2026-11-23: "Why this token's recent transactions not showing up" --
// BABYBLACKDRAGON). The chain read above covers the token's newest NEWEST transactions only, and a token whose recent
// history is all transfers (22,574 transactions, the newest 120 none of them swaps) read "No trades found" although it
// last traded on 11-16. near-pool-indexer keeps every Rhea pool swap since it began; the token's pools come from our
// own /lxapi/nearpools, called in-process (GeckoTerminal refuses Cloudflare's servers: live answered 0 rows through it,
// 2026-11-23), GeckoTerminal only if that has none; at most three, by liquidity, newest swaps first. One
// transaction can pass through two of the token's pools; its legs are netted, and a route that leaves the trader's
// balance of the token unchanged is not a trade of it -- the same rule the chain read applies.
const IDX = 'https://near-pool-indexer.usa282.workers.dev';
async function getJson(u, ttl) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { accept: 'application/json' }, cf: { cacheTtl: ttl, cacheEverything: true } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function ownPools(id, ctx) {
  try {
    const r = await nearPools({ request: new Request('https://lumoscore.com/lxapi/nearpools?q=' + encodeURIComponent(id) + '&full=1'),
      env: ctx.env, waitUntil: (p) => { try { ctx.waitUntil(p); } catch (e) {} } });
    const j = await r.json();
    return ((j && j.ok && j.rows) || []).filter((p) => /^\d{1,7}$/.test(String(p.id))).map((p) => ({ id: String(p.id), liq: +p.liq || 0 }));
  } catch (e) { return []; }
}
async function indexerRecs(id, ctx) {
  let pools = await ownPools(id, ctx);
  if (pools.length) pools = pools.sort((a, b) => b.liq - a.liq).slice(0, 3);
  else {
  const g = await getJson('https://api.geckoterminal.com/api/v2/networks/near/tokens/' + encodeURIComponent(id) + '/pools?page=1', 600);
  pools = ((g && g.data) || []).map((p) => {
    const m = /^near_refv1-(\d+)$/.exec(String(p.id || '')); const a = p.attributes || {};
    return m ? { id: m[1], liq: +a.reserve_in_usd || 0 } : null;
  }).filter(Boolean).sort((a, b) => b.liq - a.liq).slice(0, 3);
  }
  const by = {};
  for (const p of pools) {
    const j = await getJson(IDX + '/pool?id=' + p.id + '&kind=swap&limit=' + N, 60);
    for (const x of (j && j.rows) || []) {
      if (!x.tx || (x.ta !== id && x.tb !== id)) continue;
      const r = by[x.tx] || (by[x.tx] = { h: x.tx, who: x.who || '', ts: +x.t || 0, net: 0n, oth: null });
      if (x.tb === id) { r.net += big(x.ab); if (!r.oth && x.ta) r.oth = { c: x.ta, raw: '-' + x.aa }; }
      if (x.ta === id) { r.net -= big(x.aa); if (!r.oth && x.tb) r.oth = { c: x.tb, raw: x.ab }; }
    }
  }
  return Object.keys(by).map((k) => by[k]).filter((r) => r.net !== 0n).map((r) => ({
    h: r.h, who: r.who, ts: r.ts, tok: (r.net < 0n ? '-' + (-r.net).toString() : r.net.toString()),
    oth: r.oth ? { c: r.oth.c === WNEAR ? 'near' : r.oth.c, raw: String(r.oth.raw).replace(/^-/, '') } : null,
  }));
}

async function build(cache, id, pool, ctx) {
  const j = await post('account', { account_id: id });
  if (!j || !Array.isArray(j.account_txs)) throw new Error('fastnear: no index');
  const list = j.account_txs.filter((x) => x && x.transaction_hash)
    .map((x) => ({ h: x.transaction_hash, ok: x.is_success !== false, height: Number(x.tx_block_height) || 0 }))
    .sort((a, b) => b.height - a.height).slice(0, NEWEST);
  const D = await decodeNew(cache, 'trades4/' + id, list.filter((x) => x.ok), decoder(id), PER_RUN), map = D.map;
  await D.save();
  // Only the unbroken run from the newest down: a row past the first undecoded transaction could sit in the wrong place.
  let cut = list.findIndex((x) => x.ok && !(x.h in map));
  if (cut < 0) cut = list.length;
  const recs = list.slice(0, cut).filter((x) => x.ok).map((x) => map[x.h])
    .filter((r) => r && (!pool || (r.pools || []).indexOf(pool) >= 0)).sort((a, b) => b.ts - a.ts).slice(0, N);
  if (!pool && recs.length < N) {
    const seen = {}; for (const r of recs) seen[r.h] = 1;
    for (const r of await indexerRecs(id, ctx)) if (!seen[r.h]) { seen[r.h] = 1; recs.push(r); }
    recs.sort((a, b) => b.ts - a.ts); recs.length = Math.min(recs.length, N);
  }
  const tm = await ftMeta(id);
  if (!tm) throw new Error('token metadata unread');
  const others = {};
  for (const r of recs) if (r.oth && r.oth.c !== 'near') others[r.oth.c] = 1;
  const om = {};
  for (const c of Object.keys(others).slice(0, 3)) om[c] = await ftMeta(c);
  const rows = [];
  for (const r of recs) {
    const sell = r.tok.charAt(0) === '-', amt = units(sell ? r.tok.slice(1) : r.tok, tm.d);
    if (!(amt > 0)) continue;
    let near = null, oth = null;
    if (r.oth && r.oth.c === 'near') near = units(r.oth.raw, 24);
    else if (r.oth) { const m = om[r.oth.c]; oth = { v: m ? units(r.oth.raw, m.d) : null, s: m ? m.s : r.oth.c.slice(0, 12) }; }
    rows.push({ addr: r.who, side: sell ? 'sell' : 'buy', amt, near: near > 0 ? near : null, px: near > 0 ? near / amt : null,
      t: r.ts, hash: /^[A-Za-z0-9]{20,64}$/.test(r.h) ? r.h : '', oth, ...(pool ? { oc: r.oth ? r.oth.c : null } : {}) });
  }
  const partial = list.some((x) => x.ok && !(x.h in map));
  return { ok: true, i: id, pool: pool || undefined, at: Date.now(), rows, partial: partial || undefined,
    scanned: cut, total: Number(j.txs_count) || j.account_txs.length };
}

export async function onRequestGet(context) {
  // Admin-curated tokens (RAZA 2026-11-24, _netcurated.js) join the built-in list before anything reads it.
  await nearCuratedSync(context.env, CURATED, (c, on) => { if (on) CUR[c.i] = c; else delete CUR[c.i]; });
  const id = String(new URL(context.request.url).searchParams.get('i') || '').trim().toLowerCase();
  if (!ID_RE.test(id)) return json({ ok: false, error: 'bad token id' }, 0);
  const pool = String(new URL(context.request.url).searchParams.get('pool') || '');
  if (pool && !/^[0-9]{1,7}$/.test(pool)) return json({ ok: false, error: 'bad pool id' }, 0);
  const cache = caches.default;
  const key = new Request('https://lumoscore.internal/lxapi/neartokentrades/' + VER + '/' + encodeURIComponent(id) + (pool ? '/' + pool : ''));
  const hit = await cache.match(key);
  if (hit) return json(await hit.json(), 30);
  try {
    const body = await build(cache, id, pool, context);
    context.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json',
      'cache-control': 'public, max-age=' + (body.partial ? 5 : TTL) } })));
    return json(body, body.partial ? 5 : 30);
  } catch (e) {
    return json({ ok: false, error: 'trades unavailable' }, 0);
  }
}
