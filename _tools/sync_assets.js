// Copy this repo's OWN assets (assets/ -> dist/assets/) so the combine can carry them.
//
// extract_site.js builds pages only; it copies no assets for a subfolder build. Pages reference assets
// root-relative (/assets/...), so in the combined deploy they resolve against Stellar's asset tree, and
// the combine adds a fork's dist/assets on top — additively, never replacing a Stellar file. This
// repo's assets/ therefore holds ONLY what NEAR adds: its wallet logos and the self-hosted NEAR Connect
// bundle with its pinned wallet list.
//
// Idempotent: copies over whatever is there.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets');
const DST = path.join(ROOT, 'dist', 'assets');
let n = 0;
(function walk(rel) {
  for (const e of fs.readdirSync(path.join(SRC, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) { walk(r); continue; }
    fs.mkdirSync(path.dirname(path.join(DST, r)), { recursive: true });
    fs.copyFileSync(path.join(SRC, r), path.join(DST, r));
    n++;
  }
})('');
console.log('sync_assets: ' + n + ' file(s) -> dist/assets');
