// GET /lxapi/neartoken?i=<contract id> — one NEAR token, for the Trade-Asset page (/trade/near/<id>).
//
// WHERE EACH FIGURE COMES FROM, and why it is that source:
//   * price, 24h change, 24h volume, liquidity, trades — for a token the market table lists, the
//     table's OWN row (marketBody from nearmarket.js, same cache entry). The page one click away from
//     a row must not quote a different number for the same token; reading the row is the only way to
//     guarantee that, and it costs the upstreams nothing when the table is warm.
//     For any other token, the same rule the table applies, on this token's own pairs: its busiest
//     DexScreener pair gives volume / liquidity / trades and the change (only when the token is that
//     pair's base, or the quote of a wNEAR pair — see nearmarket.js), and its USD price.
//   * symbol, name, decimals, icon, total supply — the token contract itself (ft_metadata,
//     ft_total_supply), over NEAR RPC. The contract is the authority on what it is called and how
//     many exist; a listing site is not.
//   * pools — every pair DexScreener knows for the token (token-pairs/v1), largest first.
//   * lock — how many FULL-ACCESS keys the contract account holds. A key can redeploy the contract,
//     so keys > 0 means the code can change: locked:false. Zero keys means nobody can redeploy, but it
//     does NOT mean supply is fixed — a contract with no keys can still mint if its code lets it, and
//     that cannot be read from here. So zero keys is locked:null ("can't tell"), never true.
//
// NOT GECKOTERMINAL OR COINGECKO: both answer 429 to Cloudflare's shared egress (measured 2026-10-21).
// The page asks them itself, from the visitor's connection, for the chart.
//
// CACHING follows nearmarket: two minutes fresh per token, the last good answer kept a day and served
// marked stale when a refresh fails, and a failure is NEVER stored. A PARTIAL answer (one source
// refused) is served but not stored either: caching it would show "no supply" for two minutes on the
// strength of one dropped request.
//
// Subrequests per miss: market (0 when warm, 4 cold) + 1 DexScreener + 3 RPC = at most 8.
import { CURATED } from './_nearcurated.js';
import { marketBody } from './nearmarket.js';

const TTL = 120;
const KEEP = 86400;
const WNEAR = 'wrap.near';
const RPC = 'https://free.rpc.fastnear.com';
const PAIRS = 'https://api.dexscreener.com/token-pairs/v1/near/';
const VER = 'v2';   // v2: web, x, desc (2026-10-29)

// NEAR account-id rules (nomicon): 2-64 chars, lowercase alphanumerics separated by single - _ or .,
// no leading/trailing separator. Implicit accounts (64 hex) and eth-implicit (0x + 40 hex) satisfy
// the same pattern, so one test covers all three.
const ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function json(body, status, maxAge) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + (maxAge == null ? 30 : maxAge),
    'access-control-allow-origin': '*' } });
}

async function getJson(u, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  try {
    const r = await fetch(u, Object.assign({ signal: ctl.signal }, opts || {}, {
      headers: Object.assign({ accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' }, (opts || {}).headers || {}) }));
    if (!r.ok) throw new Error(u.split('?')[0] + ' ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// A view call. Resolves { ok:true, v } with the decoded JSON result, { ok:false, none:true } when the
// chain answered that the account or method does not exist (a definitive "no"), or { ok:false } when
// the call itself failed (an outage — which must not be reported as "not a token").
async function view(account, method) {
  try {
    const j = await getJson(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: {
        request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: 'e30=' } }) }, 5000);
    if (j.error || (j.result && j.result.error)) {
      const why = JSON.stringify(j.error || j.result.error);
      return { ok: false, none: /UNKNOWN_ACCOUNT|MethodNotFound|CodeDoesNotExist|does not exist|NO_CONTRACT_CODE/i.test(why) };
    }
    const bytes = (j.result && j.result.result) || [];
    return { ok: true, v: JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) };
  } catch (e) { return { ok: false }; }
}

async function fullAccessKeys(account) {
  try {
    const j = await getJson(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: {
        request_type: 'view_access_key_list', finality: 'final', account_id: account } }) }, 5000);
    if (j.error || !j.result || !Array.isArray(j.result.keys)) return null;
    return j.result.keys.filter((k) => k && k.access_key && k.access_key.permission === 'FullAccess').length;
  } catch (e) { return null; }
}

// Only an image a browser cannot be talked into running script from: a data: image or https url.
function safeLogo(u) {
  u = String(u || '');
  if (u.length > 200000) return '';
  return /^(data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]|https:\/\/)/i.test(u) ? u : '';
}

