// The "Promoted" card on NEAR token pages: LUMOS / NEAR (RAZA, 2026-10-22).
//
// The card is static markup inherited from Stellar (`#lxAdWrap .lxad`, driven by the lx-ad script, which only
// reads data-href / data-adcode), so only two exact strings change:
//   * the pair label  LUMOS / XLM  ->  LUMOS / NEAR
//   * the click target. LUMOS is not minted on NEAR yet ("we will do that before release"), so until then
//     "Buy LUMOS" keeps going to Stellar's LUMOS page, the one place it can be bought today. Fill in
//     NEAR_LUMOS with the NEAR contract when it is minted and the card points at /trade/near/<contract>.
//
// Idempotent: a page already carrying the NEAR label and the current target matches nothing and counts 0.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const NEAR_LUMOS = '';   // e.g. 'lumos.lumoscore.near' once minted on NEAR

const STELLAR_HREF = 'data-href="/trade/stellar/LUMOS-GB5T2EQC2VDG2XEYQ5C2CQJ2SCB5RFPPWALUU2GQ3R5HUEGOZST55B6S"';
const HREF = NEAR_LUMOS ? 'data-href="/trade/near/' + encodeURIComponent(NEAR_LUMOS) + '"' : STELLAR_HREF;
const PAIRS = [
  ['<span class="lxad-pair">LUMOS / XLM<', '<span class="lxad-pair">LUMOS / NEAR<'],
];
if (HREF !== STELLAR_HREF) PAIRS.push([STELLAR_HREF, HREF]);

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
    json[k] = h;
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near ad: LUMOS / NEAR on ' + pages + ' page key(s), ' + n + ' replacement(s); target '
  + (NEAR_LUMOS ? '/trade/near/' + NEAR_LUMOS : 'Stellar LUMOS (not minted on NEAR yet)'));
if (!pages) { console.error('  ! no page carried the Promoted card'); process.exit(1); }
