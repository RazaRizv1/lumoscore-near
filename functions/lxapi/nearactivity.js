// GET /lxapi/nearactivity — the Dashboard's Platform Activity on NEAR: the newest 15 LumosCore writes, platform-wide,
// already in the shape dashboard.js's actRow() draws: { h, who, memo, ts, give: {s, v, ic}, get: {s, v, ic} }.
//
// WHY ON THE EDGE (RAZA 2026-11-11): the page read FastNEAR's transaction index from the visitor's browser -- an index
// call, three transaction calls and token metadata -- and FastNEAR often refuses his IP, so the box sat on "Couldn't load
// platform activity just now" for minutes. Stellar's and XRPL's appear at once. Here one edge read serves every visitor
// for a minute, and the last good answer is kept a day for when FastNEAR refuses the edge too.
//
// THE SAME READING AS THE PAGE'S (browser/nearcore.js platformActivity, feeMemo, decodeTx, withMeta), ported line for
// line: a transaction counts when it pays LumosCore's fee -- an ft_transfer to fees-lumoscore.near (its memo names the
// kind) or, since 2026-11-10, a fee-slice swap whose msg sends its output to that account -- and it succeeded. Its token
// movements are netted per token from the SIGNER's side out of the receipts' NEP-141 events, wrap.near's plain logs and
// NEAR transfers; give is the first outflow, get the last inflow.
//
// Decoded transactions are kept a week in one cache entry (_nearfeetx.js, shared index read with /lxapi/nearbridgetx).
// Logos: the curated list's when it is a url or our own /assets path, else the pool indexer's /icon url -- never a data:
// icon, which can be 50 KB a token. A failure is never cached and never answers "no activity": it is a 200 {ok:false}.
import { CURATED } from './_nearcurated.js';
import { FEE, WNEAR, post, feeIndex, decodeNew } from './_nearfeetx.js';

