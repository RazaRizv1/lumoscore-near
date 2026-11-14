// The phone bottom bar on the launchpad page, with Launch lit (RAZA, 2026-11-14: "Yes, add it", after the bar's Pools
// tab became Launch). The design gave /launchpad no bar, so tapping Launch left the bar behind; every other tab's page
// keeps it with its own tab lit.
//
// Nothing is drawn new: the bar, its stylesheet and its script are copied verbatim from the bridge page (whose bar
// _nearnavlaunch has already given the Launch tab), so the launchpad's bar is the same bar. Only which tab is lit
// differs. The launchpad already pins its cost summary to the bottom (.summary-fixed), so that panel is raised to sit on
// the bar and the page's bottom padding grows by the bar's height (72px), keeping the last field clear of both.
//
// Only the launchpad page itself: Review and Confirm are steps inside one launch, and carry no bar.
// After _nearnavlaunch. Idempotent: a page that already has the bar is left alone.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const SRC = 'lumoscore-bridge-mobile.html';
const DST = 'lumoscore-launch-token-mobile.html';
const BAR_H = 72;

function block(h, tag, id) {
  const i = h.indexOf('<' + tag + ' id="' + id + '"');
  if (i < 0) return null;
  const end = '</' + tag + '>';
  return h.slice(i, h.indexOf(end, i) + end.length);
}

const file = 'lumoscore-near-mobile.html';
const data = read(file);
const { json, s, e } = getContents(data);
const src = json[SRC], dst = json[DST];
if (typeof src !== 'string' || typeof dst !== 'string') { console.error('near launch bar ABORT: missing ' + SRC + ' or ' + DST); process.exit(1); }

if (dst.indexOf('class="nb-bar"') >= 0) {
  console.log('near launch bar: already on the launchpad page');
} else {
  const n0 = src.indexOf('<nav class="nb-bar"');
  if (n0 < 0) { console.error('near launch bar ABORT: no bar on ' + SRC); process.exit(1); }
  let nav = src.slice(n0, src.indexOf('</nav>', n0) + 6);
  if (nav.indexOf('data-id="launch"') < 0) { console.error('near launch bar ABORT: the bar has no Launch tab (run _nearnavlaunch first)'); process.exit(1); }
  nav = nav.split('class="nb-tab active"').join('class="nb-tab"')
           .split('<a class="nb-tab" data-id="launch"').join('<a class="nb-tab active" data-id="launch"');

  const parts = {};
  for (const [tag, id] of [['style', 'nbnav-css'], ['style', 'lx-nbwide'], ['style', 'lx-nbviewport'], ['script', 'nbnav-js']]) {
    parts[id] = block(src, tag, id);
    if (!parts[id]) { console.error('near launch bar ABORT: ' + SRC + ' has no ' + id); process.exit(1); }
    if (dst.indexOf(' id="' + id + '"') >= 0) { console.error('near launch bar ABORT: ' + DST + ' already has ' + id); process.exit(1); }
  }
  const lift = '<style id="lx-nearlaunchbar">html .summary-fixed{bottom:' + BAR_H + 'px!important}'
    + 'html body{padding-bottom:' + (220 + BAR_H) + 'px!important}</style>';

  let h = dst;
  const hd = h.indexOf('</head>');
  const bd = h.lastIndexOf('</body>');
  if (hd < 0 || bd < 0 || h.split('</body>').length !== 2) { console.error('near launch bar ABORT: ' + DST + ' head/body not found once'); process.exit(1); }
  h = h.slice(0, bd) + nav + parts['nbnav-js'] + h.slice(bd);
  h = h.slice(0, hd) + parts['nbnav-css'] + parts['lx-nbwide'] + parts['lx-nbviewport'] + lift + h.slice(hd);
  json[DST] = h;
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
  console.log('near launch bar: bottom bar on the launchpad page, Launch lit');
}
