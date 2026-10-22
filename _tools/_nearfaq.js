// NEAR answers for the FAQs inherited from Stellar, page by page, as each NEAR page is built.
//
// The FAQ ships in two places on a page — the visible lx-faq cards and the FAQPage JSON-LD that
// mirrors them for search engines — and both carry the same sentences. Each pair below replaces one
// exact Stellar string with its NEAR one EVERYWHERE in the page key, so the two copies cannot drift
// apart. Exact strings, decided one by one, never a regex over "Stellar"; a page is listed here only
// once its NEAR feature exists, so no answer describes something NEAR does not have yet.
//
// Every pair must match on every page it is listed for, or the build aborts (the design moved and an
// answer would silently stay Stellar's). Idempotent: an already-replaced page matches the NEAR text
// and counts as done.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// base page name (without -dark/-light/-mobile) -> [[stellar text, near text], ...]
const FAQ = {
  'lumoscore-dex-asset': [
    ['What does the issuer address mean?', 'What does the contract address mean?'],
    ['Every Stellar asset except XLM is created by an account, and that account’s address is the issuer. It is the asset’s real identity: two tokens can both call themselves USDC and be entirely unrelated.',
     'Every NEAR token is a smart contract, and its account name, such as usdt.tether-token.near, is the token’s real identity. Two tokens can both call themselves USDC and be entirely unrelated; the contract is how you tell them apart.'],
    ['What is a trustline?', 'What is token registration?'],
    ['A trustline is your account’s permission to hold a given asset, and Stellar will not deliver a token you have not opted into. Each one locks 0.5 XLM of your reserve, released when you remove it.',
     'Before a NEAR account can hold a token, it registers with that token’s contract by paying a small storage deposit, about 0.00125 NEAR. The deposit comes back if you unregister once your balance is zero.'],
    ['From real trades on the Stellar DEX: what the asset last traded at against XLM, read from the network rather than quoted by us. The dollar figure converts that at the live XLM rate, so the two can disagree.',
     'From Rhea Finance, NEAR’s main exchange: the token’s dollar price from Rhea’s own price feed, shown in NEAR at NEAR’s live rate. The 24-hour figures come from the token’s most active trading pair.'],
    ['LumosCore charges 0.2% per trade, reduced to 0.1% if you hold at least 250,000 LUMOS. On top of that Stellar itself charges a network fee of a small fraction of a cent.',
     'LumosCore charges 0.2% per trade. On top of that NEAR itself charges a network fee of a small fraction of a cent.'],
    ['What is a locked issuer address?', 'What does the padlock next to the contract mean?'],
    ['A locked issuer has given up its own signing keys, so no more of the asset can ever be minted and the supply you can see is final. An unlocked issuer can still mint at any time.',
     'A green padlock means the token’s contract can no longer be changed and no more of it can be minted, so the supply you see is final. A red padlock means someone still holds full control of the contract. No padlock means we could not confirm either way.'],
  ],
  // Pools (2026-10-21, with the Pools port). Only the two answers that name XLM and trustlines change; the
  // rest is chain-neutral. Pool creation and deposits are not built on NEAR yet, and the answers say so
  // rather than describe a flow the page does not have.
  'lumoscore-amm': [
    ['Choose Create pool, pick two assets and an amount of each. The ratio sets the opening price, so match the market rate. Keep spare XLM: a new pool position is a trustline and locks 0.5 XLM of reserve.',
     'On NEAR, pools live on Rhea Finance: a new pool takes two tokens and an amount of each, and the ratio sets the opening price, so match the market rate. Keep a little NEAR spare for gas and storage deposits. Creating pools from LumosCore on NEAR is coming soon.'],
  ],
  'lumoscore-amm-pool': [
    ['Use Add liquidity on this page: enter an amount for either asset and the other side fills in at the pool’s ratio. A first position also opens a trustline, which locks 0.5 XLM, so keep a little spare.',
     'Adding liquidity from LumosCore on NEAR is coming soon. In a Rhea pool you deposit every token at the pool’s current ratio, and a first deposit pays a small NEAR storage deposit, so keep a little NEAR spare.'],
  ],
  // The wallet's first answer described Stellar's claimable balances, which NEAR does not have (the tab
  // is hidden), so the question becomes the NEAR concept a reader actually meets: registration. Send
  // adds the recipient's registration in the same transaction (browser/send.js), which is what it says.
  'lumoscore-wallet': [
    ['What are claimable payments?', 'Why does a token need registering before it can be received?'],
    ['A payment someone has sent that is waiting for you to accept, used when it cannot be delivered straight away, usually because you do not hold a trustline for that asset yet. Add the trustline and claim it.',
     'A NEAR token keeps a record for every account that holds it, and that record needs a small storage deposit, about 0.00125 NEAR. When you send a token to someone who has never held it, LumosCore adds their registration to the same transaction.'],
    ['How do I add or remove a trustline?', 'How do tokens appear in my wallet?'],
    ['In Wallet, use Add asset with the code and issuer, or add it from search. To remove one its balance must be zero, so send or swap the remainder first, and that releases the 0.5 XLM it was holding.',
     'Every token your NEAR account holds shows up in Wallet on its own. Receiving a token for the first time registers your account with its contract for that small storage deposit, which comes back if you unregister once the balance is zero.'],
  ],
  // The Trade hub (2026-10-22). Facts: 0.2% flat (the LUMOS tier is deferred on NEAR), NEAR gas, limit
  // orders free but Rhea's DCL holds ~0.5 NEAR storage for an account's first order (browser/neardcl.js),
  // curation by >= $25K liquidity on any NEAR DEX (_nearcurate.js), and the paid listing page offers
  // Stellar assets only, so the NEAR answers do not send anyone to pay $250 in XLM for a NEAR token.
  'lumoscore-dex': [
    ['LumosCore charges 0.2% per trade, reduced to 0.1% if you hold at least 250,000 LUMOS. On top of that Stellar itself charges a network fee of a small fraction of a cent.',
     'LumosCore charges 0.2% per trade. On top of that NEAR itself charges a gas fee of a small fraction of a cent.'],
    ['No. LumosCore takes no fee on a limit order, because a resting order may never fill and charging upfront would not be fair. You pay only the Stellar network fee, a fraction of a cent, whether or not it fills.',
     'No. LumosCore takes no fee on a limit order, because a resting order may never fill and charging upfront would not be fair. You pay only NEAR gas, a fraction of a cent, whether or not it fills. Your first order also leaves a one-time storage deposit of about 0.5 NEAR with Rhea’s order-book contract, held for your account.'],
    ['Curated is the set of assets LumosCore has checked and chosen to list. Anyone can issue a token under any ticker on Stellar, so we verify which issuer an asset actually comes from before putting it in front of people.',
     'Curated is the set of assets LumosCore has checked and chosen to list. Anyone can deploy a token under any ticker on NEAR, so we check which contract an asset actually comes from before putting it in front of people.'],
    ['Apply on the List your token page: pick the network, give the asset code, issuing account, description and logo, and pay $250 in XLM from your own wallet. We review it by hand and verify the issuer. Listing is not automatic, but if we say no you get the whole $250 back.',
     'On NEAR the curated list is built from the market: a token holding at least $25,000 of liquidity on a NEAR exchange, with real trading, is added at our next review unless it is a scam. Paid applications on the List your token page are open for Stellar assets; NEAR applications are not open yet.'],
    ['You are refunded in full — the same amount of XLM, sent back to the account that paid it — and told why. In effect you only pay if the asset is listed, and most declines are fixable, so reapplying afterwards is fine.',
     'A paid application that is declined is refunded in full and told why. On NEAR nothing is paid yet: a token left out either falls short of the $25,000 liquidity bar or is one we judge a scam, and it is looked at again at every review.'],
    ['Your placement is shown to people already trading Stellar assets, so the impressions are an audience rather than traffic.',
     'Your placement is shown to people already trading on LumosCore, so the impressions are an audience rather than traffic.'],
    ['Hold 250,000 LUMOS or more and your fee drops from 0.2% to 0.1% across Trade, Pools and the bridge. There is nothing to stake, lock or claim, and LUMOS held in a liquidity pool counts towards the total too.',
     'Hold 250,000 LUMOS or more and your fee drops from 0.2% to 0.1% across Trade, Pools and the bridge. There is nothing to stake, lock or claim, and LUMOS held in a liquidity pool counts towards the total too. On NEAR this starts once LUMOS is live here; until then every NEAR trade is 0.2%.'],
  ],
  // The Launchpad's listing answer, with the same NEAR listing facts as the Trade hub's above.
  'lumoscore-launch-token': [
    ['Apply on the List your token page with the code, issuer, description and logo, and pay $250 in XLM, refunded in full if the review says no.',
     'On NEAR a token joins the curated list once it holds at least $25,000 of liquidity on a NEAR exchange with real trading, at our next review, unless it is a scam.'],
  ],
};

const BASE = (k) => k.replace(/-(dark|light|mobile)\.html$/, '').replace(/\.html$/, '');
const tally = {};
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  const data = read(file);
  const { json, s, e } = getContents(data);
  for (const key of Object.keys(json)) {
    const pairs = FAQ[BASE(key)];
    if (!pairs || typeof json[key] !== 'string') continue;
    let h = json[key];
    pairs.forEach(([from, to], i) => {
      // When the NEAR text CONTAINS the Stellar text (an answer that only gains a sentence), an already
      // converted answer would match again and grow on every run. Park converted copies first.
      const PARK = '\u0000lxfaq' + i + '\u0000';
      if (to.indexOf(from) >= 0) h = h.split(to).join(PARK);
      const n = h.split(from).length - 1;
      if (n) h = h.split(from).join(to);
      h = h.split(PARK).join(to);
      if (!n && h.indexOf(to) < 0) { console.error('near faq ABORT: ' + file + ' ' + key + ' — not found: ' + from.slice(0, 70)); process.exit(1); }
      tally[key] = (tally[key] || 0) + n;
    });
    json[key] = h;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near faq: ' + Object.keys(tally).length + ' page key(s); replacements ' + JSON.stringify(tally));
