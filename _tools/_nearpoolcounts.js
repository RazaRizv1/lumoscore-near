// Bake every curated token's pool count on Rhea Finance: _tools/nearpoolcounts.generated.json.
//
//   node _tools/_nearpoolcounts.js          (network: NEAR RPC, ~31 view calls, under a minute)
//
// RAZA 2026-10-30: "can you please verify if the pool counts in trade-asset page is correct? ... on Stellar and
// XRPL we got hundreds of pools for major assets". They were not correct: the page counted the pairs DexScreener
// returns for a token, and DexScreener returns at most 30 -- USDC read "30" while Rhea holds far more. Stellar's
// figure is every liquidity pool holding the asset; on NEAR that is every pool on Rhea's two contracts --
// v2.ref-finance.near (classic, stable and rated pools) and dclv2.ref-labs.near (concentrated liquidity) --
// that has the token as one of its sides.
//
// Two figures per token: `n` every such pool, and `live` the ones holding liquidity right now (both reserves
// above zero, or a DCL pool with liquidity in range). The page shows `live`, the pools you can trade in, with
// `n` in its tooltip.
//
// Read at build time, not per page: the whole set is ~15,000 pools, and parsing it at the edge would cost far
// more than the plan's 10 ms of CPU. Pools are created slowly; re-run before a release.
const fs = require('fs');
const path = require('path');

const RPCS = ['https://free.rpc.fastnear.com', 'https://near.drpc.org'];
const CUR = path.join(__dirname, 'nearcurated.generated.json');
const OUT = path.join(__dirname, 'nearpoolcounts.generated.json');
const PAGE = 500;
// EVERY POOL OF A TOKEN, for its Trade page (RAZA 2026-11-05: "browse all 394 pools for USDC"). The live pool list the
// edge reads holds ~2,500 of Rhea's ~9,000 pools, so USDC read 52 where its count says 394. This whole-chain read is
// the only list that has them all, so each token's live classic pools are written here, one small file per token,
// and the page fetches only its own. Reserves are as of this run, which is enough for the small pools only this file
// knows: the live list wins for every pool it carries. wNEAR is left out: it is every pool's other side.
const POOLS_DIR = path.join(__dirname, '..', 'assets', 'tokenpools');
const PRICES = 'https://indexer.ref.finance/list-token-price';

async function view(account_id, method_name, args) {
  let last;
  for (const u of RPCS) {
    for (let k = 0; k < 3; k++) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final',
            account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') } }) });
        const j = await r.json();
        if (!j.result || !j.result.result) throw new Error(method_name + ': ' + JSON.stringify(j.error || j).slice(0, 160));
        return JSON.parse(Buffer.from(j.result.result).toString());
      } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500)); }
    }
  }
  throw last;
}
async function all(account, method, total) {
  const out = [];
  for (let from = 0; from < total; from += PAGE) {
    const p = await view(account, method, { from_index: from, limit: PAGE });
    if (!Array.isArray(p)) throw new Error(method + ' page ' + from + ': not a list');
    out.push(...p);
  }
  return out;
}

(async () => {
  const tokens = JSON.parse(fs.readFileSync(CUR, 'utf8')).tokens || [];
  const nClassic = Number(await view('v2.ref-finance.near', 'get_number_of_pools', {}));
  const dclMeta = await view('dclv2.ref-labs.near', 'get_metadata', {});
  const nDcl = Number(dclMeta && dclMeta.pool_count);
  if (!(nClassic > 0) || !(nDcl > 0)) throw new Error('pool totals unreadable: ' + nClassic + ' / ' + nDcl);
  const classic = await all('v2.ref-finance.near', 'get_pools', nClassic);
  const dcl = await all('dclv2.ref-labs.near', 'list_pools', nDcl);
  // A short read is a failed read, not fewer pools.
  if (classic.length < nClassic * 0.99 || dcl.length < nDcl * 0.99) throw new Error('short read: ' + classic.length + '/' + nClassic + ', ' + dcl.length + '/' + nDcl);

  const counts = {};
  const bump = (id, live) => { const c = counts[id] || (counts[id] = { n: 0, live: 0 }); c.n++; if (live) c.live++; };
  for (const p of classic) {
    const ids = p.token_account_ids || [], am = p.amounts || [];
    const live = am.length > 0 && am.every((a) => /^\d+$/.test(String(a)) && String(a) !== '0');
    new Set(ids).forEach((id) => bump(id, live));
  }
  for (const p of dcl) {
    const live = String(p.liquidity || '0') !== '0' && String(p.total_x || '0') !== '0' && String(p.total_y || '0') !== '0'
      && String(p.state || 'Running') === 'Running';
    new Set([p.token_x, p.token_y]).forEach((id) => bump(id, live));
  }
  const out = {};
  for (const t of tokens) if (counts[t.i]) out[t.i] = counts[t.i];
  const px = await fetch(PRICES).then((r) => r.json());
  const nearUsd = Number((px['wrap.near'] || {}).price);
  if (!(nearUsd > 0)) throw new Error('no NEAR price');
  const symOf = (id) => { const c = tokens.find((t) => t.i === id); return String((c && c.s) || (px[id] && px[id].symbol) || id.split('.')[0].slice(0, 12)).slice(0, 16); };
  const decOf = (id) => { const c = tokens.find((t) => t.i === id); const d = c && c.d != null ? c.d : (px[id] && px[id].decimal); return d == null ? null : +d; };
  fs.mkdirSync(POOLS_DIR, { recursive: true });
  let files = 0;
  for (const t of tokens) {
    if (t.i === 'wrap.near') continue;
    const rows = [];
    classic.forEach((p, id) => {
      const ids = p.token_account_ids || [], am = p.amounts || [];
      if (ids.indexOf(t.i) < 0 || !am.length || !am.every((a) => /^[0-9]+$/.test(String(a)) && String(a) !== '0')) return;
      // Liquidity in NEAR: a wNEAR side doubled, else reserves x prices when every side is priced, else unknown (null).
      const wi = ids.indexOf('wrap.near');
      let liq = null;
      if (ids.length === 2 && wi >= 0) liq = Number(am[wi]) / 1e24 * 2;
      else {
        let usd = 0;
        ids.forEach((x, k) => { const d = decOf(x), pr = Number((px[x] || {}).price); usd = (usd == null || d == null || !(pr > 0)) ? null : usd + Number(am[k]) / Math.pow(10, d) * pr; });
        if (usd != null) liq = usd / nearUsd;
      }
      // Scam tokens quote absurd prices: such a figure is unknown, not the biggest pool on the page.
      if (liq != null && !(liq < 1e8)) liq = null;
      rows.push([String(id), liq == null ? null : +liq.toPrecision(5), ids.map((x) => [x, symOf(x)])]);
    });
    rows.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    fs.writeFileSync(path.join(POOLS_DIR, t.i + '.json'), JSON.stringify(rows));
    files++;
  }
  console.log('token pool lists: ' + files + ' file(s) -> assets/tokenpools/');
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), classic: classic.length, dcl: dcl.length, counts: out }, null, 1) + '\n');
  console.log('pools read: ' + classic.length + ' classic + ' + dcl.length + ' DCL; ' + Object.keys(out).length + ' of ' + tokens.length + ' curated token(s) counted -> ' + path.basename(OUT));
  tokens.slice(0, 12).forEach((t) => { const c = out[t.i] || { n: 0, live: 0 }; console.log('  ' + t.s.padEnd(12) + String(c.live).padStart(5) + ' live  ' + String(c.n).padStart(5) + ' total'); });
})().catch((e) => { console.error('pool counts failed: ' + e.message); process.exit(1); });
