// Remove inherited Stellar layers that cannot work on a NEAR page AND draw nothing.
//
// The fork is built from Stellar's containers, so it inherits every Stellar layer along with the
// design. This file takes out only the ones that own NO UI, so removing them changes nothing a reader
// can see. Same shape as C:\LumosCore-XRPL\_tools\_xrplstripstellar.js.
//
//   lx-poolwarm   Advances Stellar's /lxapi/pools ranking from other pages' idle time. The NEAR pages
//                 have no use for Stellar's pool ranking, so every call is a dead request.
//   lx-actbeacon  Wraps the POST to Horizon's /transactions to record LumosCore activity. A NEAR page
//                 never submits to Horizon, so it can never fire. NEAR's own activity marker rides the
//                 fee transfer's memo instead (scope doc, Wallet and Send).
//
// DELIBERATELY NOT HERE, each because it owns UI and goes in the workstream that replaces it, never on
// its own — removing it first would leave a blank section or the design's sample data:
//   lx-wclaim     also BUILDS the wallet's Open Orders / Claimable tab bar at runtime, so stripping it
//                 alone would change the wallet layout. Claimable is hidden on NEAR (decided); that
//                 lands with the wallet page.
//   lx-walletdata, lx-mobwallet, lx-qorders, lx-swapcalc, lx-ammdata, lx-dxadata, lx-dexmain,
//   lx-searchassets, lx-ltdata, lx-accdata, lx-realdata, lx-dashtop, lx-aodata, lx-rewardsdata,
//   lx-lp-js, lx-listtoken, lx-mobdex, lx-feerate, lx-realconnect, and the three bridge clients.
//
// Idempotent: removes by id only, so a re-run finds nothing and reports zero.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const DEAD = ['lx-poolwarm', 'lx-actbeacon'];

let files = 0, pages = 0;
const per = {};

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    let touched = 0;
    for (const id of DEAD) {
      const r = stripById(h, id);
      h = r.html;
      if (r.removed) { per[id] = (per[id] || 0) + r.removed; touched += r.removed; }
    }
    if (touched) { json[key] = h; changed = true; pages++; }
  }
  if (changed) {
    fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
  }
}

const total = Object.values(per).reduce((a, b) => a + b, 0);
console.log('near strip stellar: ' + total + ' block(s) from ' + pages + ' page key(s) across ' + files + ' container(s)');
for (const k of Object.keys(per)) console.log('   ' + k.padEnd(16) + per[k]);
