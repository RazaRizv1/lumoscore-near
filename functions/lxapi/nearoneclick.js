// Cloudflare Pages Function — the bridge's NEAR Intents (1Click) route, proxied. NEAR BUILD.
//
// Ported from the XRPL fork's functions/lxapi/xrploneclick.js. The differences are ALL consequences of the
// origin chain, and each was measured against the live API on 2026-10-22 rather than assumed:
//
//   1. depositMode is SIMPLE. A dry quote from nep141:17208628… (USDC on NEAR) with depositMode MEMO is
//      refused with HTTP 400 "Incorrect depositMode"; SIMPLE (and omitting the field) answers 201. So a
//      NEAR transfer is an ft_transfer to a per-quote deposit account, with no memo for a user to omit.
//   2. depositType ORIGIN_CHAIN: the deposit address is an account ON NEAR that the tokens are sent to with
//      an ordinary ft_transfer. (INTENTS would mean the funds already sit inside intents.near, which a
//      wallet balance does not.)
//   3. The origin is a NEP-141 token on chain `near`, and only one the LumosCore curated list carries.
//      1Click lists NO native NEAR on chain `near` -- only nep141:wrap.near -- so the page wraps NEAR into
//      wNEAR inside the same transaction and deposits the wNEAR. That decision lives in the client; this
//      file simply never sees a "native NEAR" asset id, because there is none.
//   4. refundTo is a NEAR account, refundType ORIGIN_CHAIN: a refund lands back in the paying wallet.
//   5. deposit/submit carries nearSenderAccount, which 1Click's own request model documents as "used
//      only for NEAR blockchain".
//
// WHY A PROXY, unchanged from Stellar and XRPL: 1Click is reachable from a browser, but the partner key --
// which lowers 1Click's fee -- must never ship in a page. It lives only in the Pages env as ONECLICK_JWT,
// is added here as X-API-Key, and is never echoed, logged or returned. Without it the calls still work at
// 1Click's keyless fee.
//
// WHAT IS LET THROUGH, so an open endpoint cannot be turned into a general relay:
//   origin      = a nep141 token on chain `near` that is ALSO on the curated NEAR list
//   deposit     = ORIGIN_CHAIN, SIMPLE mode
//   refund      = ORIGIN_CHAIN, to a NEAR account
//   recipient   = DESTINATION_CHAIN, shape-checked per destination family
//   destination = a chain in CHAINS (every chain 1Click offers except `near`, the origin)
//   no appFees  (LumosCore takes its 0.2% on NEAR before the deposit, in the same transaction)
//
// ops:  GET  ?op=tokens                        -> origins + destination tokens (edge-cached 10 min)
//       POST ?op=quote                         -> 1Click /v0/quote (validated as above; dry or live)
//       GET  ?op=status&depositAddress=…       -> 1Click /v0/status
//       POST ?op=submit                        -> 1Click /v0/deposit/submit {txHash, depositAddress, nearSenderAccount}
//       GET  ?op=logo&id=…                     -> a CoinGecko logo for a token beyond the shipped set
//
// NEVER CACHE A FAILURE AS AN ANSWER: only a 200 token list is stored (in memory and at the edge); a
// failed upstream read answers 502 and is asked again next time.
import { CURATED } from './_nearcurated.js';
import { nearCuratedSync } from './_netcurated.js';

const API = 'https://1click.chaindefuser.com/v0';
const TIMEOUT_MS = 12000;

// THE DESTINATION WHITELIST: every chain 1Click served on a live /tokens read of 2026-10-22, except `near`
// (the origin -- NEAR to NEAR is not a bridge) and `qtc` (new upstream, not yet checked here; an unknown
// chain is dropped rather than offered, which is the safe direction). It is the XRPL fork's list with
// `near` taken out and `xrp` put in: on XRPL `xrp` was the origin, here it is a destination.
//
// MUST MATCH NI_CHAIN in _tools/browser/nibridge.js. _tools/_nearintents.js fails the build when the two
// disagree: on the Stellar build the two lists drifting apart surfaced as "0 ASSETS" in the picker and a
// quote failure per missing chain, never as an error.
const CHAINS = {
  // EVM-family, confirmed by the presence of 0x-contract tokens on each in the live list
  arb: 1, avax: 1, base: 1, bera: 1, bsc: 1, eth: 1, gnosis: 1, hood: 1, hypercore: 1,
  monad: 1, op: 1, plasma: 1, pol: 1, scroll: 1, xlayer: 1, abs: 1,
  // non-EVM
  aleo: 1, aptos: 1, bch: 1, btc: 1, cardano: 1, dash: 1, doge: 1, fogo: 1, ltc: 1,
  movement: 1, sol: 1, starknet: 1, sui: 1, ton: 1, tron: 1, zec: 1, adi: 1,
  // The other two LumosCore chains, both ordinary 1Click destinations.
  stellar: 1, xrp: 1,
};

