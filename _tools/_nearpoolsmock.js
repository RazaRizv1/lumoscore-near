// Blank the Pools page's Market Overview figures IN THE MARKUP. Ported from the XRPL fork's _xrplpoolsmock.js.
//
// The design ships "12.7M APT ≈ $5.32M", "100" active pools, "$21,483.83 · 51,250 APT swapped" and 11,274
// participants. On Stellar they sit under a shimmer gate (html:not(.lx-ammready)) until lx-ammdata writes
// over them; pools.js lifts that gate as soon as it starts reading, as the XRPL layer does, so whatever is in
// the markup at that moment is visible until the NEAR figures land. A script at the end of the body cannot
// beat the first paint of the document that carries it, so the figures are emptied here and the page goes
// blank -> real, never Aptos mock -> real.
//
// Every .amm-snapshot-value and .amm-snapshot-vsub is a figure. .amm-snapshot-sub is BOTH -- "51,250 APT
// swapped" is mock, "Across all pools" is the design's caption -- so only the subs carrying a digit go.
//
// Only on the Pools list page keys (desktop #poolsBody, phone #panelAll), not the $LUMOS page. Replacements
// are functions, never replacement strings. Idempotent; aborts if no Pools page is found.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

function blank(html) {
  let n = 0;
  let out = html.replace(/(<div class="amm-snapshot-value">)([\s\S]*?)(<\/div>)/g, (m, a, inner, c) => {
    if (inner === '&mdash;' || inner === '—') return m;
    n++;
    return a + '—' + c;
  });
  out = out.replace(/(<div class="amm-snapshot-vsub">)([\s\S]*?)(<\/div>)/g, (m, a, inner, c) => {
    if (!inner) return m;
    n++;
    return a + c;
  });
  out = out.replace(/(<div class="amm-snapshot-sub([^"]*)">)([\s\S]*?)(<\/div>)/g, (m, a, extra, inner, c) => {
    if (!inner || !/\d/.test(inner)) return m;            // a caption, not a figure
    n++;
    return a + c;
  });
  // THE PAGER SHIPS "Showing 1–10 of 100 pools" with numbered buttons 1 2 3 … 10 -- the design's own count,
  // in view from the first paint until pools.js rebuilds it (seen on the first local check, 2026-10-21).
  // It ships hidden instead; buildPager() shows it once there is more than one real page, and the design's
  // tab script shows it again on the All Pools tab as it always did.
  // The Total Liquidity caption ships as pools.js writes it, because writing it only at runtime swapped one
  // caption for another in view (measured: at 267ms). RAZA 2026-11-05: "Across all NEAR pools". The containers
  // keep their last-run text, so the wording before that is matched as well as the design's own.
  for (const was of ['Across all pools', 'Across the pools listed here']) {
    const CAP = '<div class="amm-snapshot-sub">' + was + '</div>';
    if (out.indexOf(CAP) < 0) continue;
    n += out.split(CAP).length - 1;
    out = out.split(CAP).join('<div class="amm-snapshot-sub">Across all NEAR pools</div>');
  }
  const PG = '<div class="pagination" id="paginationAll">';
  if (out.indexOf(PG) >= 0) {
    n += out.split(PG).length - 1;
    out = out.split(PG).join('<div class="pagination" id="paginationAll" style="display:none">');
  }
  return { html: out, n };
}

let listPages = 0, pages = 0, cleared = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — aborting'); process.exit(1); }
  const { json, s, e } = getContents(data);
  let touched = 0;
  for (const key of Object.keys(json)) {
    const h = json[key];
    if (typeof h !== 'string') continue;
    if (h.indexOf('id="poolsBody"') < 0 && h.indexOf('id="panelAll"') < 0) continue;
    if (h.indexOf('class="lumos-hero-row') >= 0) continue;     // the desktop $LUMOS page, by its markup
    if (h.indexOf('amm-snapshot-row') < 0) continue;
    listPages++;
    const r = blank(h);
    if (!r.n) continue;
    json[key] = r.html;
    pages++; touched++;
    cleared += r.n;
  }
  if (touched) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}
if (!listPages) { console.error('near pools overview mock: ABORT — no Pools page with a Market Overview'); process.exit(1); }
console.log('near pools overview mock: ' + cleared + ' figure(s) blanked on ' + pages + ' of ' + listPages + ' Pools page key(s)'
  + (cleared ? '' : ' (already clean)'));
