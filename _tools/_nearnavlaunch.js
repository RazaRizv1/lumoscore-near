// Phone bottom bar: Launch instead of Pools (RAZA, 2026-11-14: "instead of pools, we should have Launch (linking to
// launchpad page). thats because its a more important feature than pools and pools is already accessible in the side
// menu").
//
// The bar (`nav.nb-bar`) is static markup on every mobile page, five `a.nb-tab`s. Only the Pools tab is replaced, in
// place, with a Launch tab pointing at the launchpad page and drawing the side menu's own rocket, so the bar keeps its
// order, size and rail. The pool pages lose their highlighted tab (as every page outside the bar does); the launchpad
// pages carry no bar, so nothing there needs marking. Desktop has no bottom bar and is not touched.
//
// Idempotent: a bar that already has the Launch tab and no Pools tab matches nothing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const POOLS = /<a class="nb-tab(?: active)?" data-id="pools" href="lumoscore-amm-mobile\.html">[\s\S]*?<\/a>/g;
const ROCKET = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>'
  + '<path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.9 12.9 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/>'
  + '<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>';
const LAUNCH = '<a class="nb-tab" data-id="launch" href="lumoscore-launch-token-mobile.html"><span class="nb-ico">'
  + ROCKET + '</span><span class="nb-lbl">Launch</span></a>';

const file = 'lumoscore-near-mobile.html';
const data = read(file);
const { json, s, e } = getContents(data);
let bars = 0, swapped = 0;
for (const k of Object.keys(json)) {
  let h = json[k];
  if (typeof h !== 'string' || h.indexOf('class="nb-bar"') < 0) continue;
  bars++;
  const c = (h.match(POOLS) || []).length;
  if (c > 1) { console.error('near nav ABORT: ' + k + ' has ' + c + ' Pools tabs'); process.exit(1); }
  if (c === 1) { h = h.replace(POOLS, () => LAUNCH); swapped++; }
  else if (h.indexOf('data-id="launch"') < 0) { console.error('near nav ABORT: ' + k + ' has a bar with neither Pools nor Launch'); process.exit(1); }
  json[k] = h;
}
if (!bars) { console.error('near nav ABORT: no page carried the bottom bar'); process.exit(1); }
fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
console.log('near nav: Launch tab on ' + bars + ' bar(s), ' + swapped + ' swapped this run');
