// Strip the Stellar issuance layer from the NEAR Launchpad pages.
//
// `lx-lp-js` (~69KB) is Stellar MAINNET issuance: horizon.stellar.org, the Stellar network passphrase, and
// the Stellar fee collector GAMZFXIJ…. It came across with the frozen Stellar build onto pages that now say
// NEAR. The XRPL fork found the same layer and removed it first (_xrplaunchpad.js); the same reasoning
// holds here: a launchpad that says it cannot launch yet is strictly better than one that launches on the
// wrong chain. `lx-lpticker` is the same layer's ticker helper and reads __lxLP, gone with it.
//
// Until the LumosCore NEAR token factory is deployed, browser/launchgate.js keeps "Confirm & Launch"
// disabled and sends the success page back to the form. This transform is where the real NEAR launch
// layer will be injected instead.
//
// Idempotent: the injected block is removed by id first. A page is a launchpad page if it carries the
// Stellar layer, the form, or our own block, so a second run still finds it.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearlaunchpad';
const src = fs.readFileSync(__dirname + '/browser/launchgate.js', 'utf8');
if (src.indexOf('</' + 'script') >= 0) { console.error('  browser/launchgate.js contains a closing script tag — aborting'); process.exit(1); }
const SCRIPT = '<script id="' + ID + '">\n' + src + '\n</' + 'script>';

function isLaunchpad(k, h) {
  return /lumoscore-launch-(token|review|confirm)/.test(k)
    && (h.indexOf('id="lx-lp-js"') >= 0 || h.indexOf('id="tokenTicker"') >= 0 || h.indexOf('id="' + ID + '"') >= 0);
}

let pages = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string' || !isLaunchpad(k, h)) continue;
    const gone = stripById(h, 'lx-lp-js');
    h = gone.html;
    stripped += gone.removed;
    h = stripById(h, 'lx-lpticker').html;
    h = stripById(h, ID).html;
    if (h.indexOf('horizon.stellar.org') >= 0 && h.indexOf('Public Global Stellar Network') >= 0) {
      console.error('  ' + k + ': Stellar signing config still present after the strip — aborting');
      process.exit(1);
    }
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + k + ': no closing body — aborting'); process.exit(1); }
    json[k] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near launchpad: Stellar issuance layer stripped from ' + stripped + ', gate injected on ' + pages + ' page key(s)');
if (!pages) { console.error('  ! no launchpad page found'); process.exit(1); }
