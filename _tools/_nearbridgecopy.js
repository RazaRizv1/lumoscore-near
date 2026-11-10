// NEAR wording on the bridge page: the hero line, the FAQ and its FAQPage ld+json, the static "How the
// bridge works" modal, and the lx-bhiw dialog that actually answers the "How it works?" button.
//
// Ported from the XRPL fork's _xrplbridgecopy.js + _xrplbridgehiw.js. The page arrived describing Stellar's
// bridge -- CCTP burning and minting USDC, LayerZero moving USDT0, a claim on arrival, a swap on Stellar --
// none of which happens on NEAR. WRITTEN OUT, NOT FIND-AND-REPLACED: a regex over "Stellar" turns
// sentences about a burn-and-mint bridge into false sentences about an intent network.
//
// THE COPY NAMES THE THIRD PARTY. "LumosCore never holds your funds" stays true, but for the ~30 seconds a
// transfer takes NEAR Intents does, and the copy says so (memory note on the Stellar route, 2026-09-19).
//
// THREE ROUTES SINCE 2026-10-30: NEAR Intents, Omni Bridge and Wormhole. Each earlier NEAR wording is
// kept as a FROM value (SUB_PREV, STATIC), so an incremental build that already carries it is moved on
// rather than reported missing.
//
// Every FAQ question is matched by its exact current text; a question that is not found is reported, not
// guessed at. The ld+json is rebuilt from the visible pairs after the rewrite, so the two cannot disagree.
//
// The docs pages are deliberately not touched: the NEAR build does not route /docs (they exist once, on
// the company site), so there is no NEAR copy of the cross-chain doc to correct.
//
// Idempotent: each rewrite writes an exact value, and a page already carrying it is left unchanged.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const SUB = 'Bridge NEAR, USDC, USDT and other NEAR tokens to thirty-five networks with NEAR Intents, '
  + 'Omni Bridge or Wormhole — swap into the destination chain’s own token, or carry the token itself.';
const SUB_PREV = ['Bridge NEAR, USDC, USDT and other NEAR tokens to thirty-five networks with NEAR Intents — '
  + 'delivered as the destination chain’s own token, nothing to claim.'];
const SUB_OLD = 'Bridge USDC with Circle CCTP, USDT0 with LayerZero, or swap into XRP, Bitcoin, Solana and other major assets with NEAR Intents.';

