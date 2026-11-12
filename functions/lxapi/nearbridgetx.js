// GET /lxapi/nearbridgetx — every LumosCore bridge transfer out of NEAR, every wallet, newest first, for the Bridge page's
// Recent transactions (RAZA 2026-11-10, ticket 319: "every wallet's bridge transfers platform-wide, like Stellar").
//
// STELLAR'S LIST IS GLOBAL: /lxapi/bridgetx (C:\LumosCore) keeps every transfer in KV, registered by the sending browser
// and stored only once the ledger agrees. NEAR needs no registry and no write endpoint at all, because every LumosCore
// bridge from NEAR already marks itself on chain: the user's own transaction carries LumosCore's fee as
//   ft_transfer(fees-lumoscore.near, fee, memo "lx:ni" | "lx:om" | "lx:wh")
// beside the transfer itself (browser/nibridge.js, browser/nearbridges.js). FastNEAR's transaction index lists every
// transaction naming fees-lumoscore.near in its arguments, so the list is READ from the chain: nothing a browser says is
// stored, and there is nothing anyone can post to.
//
// WHAT EACH ROW CARRIES, decoded from the signed actions only:
//   ni   the 1Click deposit account (64 hex) and the gross sent; the page asks 1Click for the destination, as it does
//        for its own history (recoverFromChain).
//   om   ft_transfer_call to omni.bridge.near: the recipient ("arb:0x…") names the chain.
//   wh   ft_transfer_call to contract.portalbridge.near: its message names the chain and the receiver. Native NEAR goes
//        to the portal in a transaction of its OWN, before the fee one: it is found among the portal's transactions by
//        the same signer, within ten minutes before the fee, or the row says nothing it cannot read.
// A row's hash is the transaction that moved the tokens, which is what NearBlocks and Wormholescan know it by.
//
// COST: one index call (shared with /lxapi/nearactivity through _nearfeetx.js), then only transactions not decoded before,
// five a call, at most 30 per request; the decoded map is kept a week in one cache entry and the answer a minute. A failure is never cached: the last good answer is kept a day
// and served marked stale.
import { CURATED } from './_nearcurated.js';
import { FEE, WNEAR, post, signed, feeIndex, decodeNew } from './_nearfeetx.js';

const RPC = 'https://free.rpc.fastnear.com';
const OMNI = 'omni.bridge.near', PORTAL = 'contract.portalbridge.near';
const VER = 'v1', TTL = 60, KEEP = 86400, NEWEST = 80, PER_RUN = 30;
const OM_CHAIN = { eth: 'Ethereum', base: 'Base', arb: 'Arbitrum', sol: 'Solana', bnb: 'BNB Chain', pol: 'Polygon' };
const WH_CHAIN = { 2: 'Ethereum', 4: 'BNB Chain', 5: 'Polygon', 6: 'Avalanche', 23: 'Arbitrum', 24: 'Optimism', 30: 'Base' };
const DEC = {};
for (const c of CURATED) DEC[c.i] = { d: c.d, s: c.s };

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + maxAge, 'access-control-allow-origin': '*' } });
}
async function meta(id) {
  if (DEC[id]) return DEC[id];
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: id, method_name: 'ft_metadata', args_base64: 'e30=' } }) });
    const j = await r.json();
    const m = JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    if (Number.isFinite(+m.decimals)) return (DEC[id] = { d: +m.decimals, s: String(m.symbol || '').replace(/[^A-Za-z0-9.$_-]/g, '').slice(0, 16) });
  } catch (e) {}
  return null;
}
function scaled(raw, d) {
  const s = String(raw || '');
  if (!/^[0-9]+$/.test(s) || d == null) return null;
  const whole = s.length > d ? s.slice(0, s.length - d) : '0';
  const frac = (s.length > d ? s.slice(s.length - d) : s.padStart(d, '0')).replace(/0+$/, '');
  return whole + (frac ? '.' + frac : '');
}
const ok64 = (x) => /^[0-9a-f]{64}$/.test(String(x || ''));
// Wormhole names an EVM receiver as 32 bytes, left-padded: the address is the last 20.
function evm(r) { const m = /^(?:0x)?(?:0{24})?([0-9a-f]{40})$/i.exec(String(r || '')); return m ? '0x' + m[1].toLowerCase() : null; }