// A link for an href: https only, no credentials, no quotes or whitespace.
function safeHref(u) {
  u = String(u || '').trim();
  if (!/^https:\/\/[^\s"'<>@]+$/i.test(u) || u.length > 300) return '';
  try { return new URL(u).protocol === 'https:' ? u : ''; } catch (e) { return ''; }
}
function xHref(u) {
  const m = String(u || '').trim().match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i);
  return m ? 'https://x.com/' + m[1] : '';
}

// ONE ASSET, ONE DESCRIPTION, whichever network it is on (RAZA 2026-10-29: "The Text below the Asset
// name should be the same if one asset [is] available on multiple networks"). Keyed by the NEAR
// contract of the issuer's own deployment -- never by symbol, which anyone can copy. The text is the
// issuer's own, as Stellar's page prints it from the issuer's stellar.toml.
const DESC = {
  // Circle's native USDC on NEAR (Stellar: GA5Z...KZVN, desc from circle.com's stellar.toml).
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': 'USDC is a fully collateralized US Dollar stablecoin.',
};

// Plain text, bounded: names and symbols are whatever the contract's deployer chose.
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max || 64);
}

// Decimal string / 10^decimals without losing the integer part to float rounding first.
function scaled(raw, decimals) {
  const s = String(raw || '').replace(/^"|"$/g, '');
  if (!/^\d+$/.test(s)) return null;
  const d = Math.max(0, Math.min(40, +decimals || 0));
  const whole = s.length > d ? s.slice(0, s.length - d) : '0';
  const frac = (s.length > d ? s.slice(s.length - d) : s.padStart(d, '0')).slice(0, 12);
  const v = Number(whole + (frac ? '.' + frac : ''));
  return isFinite(v) ? v : null;
}

function usdOf(p, id) {
  // DexScreener's priceUsd is the BASE token's; a quote token's is base USD / (base in quote).
  const pu = +p.priceUsd, pn = +p.priceNative;
  if (String((p.baseToken || {}).address) === id) return pu > 0 ? pu : null;
  return (pu > 0 && pn > 0) ? pu / pn : null;
}

