// Hide the inherited LUMOS fee-discount pieces on NEAR pages, until LUMOS exists on NEAR.
//
// RAZA, 2026-10-21: the 250,000-LUMOS discount (0.2% -> 0.1%) and Rewards are DEFERRED on NEAR until LUMOS
// is minted there. The inherited Stellar layers still drew three pieces that promise it:
//   .lx-feebanner-wrap  "50% off trading fees — hold 250,000 LUMOS" under the swap/limit panes
//   .lx-feetier         the "Hold 250,000 LUMOS to lower your fee to 0.1%" card with its balance bar
//   .lx-rv-lumos        the review popup's "Hold 250,000 LUMOS · You hold x / 250,000" row
// On NEAR none can be true yet (no LUMOS to hold), and the banner linked to a LUMOS page that does not exist
// on NEAR. They are HIDDEN, not removed: the scripts that draw them stay, so turning the discount on is
// deleting this transform from rebuild.js, not rebuilding the feature.
//
// A stylesheet in <head>, so the pieces never paint — no flash. Idempotent: the block is replaced by id.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-near-lumosdeferred';
const STYLE = '<style id="' + ID + '">.lx-feebanner-wrap,.lx-feetier,.lx-rv-lumos{display:none!important}</style>';

let pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string' || h.indexOf('</head>') < 0) continue;
    if (h.indexOf('lx-feebanner-wrap') < 0 && h.indexOf('lx-feetier') < 0 && h.indexOf('lx-rv-lumos') < 0) continue;
    const a = h.indexOf('<style id="' + ID + '">');
    if (a >= 0) h = h.slice(0, a) + h.slice(h.indexOf('</style>', a) + 8);
    h = h.replace('</head>', STYLE + '</head>');
    json[k] = h;
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near lumos deferred: discount pieces hidden on ' + pages + ' page key(s)');