// [question as it stands today, new question, new answer]
const FAQ = [
  ['How do I bridge to or from Stellar?', 'How do I bridge from NEAR?',
    'Connect a NEAR wallet, pick the destination network, enter an amount and the receiving address, choose '
    + 'a route — NEAR Intents, Omni Bridge or Wormhole, whichever can carry that asset there — then review and '
    + 'sign in your NEAR wallet. The route and exactly what will arrive are shown before you sign.'],
  ['Do I have to claim it on the other side?', 'Do I have to claim anything on the other side?',
    'Not with NEAR Intents or Omni Bridge: both deliver to the address you give, with no second signature. '
    + 'Wormhole is the exception — nobody relays NEAR transfers on it, so once its guardians have signed the '
    + 'transfer (about fifteen minutes) you claim it from the Pending claims tab with an EVM wallet, paying that '
    + 'chain’s gas.'],
  ['What if I close the tab before claiming?', 'What if I close the tab?',
    'Once the NEAR transaction is signed, NEAR Intents and Omni Bridge carry the transfer whether or not the '
    + 'page is open. A Wormhole transfer waits for you to claim it: it stays listed under Pending claims '
    + 'whenever the wallet that sent it is connected, and can be claimed later. Close the tab before signing and nothing has happened. If a '
    + 'NEAR Intents transfer cannot be completed, it is refunded to the NEAR account that paid.'],
  ['What is Circle CCTP?', 'Which bridge does LumosCore use here?',
    'Three. NEAR Intents, through its 1Click service: solvers deliver the destination chain’s own token. '
    + 'Omni Bridge, by Near One: carries the NEAR token itself as Omni’s bridged copy, finished by relayers '
    + 'paid in NEAR. Wormhole: carries it as Wormhole’s wrapped copy, which you claim on arrival. The Route '
    + 'panel shows which of them can carry the asset you picked, and uses the one you choose.'],
  ['What are LayerZero and USDT0?', 'Who holds my funds during a transfer?',
    'Not LumosCore. With NEAR Intents, a deposit account it creates for that one quote holds the amount for '
    + 'the roughly thirty seconds a solver takes. Omni Bridge and Wormhole lock the token in their own NEAR '
    + 'contracts (omni.bridge.near, contract.portalbridge.near) and issue the bridged copy on the other side.'],
  ['Which chains are supported?', 'Which chains are supported?',
    'Thirty-five destinations through NEAR Intents — including Bitcoin, Ethereum, Solana, Base, Arbitrum, '
    + 'Tron, TON, Cardano, the XRP Ledger and Stellar — read live rather than written into the page. Omni '
    + 'Bridge reaches Ethereum, Base, Arbitrum, Solana, BNB Chain and Polygon, and Wormhole Ethereum, BNB '
    + 'Chain, Polygon, Avalanche, Arbitrum, Optimism and Base, each for the tokens it carries.'],
  ['How long does a transfer take?', 'How long does a transfer take?',
    'About thirty seconds with NEAR Intents, which returns its own estimate with every quote. Omni Bridge '
    + 'usually takes a few minutes. Wormhole’s guardians sign a NEAR transfer in about fifteen minutes, '
    + 'after which you claim it. The review step shows the route’s time before you sign.'],
  ['What are the cross-chain fees?', 'What are the cross-chain fees?',
    'LumosCore takes 0.2% of the amount you send, in the asset you send — send 100 and 99.8 is bridged. On '
    + 'top of that is the route’s own cost: NEAR Intents’ fee, Omni’s relayer fee (paid in NEAR), or for '
    + 'Wormhole the gas of your claim on the destination chain. The Route panel shows it before you sign. '
    + 'NEAR’s own gas goes to the network, not to us.'],
  ['Can I bridge my own Stellar asset?', 'Can I bridge my own NEAR token?',
    'Only curated NEAR tokens that one of the three routes carries — NEAR itself, wNEAR, USDC, USDT and a few '
    + 'dozen more; the source picker lists exactly those. Any other token cannot be bridged from this page.'],
];

// The design's static modal (desktop only). lx-bhiw intercepts the button, so this is what a crawler
// reads rather than what a person sees -- still corrected, by exact pairs.
const STATIC = [
  ['Cross-chain transfers via Wormhole and LayerZero.', 'Cross-chain transfers via NEAR Intents, Omni Bridge and Wormhole.'],
  ['Cross-chain transfers via NEAR Intents.', 'Cross-chain transfers via NEAR Intents, Omni Bridge and Wormhole.'],
  ["Choose the chains you're bridging between (Stellar and your destination network), then the asset and the amount you want to move.",
   "Choose the chains you're bridging between (NEAR and your destination network), then the asset and the amount you want to move."],
  ['Transfers route through Wormhole and LayerZero, so you receive the destination asset directly.',
   'NEAR Intents delivers the destination chain’s own asset; Omni Bridge and Wormhole carry the token itself.'],
  ['Transfers route through NEAR Intents, so you receive the destination asset directly.',
   'NEAR Intents delivers the destination chain’s own asset; Omni Bridge and Wormhole carry the token itself.'],
  ['Your wallet signs the source-chain transaction. The bridge locks on the source side and releases the matching asset on the destination side.',
   'Your NEAR wallet signs one transaction. NEAR Intents holds the deposit for about thirty seconds while a solver delivers the matching asset on the destination side.'],
  ['No central bridge holds your funds. Assets move pool-to-pool and settle straight to your destination wallet.',
   'LumosCore never holds your funds. NEAR Intents holds a deposit for the half-minute a transfer takes; Omni Bridge and Wormhole lock the token in their own contracts.'],
  ['LumosCore never holds your funds. NEAR Intents holds the deposit for the half-minute a transfer takes, then settles straight to your destination wallet.',
   'LumosCore never holds your funds. NEAR Intents holds a deposit for the half-minute a transfer takes; Omni Bridge and Wormhole lock the token in their own contracts.'],
];

