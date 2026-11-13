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
const CSSID = 'lx-nearconnect-css';

// The DONE step's green box and its tick are not in the design's base CSS. The base gives a done step
// only `color:var(--text)` plus a green `.lxw-sdot` — and `.lxw-sdot` is hidden site-wide by the
// `lx-nodots` sweep (identical on Stellar and NEAR), so nothing visible marks a finished step. On
// Stellar the green state and the tick come from `<style id="lx-realconnect-css">` in
// `_wallet_realconnect.js`, which edit 1 above DELETES on every NEAR page — necessarily, because that
// layer ends by storing a Stellar G-address under lumos.address.
//
// So NEAR keeps the design's step MARKUP and loses its finished-state PAINT: RAZA 2026-10-28, HOT
// Wallet vs Rabet — "it is not highlighting the 3 login steps boxes ... nor the ticks are appearing".
// `is-active` still worked throughout, because its orange border IS in the base.
//
// These are Stellar's three rules, owned here rather than inherited, so nothing depends on a style
// block this transform is required to strip. Kept byte-for-byte equivalent to Stellar's so the two
// connect screens cannot drift apart.
const CSS = '<style id="' + CSSID + '">'
  + '.lxw-step{transition:background .28s ease,border-color .28s ease,color .28s ease}'
  + '.lxw-step.is-done{color:var(--text,#fff)!important;border-color:rgba(52,192,127,.55)!important;'
  + 'background:rgba(52,192,127,.13)!important}'
  + '.lxw-step.is-done::after{content:"' + B + '2713";margin-left:auto;color:#35c07f;font-weight:800;'
  + 'font-size:13px;line-height:1}'
  + '</style>';

const page = fs.readFileSync(__dirname + '/browser/nearconnect.js', 'utf8');
if (page.indexOf('</' + 'script') >= 0) { console.error('  nearconnect.js contains a closing script tag — aborting'); process.exit(1); }
const SCRIPT = CSS + '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

// The wallet table entry lives in near-wallets.js, because the combine (chains/near.js) writes the
// same entry into the OTHER build's pages — see its header. Two copies would drift.
const { SUB, SUB_RE, MNW_OLD, NEAR_ENTRY, NEAR_MARK, NETS_ANCHOR, NAMES_ANCHOR, NAMES_ADD } = require(__dirname + '/near-wallets.js');

const once = (s, a) => s.split(a).length - 1;
let pages = 0, nets = 0, stripped = 0, files = 0, subs = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string' || h.indexOf('window.lxwOpenWallet=') < 0) continue;

    for (const id of ['lx-realconnect', ID]) { const r = stripById(h, id); h = r.html; if (id !== ID) stripped += r.removed; }
    // stripById only knows <script id="...">, so both <style> blocks are removed by id here: Stellar's
    // (edit 1) and our own (idempotence — without this a rebuild stacks a new copy every run).
    h = h.replace(/<style id="lx-realconnect-css">[\s\S]*?<\/style>/g, '')
         .replace(new RegExp('<style id="' + CSSID + '">[\\s\\S]*?<\\/style>', 'g'), '');

    if (h.indexOf(NEAR_MARK) < 0) {
      if (once(h, NETS_ANCHOR) !== 1 || once(h, NAMES_ANCHOR) !== 1) {
        console.error('ABORT ' + file + ' ' + key + ': design modal anchors found NETS x' + once(h, NETS_ANCHOR)
          + ', NAMES x' + once(h, NAMES_ANCHOR));
        process.exit(1);
      }
      h = h.replace(NETS_ANCHOR, NETS_ANCHOR + NEAR_ENTRY).replace(NAMES_ANCHOR, NAMES_ANCHOR + NAMES_ADD);
      nets++;
    }

    // The insert above is skipped once the entry exists, so without this an incremental
    // `node _tools/rebuild.js` could never change a word of it again — only a --base run could, and
    // the two builds would disagree. Keep the entry's sub in step with SUB on every run.
    const before = h;
    h = h.split(MNW_OLD).join('');                 // MyNearWallet removed (RAZA 2026-11-13)
    h = h.replace(SUB_RE, '$1' + SUB + '$2');
    if (h !== before) subs++;

    const bi = h.lastIndexOf('</body>');
    if (bi < 0) { console.error('ABORT ' + file + ' ' + key + ': no </body>'); process.exit(1); }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('nearconnect: ' + pages + ' page key(s) across ' + files + ' container(s); near wallets added to '
  + nets + ' modal(s); sub retitled on ' + subs + ' page(s); lx-realconnect stripped ' + stripped + 'x');
