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
      const n = h.split(from).length - 1;
      if (n) h = h.split(from).join(to);
      else if (h.indexOf(to) < 0) { console.error('near faq ABORT: ' + file + ' ' + key + ' — not found: ' + from.slice(0, 70)); process.exit(1); }
      tally[key] = (tally[key] || 0) + n;
    });
    json[key] = h;
  }
  fs.writeFileSync(file, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('near faq: ' + Object.keys(tally).length + ' page key(s); replacements ' + JSON.stringify(tally));
