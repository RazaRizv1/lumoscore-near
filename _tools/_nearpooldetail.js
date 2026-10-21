// Wire the pool detail page (/pools/near/id/<Rhea pool id>) to /lxapi/nearpools. Ported from the XRPL fork's
// _xrplpooldetail.js.
//
// The page ships the design's mock pool (LUMOS / APT, 3,420,180 APT, a 64-hex id, 847 participants, nineteen
// Aptos transactions, a $1,247.50 position). lx-ammdata used to overwrite it with a STELLAR pool from Horizon;
// _nearpools.js strips that layer from every page, so without this nothing replaces the mock -- and every row
// of the NEAR Pools table links here.
//
// INHERITED WRITERS ON THESE ELEMENTS (inventoried 2026-10-21): the design's own chart script (draws its mock
// series into #tvlChart -- kept behind the inherited html:not(.lx-chartready) gate, which this layer never
// lifts because nothing real is drawn), the phone's panel-tab and theme script (kept: it only switches
// panels), lx-gate on the deposit CTA (handled through data-lxorig/data-lxdis), and the logo healer (opted
// out with data-logoed / img children).
//
// Strips its own block from EVERY page first and injects only where #tvlChart lives in markup -- the XRPL
// build once guarded on a class that also appears in stylesheets and landed on 12 keys instead of 3.
// Idempotent. Aborts when no page carries the chart.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearpooldetail';
const page = fs.readFileSync(__dirname + '/browser/pooldetail.js', 'utf8');
if (page.indexOf('</' + 'script') >= 0) { console.error('  browser/pooldetail.js contains a closing script tag — aborting'); process.exit(1); }
const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

let files = 0, pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — aborting'); process.exit(1); }
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    const before = h;
    h = stripById(h, ID).html;
    if (h.indexOf('id="tvlChart"') < 0) { if (h !== before) json[key] = h; continue; }
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — aborting'); process.exit(1); }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
console.log('near pool detail: injected on ' + pages + ' page key(s) across ' + files + ' container(s)');
if (!pages) { console.error('  ! no page carried id="tvlChart" — nothing was wired'); process.exit(1); }
