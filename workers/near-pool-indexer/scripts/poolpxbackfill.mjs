// One-off (2026-11-14): replace the px table's last week for the tokens whose stored hourly price is Rhea's FROZEN
// figure (src/index.js snapPoolPrices explains), with the week their own pool actually had.
//
//   node workers/near-pool-indexer/scripts/poolpxbackfill.mjs        writes poolpx-backfill.sql beside this file
//   npx wrangler d1 execute lumoscore-near-pooltxs --remote --file=workers/near-pool-indexer/scripts/poolpx-backfill.sql
//
// Run it AFTER snapPoolPrices has priced the current hour: each token's series is anchored to that live spot price.
//
// Source: GeckoTerminal's hourly candles for the token's main pool, priced in NEAR (currency=token). A candle exists
// only for an hour with a trade, so each hour takes the last close at or before it -- a pool's price moves only when
// someone swaps. The whole series is then scaled so its newest close equals the pool's spot price now: a fill sits a
// fee away from the spot price (1% on a 10000 pool), and without this the hand-over from candles to the live job
// would read as a 1% move that never happened. Dollars = that NEAR price x NEAR's own stored dollar price that hour.
// Only tokens whose last week holds under 48 distinct dollar prices are touched (a live series has ~168).
// Paced at one GeckoTerminal call per 4 s: this IP is RAZA's browser too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POOLPX } from '../src/poolpx.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IDX = 'https://near-pool-indexer.usa282.workers.dev/prices?ids=';
const GT = 'https://api.geckoterminal.com/api/v2/networks/near/pools/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gt(u) {
  for (let k = 0; k < 5; k++) {
    await sleep(4000);
    const r = await fetch(u, { headers: { accept: 'application/json' } });
    if (r.status === 429) { console.log('  429, waiting 60s'); await sleep(60000); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(u + ' -> ' + r.status);
    return r.json();
  }
  throw new Error(u + ' -> still rate-limited');
}

const ids = Object.keys(POOLPX);
const series = {};
let near = null, H = null;
for (let k = 0; k < ids.length; k += 60) {
  const j = await (await fetch(IDX + ids.slice(k, k + 60).map(encodeURIComponent).join(','))).json();
  if (!j.ok) throw new Error('indexer /prices refused');
  near = j.near; H = j.h;
  Object.assign(series, j.tok);
}
const nearAt = new Map(near.map((x) => [x[0], x[1]]));
const sql = [];
const report = [];
for (const id of ids) {
  const s = series[id] || [];
  const distinct = new Set(s.map((x) => x[1])).size;
  if (distinct >= 48) continue;                                    // a live series: leave it
  const now = s.find((x) => x[0] === H);
  if (!now || !(nearAt.get(H) > 0)) { report.push(id + ': no live pool price this hour yet, skipped'); continue; }
  const spot = now[1] / nearAt.get(H);                             // NEAR per token, from the live job
  const pool = POOLPX[id][0];
  const addr = typeof pool === 'number' ? 'refv1-' + pool : 'refv2-' + pool.split('|').join(':');
  const o = await gt(GT + encodeURIComponent(addr) + '/ohlcv/hour?limit=1000&currency=token&token=' + encodeURIComponent(id));
  const list = ((o && o.data && o.data.attributes.ohlcv_list) || []).map((c) => [Math.floor(c[0] / 3600), +c[4]])
    .filter((c) => c[1] > 0).sort((a, b) => a[0] - b[0]);
  if (!list.length) { report.push(id + ': pool has no candles, skipped'); continue; }
  const scale = spot / list[list.length - 1][1];
  let k = 0, last = null, n = 0;
  for (let h = H - 7 * 24; h < H; h++) {
    while (k < list.length && list[k][0] <= h) last = list[k++][1];
    const nu = nearAt.get(h);
    if (last == null || !(nu > 0)) continue;
    sql.push("INSERT OR REPLACE INTO px (t, h, usd) VALUES ('" + id.replace(/'/g, "''") + "', " + h + ', ' + (last * scale * nu) + ');');
    n++;
  }
  report.push(id + ': ' + n + ' hours (was ' + distinct + ' distinct), last fill x' + scale.toFixed(4) + ' to spot');
}
fs.writeFileSync(path.join(HERE, 'poolpx-backfill.sql'), sql.join('\n') + '\n');
console.log(report.join('\n'));
console.log(sql.length + ' row(s) -> poolpx-backfill.sql');