async function build(id, context) {
  const cur = CURATED.find((c) => c.i === id) || null;
  const [market, pairsRaw, meta, supplyRaw, keys] = await Promise.all([
    marketBody(context).catch(() => null),
    getJson(PAIRS + encodeURIComponent(id), null, 6000).catch(() => null),
    view(id, 'ft_metadata'),
    view(id, 'ft_total_supply'),
    fullAccessKeys(id),
  ]);
  const pairs = Array.isArray(pairsRaw) ? pairsRaw : null;
  let partial = !pairs || !meta.ok || !supplyRaw.ok || keys == null;

  // A definitive "this is not a fungible-token contract" from the chain, and no market anywhere.
  if (!meta.ok && meta.none && pairs && !pairs.length) return { body: { ok: false, error: 'not a token', none: true }, store: false };
  if (!meta.ok && !pairs && !cur) throw new Error('no source answered');

  const m = meta.ok ? (meta.v || {}) : {};
  const decimals = Number.isFinite(+m.decimals) ? +m.decimals : (cur ? cur.d : null);
  const nearUsd = market && market.usd > 0 ? +market.usd : null;
  const near24 = market && market.near24 != null ? +market.near24 : null;
  const row = market && Array.isArray(market.rows) ? market.rows.find((r) => r.i === id) : null;

  // Market figures: the table's row when it has one, otherwise this token's busiest pair.
  let price = null, usd = null, d24 = null, v24 = null, liq = null, trades = null, src = null;
  if (row) {
    price = row.p; usd = nearUsd ? row.p * nearUsd : null; d24 = row.d; v24 = row.v; liq = row.t; trades = row.x;
    src = 'market';
  } else if (id === WNEAR) {
    price = 1; usd = nearUsd; d24 = near24; src = 'unit';
  }
  const own = (pairs || []).filter((p) => p && (String((p.baseToken || {}).address) === id || String((p.quoteToken || {}).address) === id));
  if (!row && own.length) {
    const main = own.slice().sort((a, b) => (+((b.volume || {}).h24) || 0) - (+((a.volume || {}).h24) || 0))[0];
    const u = usdOf(main, id);
    if (u != null && id !== WNEAR) { usd = u; price = nearUsd ? u / nearUsd : null; }
    if (nearUsd) {
      const tx = (main.txns || {}).h24 || {};
      v24 = (+((main.volume || {}).h24) || 0) / nearUsd;
      liq = (+((main.liquidity || {}).usd) || 0) / nearUsd;
      trades = (+tx.buys || 0) + (+tx.sells || 0);
    }
    const ch = (main.priceChange || {}).h24;
    const isBase = String((main.baseToken || {}).address) === id;
    if (ch != null && isFinite(+ch)) {
      if (isBase) d24 = +ch;
      else if (String((main.baseToken || {}).address) === WNEAR && near24 != null) {
        const inv = (100 / (100 + +ch) - 1) * 100;
        d24 = ((1 + inv / 100) * (1 + near24 / 100) - 1) * 100;
      }
    }
    src = 'pairs';
  }
  if (price == null && !partial) partial = true;

  // Identity: the contract first, then the curated list, then whatever the pair listing says.
  const p0 = own[0] || null;
  const side = p0 ? (String(p0.baseToken.address) === id ? p0.baseToken : p0.quoteToken) : {};
  const symbol = clean(m.symbol || (cur && cur.s) || side.symbol || '', 24);
  const name = clean(m.name || (cur && cur.n) || side.name || '', 80);
  const logo = safeLogo(m.icon) || safeLogo(cur && cur.logo)
    || safeLogo(p0 && String((p0.baseToken || {}).address) === id && p0.info && p0.info.imageUrl);
  const supply = supplyRaw.ok && decimals != null ? scaled(supplyRaw.v, decimals) : null;
  // The issuer's site and X profile: baked for curated tokens (_tools/_nearlinks.js), else the token's
  // DexScreener profile.
  const prof = (own.find((p) => String((p.baseToken || {}).address) === id && p.info) || {}).info || {};
  const web = safeHref(cur && cur.w) || safeHref(((prof.websites || [])[0] || {}).url);
  const x = xHref(cur && cur.x) || xHref(((prof.socials || []).find((q) => q && q.type === 'twitter') || {}).url);

  // Pools, largest first. Logos travel once in a map rather than repeated per pool.
  const logos = {};
  const pools = own.slice().sort((a, b) => (+((b.liquidity || {}).usd) || 0) - (+((a.liquidity || {}).usd) || 0))
    .slice(0, 25).map((p) => {
      const b = p.baseToken || {}, q = p.quoteToken || {};
      for (const t of [b, q]) {
        const a = String(t.address || '');
        if (!a || logos[a] !== undefined) continue;
        const c = CURATED.find((x) => x.i === a);
        logos[a] = (a === id ? logo : '') || safeLogo(c && c.logo)
          || (a === String(b.address) ? safeLogo(p.info && p.info.imageUrl) : '');
      }
      const lu = +((p.liquidity || {}).usd) || 0, vu = +((p.volume || {}).h24) || 0;
      return {
        pair: clean(b.symbol, 24) + ' / ' + clean(q.symbol, 24),
        base: { i: String(b.address || ''), s: clean(b.symbol, 24) },
        quote: { i: String(q.address || ''), s: clean(q.symbol, 24) },
        dex: clean(p.dexId, 40),
        liqUsd: lu, volUsd: vu,
        liq: nearUsd ? lu / nearUsd : null, vol: nearUsd ? vu / nearUsd : null,
        id: clean(p.pairAddress, 200),
        url: /^https:\/\/dexscreener\.com\//.test(String(p.url || '')) ? String(p.url) : '',
      };
    });
  for (const k of Object.keys(logos)) if (!logos[k]) delete logos[k];

  const body = {
    ok: true, i: id, symbol, name, decimals, logo, supply,
    price, usd, nearUsd, near24, d24, v24, liquidity: liq, trades24: trades,
    pools, poolCount: own.length, logos,
    curated: !!cur, cg: (cur && cur.cg) || '', web, x, desc: DESC[id] || '',
    lock: { keys, locked: keys == null ? null : (keys > 0 ? false : null) },
    src, at: Date.now(),
  };
  if (partial) body.partial = true;
  return { body, store: !partial };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const id = String(url.searchParams.get('i') || '').trim().toLowerCase();
  if (!ID_RE.test(id)) return json({ ok: false, error: 'invalid contract id' }, 400, 300);

  const cache = caches.default;
  const fresh = new Request('https://lumoscore.internal/lxapi/neartoken/' + VER + '/fresh/' + encodeURIComponent(id));
  const kept = new Request('https://lumoscore.internal/lxapi/neartoken/' + VER + '/kept/' + encodeURIComponent(id));

  const hit = await cache.match(fresh);
  if (hit) return json(await hit.json());

  try {
    const { body, store } = await build(id, context);
    if (store) {
      const put = (req, ttl) => cache.put(req, new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } }));
      context.waitUntil(Promise.all([put(fresh, TTL), put(kept, KEEP)]));
      return json(body);
    }
    // Not stored. A partial answer still beats an older complete one only if there is no older one.
    if (body.ok && body.partial) {
      const old = await cache.match(kept);
      if (old) { const b = await old.json(); b.stale = true; return json(b, 200, 15); }
      return json(body, 200, 15);
    }
    return json(body, 200, 60);
  } catch (e) {
    const old = await cache.match(kept);
    if (old) { const b = await old.json(); b.stale = true; return json(b, 200, 15); }
    return json({ ok: false, error: 'token data unavailable', why: String((e && e.message) || e).slice(0, 200) }, 200, 0);
  }
}
