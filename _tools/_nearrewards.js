// The Rewards page on NEAR (/rewards/near): Stellar's data layer out, NEAR's in, and the page's own copy made NEAR's.
// PORTED FROM the XRPL fork's _xrplrewards.js, which set the precedent: eligibility read off the chain, the round
// report honestly empty until a round has run there.
//
// RAZA 2026-11-12, ticket 368: "rewards on near will start from 1st Dec, not 15th Nov", "Connect stellar wallet",
// and round reports "showing stellar wallet addresses". Per page key carrying #eligBox:
//   * strips lx-rewardsdata (Horizon + G-addresses) and the three other Stellar layers that run here for nothing:
//     lx-swapcalc, lx-qorders, lx-wclaim (_nearstripstellar.js leaves this page to this transform);
//   * the countdown: the design's script and lx-cdfix both pick the next 1st or 15th; on NEAR nothing is paid before
//     1 December 2026, so that is the first date, then the 1st/15th rhythm as everywhere else;
//   * the copy: the NEAR wallet, the LUMOS/wNEAR pool, NEAR's ten Ecosystem assets (RAZA's list, ticket 270, the
//     same ten browser/nearlumospage.js shows), "Distributed" at zero, and the FAQ with its FAQPage ld+json;
//   * injects lx-nearrewards (browser/nearrewards.js) before </body>.
// THE AMOUNTS ARE STELLAR'S, CONFIRMED (RAZA 2026-11-12, "yes, the rewards are same"): 3,000,000 per round,
// 530,000,000 allocation, 1,000,000 per programme, 100,000 per Ecosystem pool, 240M / 50M caps. Left as they are.
//
// Every replacement must match (or already be in its NEAR form) on every key, or the build aborts. Idempotent.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-nearrewards';
const DEAD = ['lx-rewardsdata', 'lx-swapcalc', 'lx-qorders', 'lx-wclaim'];
const page = fs.readFileSync(__dirname + '/browser/nearrewards.js', 'utf8');
if (page.indexOf('</' + 'script') >= 0) { console.error('  nearrewards.js contains a closing script tag — aborting'); process.exit(1); }
if (page.indexOf(B) >= 0) { console.error('  nearrewards.js contains a backslash — aborting (it is injected through a template)'); process.exit(1); }
const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

const ND_OLD = 'function nd(){var n=new Date(),y=n.getFullYear(),m=n.getMonth(),dd=n.getDate();return dd<15?new Date(y,m,15):new Date(y,m+1,1);}';
const ND_NEW = 'function nd(){var n=new Date(),f=new Date(2026,11,1);if(n<f)return f;var y=n.getFullYear(),m=n.getMonth(),dd=n.getDate();return dd<15?new Date(y,m,15):new Date(y,m+1,1);}';

