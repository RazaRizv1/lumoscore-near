// Build the NEAR urls for sitemap.xml: _tools/nearsitemap.generated.json.
//
//   node _tools/_nearsitemapgen.js          (network: Rhea's indexer; re-run after _nearcurate.js)
//
// WHY. On the four-chain staging build (2026-10-22) the sitemap carried 933 XRPL urls and 8 NEAR ones (the
// hubs). Every NEAR token page and pool page is real and individually titled, and nothing listed them.
//
// WHAT. Stellar's rule and weights (sitemap.xml.js): asset pages at 0.7, pool pages at 0.6, only things that
// trade. Here:
//   * /trade/near/<contract>    every curated token (_tools/nearcurated.generated.json), wNEAR excepted
//                               (it is NEAR itself: the Trade hub's unit, not a row)
//   * /pools/near/id/<pool id>  Rhea classic pools holding at least one curated token with >= $25,000 of
//                               liquidity (reserves x Rhea prices, the computation /lxapi/nearpools uses) —
//                               the same bar the curation uses
//
// BAKED, not fetched per request. NEAR's list is curated and changes only when this is re-run, and a live
// fetch that failed would publish a sitemap with no NEAR pages and no error (the XRPL module's own note).
// The combine (C:\LumosCore-Deploy\chains\near.js) bakes this file into functions/_nearsitemap.js, and
// refuses an empty one.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'nearsitemap.generated.json');
const CURATED = path.join(__dirname, 'nearcurated.generated.json');
const LIQ_MIN = 25000;

async function getJson(u) {
  for (let k = 0; k < 4; k++) {
    const r = await fetch(u, { headers: { accept: 'application/json' } });
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 15000)); continue; }
    if (!r.ok) throw new Error(u + ' -> ' + r.status);
    return r.json();
  }
  throw new Error(u + ' -> still rate-limited');
}

(async () => {
  const tokens = JSON.parse(fs.readFileSync(CURATED, 'utf8')).tokens;
  const curated = new Set(tokens.map((t) => t.i));
  const urls = tokens.filter((t) => t.i !== 'wrap.near')
    .map((t) => ({ path: '/trade/near/' + encodeURIComponent(t.i), priority: '0.7' }));

  const [pools, prices] = await Promise.all([
    getJson('https://indexer.ref.finance/list-top-pools'),
    getJson('https://indexer.ref.finance/list-token-price'),
  ]);
  if (!Array.isArray(pools) || !pools.length) throw new Error('Rhea returned no pools — not writing a sitemap without them');
  const liq = (p) => p.token_account_ids.reduce((sum, t, k) => {
    const x = prices[t];
    if (!x) return sum;
    const v = Number(p.amounts[k] || 0) / Math.pow(10, +x.decimal || 0) * (+x.price || 0);
    return isFinite(v) ? sum + v : sum;
  }, 0);
  const kept = pools.filter((p) => p && /^[0-9]+$/.test(String(p.id))
      && p.token_account_ids.some((t) => curated.has(t)) && liq(p) >= LIQ_MIN)
    .sort((a, b) => liq(b) - liq(a));
  for (const p of kept) urls.push({ path: '/pools/near/id/' + p.id, priority: '0.6' });

  fs.writeFileSync(OUT, JSON.stringify(urls, null, 1) + '\n');
  console.log('near sitemap: ' + (urls.length - kept.length) + ' token page(s) + ' + kept.length
    + ' pool page(s) (>= $' + LIQ_MIN + ' liquidity) -> ' + path.basename(OUT));
})().catch((e) => { console.error('near sitemap failed: ' + e.message); process.exit(1); });
