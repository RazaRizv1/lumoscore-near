// Build the curated tokens' website + X links: _tools/nearlinks.generated.json.
//
//   node _tools/_nearlinks.js          (network: CoinGecko, DexScreener; ~8 minutes, paced for free tiers)
//
// RAZA 2026-10-29: the token page should show the issuer's site and X account beside the address, as
// Stellar does ("circle.com" and the X mark). Stellar reads them from the issuer's stellar.toml; NEAR has
// no such record, so they come from the token's CoinGecko entry (homepage, twitter_screen_name) for the 39
// curated tokens that have a coin id, else DexScreener's token profile (websites, socials).
//
// A SEPARATE COMMAND, like _nearcurate.js: it talks to rate-limited third parties, and the build must not
// need the network to succeed. Output is committed; bake_curated.js folds it into the curated module as
// `w` (website) and `x` (X profile url). A token with neither simply shows no links.
const fs = require('fs');
const path = require('path');

const CUR = path.join(__dirname, 'nearcurated.generated.json');
const OUT = path.join(__dirname, 'nearlinks.generated.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The issuer's own links where a token is the same asset LumosCore lists on Stellar, so the two pages
// agree: Stellar takes them from circle.com's stellar.toml (CoinGecko's USDC entry has no X account).
const OVERRIDE = {
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': { w: 'https://circle.com', x: 'https://x.com/circle' },
};

// https only, no credentials, no whitespace or quotes: these land in an href.
// A website is not an X post: THREE's DexScreener "website" was a tweet, and it would have printed as
// "x.com" in the website pill beside the real X mark.
function safeUrl(u) {
  u = String(u || '').trim();
  if (!/^https:\/\/[^\s"'<>@]+$/i.test(u)) return '';
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:' || /(^|\.)(x|twitter)\.com$/i.test(p.hostname)) return '';
    return p.href;
  } catch (e) { return ''; }
}
function xUrl(handleOrUrl) {
  const s = String(handleOrUrl || '').trim();
  if (!s) return '';
  const m = s.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i);
  if (m) return 'https://x.com/' + m[1];
  if (/^[A-Za-z0-9_]{1,15}$/.test(s)) return 'https://x.com/' + s;
  return '';
}

async function getJson(u) {
  for (let k = 0; k < 4; k++) {
    const r = await fetch(u, { headers: { accept: 'application/json' } });
    if (r.status === 429) { await sleep(30000); continue; }
    if (!r.ok) throw new Error(u + ' -> ' + r.status);
    return r.json();
  }
  throw new Error(u + ' -> still rate-limited');
}

(async () => {
  const tokens = JSON.parse(fs.readFileSync(CUR, 'utf8')).tokens || [];
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).links || {}; } catch (e) {}
  const links = {};
  for (const t of tokens) {
    let w = '', x = '';
    if (t.cg) {
      try {
        const j = await getJson('https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(t.cg)
          + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false');
        const L = (j && j.links) || {};
        w = safeUrl(((L.homepage || []).filter(Boolean))[0]);
        x = xUrl(L.twitter_screen_name);
      } catch (e) { console.warn('  coingecko ' + t.cg + ': ' + e.message); }
      await sleep(7000);
    }
    if (!w || !x) {
      try {
        const j = await getJson('https://api.dexscreener.com/tokens/v1/near/' + encodeURIComponent(t.i));
        const p = (Array.isArray(j) ? j : []).find((q) => q && q.baseToken && q.baseToken.address === t.i && q.info);
        if (p) {
          if (!w) w = safeUrl(((p.info.websites || [])[0] || {}).url);
          if (!x) x = xUrl(((p.info.socials || []).find((s) => s && s.type === 'twitter') || {}).url);
        }
      } catch (e) { console.warn('  dexscreener ' + t.i + ': ' + e.message); }
      await sleep(1200);
    }
    // A lookup that failed this run keeps what the last run found, rather than erasing a good link.
    if (!w && prev[t.i] && prev[t.i].w) w = safeUrl(prev[t.i].w);
    if (!x && prev[t.i] && prev[t.i].x) x = prev[t.i].x;
    if (OVERRIDE[t.i]) { w = OVERRIDE[t.i].w || w; x = OVERRIDE[t.i].x || x; }
    if (w || x) links[t.i] = Object.assign(w ? { w } : {}, x ? { x } : {});
    console.log('  ' + (t.s || '').padEnd(12) + (w || '-') + '  ' + (x || '-'));
  }
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), links }, null, 1) + '\n');
  console.log('links: ' + Object.keys(links).length + ' of ' + tokens.length + ' token(s) -> ' + path.basename(OUT));
})().catch((e) => { console.error('links failed: ' + e.message); process.exit(1); });
