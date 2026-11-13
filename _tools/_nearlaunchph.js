// The Launchpad's two name fields DESCRIBE what to type instead of naming a real token. PORTED FROM Stellar's
// _launchph.js (RAZA 2026-11-13: "replicate onto NEAR"), whose header carries the reasoning; in short:
//
//   * The launchpad CREATES a token, so any real-looking example ("e.g. Tether" / "e.g. USDT", or the phone's
//     invented "e.g. Solar Flare" / "e.g. SLR") suggests the reader could mint that token. RAZA, on Stellar:
//     "placing usdc in placeholder is not right". So: Token Name -> "Your token's name", Ticker -> "ASSET".
//   * Anchored on the ATTRIBUTE, id first where the form has one, never the words alone: an "e.g. USDC" elsewhere
//     on the site (the Add-custom-asset modal) is a different surface and is right there.
//   * A STRAIGHT apostrophe, as Stellar's: the string is an anchor in other repos' transforms too.
//   * Both layouts move together, so the same form never teaches two things depending on the device.
//
// NEAR's base carried the older generation measured 2026-11-13: desktop "e.g. Tether" / "e.g. USDT" on two keys,
// phone "e.g. Solar Flare" (the design's attribute written TWICE on the one input) / "e.g. SLR" on one key. The
// doubled form is listed first so it collapses to one attribute rather than leaving a stale second copy.
//
// Applies by default (rebuild.js runs every transform without flags; Stellar's is dry-run-first because it is run
// by hand). Idempotent: no target contains its own source. Aborts when neither the old nor the new strings are on a
// launch page -- the form has been reshaped, and "0 rewritten" would read as success.
const { read, getContents, writeContents } = require(__dirname + '/lib.js');

const NAME_NEW = 'placeholder="Your token' + String.fromCharCode(39) + 's name"';
const TICK_NEW = 'placeholder="ASSET"';
const PAIRS = [
  ['id="tokenName" placeholder="e.g. Solar Flare" placeholder="e.g. Solar Flare"', 'id="tokenName" ' + NAME_NEW],
  ['id="tokenName" placeholder="e.g. Tether"', 'id="tokenName" ' + NAME_NEW],
  ['id="tokenTicker" placeholder="e.g. USDT"', 'id="tokenTicker" ' + TICK_NEW],
  ['id="tokenName" placeholder="e.g. Solar Flare"', 'id="tokenName" ' + NAME_NEW],
  ['id="tokenTicker" placeholder="e.g. SLR"', 'id="tokenTicker" ' + TICK_NEW],
  // Stellar's newer generation, should a fresh base ever carry it here.
  ['id="tokenName" placeholder="e.g. USD Coin" placeholder="e.g. USD Coin"', 'id="tokenName" ' + NAME_NEW],
  ['id="tokenName" placeholder="e.g. USD Coin"', 'id="tokenName" ' + NAME_NEW],
  ['id="tokenTicker" placeholder="e.g. USDC"', 'id="tokenTicker" ' + TICK_NEW],
];

let failed = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let hits = 0, pages = 0, current = 0;
  try { read(file); } catch (e) { console.error('  ' + file + ': missing -- skipped'); continue; }
  writeContents(file, (json) => {
    for (const k of Object.keys(json)) {
      let h = json[k];
      if (typeof h !== 'string' || h.indexOf('id="tokenTicker"') < 0) continue;   // the launch form's pages only
      pages++;
      for (const [a, b] of PAIRS) {
        const n = h.split(a).length - 1;
        if (n) { h = h.split(a).join(b); hits += n; }
      }
      if (h.indexOf('id="tokenName" ' + NAME_NEW) >= 0 && h.indexOf('id="tokenTicker" ' + TICK_NEW) >= 0) current++;
      json[k] = h;
    }
  });
  console.log('near launch placeholders: ' + file + ' -- ' + pages + ' launch page(s), ' + hits + ' rewritten, '
    + current + ' now describing the field');
  if (pages && current !== pages) {
    console.error('  ! ' + file + ': ' + (pages - current) + ' launch page(s) carry neither the old nor the new'
      + ' placeholders -- the form has been reshaped; fix the anchors before trusting this.');
    failed++;
  }
}
if (failed) process.exit(1);