const HIW_ID = 'lx-bhiw';
const hiw = fs.readFileSync(__dirname + '/browser/bridgehiw.js', 'utf8');
if (hiw.indexOf('</' + 'script') >= 0) { console.error('  browser/bridgehiw.js contains a closing script tag — aborting'); process.exit(1); }
const HIW = '<script id="' + HIW_ID + '">' + hiw + '</' + 'script>';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unesc(s) { return String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

let files = 0, pages = 0, subs = 0, qas = 0, lds = 0, statics = 0, hiws = 0;
const missing = new Set();
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (h.indexOf('br-steps') < 0) continue;              // the three bridge keys
    const before = h;

    // ---- hero line ----
    if (h.indexOf(SUB_OLD) >= 0) { h = h.split(SUB_OLD).join(esc(SUB)); subs++; }
    SUB_PREV.forEach((p) => { if (h.indexOf(esc(p)) >= 0) { h = h.split(esc(p)).join(esc(SUB)); subs++; } });
    if (h.indexOf(esc(SUB)) < 0) missing.add('hero sub');

    // ---- FAQ: each item located by its question, rewritten whole ----
    const itemRe = /(<h3 class="lx-faq-q"[^>]*>)([^<]*)(<\/h3>\s*<p class="lx-faq-a"[^>]*>)([\s\S]*?)(<\/p>)/g;
    const byQ = {};
    FAQ.forEach((f) => { byQ[f[0]] = f; byQ[f[1]] = f; });
    const seenQ = new Set();
    h = h.replace(itemRe, function (m0, o1, q, mid, a, c) {
      const f = byQ[unesc(q).trim()];
      if (!f) return m0;
      seenQ.add(f[0]);
      const out = o1 + esc(f[1]) + mid + esc(f[2]) + c;
      if (out !== m0) qas++;
      return out;
    });
    FAQ.forEach((f) => { if (!seenQ.has(f[0])) missing.add('FAQ: ' + f[0]); });

    // ---- FAQPage ld+json, rebuilt from the visible pairs ----
    const pairs = [];
    let pm; const pre = /<h3 class="lx-faq-q"[^>]*>([^<]*)<\/h3>\s*<p class="lx-faq-a"[^>]*>([\s\S]*?)<\/p>/g;
    while ((pm = pre.exec(h))) {
      pairs.push({ q: unesc(pm[1].replace(/\s+/g, ' ').trim()), a: unesc(pm[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()) });
    }
    if (pairs.length) {
      const ld = { '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: pairs.map((p) => ({ '@type': 'Question', name: p.q, acceptedAnswer: { '@type': 'Answer', text: p.a } })) };
      const open = '<script type="application/ld+json" id="lx-faq-ld">';
      const i = h.indexOf(open);
      if (i >= 0) {
        const j = h.indexOf('</' + 'script>', i);
        // `<` cannot appear in the answers (they are plain text), but escape it anyway so the JSON can never
        // close its own script tag.
        const body = JSON.stringify(ld).split('<').join(B + 'u003c');
        if (h.slice(i + open.length, j) !== body) { h = h.slice(0, i + open.length) + body + h.slice(j); lds++; }
      } else missing.add('lx-faq-ld');
    }

    // ---- static modal ----
    for (const [from, to] of STATIC) {
      const n = h.split(from).length - 1;
      if (n) { h = h.split(from).join(to); statics += n; }
    }

    // ---- lx-bhiw, replaced in place (its position among the window-capture listeners matters) ----
    const open = '<script id="' + HIW_ID + '">';
    const hi = h.indexOf(open);
    if (hi >= 0) {
      const hj = h.indexOf('</' + 'script>', hi);
      const cur = h.slice(hi, hj + ('</' + 'script>').length);
      if (cur !== HIW) { h = h.slice(0, hi) + HIW + h.slice(hj + ('</' + 'script>').length); hiws++; }
    } else missing.add('lx-bhiw');

    if (h !== before) { json[key] = h; pages++; }
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}

console.log('near bridge copy: ' + pages + ' page key(s) changed across ' + files + ' container(s) — '
  + subs + ' hero line(s), ' + qas + ' FAQ item(s), ' + lds + ' ld+json block(s), ' + statics
  + ' static modal string(s), ' + hiws + ' how-it-works dialog(s)');
if (missing.size) console.log('  not found (already NEAR, or the design moved): ' + [...missing].join('; '));
