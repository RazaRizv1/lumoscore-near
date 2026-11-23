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
import { nearCuratedSync } from './_netcurated.js';
import { FEE, WNEAR, post, feeIndex, decodeNew } from './_nearfeetx.js';
import { decodeBridge, whLeg } from './nearbridgetx.js';
import { niDelivery } from './nearoneclick.js';
import { readList as lpList } from './nearact.js';

const RPC = 'https://free.rpc.fastnear.com';
const IDX = 'https://near-pool-indexer.usa282.workers.dev';
const NEAR_LOGO = '/assets/networks/near.png';
const VER = 'v2', TTL = 60, KEEP = 86400, N = 15, NEWEST = 40, PER_RUN = 25, META_MAX = 6;
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
  const r = { h: a.h, who: a.me, memo, ts: a.ts, legs: legsOf(T, a.me) };
  if (/^lx:(ni|om|wh)$/.test(memo)) r.br = decodeBridge(T) || 0;      // the transfer itself, read as the Bridge page reads it
  return r;
}

// BRIDGE ROWS AS STELLAR'S CROSS-CHAIN ROWS (RAZA 2026-11-12, ticket 353: "0.1 NEAR → Omni Bridge" is the contract's name,
// not a destination). What was sent, what arrives and on which network, decoded from the transfer: Omni's recipient
// ("arb:0x…") and Wormhole's message name the chain and carry the token itself; NEAR Intents' deposit is asked of 1Click,
// which says what it delivered. A destination nothing has answered for yet is left out of the row, never guessed.
const NI_LABEL = { eth: 'Ethereum', arb: 'Arbitrum', base: 'Base', op: 'Optimism', pol: 'Polygon', avax: 'Avalanche',
  bsc: 'BNB Chain', scroll: 'Scroll', gnosis: 'Gnosis', bera: 'Berachain', monad: 'Monad', plasma: 'Plasma', xlayer: 'X Layer',
  abs: 'Abstract', hood: 'Hood', hypercore: 'Hyperliquid', sol: 'Solana', sui: 'Sui', starknet: 'Starknet', aptos: 'Aptos',
  movement: 'Movement', ton: 'TON', tron: 'Tron', cardano: 'Cardano', btc: 'Bitcoin', ltc: 'Litecoin', doge: 'Dogecoin',
  bch: 'Bitcoin Cash', dash: 'Dash', zec: 'Zcash', aleo: 'Aleo', fogo: 'Fogo', adi: 'ADI', stellar: 'Stellar', xrp: 'XRP Ledger' };
