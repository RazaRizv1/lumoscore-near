// THE LUMOS-ON-NEAR SWITCH. One value, read by every transform that behaves differently once LUMOS exists
// on NEAR (RAZA, 2026-10-22: "lumos token is not yet minted on Near but we will do that before release").
//
//   ''                       today: the 250,000-LUMOS discount pieces stay hidden (_nearlumosdeferred), the
//                            fee is a flat 0.2% (_nearfeerate), the Promoted card's "Buy LUMOS" goes to
//                            Stellar's LUMOS page (_nearad)
//   'lumos.lumoscore.near'   after the mint (contracts/DEPLOY.md, create_reserved_token): the discount pieces
//                            show, browser/feerate.js reads the account's LUMOS (wallet + Rhea pools) and
//                            publishes 0.1% at 250,000+, and the card links to /trade/near/<contract>
//
// Rebuild with `node _tools/rebuild.js` after changing it. Check the result on the token page before shipping:
// the discount pieces were Stellar's and have only been seen running on NEAR with the tier switched off.
// NEAR_LUMOS_POOL: LUMOS's own LUMOS/wNEAR pool on Rhea (created by treasury.lumoscore.near 2026-11-04). Until Rhea's
// indexer lists and prices it, the market, pool list, swap routing and token page read it from the chain through
// functions/lxapi/_nearownpools.js.
module.exports = { NEAR_LUMOS: 'lumos.lumoscore.near', NEAR_LUMOS_POOL: 9001 };   // minted 2026-11-04, verified on chain
