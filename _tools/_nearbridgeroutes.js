// Which curated NEAR tokens Omni Bridge and Wormhole can carry, and to which chains.
//
// RUN BY HAND, like _nearholdercounts.js: `node _tools/_nearbridgeroutes.js`, then the build. It writes
// _tools/nearbridgeroutes.generated.json, which _nearintents.js stamps into the bridge page, so the page
// offers a route without asking two bridges and seven EVM chains on every visit. The page still asks the
// live question at send time (Omni's fee API prices the transfer; Wormhole's wrapped asset is re-read on
// the destination before a claim), so a stale table can only hide a route, never send one that fails.
//
// OMNI (omni.bridge.near): get_bridged_token({chain, address:"near:<id>"}) answers the token's address on
//   that chain, or nothing when it is not deployed there. get_token_decimals gives what the amount is
//   normalised to on the way, so the page can floor the amount to a figure that survives it.
// WORMHOLE (contract.portalbridge.near, NEAR chain id 15): a NEAR token's Wormhole address is
//   sha256(account id); native NEAR is 32 zero bytes. TokenBridge.wrappedAsset(15, addr) on the
//   destination is the wrapped token, or address(0) when nobody has attested it there -- and a transfer
//   of an unattested token cannot be claimed, so those are left out.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NRPC = 'https://free.rpc.fastnear.com';
const OUT = path.join(__dirname, 'nearbridgeroutes.generated.json');
const CUR = JSON.parse(fs.readFileSync(path.join(__dirname, 'nearcurated.generated.json'), 'utf8')).tokens;