// The curated NEAR roster, by contract. A token not on it is not offered as an origin, however many
// chains 1Click would take it to -- the same rule every other NEAR surface applies.
const CURATED_IDS = new Set((CURATED || []).map((c) => c && c.i).filter(Boolean));

// A NEAR account id: named (alice.near, sub.alice.near) or implicit (64 hex, or 0x + 40 hex).
const NEAR_RE = /^(?:[0-9a-f]{64}|0x[0-9a-f]{40}|(?:(?:[a-z\d]+[-_])*[a-z\d]+\.)*(?:[a-z\d]+[-_])*[a-z\d]+)$/;
function nearOk(a) { const s = String(a || ''); return s.length >= 2 && s.length <= 64 && NEAR_RE.test(s); }
// A NEAR transaction hash: base58 of 32 bytes.
const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

// RECIPIENT SHAPE PER DESTINATION FAMILY. Carried over from XRPL with its lesson intact: this stops an open
// endpoint relaying junk; it is not the authority on address formats. 1Click validates against the real
// chain and says so ("recipient is not valid").
const EVM_FAMILY = { arb: 1, avax: 1, base: 1, bera: 1, bsc: 1, eth: 1, gnosis: 1, hood: 1,
  hypercore: 1, monad: 1, op: 1, plasma: 1, pol: 1, scroll: 1, xlayer: 1, abs: 1 };
const ADDR_RE = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  fogo: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  stellar: /^G[A-Z2-7]{55}$/,
  xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  ton: /^[UE]Q[A-Za-z0-9_-]{46}$/,
  sui: /^0x[0-9a-fA-F]{64}$/,
  aptos: /^0x[0-9a-fA-F]{1,64}$/,
  movement: /^0x[0-9a-fA-F]{1,64}$/,
  starknet: /^0x[0-9a-fA-F]{1,64}$/,
  aleo: /^aleo1[0-9a-z]{50,70}$/,
  cardano: /^(?:addr1[0-9a-z]{20,110}|[1-9A-HJ-NP-Za-km-z]{50,120})$/,
  btc: /^(?:bc1[0-9a-z]{20,80}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/,
  ltc: /^(?:ltc1[0-9a-z]{20,80}|[LM3][1-9A-HJ-NP-Za-km-z]{25,39})$/,
  doge: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,39}$/,
  dash: /^X[1-9A-HJ-NP-Za-km-z]{25,39}$/,
  bch: /^(?:(?:bitcoincash:)?[qp][0-9a-z]{38,58}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/,
  zec: /^(?:t1|t3)[1-9A-HJ-NP-Za-km-z]{25,39}$/,
};
const ADDR_GENERIC = /^[A-Za-z0-9:._-]{20,120}$/;
function recipientOk(chain, addr) {
  const a = String(addr || '');
  if (!a) return false;
  const re = EVM_FAMILY[chain] ? ADDR_RE.evm : ADDR_RE[chain];
  return re ? re.test(a) : ADDR_GENERIC.test(a);
}

function json(body, status, ttl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': ttl ? ('public, max-age=0, s-maxage=' + ttl) : 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
function headers(env) {
  const h = { 'content-type': 'application/json', accept: 'application/json' };
  if (env && env.ONECLICK_JWT) h['X-API-Key'] = env.ONECLICK_JWT;   // never echoed, never logged
  return h;
}
async function call(env, path, init) {
  const r = await fetch(API + path, Object.assign(
    { headers: headers(env), signal: AbortSignal.timeout(TIMEOUT_MS) }, init || {}));
  let body = null; try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body };
}

// The origin's contract: nep141:<contract>, or 1Click's `1cs_v1:near:nep141:<contract>` form (ZEC and QTC on
// 2026-10-22). Verified the same day that the latter deposits exactly like the plain form: a live quote
// for 1cs_v1:near:nep141:zec.omft.near returned a 64-hex NEAR deposit account and no memo, so it is an
// ft_transfer of the contract's token like any other. (Its plain nep141: id is refused by /quote.)
function originContract(t) {
  const m = /^(?:1cs_v1:near:)?nep141:(.+)$/.exec(String((t && t.assetId) || ''));
  return m ? m[1] : '';
}