const VIA = { ni: 'NEAR Intents', om: 'Omni Bridge', wh: 'Wormhole' };
const NI_DONE = { SUCCESS: 1, REFUNDED: 1, FAILED: 1 };
const BR_PER_RUN = 4;
const ALL_PER_RUN = 10, ALL_BR_PER_RUN = 2;
async function enrichBridge(r, env) {
  const b = r.br;
  if (!b) return false;
  if (b.whNative && !b.leg && !(b.tries > 3)) { await whLeg(b, b.hash); return true; }
  if (b.route === 'ni' && b.dep && !(b.ni && NI_DONE[b.ni.status]) && !((b.nt || 0) > 8)) {
    b.nt = (b.nt || 0) + 1;
    try { const d = await niDelivery(env, b.dep); if (d) b.ni = d; } catch (e) {}
    return true;
  }
  return false;
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

async function build(cache, env) {
  const list = (await feeIndex(cache)).slice(0, NEWEST);
  // 'activity2': rows decoded before bridge rows carried their transfer are read again once.
  const D = await decodeNew(cache, 'activity2', list, decode, PER_RUN), map = D.map;
  let brAsks = 0;
  for (const x of list.slice(0, N + 5)) {
    const r = map[x.h];
    if (!r || !r.br || brAsks >= BR_PER_RUN) continue;
    if (await enrichBridge(r, env)) { brAsks++; D.touch(); }
  }
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
  // POOL DEPOSITS AND WITHDRAWALS MADE HERE (RAZA 2026-11-13: the LUMOS/ZEC pool he created was missing). They pay no
  // fee, so the index above cannot see them; the site records them (/lxapi/nearact, checked against the chain there)
  // and they join the newest rows, as Stellar's /lxapi/act rows join its feed. An unreadable store adds nothing.
  const lps = ((await lpList(env)) || []).filter((x) => x && x.h && Array.isArray(x.t) && x.t.length).slice(0, N);
  const ids = {};
  lps.forEach((x) => x.t.forEach((t) => { ids[t[1]] = 1; }));
  recs.forEach((r) => { r.legs.forEach((g) => { ids[g.c] = 1; }); if (r.p) ids[r.p.get.c] = 1; if (r.br && !r.br.native) ids[r.br.token] = 1; });
  const meta = await metaFor(Object.keys(ids));
  const leg = (g) => {
    if (!g) return null;
    const m = meta[g.c];
    return { s: m.s, v: m.d == null ? null : units(g.raw, m.d), ic: m.ic, c: g.c };
  };
  const rows = recs.map((r) => {
    const row = { h: r.h, who: r.who, memo: r.memo, ts: r.ts,
      give: leg(r.legs.filter((g) => g.neg)[0]), get: leg(r.p ? r.p.get : r.legs.filter((g) => !g.neg).slice(-1)[0]),
      h2: r.p ? r.p.h : undefined };
    const b = r.br;
    if (b && !(b.whNative && !b.leg)) {
      const tk = b.native ? 'near' : b.token, m = meta[tk];
      if (m && m.d != null) {
        // What was sent: LumosCore's fee and the transfer together, as the Bridge page lists it.
        row.give = { s: m.s, v: units((BigInt(b.fee || '0') + BigInt(b.carried || '0')).toString(), m.d), ic: m.ic, c: tk };
        if (b.leg) row.h = b.leg;
        const x = { via: VIA[b.route] };
        if (b.route === 'ni') {
          if (b.ni && b.ni.sym) { x.s = b.ni.sym; x.v = b.ni.out != null && isFinite(+b.ni.out) ? +b.ni.out : null; x.chain = NI_LABEL[b.ni.chain] || null;
            if (b.ni.status === 'REFUNDED' || b.ni.status === 'FAILED') x.note = b.ni.status === 'REFUNDED' ? 'refunded' : 'failed'; }
        } else {
          x.s = m.s; x.v = units(b.carried || '0', m.d); x.ic = m.ic; x.chain = b.chain || null;
        }
        row.x = x;
        row.get = null;
      }
    }
    return row;
  });
  const feeH = {};
  rows.forEach((r) => { feeH[r.h] = 1; });
  lps.forEach((x) => {
    if (feeH[x.h]) return;
    const lp = x.t.map((t) => { const m = meta[t[1]] || {}; return m.d == null ? null : { s: m.s, v: units(t[0], m.d), ic: m.ic, c: t[1] }; }).filter(Boolean);
    if (!lp.length) return;
    rows.push({ h: x.h, who: x.who, memo: x.k === '-' ? 'lx:lp-' : 'lx:lp+', ts: x.ts, give: lp[0], get: null, lp });
  });
  rows.sort((a, b) => b.ts - a.ts);
  if (rows.length > N) rows.length = N;
  // Not all of the newest transactions decoded yet (a cold start, or more new ones than one run reads): served, not kept.
  const partial = list.some((x) => !(x.h in map));
  return { ok: true, at: Date.now(), rows, partial: partial || undefined };
}

// ?all=1 -- EVERY LumosCore transaction on NEAR, for the admin's volume (RAZA 2026-11-18: "the admin only shows $1.01 of
// cross-chain volume, which is prolly from Stellar" -- NEAR receipts entered the admin with their fee only, so a 6.04 NEAR
// transfer to Arbitrum counted nothing). Same index, same decode() and the SAME decoded map as the feed ('activity2'), so
// neither decodes twice; it fills older rows PER_RUN at a time and says complete:false until it has every one. Each row is
// the token amount the signer paid in (give), or for a bridge what was sent (fee + transfer), with its kind; pricing it
// is the caller's job. Nothing is enriched here (no 1Click or Wormhole asks): the amount sent is on chain already.
async function buildAll(cache, env) {
  const list = await feeIndex(cache);
  // 10 A CALL, NOT THE FEED'S 25: a cold start at 25 answered Cloudflare's error page or ok:false on its first calls
  // (measured on staging 2026-11-18) -- decoding 25 full transactions is past the free plan's per-request CPU. The
  // caller asks again until complete; the map is shared with the feed and kept a week, so this is a once-a-week cost.
  const D = await decodeNew(cache, 'activity2', list, decode, ALL_PER_RUN), map = D.map;
  // A Wormhole transfer of NATIVE NEAR sends the NEAR in its own transaction, before the fee one; until that leg is found
  // the row knows only the fee (0.0002 of a 0.1 NEAR transfer, measured). The feed finds it for its newest rows only, so
  // the older ones are looked up here, a few a request, the same way (enrichBridge -> whLeg).
  // A NEAR Intents transfer can be REFUNDED when its destination leg fails; that moved nothing and is not volume. Its
  // final status is 1Click's answer, asked the same way the feed asks it (enrichBridge -> niDelivery), a few a request.
  let wh = 0, whLeft = 0;
  for (const x of list) {
    const r = map[x.h], b = r && r.br;
    if (!b) continue;
    const needWh = b.whNative && !b.leg && !(b.tries > 3);
    const needNi = b.route === 'ni' && b.dep && !(b.ni && NI_DONE[b.ni.status]) && !((b.nt || 0) > 8);
    if (!needWh && !needNi) continue;
    if (wh < ALL_BR_PER_RUN) { wh++; try { if (await enrichBridge(r, env)) D.touch(); } catch (e) {} }
    if ((b.whNative && !b.leg && !(b.tries > 3)) || (b.route === 'ni' && b.dep && !(b.ni && NI_DONE[b.ni.status]) && !((b.nt || 0) > 8))) whLeft++;
  }
  await D.save();
  const done = list.filter((x) => x.h in map).length;
  const recs = list.filter((x) => x.ok !== false && map[x.h]).map((x) => map[x.h]);
  const ids = {};
  recs.forEach((r) => { if (r.br && r.br.token) ids[r.br.native ? 'near' : r.br.token] = 1; (r.legs || []).forEach((g) => { ids[g.c] = 1; }); });
  const meta = await metaFor(Object.keys(ids));
  const rows = recs.map((r) => {
    const b = r.br;
    let c = null, raw = null, kind = 'swap', via;
    if (b && (b.carried || b.fee)) {
      c = b.native ? 'near' : b.token; raw = (BigInt(b.fee || '0') + BigInt(b.carried || '0')).toString();
      kind = 'bridge'; via = VIA[b.route];
      if (b.ni && (b.ni.status === 'REFUNDED' || b.ni.status === 'FAILED')) kind = 'bridge_' + b.ni.status.toLowerCase();
    } else {
      const g = (r.legs || []).filter((x) => x.neg)[0];
      if (g) { c = g.c; raw = g.raw; }
      if (/^lx:(ni|om|wh)$/.test(r.memo)) { kind = 'bridge'; via = VIA[r.memo.slice(3)]; }
      // Placing a limit order is not traded volume (its fill is, later, and has no row of ours); kept, marked.
      else if (/limit order/i.test(r.memo)) kind = 'limit';
    }
    const m = c ? meta[c] : null;
    return { h: r.h, ts: r.ts, who: r.who, memo: r.memo, kind, via, c, s: m ? m.s : null,
      v: m && m.d != null && raw != null ? units(String(raw).replace(/^-/, ''), m.d) : null };
  }).sort((a, b) => b.ts - a.ts);
  return { ok: true, at: Date.now(), complete: done === list.length && !whLeft, decoded: done, total: list.length,
    bridge_legs_pending: whLeft || undefined, rows };
}

export async function onRequestGet(context) {
  // Admin-curated tokens (RAZA 2026-11-24, _netcurated.js) join the built-in list before anything reads it.
  await nearCuratedSync(context.env, CURATED, (c, on) => { if (on) CUR[c.i] = c; else delete CUR[c.i]; });
  const cache = caches.default;
  if (new URL(context.request.url).searchParams.get('all') === '1') {
    try { const b = await buildAll(cache, context.env); return json(b, b.complete ? 60 : 0); }
    catch (e) { return json({ ok: false, error: 'NEAR activity unavailable' }, 0); }
  }
  const fresh = new Request('https://lumoscore.internal/lxapi/nearactivity/' + VER + '/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearactivity/' + VER + '/kept');
  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json(), 20);
  try {
    const body = await build(cache, context.env);
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