// Omni's chain kinds, named as the bridge page names its destinations (NI_CHAIN labels in nibridge.js).
const OMNI = { Eth: 'Ethereum', Base: 'Base', Arb: 'Arbitrum', Sol: 'Solana', Bnb: 'BNB Chain', Pol: 'Polygon' };
// Wormhole TokenBridge per EVM chain, each confirmed by its own chainId() before it is trusted.
const WH = {
  Ethereum: { id: 2, tb: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', rpc: 'https://ethereum-rpc.publicnode.com' },
  'BNB Chain': { id: 4, tb: '0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7', rpc: 'https://bsc-rpc.publicnode.com' },
  Polygon: { id: 5, tb: '0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  Avalanche: { id: 6, tb: '0x0e082F06FF657D94310cB8cE8B0D9a04541d8052', rpc: 'https://avalanche-c-chain-rpc.publicnode.com' },
  Arbitrum: { id: 23, tb: '0x0b2402144Bb366A632D14B83F244D2e0e21bD39c', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  Optimism: { id: 24, tb: '0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b', rpc: 'https://optimism-rpc.publicnode.com' },
  Base: { id: 30, tb: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627', rpc: 'https://base-rpc.publicnode.com' },
};

// PACED, because FastNEAR's free tier is per IP and this machine is also RAZA's browser: a burst here
// rate-limits the live site for him. One call every 250ms, and a 429 waits and asks again.
const sleep = (ms) => new Promise((go) => setTimeout(go, ms));
async function view(c, m, a, tries) {
  tries = tries || 0;
  await sleep(250);
  const r = await fetch(NRPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function',
      finality: 'final', account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') } }) });
  const j = await r.json();
  if (j.error && j.error.code === -429 && tries < 6) { await sleep(3000 * (tries + 1)); return view(c, m, a, tries + 1); }
  if (j.error) throw new Error(m + ': ' + JSON.stringify(j.error).slice(0, 160));
  if (!j.result || !j.result.result) return { missing: String((j.result && j.result.error) || '') };
  return { v: JSON.parse(Buffer.from(j.result.result).toString()) };
}
async function ethCall(c, data) {
  const r = await fetch(c.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c.tb, data }, 'latest'] }) });
  const j = await r.json();
  if (!j.result) throw new Error('eth_call ' + c.tb + ': ' + JSON.stringify(j.error).slice(0, 120));
  return j.result;
}
const hex32 = (n) => n.toString(16).padStart(64, '0');
// A token too small to matter is kept; a data: logo is kept only when small, the rest fall back to letters.
// A TOKEN'S LOGO, in the order the rest of the NEAR build uses (RAZA 2026-10-30: "in source assets dropdown,
// some assets dont have their logos" -- NINU, DARK, XRHEA): the curated logo, then the fallback list the Trade
// pages already use (nearlogos.fallback.json: DARK, QTC, WETH...), then the token's own on-chain ft_metadata
// icon. Only an https url or a data:image up to 12 KB (NINU's and xRHEA's are ~7 KB, which the old 6 KB cap
// dropped); _nearintents.js then drops any that ships as /assets/tokens/ni art, so the page carries each once.
const FALLBACK = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'nearlogos.fallback.json'), 'utf8')).logos || {}; } catch (e) { return {}; } })();
const okLogo = (l) => !!l && (/^https:\/\//.test(l) || (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)[;,]/i.test(l) && l.length <= 12000));
async function logoOf(t) {
  if (okLogo(t.logo)) return t.logo;
  if (okLogo(FALLBACK[t.i])) return FALLBACK[t.i];
  try { const m = await view(t.i, 'ft_metadata', {}); if (m.v && okLogo(m.v.icon)) return m.v.icon; } catch (e) {}
  return '';
}

(async () => {
  for (const [n, c] of Object.entries(WH)) {
    const id = parseInt(await ethCall(c, '0x9a8a0592'), 16);
    if (id !== c.id) { console.error('  ' + n + ' TokenBridge answered chain ' + id + ', expected ' + c.id + ' — aborting'); process.exit(1); }
  }
  const om = {}, wh = {}, meta = {};
  let errors = 0;
  const list = [{ i: 'near', s: 'NEAR', d: 24, native: true }].concat(CUR);
  for (const t of list) {
    // OMNI. Native NEAR goes as wNEAR (wrapped in the same transaction), so it shares wrap.near's row.
    if (!t.native) {
      for (const [kind, label] of Object.entries(OMNI)) {
        try {
          const b = await view('omni.bridge.near', 'get_bridged_token', { chain: kind, address: 'near:' + t.i });
          if (!b.v || typeof b.v !== 'string') continue;
          const d = await view('omni.bridge.near', 'get_token_decimals', { address: b.v });
          const dd = d.v && typeof d.v === 'object' ? d.v : {};
          (om[t.i] = om[t.i] || {})[label] = { to: b.v.replace(/^[a-z]+:/, ''), dec: Number(dd.decimals), odec: Number(dd.origin_decimals) };
        } catch (e) { errors++; console.warn('  omni ' + t.s + ' ' + kind + ': ' + e.message); }
      }
    }
    // WORMHOLE.
    const addr = t.native ? '0'.repeat(64) : crypto.createHash('sha256').update(t.i).digest('hex');
    for (const [label, c] of Object.entries(WH)) {
      try {
        const res = await ethCall(c, '0x1ff1e286' + hex32(15) + addr);
        if (/^0x0*$/.test(res)) continue;
        (wh[t.i] = wh[t.i] || {})[label] = { to: '0x' + res.slice(-40) };
      } catch (e) { errors++; console.warn('  wormhole ' + t.s + ' ' + label + ': ' + e.message); }
    }
    if (om[t.i] || wh[t.i]) meta[t.i] = t.native ? { s: 'NEAR', n: 'NEAR', d: 24, native: 1 } : { s: t.s, n: t.n || t.s, d: t.d, logo: await logoOf(t) };
  }
  if (errors) { console.error('  ' + errors + ' lookup(s) failed — not writing a partial table'); process.exit(1); }
  const out = { generated: new Date().toISOString(), wh_chain: Object.fromEntries(Object.entries(WH).map(([n, c]) => [n, { id: c.id, tb: c.tb }])), meta, om, wh };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  const line = (o) => Object.entries(o).map(([k, v]) => (meta[k] ? meta[k].s : k) + '→' + Object.keys(v).join('/')).join(', ');
  console.log('Omni:     ' + line(om));
  console.log('Wormhole: ' + line(wh));
  console.log('wrote ' + path.relative(process.cwd(), OUT));
})().catch((e) => { console.error(e); process.exit(1); });
