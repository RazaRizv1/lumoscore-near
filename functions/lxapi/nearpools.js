// GET /lxapi/nearpools — Rhea Finance pools for the NEAR Pools page.
//
//   ?n=100        how many pools, best liquidity first (max 200)
//   ?id=<pool>    one pool by its Rhea pool id (for the pool page)
//   ?token=<id>   only pools holding that token (for a token page's Pools tab)
//
// ONLY POOLS WHOSE EVERY TOKEN IS CURATED. Rhea lists 2,465 pools, most of them a memecoin paired with
// itself or with dust; a pool ranked here is one a reader can trade through on LumosCore, and its
// tokens are ones we vouch for (measured 2026-10-21: 170 qualify).
//
// SOURCES, both reachable from Cloudflare (GeckoTerminal and CoinGecko are not — they 429 it):
//   * Rhea's indexer, list-top-pools — every classic/stable pool with its RESERVES.
//   * Rhea's indexer, list-token-price — USD prices, NEAR's included.
// LIQUIDITY IS COMPUTED, reserves x prices, and not read from either source's own field: Rhea's tvl for
// USDC/wNEAR said $1.46M against reserves of 1.17M USDC + 223K wNEAR ($2.33M), and DexScreener's for
// STNEAR/wNEAR read 4x Rhea's. The reserves are what the pool holds; anyone can check the product.
//   * DexScreener, latest/dex/pairs/near/refv1-<id> (30 a call) — 24h volume and trades. A pool it
//     does not carry keeps volume null, never zero.
//   * Rhea's data service, /api/poollist/<id|id|…>/rolling24hvolume/sum — the 24h volume of every pool
//     DexScreener does not carry (RAZA 2026-10-30: "why aren't volume, fees, and APR calculated for such
//     pools" -- DexScreener lists PAIRS, so every 3- and 4-token stable pool read "—"). Checked against
//     DexScreener the same day on pools both carry: 4512 1.05x, 6494 0.99x, 3514 0.97x, 5470 1.02x.
// Fees earned = volume x the pool's fee; APR = fees x 365 / liquidity. Both null without volume.
//
// Cached like nearmarket: versioned key, 2 minutes fresh, last good kept a day, failures never cached.
import { CURATED } from './_nearcurated.js';