let TOKENS = null, TOKENS_AT = 0, NATIVES = null, ORIGINS = null;
async function tokens(env) {
  if (TOKENS && Date.now() - TOKENS_AT < 600000) return TOKENS;
  const r = await call(env, '/tokens', { method: 'GET' });
  if (r.status !== 200 || !Array.isArray(r.body)) throw new Error('token list unavailable');
  const nat = {};
  for (const t of r.body) {
    if (t && !t.contractAddress && t.coingeckoId && t.symbol) nat[t.symbol + '|' + t.coingeckoId] = t.blockchain;
  }
  const shape = (t) => ({ assetId: t.assetId, blockchain: t.blockchain, symbol: t.symbol, decimals: t.decimals,
    price: t.price, contractAddress: t.contractAddress || null, coingeckoId: t.coingeckoId || null });
  const list = r.body
    .filter((t) => t && CHAINS[t.blockchain] && !/DEPRECATED/i.test(t.symbol || ''))
    .map(shape);
  const curated = new Map((CURATED || []).map((c) => [c.i, c]));
  // One origin per contract: 1Click lists some tokens more than once (ZEC twice on 2026-10-22). A plain
  // nep141: entry wins over a 1cs_v1 one for the same contract.
  const byContract = new Map();
  for (const t of r.body) {
    if (!t || t.blockchain !== 'near' || !CURATED_IDS.has(originContract(t))) continue;
    const k = originContract(t), had = byContract.get(k);
    if (!had || (/^1cs_v1:/.test(had.assetId) && /^nep141:/.test(t.assetId))) byContract.set(k, t);
  }
  const origins = [...byContract.values()]
    .map((t) => {
      const c = curated.get(originContract(t)) || {};
      const o = shape(t);
      o.contract = originContract(t);
      o.name = String(c.n || '').slice(0, 60);
      // Only an image the browser cannot execute: an https url or an inline data:image. The curated
      // list's logos come from on-chain ft_metadata, which anyone writes.
      const lg = String(c.logo || '');
      o.logo = /^(https:\/\/|data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)[;,])/i.test(lg) && lg.length < 60000 ? lg : '';
      return o;
    });
  NATIVES = nat; TOKENS = list; ORIGINS = origins; TOKENS_AT = Date.now();
  return TOKENS;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
}

// ---- logos for tokens beyond the shipped set (unchanged from XRPL) ---------------------------------
function rasterType(b) {
  if (b.length < 12) return '';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}
