// NEAR wallet connect, wired into the design's own connect modal. Three edits, on every page key that
// carries the design's modal (window.lxwOpenWallet):
//
// 1. STRIP lx-realconnect (and its css). Stellar's connect flow: Freighter, xBull, LOBSTR, Albedo,
//    WalletConnect. On a NEAR page every path through it ends by storing a Stellar G-address under
//    lumos.address, the key every NEAR layer reads. The XRPL fork replaced it for the same reason.
//
// 2. ADD near TO THE DESIGN'S WALLET TABLE. The modal renders its rows from its own NETS table (one
//    entry per chain: stellar, xrpl, hedera, starknet...) and its own NAMES map. Adding a near entry is a
//    data change inside the design's structure, so the rows, icons, search and "Last used" tag are the
//    design's, exactly as for every other chain. Five wallets, as RAZA approved: HOT, Meteor and NEAR
//    Mobile under Popular; MyNearWallet and Intear under All wallets. Logos are self-hosted under
//    /assets/wallets/near/ (copied from each wallet's manifest icon).
//
// 3. INJECT lx-nearconnect: _tools/browser/nearconnect.js, read from file and injected verbatim —
//    browser code never lives inside a quoted string in a transform here.
//
// Idempotent: the NETS edit is skipped when the near entry is present; the two scripts are stripped by
// id before the new one goes in. Aborts without writing if an anchor is missing or doubled.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearconnect';
const page = fs.readFileSync(__dirname + '/browser/nearconnect.js', 'utf8');
if (page.indexOf('</' + 'script') >= 0) { console.error('  nearconnect.js contains a closing script tag — aborting'); process.exit(1); }
const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

const IMG = (f) => '<img src="/assets/wallets/near/' + f + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block">';
const GRAD = 'linear-gradient(135deg,#1f2937 0%,#0b1220 100%)';
const W = (id, name, sub, file) => "{id:'" + id + "',name:'" + name + "',sub:'" + sub + "',grad:'" + GRAD + "',icon:'" + IMG(file) + "'}";
const NEAR_ENTRY = "near:{ label:'NEAR', chip:'NEAR', addr:'', sub:'Choose a NEAR wallet to continue', groups:["
  + "{section:'Popular', wallets:["
  + W('HOTWallet', 'HOT Wallet', 'Mobile app & extension', 'hot-wallet.png') + ','
  + W('MeteorWallet', 'Meteor Wallet', 'Extension & web', 'meteor-wallet.svg') + ','
  + W('NEARMobile', 'NEAR Mobile', 'Mobile app', 'near-mobile.webp')
  + "]},{section:'All wallets', wallets:["
  + W('MyNearWallet', 'MyNearWallet', 'Web wallet · No install', 'mynearwallet.png') + ','
  + W('IntearWallet', 'Intear Wallet', 'Web wallet', 'intear-wallet.svg')
  + "]}]},";
const NETS_ANCHOR = 'var NETS={';
const NAMES_ANCHOR = "var NAMES={stellar:'Stellar',";
const NEAR_MARK = "near:{ label:'NEAR'";

const once = (s, a) => s.split(a).length - 1;
let pages = 0, nets = 0, stripped = 0, files = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string' || h.indexOf('window.lxwOpenWallet=') < 0) continue;

    for (const id of ['lx-realconnect', ID]) { const r = stripById(h, id); h = r.html; if (id !== ID) stripped += r.removed; }
    h = h.replace(/<style id="lx-realconnect-css">[\s\S]*?<\/style>/g, '');

    if (h.indexOf(NEAR_MARK) < 0) {
      if (once(h, NETS_ANCHOR) !== 1 || once(h, NAMES_ANCHOR) !== 1) {
        console.error('ABORT ' + file + ' ' + key + ': design modal anchors found NETS x' + once(h, NETS_ANCHOR)
          + ', NAMES x' + once(h, NAMES_ANCHOR));
        process.exit(1);
      }
      h = h.replace(NETS_ANCHOR, NETS_ANCHOR + NEAR_ENTRY).replace(NAMES_ANCHOR, NAMES_ANCHOR + "near:'NEAR',");
      nets++;
    }

    const bi = h.lastIndexOf('</body>');
    if (bi < 0) { console.error('ABORT ' + file + ' ' + key + ': no </body>'); process.exit(1); }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('nearconnect: ' + pages + ' page key(s) across ' + files + ' container(s); near wallets added to '
  + nets + ' modal(s); lx-realconnect stripped ' + stripped + 'x');
