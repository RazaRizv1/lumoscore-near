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

const SUB = 'Bridge NEAR, USDC, USDT and other NEAR tokens to thirty-five networks with NEAR Intents — '
  + 'delivered as the destination chain’s own token, nothing to claim.';
const SUB_OLD = 'Bridge USDC with Circle CCTP, USDT0 with LayerZero, or swap into XRP, Bitcoin, Solana and other major assets with NEAR Intents.';

// [question as it stands today, new question, new answer]
const FAQ = [
  ['How do I bridge to or from Stellar?', 'How do I bridge from NEAR?',
    'Connect a NEAR wallet, pick the destination network and the asset you want there, enter an amount and '
    + 'the receiving address, then review and sign one NEAR transaction. The route and what will arrive are '
    + 'shown before you sign.'],
  ['Do I have to claim it on the other side?', 'Do I have to claim anything on the other side?',
    'No. NEAR Intents delivers to the address you give, with no second signature and no gas needed on '
    + 'arrival. That is different from Circle’s CCTP on the Stellar build, where you redeem on the '
    + 'destination chain; CCTP does not reach NEAR and is not used here.'],
  ['What if I close the tab before claiming?', 'What if I close the tab?',
    'Once the transaction is signed and submitted, NEAR Intents carries the transfer whether or not the page '
    + 'is open — it is the NEAR transaction that commits you, not the tab. Close it before signing and '
    + 'nothing has happened. If a transfer cannot be completed, NEAR Intents refunds it to the NEAR account '
    + 'that paid.'],
  ['What is Circle CCTP?', 'Which bridge does LumosCore use here?',
    'NEAR Intents, through its 1Click service. Solvers compete to fill each transfer and deliver the '
    + 'destination chain’s own token rather than a wrapped copy. Circle CCTP and LayerZero, which the Stellar '
    + 'build also uses, do not carry assets out of NEAR, so they are not offered on this page.'],
  ['What are LayerZero and USDT0?', 'Who holds my funds during a transfer?',
    'Not LumosCore. Your transaction sends the amount to a deposit account NEAR Intents creates for that one '
    + 'quote, and NEAR Intents holds it for the roughly thirty seconds a solver takes to deliver. If the '
    + 'transfer cannot be filled, NEAR Intents refunds it to the NEAR account it came from.'],
  ['Which chains are supported?', 'Which chains are supported?',
    'Thirty-five destinations, all through NEAR Intents — including Bitcoin, Ethereum, Solana, Base, '
    + 'Arbitrum, Tron, TON, Cardano, the XRP Ledger and Stellar. The list is read live from NEAR Intents '
    + 'rather than written into the page, so it cannot go stale.'],
  ['How long does a transfer take?', 'How long does a transfer take?',
    'Usually about thirty seconds. NEAR Intents returns its own estimate with every quote, and the review '
    + 'step shows it before you sign. Nothing needs claiming on the other side, so once you have signed you '
    + 'can close the tab.'],
  ['What are the cross-chain fees?', 'What are the cross-chain fees?',
    'LumosCore takes 0.2% of the amount you send, in the asset you send, inside the same NEAR transaction as '
    + 'the deposit — so send 100 and 99.8 is bridged. NEAR Intents charges its own fee on top, shown on the '
    + 'Route panel before you sign, and the quoted amount is what arrives after all of it. NEAR’s own gas is '
    + 'a fraction of a cent and goes to the network, not to us.'],
  ['Can I bridge my own Stellar asset?', 'Can I bridge my own NEAR token?',
    'Only the curated NEAR tokens NEAR Intents accepts — NEAR itself, wNEAR, USDC, USDT and about twenty '
    + 'more; the source picker lists exactly those. NEAR is wrapped to wNEAR inside the same transaction. '
    + 'Any other token cannot be bridged from this page.'],
];

// The design's static modal (desktop only). lx-bhiw intercepts the button, so this is what a crawler
// reads rather than what a person sees -- still corrected, by exact pairs.
const STATIC = [
  ['Cross-chain transfers via Wormhole and LayerZero.', 'Cross-chain transfers via NEAR Intents.'],
  ["Choose the chains you're bridging between (Stellar and your destination network), then the asset and the amount you want to move.",
   "Choose the chains you're bridging between (NEAR and your destination network), then the asset and the amount you want to move."],
  ['Transfers route through Wormhole and LayerZero, so you receive the destination asset directly.',
   'Transfers route through NEAR Intents, so you receive the destination asset directly.'],
  ['Your wallet signs the source-chain transaction. The bridge locks on the source side and releases the matching asset on the destination side.',
   'Your NEAR wallet signs one transaction. NEAR Intents holds the deposit for about thirty seconds while a solver delivers the matching asset on the destination side.'],
  ['No central bridge holds your funds. Assets move pool-to-pool and settle straight to your destination wallet.',
   'LumosCore never holds your funds. NEAR Intents holds the deposit for the half-minute a transfer takes, then settles straight to your destination wallet.'],
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
    else if (h.indexOf(esc(SUB)) < 0) missing.add('hero sub');

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
