// The NEAR build recipe, in one place. Same shape as C:\LumosCore-XRPL\_tools\rebuild.js.
//
// Everything the fork looks like comes from Stellar's containers; everything it DOES comes from the
// transforms below, applied over them in this order.
//
//   node _tools/rebuild.js          re-run the transforms over the current containers (fast, idempotent)
//   node _tools/rebuild.js --base   re-copy the Stellar base first, then run the whole chain
//
// --base READS C:\LumosCore. It never writes there. That repo is git-connected to production, so a
// write is a deploy; this script opens it with readFileSync and nothing else.
//
// THE BASE IS STELLAR'S CURRENT CONTAINERS, not XRPL's. The XRPL fork froze Stellar at the day it was
// copied and spent weeks porting later fixes across by hand; starting from today's Stellar gives this
// fork every design fix up to now for free. It freezes from here the same way, so check the copy date
// (the containers' mtime) before concluding a Stellar layer "does not port".
//
// THE CHAIN IS NEARLY EMPTY ON PURPOSE. This is the setup step: the pages build and route under /near
// but still carry Stellar's data layers. Each NEAR transform is added here as it is written, in the
// position its comment justifies. A transform run by hand and not listed here silently disappears on
// the next --base run -- the XRPL bridge reached production that way once.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STELLAR = 'C:' + path.sep + 'LumosCore';

const CHAIN = [
  // Last until there is anything else: it only touches <a> tags pointing off-site, and any later pass
  // that rebuilds a page key from the design hands those tags back without rel="nofollow".
  '_nofollow',
];

if (process.argv.indexOf('--base') >= 0) {
  for (const dev of ['desktop', 'mobile']) {
    const from = path.join(STELLAR, 'lumoscore-aptos-' + dev + '.html');
    const to = path.join(ROOT, 'lumoscore-near-' + dev + '.html');
    if (!fs.existsSync(from)) { console.error('missing Stellar base: ' + from); process.exit(1); }
    fs.writeFileSync(to, fs.readFileSync(from));       // read-only on the Stellar side
    console.log('base  ' + dev + '  <- ' + path.basename(from));
  }
}

let failed = 0;
for (const name of CHAIN) {
  const file = path.join(__dirname, name + '.js');
  if (!fs.existsSync(file)) { console.error('SKIP  ' + name + '  (no such transform)'); failed++; continue; }
  process.stdout.write(name + '\n');
  try {
    execFileSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('FAIL  ' + name);
    failed++;
  }
}

if (failed) { console.error('\n' + failed + ' transform(s) did not complete — NOT safe to build'); process.exit(1); }
console.log('\nchain complete — now: node _tools/extract_site.js near   (subfolder build, for the combine)');
