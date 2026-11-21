// Patch the inherited header wallet chip (lx-whead, from Stellar's _wallet_header.js) for NEAR, in place.
// Same approach as the XRPL fork's _xrplwhead.js and the Arc fork's _arcwhead.js: the script stays, only
// its chain facts change --
//   NET       the fallback network          "aptos" -> "near"
//   netLabel  the network name shown         Stellar fallback -> "NEAR"
//   NETLOGO   the mark beside the address    xlm.png (Stellar's) -> /assets/networks/near.png
//   connected what counts as a session       (see below)
//
// CONNECTED MEANS A NEAR SESSION. The combined site shares one localStorage across chains, so a visitor
// connected on Stellar (G…), XRPL (r…) or Arc (0x…) opened a NEAR page and got a "Connected wallet" chip
// with the other chain's address, leading to that chain's wallet — reported for the Arc pages by the Arc
// session on staging 3f26240b (2026-10-21), and the NEAR copy had the same test. A NEAR account id alone is
// NOT enough: an 0x… address is a valid NEAR (eth-implicit) account id AND an Arc address, so the stored
// network must say near too (browser/nearconnect.js writes lumos.network = lumos.chain = 'near'). The
// account rule is window.lxn.validAccount's, inlined because lx-whead may run before lx-nearconnect.
//
// Each rule matches the inherited form or recognises its own applied form; if a page key carrying lx-whead
// matches neither, the build ABORTS — the upstream script changed and a silent skip would ship it.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const NEAR_OK = 'function lxnOk(a){a=String(a||"");if(a.length<2||a.length>64)return false;'
  + 'if(/^0x[0-9a-f]{40}$/.test(a))return true;return /^(([a-z0-9]+[-_])*[a-z0-9]+[.])*([a-z0-9]+[-_])*[a-z0-9]+$/.test(a);}';
const RULES = [
  [['var NET="aptos";'], 'var NET="near";', 'the network fallback'],
  [['function netLabel(){var n=actNet();return n?n.charAt(0).toUpperCase()+n.slice(1):"Stellar";}'],
    'function netLabel(){return "NEAR";}', 'the network label'],
  [["var NETLOGO='url(" + '"/assets/tokens/xlm.png"' + ")';"], "var NETLOGO='url(" + '"/assets/networks/near.png"' + ")';", 'the network mark'],
  // REVERTED 2026-11-14. RAZA: "You need to show the exact same thing that you're showing on
  // dashboard header even when we open any other network pages."
  //
  // The guard below wiped the wallet unless the stored network said "near", which dropped the header
  // into its SIGNED-OUT state: a visitor connected on Stellar or XRPL opening a NEAR page saw an
  // orange "Launch App" button, and mobileMenu's `los[i].style.display=on?"":"none"` hid the
  // Disconnect control with it — told they were signed out, and given no way to sign out.
  //
  // The chain the page serves is the BODY NOTICE's job (lx-wrongchain), not the header's. Stellar and
  // XRPL were reverted to the same stock form in the same pass.
  //
  // It also tested `lumos.network` against a chain name, which is unsafe on its own terms: that key
  // still holds the pre-multichain value "mainnet" for anyone who connected before the rework and it
  // never self-heals. If a connected test is ever wanted here, resolve the chain from the ADDRESS
  // SHAPE the way the wrong-chain layer does — never from that key.
  [[
    'var wallet=ls("lumos.wallet"),addr=ls("lumos.address");' + NEAR_OK
      + 'if(ls("lumos.network")!=="near"||!lxnOk(addr)){wallet=null;addr=null;}var on=!!(wallet||addr);',
    'var wallet=ls("lumos.wallet"),addr=ls("lumos.address");var on=!!(wallet||addr);',
  ],
    'var wallet=ls("lumos.wallet"),addr=ls("lumos.address");var on=!!(wallet||addr);',
    'the connected test'],
];

let pages = 0;
const applied = {}, already = {}, missed = {};
for (const r of RULES) { applied[r[2]] = 0; already[r[2]] = 0; missed[r[2]] = 0; }
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const k of Object.keys(json)) {
    let p = json[k];
    if (typeof p !== 'string' || p.indexOf('id="lx-whead"') < 0) continue;
    const before = p;
    for (const [froms, to, name] of RULES) {
      if (p.indexOf(to) >= 0) { already[name]++; continue; }
      const hit = froms.filter((f) => p.indexOf(f) >= 0);
      if (!hit.length) { missed[name]++; continue; }
      for (const f of hit) p = p.split(f).join(to);
      applied[name]++;
    }
    if (p !== before) { json[k] = p; pages++; }
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
const miss = Object.keys(missed).filter((n) => missed[n]);
if (miss.length) { console.error('near whead ABORT: lx-whead changed upstream; no match for ' + miss.join(', ')); process.exit(1); }
console.log('near whead: ' + pages + ' page key(s) patched; ' + Object.keys(applied).map((n) => n + ' ' + applied[n] + '/' + already[n]).join(' · '));
