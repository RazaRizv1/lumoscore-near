// The near entry for the design's connect-modal wallet table, in ONE place.
//
// Two things write it now: _nearconnect.js, into NEAR's own containers, and chains/near.js in the
// combine, into the OTHER build's pages that offer "Choose a network" (so picking NEAR opens its
// wallet list in place instead of jumping to /trade/near first). A second copy of this string would
// drift the moment a wallet is added or renamed, and the two builds would then offer different
// wallets for the same chain — so neither file owns it.
//
// Four wallets: HOT, Meteor and NEAR Mobile under Popular; Intear under All wallets. MyNearWallet was
// removed (RAZA 2026-11-13: "Remove mynear wallet from near network"); MNW_OLD is its entry as it was written,
// so _nearconnect.js can take it out of containers that already carry the table. Logos are self-hosted under /assets/wallets/near/ (each wallet's manifest icon).
// The ids here are the design's data-wallet values; browser/nearconnect.js maps them to NEAR Connect
// wallet ids in its own IDS table, so a change here needs a matching entry there.

const IMG = (f) => '<img src="/assets/wallets/near/' + f + '" alt="" style="width:100%;height:100%;'
  + 'object-fit:cover;border-radius:inherit;display:block">';
const GRAD = 'linear-gradient(135deg,#1f2937 0%,#0b1220 100%)';
const W = (id, name, sub, file) =>
  "{id:'" + id + "',name:'" + name + "',sub:'" + sub + "',grad:'" + GRAD + "',icon:'" + IMG(file) + "'}";

// The design's own default wording, which most of the modal's entries already use — RAZA 2026-10-28:
// "remove 'Near' from the text". The modal is already chain-specific by the time it is open.
const SUB = 'Choose a wallet to continue';

const NEAR_ENTRY = "near:{ label:'NEAR', chip:'NEAR', addr:'', sub:'" + SUB + "', groups:["
  + "{section:'Popular', wallets:["
  + W('HOTWallet', 'HOT Wallet', 'Mobile app & extension', 'hot-wallet.png') + ','
  + W('MeteorWallet', 'Meteor Wallet', 'Extension & web', 'meteor-wallet.svg') + ','
  + W('NEARMobile', 'NEAR Mobile', 'Mobile app', 'near-mobile.webp')
  + "]},{section:'All wallets', wallets:["
  + W('IntearWallet', 'Intear Wallet', 'Web wallet', 'intear-wallet.svg')
  + "]}]},";

const MNW_OLD = W('MyNearWallet', 'MyNearWallet', 'Web wallet · No install', 'mynearwallet.png') + ',';

module.exports = {
  SUB,
  MNW_OLD,
  NEAR_ENTRY,
  NEAR_MARK: "near:{ label:'NEAR'",
  NETS_ANCHOR: 'var NETS={',
  NAMES_ANCHOR: "var NAMES={stellar:'Stellar',",
  NAMES_ADD: "near:'NEAR',",
  // Keeps an already-written entry's sub in step with SUB, for callers that skip the insert once the
  // entry exists. Without it the wording could only ever be changed by a full --base rebuild.
  SUB_RE: /(near:\{ label:'NEAR', chip:'NEAR', addr:'', sub:')[^']*(')/g,
};