// One fee transaction -> a row, or null (a swap's fee, a failed transaction, anything not a bridge). Wormhole's native
// leg is looked up later (needs the portal's list).
// Exported: /lxapi/nearactivity draws the same transfers on the Dashboard (RAZA 2026-11-12, ticket 353).
export function decodeBridge(T) { return decode(T); }
function decode(T) {
  const s = signed(T);
  const fee = s.calls.find((c) => c.m === 'ft_transfer' && c.args && c.args.receiver_id === FEE && /^lx:(ni|om|wh)$/.test(c.args.memo || ''));
  if (!fee) return null;
  const route = fee.args.memo.slice(3), token = s.to, native = s.calls.some((c) => c.m === 'near_deposit') && token === WNEAR;
  const row = { hash: s.hash, at: s.ts, from: s.who, route, token, native, fee: String(fee.args.amount || '0') };
  if (route === 'ni') {
    const dep = s.calls.find((c) => c.m === 'ft_transfer' && c.args && ok64(c.args.receiver_id));
    if (!dep) return null;
    row.dep = dep.args.receiver_id; row.carried = String(dep.args.amount || '0');
  } else if (route === 'om') {
    const tc = s.calls.find((c) => c.m === 'ft_transfer_call' && c.args && c.args.receiver_id === OMNI);
    if (!tc) return null;
    let msg = {}; try { msg = JSON.parse(tc.args.msg || '{}'); } catch (e) {}
    const m = /^([a-z]+):(.{1,120})$/.exec(String(msg.recipient || ''));
    row.carried = String(tc.args.amount || '0');
    if (m && OM_CHAIN[m[1]]) { row.chain = OM_CHAIN[m[1]]; row.to = m[2]; }
  } else {
    const tc = s.calls.find((c) => c.m === 'ft_transfer_call' && c.args && c.args.receiver_id === PORTAL);
    if (tc) {
      let msg = {}; try { msg = JSON.parse(tc.args.msg || '{}'); } catch (e) {}
      row.carried = String(tc.args.amount || '0');
      if (WH_CHAIN[msg.chain]) row.chain = WH_CHAIN[msg.chain];
      const to = evm(msg.receiver); if (to) row.to = to;
    } else row.whNative = 1;                      // the transfer is the portal transaction before this one
  }
  return row;
}

// One decoded Wormhole native-NEAR fee row (decode's whNative) given its transfer: tries counted on the row itself.
export async function whLeg(r, h) {
  r.tries = (r.tries || 0) + 1;
  try {
    const own = await post('account', { account_id: r.from });
    const near = ((own && own.account_txs) || []).filter((x) => x.is_success !== false && x.transaction_hash !== h)
      .filter((x) => { const t = Math.floor(Number(x.tx_block_timestamp) / 1e6); return t <= r.at && r.at - t < 600000; })
      .map((x) => x.transaction_hash).slice(0, 5);
    if (!near.length) return;
    const g = await post('transactions', { tx_hashes: near });
    const legs = ((g && g.transactions) || []).map(signed).map((s2) => {
      const c = s2.to === PORTAL && s2.who === r.from && s2.calls.find((x) => x.m === 'send_transfer_near' && x.args);
      return c ? { hash: s2.hash, ts: s2.ts, carried: c.dep, chain: WH_CHAIN[c.args.chain], to: evm(c.args.receiver) } : null;
    }).filter(Boolean).sort((x, y) => y.ts - x.ts);
    const leg = legs[0];
    if (!leg) return;
    r.leg = leg.hash; r.carried = leg.carried; r.native = true;
    if (leg.chain) r.chain = leg.chain;
    if (leg.to) r.to = leg.to;
  } catch (e) {}
}

async function build(cache) {
  const list = (await feeIndex(cache)).filter((x) => x.ok).slice(0, NEWEST)
    .map((x) => ({ h: x.h, transaction_hash: x.h }));
  const D = await decodeNew(cache, 'bridge', list, decode, PER_RUN), map = D.map;

  // Wormhole's native leg: the sender's own transactions in the ten minutes before the fee, and among them the one that
  // called send_transfer_near on the portal (the portal itself is too busy to search). One index call per such transfer,
  // three per request, and given up after four tries.
  const wants = Object.keys(map).filter((h) => map[h] && map[h].whNative && !map[h].leg && !(map[h].tries > 3)).slice(0, 3);
  for (const h of wants) { D.touch(); await whLeg(map[h], h); }

  const rows = [];
  for (const x of list) {
    const r = map[x.transaction_hash];
    if (!r || (r.whNative && !r.leg)) continue;
    const m = r.native ? { d: 24, s: 'NEAR' } : await meta(r.token);
    if (!m) continue;
    const gross = (BigInt(r.fee || '0') + BigInt(r.carried || '0')).toString();
    rows.push({ hash: r.leg || r.hash, feeTx: r.hash, at: r.at, from: r.from, route: r.route, token: r.native ? 'near' : r.token,
      sym: m.s, sent: scaled(gross, m.d), out: r.route === 'ni' ? null : scaled(r.carried, m.d),
      dep: r.dep || null, chain: r.chain || null, to: r.to || null });
  }

  await D.save();
  // Still behind (more new transactions than one run decodes): say so, so the answer is not kept as complete.
  return { body: { ok: true, at: Date.now(), rows, partial: list.some((x) => !(x.transaction_hash in map)) || undefined } };
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/nearbridgetx/' + VER + '/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearbridgetx/' + VER + '/kept');
  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json(), 30);
  try {
    const { body } = await build(cache);
    const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
    context.waitUntil(Promise.all([put(fresh, body.partial ? 5 : TTL), put(kept, KEEP)]));
    return json(body, body.partial ? 5 : 30);
  } catch (e) {
    const old = await cache.match(kept);
    if (old) { const b = await old.json(); b.stale = true; return json(b, 15); }
    return json({ ok: false, error: 'bridge history unavailable' }, 0);
  }
}
