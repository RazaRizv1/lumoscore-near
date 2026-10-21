// Teach the INHERITED wallet-logo script (lx-walletlogo) about NEAR. Same shape as the XRPL fork's
// _xrplwalletlogo.js: someone else's script, edited in place, keyed on anchors that must each appear
// exactly once.
//
// THE BUG IT FIXES, found 2026-10-21 with a seeded read-only session (lumos.address = root.near): the
// header chip showed the XRP LEDGER mark beside a NEAR account. The script has no artwork for NEAR
// wallets, so it falls back to a chain mark, and it picks that chain from lumos.network — which it only
// believes when it is "xrpl" or "stellar" — and otherwise from the address's FIRST LETTER: "r" means
// XRPL, "G" means Stellar. A NEAR account id is a name, and plenty start with r (root.near, rhea.near).
//
// Three edits, inside lx-walletlogo only:
//   * MAP: the five NEAR wallets' artwork, keyed the way the script normalises lumos.wallet
//     ("HOT Wallet" -> "hotwallet"), so the chip shows the wallet itself, as it does for Freighter.
//   * CHAINLOGO: a "near" mark for the case where artwork is missing.
//   * wchain(): lumos.network "near" is believed, ahead of the first-letter guess.
//
// Idempotent: skipped where the marker is present. Aborts without writing on a missing or doubled anchor.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const MARK = '/*lx-near-walletlogo*/';
const EDITS = [
  ['var MAP={"albedo":',
   'var MAP={"hotwallet":"/assets/wallets/near/hot-wallet.png","meteorwallet":"/assets/wallets/near/meteor-wallet.svg",'
   + '"nearmobile":"/assets/wallets/near/near-mobile.webp","mynearwallet":"/assets/wallets/near/mynearwallet.png",'
   + '"intearwallet":"/assets/wallets/near/intear-wallet.svg","albedo":'],
  ['var CHAINLOGO={"stellar":', 'var CHAINLOGO={"near":"/assets/networks/near.png","stellar":'],
  ['if(n==="xrpl"||n==="stellar")return n;', MARK + 'if(n==="near")return n;if(n==="xrpl"||n==="stellar")return n;'],
];

const once = (s, a) => s.split(a).length - 1;
let patched = 0, already = 0, files = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    const h = json[key];
    if (typeof h !== 'string') continue;
    const re = /(<script\b[^>]*\bid="lx-walletlogo"[^>]*>)([\s\S]*?)(<\/script>)/;
    const m = h.match(re);
    if (!m) continue;
    let body = m[2];
    if (body.indexOf(MARK) >= 0) { already++; continue; }
    for (const [a] of EDITS) {
      if (once(body, a) !== 1) { console.error('ABORT ' + file + ' ' + key + ': anchor ' + a + ' found ' + once(body, a) + 'x'); process.exit(1); }
    }
    for (const [a, b] of EDITS) body = body.replace(a, b);
    json[key] = h.replace(re, (_, x, __, z) => x + body + z);
    patched++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near walletlogo: ' + patched + ' page key(s) patched, ' + already + ' already done, across ' + files + ' containers');
