// The inherited LUMOS fee-discount pieces on NEAR pages: which show before LUMOS exists on NEAR.
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
// RAZA, 2026-11-01, overriding that for two of them: the swap pane's "50% off trading fees" banner and the
// review popup's "Hold 250,000 LUMOS to lower your fee to 0.1%" row show on NEAR "as it appears on Stellar"
// (the Custom Swap popup has carried the banner since 10-31). Both now link to /lumos/near, which exists. The
// fee itself stays a flat 0.2% until the switch below is set. Still hidden:
//   .lx-feetier                         the card with the balance bar -- Stellar hides it on Trade too
//   the banner in the LIMIT pane        NEAR limit orders are free (RAZA 2026-08-19); "50% off" nothing is
//                                       wrong there, before or after the mint
//
// A stylesheet in <head>, so the pieces never paint — no flash. Idempotent: the block is replaced by id.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-near-lumosdeferred';
// Once LUMOS is on NEAR (the one switch, _tools/near-lumos.js), the fee-tier card shows too; the limit pane's
// banner never does. The style is replaced by id, so flipping the switch back and forth is clean either way.
const { NEAR_LUMOS } = require(__dirname + '/near-lumos.js');
const HIDE = ['.dxa-pane-limit .lx-feebanner-wrap', '.mdxa-pane-limit .lx-feebanner-wrap'].concat(NEAR_LUMOS ? [] : ['.lx-feetier']);
const STYLE = '<style id="' + ID + '">' + HIDE.join(',') + '{display:none!important}</style>';
// The review row's "LUMOS" link is Stellar's (/lumos/stellar); on NEAR it is NEAR's LUMOS page.
const RV_STELLAR = 'class="lx-rv-buy" href="/lumos/stellar"', RV_NEAR = 'class="lx-rv-buy" href="/lumos/near"';

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
    h = h.split(RV_STELLAR).join(RV_NEAR);
    json[k] = h;
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near lumos deferred: banner + review row shown; hidden: ' + HIDE.join(' ')
  + ' on ' + pages + ' page key(s)');
