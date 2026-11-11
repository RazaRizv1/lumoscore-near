// Bake every curated token's holder count: _tools/nearholdercounts.generated.json.
//
//   node _tools/_nearholdercounts.js          (network: Intear; paced, ~1 minute for the whole list)
//
// RAZA 2026-10-30: "Still not seeing holders count in many assets". The count has one source, NearBlocks, and it
// allows a few calls a minute per address -- Cloudflare's shared one included -- so live reads from the edge are
// refused far more often than they answer. The edge still asks live and prefers that figure; this file is what
// it falls back to, so a curated token never shows "—" just because NearBlocks was busy. Counts move slowly, so a
// figure a few days old is a fair stand-in; its date ("at") travels with it to the endpoint (countAt).
//
// INTEAR, NOT NEARBLOCKS, SINCE 2026-11-12 (RAZA: BATMAN read 79 holders, 724 hold it). NearBlocks' token index stopped
// moving at the end of September, so its counts only fell further behind. Intear counts live, and allows the pace.
// A token with no count answers 0 or nothing: recorded as null, never as zero holders.
// A SEPARATE COMMAND, like _nearcurate.js and _nearlinks.js: the build must not need the network.
const fs = require('fs');
const path = require('path');

const CUR = path.join(__dirname, 'nearcurated.generated.json');
const OUT = path.join(__dirname, 'nearholdercounts.generated.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tokens = JSON.parse(fs.readFileSync(CUR, 'utf8')).tokens || [];
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).counts || {}; } catch (e) {}
  const counts = {};
  for (const t of tokens) {
    let n;
    for (let k = 0; k < 4 && n === undefined; k++) {
      const r = await fetch('https://prices.intear.tech/token?token_id=' + encodeURIComponent(t.i), { headers: { accept: 'application/json' } }).catch(() => null);
      if (r && r.ok) {
        const j = await r.json().catch(() => null);
        const v = Number(j && j.holders);
        n = isFinite(v) && v > 0 ? v : null;
      } else await sleep(5000);                           // refused: wait a moment, then again
    }
    // A run that could not ask keeps the last run's figure rather than erasing it.
    if (n === undefined && prev[t.i]) counts[t.i] = prev[t.i];
    else if (n !== undefined) counts[t.i] = { n, at: new Date().toISOString().slice(0, 10) };
    console.log('  ' + (t.s || '').padEnd(12) + (n === undefined ? 'unread' : n === null ? 'not indexed' : n));
    await sleep(700);
  }
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), counts }, null, 1) + '\n');
  const known = Object.values(counts).filter((c) => c && c.n > 0).length;
  console.log('holder counts: ' + known + ' of ' + tokens.length + ' token(s) -> ' + path.basename(OUT));
})().catch((e) => { console.error('holder counts failed: ' + e.message); process.exit(1); });