const ECO_NEAR = 'USDC, USDt, QTC, ZEC, BATMAN, RHEA, NEARLY, HOOT, rNEAR and USDT.e';
// [stellar, near] -- exact strings, each in every copy it appears in (visible FAQ and its ld+json alike).
const COPY = [
  ['Three reward programs, paid out automatically on the 1st and 15th of every month.',
   'Three reward programs, paid out automatically on the 1st and 15th of every month, from 1 December 2026.'],
  ['Based on your connected Stellar wallet', 'Based on your connected NEAR wallet'],
  ['<b>LUMOS/XLM</b> on Stellar', '<b>LUMOS/wNEAR</b> on NEAR'],
  ['(e.g. LUMOS/MESO, LUMOS/CELL)', '(e.g. LUMOS/USDC, LUMOS/QTC)'],
  ['>Stellar<span class="cdot">', '>NEAR<span class="cdot">'],
  ['Stellar distributions are anchored to this same contract.', ''],
  ['When did rewards start on Stellar?', 'When do rewards start on NEAR?'],
  ['The three programmes began at different times. Native LP rewards started on 15 December 2025, whale holder rewards on 1 April 2026, and Ecosystem LP rewards on 15 April 2026.',
   'All three programmes begin on NEAR with the first round on 1 December 2026.'],
  ['Every round, and rounds run from the 1st and 15th of each month, so twice a month and twelve rounds over a six-month cycle. Ecosystem LP began on 15 April 2026, making 1 October 2026 its twelfth and final round.',
   'Every round, and rounds run from the 1st and 15th of each month, so twice a month. The first round on NEAR is 1 December 2026.'],
  // Stellar's answer after its 2026-11-21 rewording (first cycle / second cycle) -- the same answer, a new anchor.
  ['Every round, and rounds run from the 1st and 15th of each month, so twice a month and twelve rounds over a six-month cycle. Ecosystem LP began on 15 April 2026, so 1 October 2026 was the twelfth and final round of its first cycle; the second cycle, with a new set of pools, began on 15 October 2026.',
   'Every round, and rounds run from the 1st and 15th of each month, so twice a month. The first round on NEAR is 1 December 2026.'],
  // a container built before RAZA confirmed the amounts carries the shorter answer
  ['Ten pools, each pairing LUMOS with one other asset. On NEAR the ten are ' + ECO_NEAR + ', and they are reselected every 6 months.',
   'Ten pools, each pairing LUMOS with one other asset. On NEAR the ten are ' + ECO_NEAR + '. Each pays 100,000 LUMOS per round, and the ten are reselected every 6 months.', 'optional'],
  ['Ten pools, each pairing LUMOS with one other asset: currently LMNR, yXLM, sages, AQUA, SSLX, SHX, TKG, LIBERATOR, KALE and USDC. Each pays 100,000 LUMOS per round, and the ten are reselected every 6 months.',
   'Ten pools, each pairing LUMOS with one other asset. On NEAR the ten are ' + ECO_NEAR + '. Each pays 100,000 LUMOS per round, and the ten are reselected every 6 months.'],
  // Stellar's sentence after its 2026-11-18 rotation to the current cycle -- the same answer, a new anchor.
  ['Ten pools, each pairing LUMOS with one other asset: currently USDC, USDT0, EURC, SHX, AQUA, BLND, xLMNR, yXLM, XRP and PYUSD. Each pays 100,000 LUMOS per round, and the ten are reselected every 6 months.',
   'Ten pools, each pairing LUMOS with one other asset. On NEAR the ten are ' + ECO_NEAR + '. Each pays 100,000 LUMOS per round, and the ten are reselected every 6 months.'],
  ['69,000,000<small>LUMOS</small></div><div class="k">Distributed so far', '0<small>LUMOS</small></div><div class="k">Distributed so far'],
];
// The three "Distributed 23M / cap" bars: nothing has been paid on NEAR.
const BAR = /<b class="mono">[0-9.]+M<\/b> \/ (240M|50M)<\/span><\/div><div class="bar"><i style="width:[0-9.]+%"><\/i>/g;

let pages = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string' || h.indexOf('id="eligBox"') < 0) continue;
    for (const id of DEAD) { const r = stripById(h, id); h = r.html; stripped += r.removed; }
    h = stripById(h, ID).html;

    const nd = h.split(ND_OLD).length - 1;
    if (nd) h = h.split(ND_OLD).join(ND_NEW);
    if (h.indexOf(ND_NEW) < 0) { console.error('near rewards ABORT: ' + key + ' — the countdown function moved'); process.exit(1); }

    for (const [from, to, optional] of COPY) {
      const n = h.split(from).length - 1;
      if (n) h = h.split(from).join(to);
      else if (!optional && (!to || h.indexOf(to) < 0)) {
        // An emptied string has nothing to find afterwards: absent is done.
        if (to) { console.error('near rewards ABORT: ' + key + ' — not found: ' + from.slice(0, 70)); process.exit(1); }
      }
    }
    const bars = (h.match(BAR) || []).length;
    h = h.replace(BAR, '<b class="mono">0</b> / $1</span></div><div class="bar"><i style="width:0%"></i>');
    if (!bars && h.indexOf('<b class="mono">0</b> / 240M') < 0) { console.error('near rewards ABORT: ' + key + ' — the Distributed bars moved'); process.exit(1); }

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('near rewards ABORT: ' + key + ' — no closing body'); process.exit(1); }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near rewards: ' + pages + ' page key(s); stripped ' + stripped + ' Stellar block(s)');
if (!pages) { console.error('near rewards ABORT: no page carried id="eligBox"'); process.exit(1); }
