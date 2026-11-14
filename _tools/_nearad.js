// The "Promoted" card on NEAR token pages: LUMOS / NEAR (RAZA, 2026-10-22).
//
// The card is static markup inherited from Stellar (`#lxAdWrap .lxad`, driven by the lx-ad script, which only
// reads data-href / data-adcode), so only two exact strings change:
//   * the pair label  LUMOS / XLM  ->  LUMOS / NEAR
//   * the click target. LUMOS is not minted on NEAR yet ("we will do that before release"), so until then
//     "Buy LUMOS" keeps going to Stellar's LUMOS page, the one place it can be bought today. Set NEAR_LUMOS
//     in _tools/near-lumos.js when it is minted and the card points at /trade/near/<contract>.
//
// Idempotent: a page already carrying the NEAR label and the current target matches nothing and counts 0.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const { NEAR_LUMOS } = require(__dirname + '/near-lumos.js');   // the one switch: '' until LUMOS is minted on NEAR

const STELLAR_HREF = 'data-href="/trade/stellar/LUMOS-GB5T2EQC2VDG2XEYQ5C2CQJ2SCB5RFPPWALUU2GQ3R5HUEGOZST55B6S"';
const HREF = NEAR_LUMOS ? 'data-href="/trade/near/' + encodeURIComponent(NEAR_LUMOS) + '"' : STELLAR_HREF;
const PAIRS = [
  ['<span class="lxad-pair">LUMOS / XLM<', '<span class="lxad-pair">LUMOS / NEAR<'],
];
// The card's target is SET to what the switch says on every run, whatever it was before, so turning the
// switch off again (or pointing it at a test token) can never leave a stale link behind.
const CARD = /(<div class="lxad" )data-href="[^"]*"/g;
const SELF_MARK = 'pth.indexOf("/trade/near/")';
const SELF_JS = 'var pth=location.pathname;if(' + SELF_MARK + '===0){var cid=decodeURIComponent(pth.slice(12).split("/")[0]);return cid===' + JSON.stringify(NEAR_LUMOS || 'lumos.lumoscore.near') + '?"LUMOS":"-";} ';

let pages = 0, n = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string' || h.indexOf('id="lxAdWrap"') < 0) continue;
    for (const [from, to] of PAIRS) {
      const c = h.split(from).length - 1;
      if (c) { h = h.split(from).join(to); n += c; }
      else if (h.indexOf(to) < 0) { console.error('near ad ABORT: ' + k + ' — not found: ' + from); process.exit(1); }
    }
    let cards = 0;
    h = h.replace(CARD, function (m, open) { cards++; return open + HREF; });
    if (cards !== 1) { console.error('near ad ABORT: ' + k + ' — expected one .lxad card, found ' + cards); process.exit(1); }
    // WHICH TOKEN THIS PAGE IS, ON NEAR (RAZA 2026-11-14: 'Buy LUMOS' did nothing on a NEAR token page). lx-ad asks
    // window.__lxRoute.asset, which NEAR's pages leave empty, so it fell back to LUMOS and marked EVERY NEAR token page as
    // LUMOS's own: the tap only scrolled. On /trade/near/<contract> the contract decides, read from the path.
    if (h.indexOf(SELF_MARK) < 0) {
      // Inside lx-ad only: its pageCode(){ try{ -- the code goes straight after that try{.
      const ad = h.indexOf('<script id="lx-ad">');
      const fn = ad < 0 ? -1 : h.indexOf('function pageCode(){', ad);
      const tr = fn < 0 ? -1 : h.indexOf('try{', fn);
      if (tr < 0 || tr - fn > 40) { console.error('near ad ABORT: ' + k + ' — lx-ad pageCode() not found'); process.exit(1); }
      h = h.slice(0, tr + 4) + SELF_JS + h.slice(tr + 4);
    }
    json[k] = h;
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near ad: LUMOS / NEAR on ' + pages + ' page key(s), ' + n + ' replacement(s); target '
  + (NEAR_LUMOS ? '/trade/near/' + NEAR_LUMOS : 'Stellar LUMOS (not minted on NEAR yet)'));
if (!pages) { console.error('  ! no page carried the Promoted card'); process.exit(1); }