const TTL = 120, KEEP = 86400, VER = 'v2';
const WNEAR = 'wrap.near';
const POOLS = 'https://indexer.ref.finance/list-top-pools';
const PRICES = 'https://indexer.ref.finance/list-token-price';
const PAIRS = 'https://api.dexscreener.com/latest/dex/pairs/near/';
const RHEA_VOL = 'https://api.data-service.ref.finance/api/poollist/';
const META = {};
for (const c of CURATED) META[c.i] = c;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 30 : maxAge),
    'access-control-allow-origin': '*' } });
}
async function getJson(u, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
    if (!r.ok) throw new Error(u.split('?')[0] + ' ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };

async function build() {
  const [pools, prices] = await Promise.all([getJson(POOLS, 8000), getJson(PRICES, 6000)]);
  const nearUsd = num((prices[WNEAR] || {}).price);
  if (!(nearUsd > 0)) throw new Error('no NEAR price');
  if (!Array.isArray(pools) || !pools.length) throw new Error('rhea: no pools');

  const ok = pools.filter((p) => Array.isArray(p.token_account_ids) && p.token_account_ids.length >= 2
    && p.token_account_ids.every((t) => META[t]))
    .slice(0);

  // Rank by computed liquidity first, so the DexScreener calls go to the pools that will be shown.
  const liqOf = (p) => p.token_account_ids.reduce((a, t, k) => { const m = META[t], px = num((prices[t] || {}).price), raw = (p.amounts || [])[k];
    return (a == null || px == null || raw == null || m.d == null) ? null : a + Number(raw) / Math.pow(10, m.d) * px; }, 0) || 0;
  ok.sort((a, b) => liqOf(b) - liqOf(a));
  ok.length = Math.min(ok.length, 200);
  const ids = ok.map((p) => 'refv1-' + p.id);
  const batches = [];
  for (let k = 0; k < ids.length; k += 30) batches.push(ids.slice(k, k + 30));
  const got = await Promise.all(batches.map((b) => getJson(PAIRS + b.join(','), 6000).catch(() => null)));
  const ds = {};
  for (const g of got) for (const p of ((g && g.pairs) || [])) ds[p.pairAddress] = p;
  // Rhea's own 24h volume for the pools DexScreener has no figure for, 80 ids a call (the path is capped at
  // 512 characters). The answer is an array in the order asked. A failed call leaves those pools at null.
  const missing = ok.filter((p) => { const d = ds['refv1-' + p.id]; return !d || num((d.volume || {}).h24) == null; }).map((p) => String(p.id));
  const rheaVol = {};
  const chunks = [];
  for (let k = 0; k < missing.length; k += 80) chunks.push(missing.slice(k, k + 80));
  await Promise.all(chunks.map((c) => getJson(RHEA_VOL + c.join('|') + '/rolling24hvolume/sum', 6000).then((arr) => {
    if (Array.isArray(arr) && arr.length === c.length) c.forEach((id, k) => { const v = num(arr[k]); if (v != null && v >= 0) rheaVol[id] = v; });
  }).catch(() => null)));

  let rows = ok.map((p) => {
    const d = ds['refv1-' + p.id];
    const fee = num(p.total_fee) == null ? null : num(p.total_fee) / 100;   // basis points -> percent
    let liqUsd = 0;
    p.token_account_ids.forEach((t, k) => {
      const m = META[t], px = num((prices[t] || {}).price), raw = (p.amounts || [])[k];
      if (liqUsd == null || px == null || raw == null || m.d == null) { liqUsd = null; return; }
      liqUsd += Number(raw) / Math.pow(10, m.d) * px;
    });
    const dsVol = d ? num((d.volume || {}).h24) : null;
    const volUsd = dsVol != null ? dsVol : (rheaVol[String(p.id)] != null ? rheaVol[String(p.id)] : null);
    const tx = d ? ((d.txns || {}).h24 || {}) : null;
    const feesUsd = (volUsd != null && fee != null) ? volUsd * fee / 100 : null;
    return {
      id: String(p.id),
      kind: String(p.pool_kind || ''),
      tokens: p.token_account_ids.map((t, k) => {
        const m = META[t];
        const raw = (p.amounts || [])[k];
        return { i: t, s: m.s, logo: m.logo || '', v: raw != null && m.d != null ? Number(raw) / Math.pow(10, m.d) : null };
      }),
      fee,
      liq: liqUsd != null ? liqUsd / nearUsd : null,
      vol: volUsd != null ? volUsd / nearUsd : null,
      fees: feesUsd != null ? feesUsd / nearUsd : null,
      apr: (feesUsd != null && liqUsd > 0) ? feesUsd * 365 / liqUsd * 100 : null,
      trades: tx ? (num(tx.buys) || 0) + (num(tx.sells) || 0) : null,
    };
  });

  rows = rows.sort((a, b) => (b.liq || 0) - (a.liq || 0)).slice(0, 200);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return { ok: true, src: 'Rhea Finance indexer, DexScreener, Rhea data service (volume DexScreener lacks)', usd: nearUsd, at: Date.now(),
    // Over the pools in this list, which is what the page shows; not a network-wide total.
    summary: { liquidity: sum('liq'), vol24: sum('vol'), fees24: sum('fees'), pools: rows.length },
    rows };
}

// ---- every Rhea pool, for search and off-list pool pages ------------------------------------------------
// list-top-pools is ~2,500 pools; it is read at most every ten minutes and kept reduced.
const ALL_TTL = 600;
async function allPools(context) {
  const key = new Request('https://lumoscore.internal/lxapi/nearpools/' + VER + '/all');
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const [pools, prices] = await Promise.all([getJson(POOLS, 12000), getJson(PRICES, 6000)]);
  if (!Array.isArray(pools) || !pools.length) throw new Error('rhea: no pools');
  const px = {};
  for (const t in prices) { const p = num((prices[t] || {}).price), d = num((prices[t] || {}).decimal); if (p != null) px[t] = [p, d]; }
  const all = { px, pools: pools.filter((p) => p && /^\d+$/.test(String(p.id)) && Array.isArray(p.token_account_ids)).map((p) => ({
    id: String(p.id), kind: String(p.pool_kind || ''), ids: p.token_account_ids, syms: (p.token_symbols || []).map((s) => String(s || '').slice(0, 32)),
    am: p.amounts || [], fee: num(p.total_fee) })) };
  context.waitUntil(caches.default.put(key, new Response(JSON.stringify(all), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ALL_TTL } })));
  return all;
}
// Decimals, symbol and logo for a token outside the curated table: the token contract itself.
const RPCS = ['https://near.drpc.org', 'https://rpc.mainnet.fastnear.com'];
async function ftMeta(t) {
  for (const u of RPCS) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(u, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final',
          account_id: t, method_name: 'ft_metadata', args_base64: 'e30=' } }) });
      clearTimeout(tm);
      const j = await r.json();
      if (!j || !j.result || !j.result.result) continue;
      const m = JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
      const icon = typeof m.icon === 'string' && m.icon.length <= 12000 && /^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/.test(m.icon) ? m.icon : '';
      return { s: String(m.symbol || '').slice(0, 32), d: num(m.decimals), logo: icon };
    } catch (e) {}
  }
  return null;
}
function offRow(p, all, meta) {
  let liqUsd = 0;
  const tokens = p.ids.map((t, k) => {
    const c = META[t], m = (meta && meta[t]) || null, pr = all.px[t];
    const d = c && c.d != null ? c.d : (pr && pr[1] != null ? pr[1] : (m ? m.d : null));
    const v = d != null && p.am[k] != null ? Number(p.am[k]) / Math.pow(10, d) : null;
    if (liqUsd != null) liqUsd = (v != null && pr) ? liqUsd + v * pr[0] : null;
    return { i: t, s: (c && c.s) || (m && m.s) || p.syms[k] || t, logo: (c && c.logo) || (m && m.logo) || '', v };
  });
  const nearUsd = (all.px[WNEAR] || [])[0];
  return { id: p.id, kind: p.kind, tokens, fee: p.fee == null ? null : p.fee / 100,
    liq: liqUsd != null && nearUsd > 0 ? liqUsd / nearUsd : null, vol: null, fees: null, apr: null, trades: null, listed: false };
}
async function offList(context, body, id) {
  const all = await allPools(context);
  const p = all.pools.find((x) => x.id === id);
  if (!p) return null;
  const meta = {};
  await Promise.all(p.ids.map(async (t) => { if (!META[t]) meta[t] = await ftMeta(t); }));
  const row = offRow(p, all, meta);
  // Rhea's own 24h volume, as the list uses for the pools DexScreener lacks.
  try {
    const arr = await getJson(RHEA_VOL + id + '/rolling24hvolume/sum', 5000);
    const v = Array.isArray(arr) ? num(arr[0]) : null, nearUsd = (all.px[WNEAR] || [])[0];
    if (v != null && v >= 0 && nearUsd > 0) {
      row.vol = v / nearUsd;
      if (row.fee != null) { row.fees = row.vol * row.fee / 100; if (row.liq > 0) row.apr = row.fees * 365 / row.liq * 100; }
    }
  } catch (e) {}
  return row;
}
// Every term must BE one of the pool's token symbols or contract ids -- an exact match, as Stellar's search
// requires an exact asset code: a substring would offer pools of a different token that merely contains the
// letters. Listed pools come back as their list rows, first; the rest as off-list rows, best liquidity first.
async function searchAll(context, body, q) {
  const terms = q.split(/[\s\/,]+/).filter(Boolean).slice(0, 4).map((x) => x === 'near' ? 'wnear' : x);
  const all = await allPools(context);
  const listed = {};
  for (const r of body.rows) listed[r.id] = r;
  const hits = all.pools.filter((p) => {
    const keys = p.ids.map((t, k) => [String(p.syms[k] || '').toLowerCase(), String(t).toLowerCase(), String((META[t] || {}).s || '').toLowerCase()]);
    return terms.every((term) => keys.some((ks) => ks.indexOf(term) >= 0));
  });
  const rows = hits.map((p) => listed[p.id] || offRow(p, all, null));
  rows.sort((a, b) => ((b.listed === false ? 0 : 1) - (a.listed === false ? 0 : 1)) || ((b.liq || 0) - (a.liq || 0)));
  return { ok: true, usd: body.usd, at: Date.now(), q, rows: rows.slice(0, 30), count: Math.min(rows.length, 30), total: rows.length, summary: null };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const n = Math.max(1, Math.min(200, parseInt(url.searchParams.get('n') || '100', 10) || 100));
  const want = url.searchParams.get('id');
  const token = url.searchParams.get('token');

  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/nearpools/' + VER + '/fresh');
  const kept = new Request('https://lumoscore.internal/lxapi/nearpools/' + VER + '/kept');
  let body = null, stale = false;
  const hit = await cache.match(fresh);
  if (hit) body = await hit.json();
  else {
    try {
      body = await build();
      const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
      context.waitUntil(Promise.all([put(fresh, TTL), put(kept, KEEP)]));
    } catch (e) {
      const old = await cache.match(kept);
      if (!old) return json({ ok: false, error: 'pool data unavailable', why: String((e && e.message) || e).slice(0, 200), rows: [] }, 0);
      body = await old.json(); stale = true;
    }
  }

  // OFF THE LIST. A search the curated rows cannot answer, and the page of a pool outside them, read Rhea's
  // whole pool list -- as Stellar's search and pool page reach any pool on its network (RAZA 2026-10-30, a search
  // for "batman" finding nothing although Rhea has a BATMAN/wNEAR pool). Such rows carry listed:false and the
  // pages say so.
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
  if (q) {
    try { return json(await searchAll(context, body, q), 60); }
    catch (e) { return json({ ok: false, error: 'pool search unavailable', why: String((e && e.message) || e).slice(0, 200), rows: [] }, 0); }
  }
  if (want && /^\d{1,9}$/.test(want) && !body.rows.some((r) => r.id === String(want))) {
    try {
      const row = await offList(context, body, String(want));
      return json(Object.assign({}, body, { rows: row ? [row] : [], count: row ? 1 : 0, filteredBy: { id: want }, summary: null }), 60);
    } catch (e) {
      return json({ ok: false, error: 'pool data unavailable', why: String((e && e.message) || e).slice(0, 200), rows: [] }, 0);
    }
  }

  let rows = body.rows;
  if (want) rows = rows.filter((r) => r.id === String(want));
  else if (token) rows = rows.filter((r) => r.tokens.some((t) => t.i === token));
  const out = Object.assign({}, body, { rows: rows.slice(0, want ? 1 : n), count: Math.min(rows.length, want ? 1 : n),
    filteredBy: want ? { id: want } : (token ? { token } : null), stale: stale || undefined });
  if (want || token) out.summary = null;      // a filtered summary is not something this list can honestly state
  return json(out, stale ? 15 : 30);
}
