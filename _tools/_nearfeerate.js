// Replace the inherited Stellar fee-tier layer (`lx-feerate`) with NEAR's flat-0.2% one, IN PLACE.
//
// lx-feerate ships on 85 NEAR pages and looked the connected NEAR account up on horizon.stellar.org: a 404
// every view. It also published the fee-rate globals other inherited layers read, so it is swapped where
// it stands (same position in the page) for browser/feerate.js, which publishes the same globals at 0.2%.
// The XRPL fork did the same for its ledger (_xrplfeerate.js).
//
// Idempotent: a page already carrying lx-nearfeerate has its block refreshed in place.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const OLD = 'lx-feerate', ID = 'lx-nearfeerate';
// The NEAR LUMOS contract, '' until LUMOS is minted on NEAR (the one switch, _tools/near-lumos.js).
const { NEAR_LUMOS } = require(__dirname + '/near-lumos.js');
if (NEAR_LUMOS && !/^[a-z0-9._-]{2,64}$/.test(NEAR_LUMOS)) { console.error('  near-lumos.js: "' + NEAR_LUMOS + '" is not a NEAR account id — aborting'); process.exit(1); }
let src = fs.readFileSync(__dirname + '/browser/feerate.js', 'utf8');
if (src.indexOf('</' + 'script') >= 0) { console.error('  browser/feerate.js contains a closing script tag — aborting'); process.exit(1); }
if (!/RATE = 0\.002/.test(src) || !/LOW = 0\.001/.test(src)) { console.error('  browser/feerate.js: expected RATE = 0.002 and LOW = 0.001 — aborting'); process.exit(1); }
if (src.split("'__NEAR_LUMOS__'").length !== 2) { console.error('  browser/feerate.js: expected one __NEAR_LUMOS__ placeholder — aborting'); process.exit(1); }
src = src.split("'__NEAR_LUMOS__'").join("'" + NEAR_LUMOS + "'");
const SCRIPT = '<script id="' + ID + '">\n' + src + '\n</' + 'script>';

function swap(h, id) {
  const open = '<script id="' + id + '">';
  const a = h.indexOf(open);
  if (a < 0) return null;
  const b = h.indexOf('</' + 'script>', a);
  if (b < 0) throw new Error('script id="' + id + '" has no closing tag');
  return h.slice(0, a) + SCRIPT + h.slice(b + 9);
}

let replaced = 0, refreshed = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string') continue;
    let out = swap(h, OLD);
    if (out != null) { replaced++; h = out; }
    else if ((out = swap(h, ID)) != null) { refreshed++; h = out; }
    else continue;
    if (h.indexOf('<script id="' + OLD + '">') >= 0) { console.error('  ' + k + ': a second lx-feerate block — aborting'); process.exit(1); }
    json[k] = h;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near fee rate: replaced lx-feerate on ' + replaced + ' page key(s), refreshed ' + refreshed);
if (!replaced && !refreshed) { console.error('  ! no page carried a fee-rate layer'); process.exit(1); }
