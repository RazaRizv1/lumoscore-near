// Build the curated NEAR token list: _tools/nearcurated.generated.json.
//
//   node _tools/_nearcurate.js          (network: NEAR RPC, Rhea's indexer, GeckoTerminal)
//
// A SEPARATE COMMAND ON PURPOSE, like the XRPL fork's _xrplpoolpairs.js: it talks to rate-limited third
// parties, and a build that must reach the network to succeed fails for reasons unrelated to building.
// The output is committed and read by the build; re-run it to refresh the list.
//
// THE RULE (RAZA, 2026-10-21: "curate the top 100 and credible ones and with high volume"), in three
// passes, as the scope doc records:
//   1. VOLUME — 24h volume on Rhea Finance only, summed over every Rhea pool a token is in. Most NEAR
//      volume runs through NEAR Intents, which is cross-chain settlement, not trading we can route;
//      ranking by it would list ZEC and ETH. Rhea is where a LumosCore trade executes.
//   2. RHEA'S WHITELIST — get_whitelisted_tokens on v2.ref-finance.near. A token Rhea itself does not
//      whitelist is not one we vouch for.
//   3. A HUMAN PASS — EXCLUDE below takes contract ids that pass 1 and 2 but should not be vouched
//      for; REVIEW in the output lists the ones a person has not looked at yet.
// wNEAR (wrap.near) is NEAR itself on Rhea and is always included, first.
//
// Each entry: { i: contract id, s: symbol, n: name, d: decimals, logo, st: 1 for a stablecoin, v: 24h
// Rhea volume in USD at generation time (for ordering only — live figures come from /lxapi/nearmarket) }.
// Logos: a data: URL from the token's own metadata, or an https url; anything else is dropped, never
// rendered. A logo larger than 24KB is dropped too — it would be inlined into every response.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'nearcurated.generated.json');
const RPC = 'https://free.rpc.fastnear.com';
const MAX = 100;
const STABLES = new Set(['USDC', 'USDT', 'USDC.E', 'USDT.E', 'DAI', 'FRAX', 'USN', 'CUSD', 'USDCE', 'USDTE']);
// Contract ids that pass volume + whitelist but must not be vouched for. Empty until a person decides.
const EXCLUDE = new Set([]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function view(account_id, method_name, args) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final',
      account_id, method_name, args_base64: Buffer.from(JSON.stringify(args || {})).toString('base64') } }) });
  const d = await r.json();
  if (!d.result || !d.result.result) throw new Error(method_name + ': ' + JSON.stringify(d.error || d.result).slice(0, 200));
  return JSON.parse(Buffer.from(d.result.result).toString());
}
async function getJson(u, tries) {
  for (let k = 0; k <= (tries || 3); k++) {
    const r = await fetch(u, { headers: { accept: 'application/json' } });
    if (r.status === 429) { await sleep(15000); continue; }
    if (!r.ok) throw new Error(u + ' -> ' + r.status);
    return r.json();
  }
  throw new Error(u + ' -> still rate-limited');
}
function safeLogo(icon) {
  if (typeof icon !== 'string' || icon.length > 24 * 1024) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)(;base64)?,/i.test(icon)) return icon;
  if (/^https:\/\/[^\s"'<>]+$/i.test(icon)) return icon;
  return '';
}

(async () => {
  const white = new Set(await view('v2.ref-finance.near', 'get_whitelisted_tokens', {}));
  console.log('rhea whitelist: ' + white.size + ' token(s)');

  // Rhea 24h volume per token, from GeckoTerminal's Rhea pools, best-volume first.
  const vol = {};
  // GeckoTerminal serves only the top 100 pools (five pages of 20; page 6 answers HTTP 500, measured
  // 2026-10-21). Those 100 are where the traded volume is, so a later page failing ends the scan.
  for (let page = 1; page <= 10; page++) {
    let j;
    try { j = await getJson('https://api.geckoterminal.com/api/v2/networks/near/dexes/rhea-finance/pools?sort=h24_volume_usd_desc&page=' + page); }
    catch (e) { if (page === 1) throw e; console.log('  gecko page ' + page + ': end (' + e.message.split(' -> ')[1] + ')'); break; }
    const rows = j.data || [];
    for (const p of rows) {
      const v = +((p.attributes.volume_usd || {}).h24 || 0);
      for (const side of ['base_token', 'quote_token']) {
        const id = String(((p.relationships[side] || {}).data || {}).id || '').replace(/^near_/, '');
        if (id) vol[id] = (vol[id] || 0) + v;
      }
    }
    process.stdout.write('  gecko page ' + page + ': ' + rows.length + ' pool(s)\n');
    if (rows.length < 20) break;
    await sleep(2500);
  }

  const ranked = Object.keys(vol).filter((id) => white.has(id) && !EXCLUDE.has(id))
    .sort((a, b) => vol[b] - vol[a]);
  if (ranked.indexOf('wrap.near') > 0) ranked.splice(ranked.indexOf('wrap.near'), 1);
  if (ranked[0] !== 'wrap.near') ranked.unshift('wrap.near');
  const pick = ranked.slice(0, MAX);

  const out = [];
  for (const id of pick) {
    let md;
    try { md = await view(id, 'ft_metadata', {}); } catch (e) { console.warn('  skip ' + id + ': no ft_metadata'); continue; }
    const sym = String(md.symbol || '').slice(0, 16);
    out.push({ i: id, s: sym, n: String(md.name || sym).slice(0, 48), d: +md.decimals || 0,
      logo: safeLogo(md.icon), st: STABLES.has(sym.toUpperCase()) ? 1 : 0, v: Math.round(vol[id] || 0) });
    await sleep(120);
  }
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), rule: 'rhea 24h volume x rhea whitelist',
    REVIEW: 'not yet reviewed by a person', tokens: out }, null, 1) + '\n');
  console.log('curated: ' + out.length + ' token(s) -> ' + path.basename(OUT));
  out.slice(0, 15).forEach((t, k) => console.log('  #' + (k + 1) + ' ' + t.s.padEnd(10) + ' ' + t.i.padEnd(52) + ' $' + t.v + (t.logo ? '' : '  (no logo)')));
})().catch((e) => { console.error('curate failed: ' + e.message); process.exit(1); });
