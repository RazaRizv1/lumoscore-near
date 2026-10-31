// One-off: fill the px table's last 7 days for the tokens CoinGecko does not list, so the Trade page's day
// high/low and 7-day curve do not wait a week for the hourly snapshot (src/index.js snapPrices) to build them.
//
//   node workers/near-pool-indexer/scripts/pxbackfill.mjs            writes px-backfill.sql beside this file
//   npx wrangler d1 execute lumoscore-near-pooltxs --remote --file=workers/near-pool-indexer/scripts/px-backfill.sql
//
// GeckoTerminal: the token's top pool, then that pool's hourly candles priced in the token. Candles exist only for
// hours with a trade, so each hour takes the last close at or before it (the price did not move without a trade);
// an hour before the first known close is left empty. INSERT OR IGNORE: a live snapshot already taken wins.
// Paced at one call per 2.5 s (GeckoTerminal allows 30 a minute per IP, and this IP is RAZA's browser too).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const GT = 'https://api.geckoterminal.com/api/v2/networks/near';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(u) {
  for (let k = 0; k < 4; k++) {
    await sleep(2500);
    const r = await fetch(u, { headers: { accept: 'application/json' } });
    if (r.status === 429) { await sleep(30000); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(u + ' -> ' + r.status);
    return r.json();
  }
  throw new Error(u + ' -> still rate-limited');
}

const curated = JSON.parse(fs.readFileSync(path.join(ROOT, '_tools', 'nearcurated.generated.json'), 'utf8')).tokens;
// Token ids on the command line backfill just those (a token curated after the first run, 2026-11-01).
// "token@pool" names the GeckoTerminal pool when its token lookup has none (v2-nearx.stader-labs.near@refv1-3688).
const ARGS = process.argv.slice(2);
const ids = ARGS.length ? ARGS : ['wrap.near'].concat(curated.filter((t) => !t.cg && t.i !== 'wrap.near').map((t) => t.i));
const now = Math.floor(Date.now() / 3600000), from = now - 7 * 24;
const sql = [];
let filled = 0;
for (const arg of ids) {
  const id = arg.split('@')[0], given = arg.split('@')[1];
  try {
    let addr = given;
    if (!addr) {
      const tok = await get(GT + '/tokens/' + encodeURIComponent(id));
      const pool = tok && tok.data && tok.data.relationships && tok.data.relationships.top_pools.data[0];
      if (!pool) { console.log('  ' + id + ': no pool on GeckoTerminal'); continue; }
      addr = pool.id.replace(/^near_/, '');
    }
    const o = await get(GT + '/pools/' + encodeURIComponent(addr) + '/ohlcv/hour?limit=1000&currency=usd&token=' + encodeURIComponent(id));
    const list = ((o && o.data && o.data.attributes.ohlcv_list) || []).map((c) => [Math.floor(c[0] / 3600), +c[4]])
      .filter((c) => c[1] > 0).sort((a, b) => a[0] - b[0]);
    let k = 0, last = null, n = 0;
    for (let h = from; h < now; h++) {
      while (k < list.length && list[k][0] <= h) last = list[k++][1];
      if (last == null) continue;
      sql.push("INSERT OR IGNORE INTO px (t, h, usd) VALUES ('" + id.replace(/'/g, "''") + "', " + h + ', ' + last + ');');
      n++;
    }
    sql.push("INSERT INTO pxwatch (t, seen) VALUES ('" + id.replace(/'/g, "''") + "', " + now + ') ON CONFLICT(t) DO UPDATE SET seen = ' + now + ';');
    if (n) filled++;
    console.log('  ' + id.slice(0, 44).padEnd(46) + n + ' hours from ' + list.length + ' candles (' + addr.slice(0, 40) + ')');
  } catch (e) { console.log('  ' + id + ': ' + e.message); }
}
const OUT = path.join(HERE, 'px-backfill.sql');
fs.writeFileSync(OUT, sql.join('\n') + '\n');
console.log(filled + ' of ' + ids.length + ' token(s) filled -> ' + OUT);