async function logo(request, id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id || '')) return new Response('bad id', { status: 400 });
  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + '/lxapi/nearoneclick?op=logo&id=' + id);
  const hit = await cache.match(key); if (hit) return hit;
  const c = await fetch('https://api.coingecko.com/api/v3/coins/' + id
    + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false',
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!c.ok) return new Response('no logo', { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
  const j = await c.json().catch(() => null);
  const url = j && j.image && (j.image.large || j.image.small);
  if (!url || !/^https:\/\//.test(url)) return new Response('no logo', { status: 404 });
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const buf = new Uint8Array(await r.arrayBuffer());
  const type = rasterType(buf);
  if (!r.ok || !type || buf.length > 2 * 1024 * 1024) return new Response('no logo', { status: 404 });
  const res = new Response(buf, { status: 200, headers: { 'content-type': type,
    'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'", 'access-control-allow-origin': '*' } });
  try { await cache.put(key, res.clone()); } catch (e) {}
  return res;
}

// Stored through the Cache API (a Pages Function response is not kept on the strength of s-maxage
// alone -- measured on the XRPL build). Only a 200 is ever stored.
async function cachedTokens(request, env, waitUntil) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + '/lxapi/nearoneclick?op=tokens');
  const hit = await cache.match(key);
  if (hit) return hit;
  const list = await tokens(env);
  const res = json({ ok: 1, keyed: !!(env && env.ONECLICK_JWT), origins: ORIGINS || [], tokens: list,
    natives: NATIVES || {} }, 200, 600);
  try { const put = cache.put(key, res.clone()); if (waitUntil) waitUntil(put); else await put; } catch (e) {}
  return res;
}

// WHERE ONE DEPOSIT WENT (RAZA 2026-11-12, ticket 353: the Dashboard's bridge rows name the delivered token, amount and
// network, as Stellar's do). 1Click's status for the deposit account, its destination asset looked up in the token list.
// Resolves { status, sym, out, chain } -- chain is 1Click's id (arb, stellar...) -- or null when 1Click does not know it.
export async function niDelivery(env, dep) {
  if (!nearOk(dep)) return null;
  const r = await call(env, '/status?depositAddress=' + encodeURIComponent(dep), { method: 'GET' });
  if (r.status !== 200 || !r.body) throw new Error('status ' + r.status);
  const qr = r.body.quoteResponse, req = qr && qr.quoteRequest;
  if (!req || !req.destinationAsset) return null;
  const list = await tokens(env);
  const t = list.find((x) => x.assetId === req.destinationAsset) || null;
  const sd = r.body.swapDetails || {}, q = qr.quote || {};
  return { status: String(r.body.status || ''), sym: t ? t.symbol : '', chain: t ? t.blockchain : '',
    out: sd.amountOutFormatted || q.amountOutFormatted || null };
}

export async function onRequestGet({ request, env, waitUntil }) {
  // Admin-curated tokens (RAZA 2026-11-24, _netcurated.js) join the built-in list before anything reads it.
  await nearCuratedSync(env, CURATED, (c, on) => { if (on) CURATED_IDS.add(c.i); else CURATED_IDS.delete(c.i); });
  const q = new URL(request.url).searchParams;
  const op = q.get('op');
  try {
    if (op === 'logo') return await logo(request, q.get('id'));
    if (op === 'tokens') return await cachedTokens(request, env, waitUntil);
    if (op === 'status') {
      const a = (q.get('depositAddress') || '').trim();
      if (!nearOk(a)) return json({ ok: 0, error: 'bad deposit address' }, 400);
      const r = await call(env, '/status?depositAddress=' + encodeURIComponent(a), { method: 'GET' });
      return json(r.body || { ok: 0 }, r.status);
    }
    return json({ ok: 0, error: 'unknown op' }, 400);
  } catch (e) { return json({ ok: 0, error: 'NEAR Intents unreachable' }, 502); }
}

export async function onRequestPost({ request, env }) {
  const op = new URL(request.url).searchParams.get('op');
  let b; try { b = await request.json(); } catch (e) { return json({ ok: 0, error: 'bad request' }, 400); }
  if (!b || typeof b !== 'object') return json({ ok: 0, error: 'bad request' }, 400);
  try {
    if (op === 'quote') {
      const list = await tokens(env);
      const origin = (ORIGINS || []).find((t) => t.assetId === b.originAsset);
      const dest = list.find((t) => t.assetId === b.destinationAsset);
      if (!origin) return json({ ok: 0, error: 'origin must be a curated token on NEAR' }, 400);
      if (!dest || !CHAINS[dest.blockchain]) return json({ ok: 0, error: 'unsupported destination asset' }, 400);
      if (!/^[0-9]{1,40}$/.test(String(b.amount || '')) || /^0+$/.test(String(b.amount))) {
        return json({ ok: 0, error: 'bad amount' }, 400);
      }
      if (!nearOk(b.refundTo)) return json({ ok: 0, error: 'refund must be a NEAR account' }, 400);
      if (!recipientOk(dest.blockchain, b.recipient)) {
        return json({ ok: 0, error: 'recipient does not look like a ' + dest.blockchain + ' address' }, 400);
      }
      const slip = Math.max(10, Math.min(300, parseInt(b.slippageTolerance, 10) || 100));   // 0.1%..3%
      const body = {
        dry: !!b.dry, swapType: 'EXACT_INPUT', slippageTolerance: slip,
        originAsset: origin.assetId, depositType: 'ORIGIN_CHAIN',
        // SIMPLE: MEMO answers 400 "Incorrect depositMode" for a NEAR origin (measured). See the header.
        depositMode: 'SIMPLE',
        destinationAsset: dest.assetId, amount: String(b.amount),
        refundTo: b.refundTo, refundType: 'ORIGIN_CHAIN',
        recipient: b.recipient, recipientType: 'DESTINATION_CHAIN',
        referral: 'lumoscore',
        deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
      const r = await call(env, '/quote', { method: 'POST', body: JSON.stringify(body) });
      const out = r.body || {};
      if (out && typeof out === 'object') out.keyed = !!(env && env.ONECLICK_JWT);
      return json(out, r.status);
    }
    if (op === 'submit') {
      if (!HASH_RE.test(b.txHash || '') || !nearOk(b.depositAddress) || !nearOk(b.nearSenderAccount)) {
        return json({ ok: 0, error: 'bad submit' }, 400);
      }
      const r = await call(env, '/deposit/submit', { method: 'POST',
        body: JSON.stringify({ txHash: b.txHash, depositAddress: b.depositAddress,
          nearSenderAccount: b.nearSenderAccount }) });
      return json(r.body || { ok: 0 }, r.status);
    }
    return json({ ok: 0, error: 'unknown op' }, 400);
  } catch (e) { return json({ ok: 0, error: 'NEAR Intents unreachable' }, 502); }
}