const RPC = 'https://free.rpc.fastnear.com';
const IDX = 'https://near-pool-indexer.usa282.workers.dev';
const NEAR_LOGO = '/assets/networks/near.png';
const VER = 'v1', TTL = 60, KEEP = 86400, N = 15, NEWEST = 40, PER_RUN = 25, META_MAX = 6;
const CUR = {};
for (const c of CURATED) CUR[c.i] = c;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + maxAge, 'access-control-allow-origin': '*' } });
}
function big(v) { try { return BigInt(String(v)); } catch (e) { return BigInt(0); } }
function actPair(a) { if (typeof a === 'string') return [a, {}]; const k = Object.keys(a || {})[0] || ''; return [k, a[k] || {}]; }
function okOutcome(o) { const s = o && o.status; return !!s && (s.SuccessValue !== undefined || s.SuccessReceiptId !== undefined); }
function nsMs(ts) { const s0 = String(ts || ''); return s0.length > 6 ? +s0.slice(0, s0.length - 6) : 0; }
function units(raw, dec) {
  let s = String(raw == null ? '0' : raw).replace(/^0+/, '') || '0';
  if (!/^[0-9]+$/.test(s)) return 0;
  dec = +dec || 0;
  if (dec <= 0) return +s;
  while (s.length <= dec) s = '0' + s;
  return +(s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec));
}
function cleanSym(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').slice(0, 24); }
function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

// feeMemo, as nearcore.js: the fee transfer's memo, or the fee-slice swap's own label.
function feeMemo(acts) {
  let memo = '';
  (acts || []).forEach((a) => {
    const p = actPair(a), b = p[1];
    if (p[0] !== 'FunctionCall' || memo) return;
    try {
      const j = JSON.parse(atob(b.args || ''));
      if (b.method_name === 'ft_transfer' && j && j.receiver_id === FEE) memo = String(j.memo || 'fee');
      else if (b.method_name === 'ft_transfer_call' && j && JSON.parse(j.msg || '{}').swap_out_recipient === FEE) memo = 'LumosCore platform fee';
    } catch (e) {}
  });
  return memo;
}

// decodeTx, as nearcore.js, for the signer: -> { h, who, memo, ts, legs: [{ neg, raw, c }] }, or null when the
// transaction pays no fee of ours.
function actor(T) {
  const tx = T.transaction || {};
  let me = tx.signer_id || '', acts = tx.actions || [];
  if (acts.length === 1 && actPair(acts[0])[0] === 'Delegate') {
    const da = actPair(acts[0])[1].delegate_action || {};
    me = da.sender_id || me; acts = da.actions || [];
  }
  return { h: tx.hash || '', me, acts, ts: nsMs((T.execution_outcome && T.execution_outcome.block_timestamp) || '') };
}
function decode(T) {
  const a = actor(T);
  const memo = feeMemo(a.acts);
  if (!memo) return null;
  return { h: a.h, who: a.me, memo, ts: a.ts, legs: legsOf(T, a.me) };
}
// The signer's token movements in one transaction, netted per token, in the order first seen.
function legsOf(T, me) {
  const net = {}, order = [];
  function add(c, amt) { if (!(c in net)) { net[c] = BigInt(0); order.push(c); } net[c] += amt; }
  const wd = {};
  (T.receipts || []).forEach((r) => {
    const o = (r.execution_outcome && r.execution_outcome.outcome) || {};
    if (o.executor_id !== WNEAR || !okOutcome(o)) return;
    (o.logs || []).forEach((l) => { const w = l.split(' '); if (w.length === 5 && w[0] === 'Withdraw' && w[2] === 'NEAR') wd[w[4] + '|' + w[1]] = 1; });
  });
  (T.receipts || []).forEach((r) => {
    const rr = r.receipt || {}, out = (r.execution_outcome && r.execution_outcome.outcome) || {};
    if (!okOutcome(out)) return;
    const pre = rr.predecessor_id || '', to = rr.receiver_id || '';
    const ra = (rr.receipt && rr.receipt.Action && rr.receipt.Action.actions) || [];
    if (pre !== 'system') ra.forEach((a) => {
      const p = actPair(a), b = p[1];
      if (pre === me && to !== me) {
        if (p[0] === 'Transfer') add('near', -big(b.deposit));
        else if (p[0] === 'FunctionCall' && to === WNEAR && b.method_name === 'near_deposit') add('near', -big(b.deposit));
      } else if (to === me && pre !== me && p[0] === 'Transfer' && (pre === WNEAR || wd[pre + '|' + b.deposit])) {
        add('near', big(b.deposit));
      }
    });
    const token = out.executor_id || to;
    (out.logs || []).forEach((l) => {
      if (token === WNEAR) {
        const lw = l.split(' ');
        if (!/^\d+$/.test(lw[1] || '')) return;
        if (lw.length === 6 && lw[0] === 'Transfer' && lw[2] === 'from' && lw[4] === 'to') {
          if (lw[5] === me && lw[3] !== me) add(token, big(lw[1]));
          else if (lw[3] === me && lw[5] !== me) add(token, -big(lw[1]));
        } else if (lw.length === 5 && lw[0] === 'Deposit' && lw[3] === 'to' && lw[4] === me) add(token, big(lw[1]));
        else if (lw.length === 5 && lw[0] === 'Withdraw' && lw[3] === 'from' && lw[4] === me) add(token, -big(lw[1]));
        if (l.indexOf('EVENT_JSON:') !== 0) return;
      }
      if (l.indexOf('EVENT_JSON:') !== 0) return;
      let ev; try { ev = JSON.parse(l.slice(11)); } catch (e) { return; }
      if (!ev || ev.standard !== 'nep141' || !ev.data) return;
      [].concat(ev.data).forEach((d) => {
        if (!d) return;
        if (ev.event === 'ft_transfer') {
          if (d.new_owner_id === me && d.old_owner_id !== me) add(token, big(d.amount));
          else if (d.old_owner_id === me && d.new_owner_id !== me) add(token, -big(d.amount));
        } else if (ev.event === 'ft_mint' && d.owner_id === me) add(token, big(d.amount));
        else if (ev.event === 'ft_burn' && d.owner_id === me) add(token, -big(d.amount));
      });
    });
  });
  const legs = [];
  order.forEach((c) => {
    const v = net[c];
    if (v === BigInt(0)) return;
    const neg = v < BigInt(0);
    if (c === 'near' && (neg ? -v : v) < BigInt('1000000000000000000')) return;   // dust, not a payment
    legs.push({ neg, raw: String(neg ? -v : v), c });
  });
  return legs;
}

// ONE SWAP, TWO TRANSACTIONS (RAZA 2026-11-12, ticket 347: "0.247512 GEAR → 0.00086206 wNEAR" where he swapped GEAR to
// NEARLY). A route through a hub token on two contracts is two swaps in a row (nearswap.js route.split): X to the hub,
// which carries our fee, then the hub to Y, which carries neither fee nor marker. Collapsed into one row the way
// Stellar shows a path payment, and only when it cannot be someone else's swap: the SAME signer, within PAIR_MS after,
// paying no fee of ours, spending the hub token the first leg delivered and no more of it than that, and receiving
// another token. Looked up as Wormhole's native leg is (nearbridgetx.js): the signer's own transactions just after.
// Until it is found the row shows the first leg as before; after PAIR_TRIES asks, or once PAIR_GIVEUP has passed, it
// stops asking and stays a one-leg row.
const HUBS = { 'wrap.near': 1, '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': 1, 'usdt.tether-token.near': 1 };
const PAIR_MS = 90000, PAIR_TRIES = 4, PAIR_GIVEUP = 900000, PAIR_PER_RUN = 3;
function hubOut(r) {
  if (!r || /^lx:|limit order/i.test(r.memo)) return null;
  const outs = r.legs.filter((g) => g.neg), ins = r.legs.filter((g) => !g.neg), last = ins[ins.length - 1];
  if (!outs.length || !last || !HUBS[last.c] || HUBS[outs[0].c] || ins.some((g) => !HUBS[g.c])) return null;
  return last;
}
async function findSecond(r) {
  const hub = hubOut(r);
  const own = await post('account', { account_id: r.who });
  const hs = ((own && own.account_txs) || []).filter((x) => x && x.is_success !== false && x.transaction_hash !== r.h)
    .filter((x) => { const t = Math.floor(Number(x.tx_block_timestamp) / 1e6); return t > r.ts && t - r.ts <= PAIR_MS; })
    .map((x) => x.transaction_hash).slice(0, 5);
  if (!hs.length) return null;
  const g = await post('transactions', { tx_hashes: hs });
  const cands = ((g && g.transactions) || []).map((T) => ({ T, a: actor(T) }))
    .filter((x) => x.a.me === r.who && !feeMemo(x.a.acts)).sort((x, y) => x.a.ts - y.a.ts);
  for (const x of cands) {
    const legs = legsOf(x.T, r.who);
    const spent = legs.filter((l) => l.neg && l.c === hub.c)[0];
    const got = legs.filter((l) => !l.neg && l.c !== hub.c);
    if (!spent || !got.length || BigInt(spent.raw) > BigInt(hub.raw)) continue;
    if (legs.some((l) => l.neg && l.c !== hub.c && !(l.c === 'near'))) continue;   // it spent something else too: not this
    return { h: x.a.h, get: got[got.length - 1] };
  }
  return null;
}

// withMeta, as nearcore.js: NEAR and wNEAR known, the curated list next, ft_metadata for the rest (a few a request; one
// unanswered shows its contract and no amount, as the page does).
const META = {};
async function ftMeta(id) {
  if (META[id] !== undefined) return META[id];
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: id, method_name: 'ft_metadata', args_base64: 'e30=' } }) });
    const j = await r.json();
    const m = JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    META[id] = Number.isFinite(+m.decimals) ? { s: cleanSym(m.symbol) || '?', d: +m.decimals } : null;
  } catch (e) { return null; }
  return META[id];
}
function logoOf(c) {
  const l = String((CUR[c] && CUR[c].logo) || '');
  if (/^(https:[/][/]|[/]assets[/])/.test(l) && l.length < 400) return l;
  return IDX + '/icon?v=2&t=' + encodeURIComponent(c);
}
async function metaFor(ids) {
  const out = {};
  let asked = 0;
  for (const c of ids) {
    if (c === 'near') { out[c] = { s: 'NEAR', d: 24, ic: NEAR_LOGO }; continue; }
    if (c === WNEAR) { out[c] = { s: 'wNEAR', d: 24, ic: NEAR_LOGO }; continue; }
    const k = CUR[c];
    if (k && k.d != null) { out[c] = { s: cleanSym(k.s) || short(c), d: +k.d, ic: logoOf(c) }; continue; }
    const m = (META[c] !== undefined || asked++ < META_MAX) ? await ftMeta(c) : null;
    out[c] = m ? { s: m.s, d: m.d, ic: logoOf(c) } : { s: short(c), d: null, ic: '' };
  }
  return out;
}

async function build(cache) {
  const list = (await feeIndex(cache)).slice(0, NEWEST);
  const D = await decodeNew(cache, 'activity', list, decode, PER_RUN), map = D.map;
  // The second legs, for the newest rows only, a few asks a request.
  let asks = 0;
  for (const x of list.slice(0, N + 5)) {
    const r = map[x.h];
    if (!r || r.p !== undefined || !hubOut(r) || asks >= PAIR_PER_RUN) continue;
    asks++;
    try {
      const two = await findSecond(r);
      if (two) r.p = two;
      else if ((r.pt = (r.pt || 0) + 1) >= PAIR_TRIES || Date.now() - r.ts > PAIR_GIVEUP) r.p = 0;
    } catch (e) {}
    D.touch();
  }
  await D.save();
  const okBy = {};
  list.forEach((x) => { okBy[x.h] = x.ok; });
  // Newest first, as the page sorts; a failed write moved nothing.
  // Only the unbroken run from the newest down (RAZA 2026-11-11, measured cold: a partial answer listed 11-06 bridges
  // above an undecoded 11-10 swap). Rows past the first undecoded transaction would sit in the wrong place.
  let cut = list.findIndex((x) => !(x.h in map));
  if (cut < 0) cut = list.length;
  const recs = list.slice(0, cut).map((x) => map[x.h]).filter((r) => r && okBy[r.h] !== false).sort((a, b) => b.ts - a.ts).slice(0, N);
  const ids = {};
  recs.forEach((r) => { r.legs.forEach((g) => { ids[g.c] = 1; }); if (r.p) ids[r.p.get.c] = 1; });
  const meta = await metaFor(Object.keys(ids));
  const leg = (g) => {
    if (!g) return null;
    const m = meta[g.c];
    return { s: m.s, v: m.d == null ? null : units(g.raw, m.d), ic: m.ic, c: g.c };
  };
  const rows = recs.map((r) => ({ h: r.h, who: r.who, memo: r.memo, ts: r.ts,
    give: leg(r.legs.filter((g) => g.neg)[0]), get: leg(r.p ? r.p.get : r.legs.filter((g) => !g.neg).slice(-1)[0]),
    h2: r.p ? r.p.h : undefined }));
  // Not all of the newest transactions decoded yet (a cold start, or more new ones than one run reads): served, not kept.
  const partial = list.some((x) => !(x.h in map));
  return { ok: true, at: Date.now(), rows, partial: partial || undefined };
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/nearactivity/' + VER + '/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearactivity/' + VER + '/kept');
  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json(), 20);
  try {
    const body = await build(cache);
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    // A partial answer is kept for seconds, and only replaces the day-long copy when there is none.
    const keptRes = await cache.match(kept), keptHas = !!keptRes;
    // While a cold start is still decoding, the last complete answer is better than a short one.
    if (body.partial && keptHas) return json(Object.assign(await keptRes.json(), { stale: true }), 5);
    context.waitUntil(Promise.all([put(fresh, body.partial ? 5 : TTL), (!body.partial || !keptHas) ? put(kept, KEEP) : null]));
    return json(body, body.partial ? 5 : 20);
  } catch (e) {
    const old = await cache.match(kept);
    if (old) { const b = await old.json(); b.stale = true; return json(b, 15); }
    return json({ ok: false, error: 'platform activity unavailable' }, 0);
  }
}
