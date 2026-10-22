// THE SWAP-ROUTER SWITCH. The account the LumosCore swap router (contracts/router) is deployed on, or '' for
// none (RAZA, 2026-10-22: "build the swap router contract so the fee is only taken if the swap succeeds").
//
//   ''                         today: a swap is the fee transfer + ft_transfer_call to Rhea in one transaction;
//                              a swap Rhea refuses returns the input but the fee is kept
//   'router.lumoscore.near'    after it is deployed (contracts/DEPLOY.md) AND registered on the curated tokens:
//                              one ft_transfer_call to the router, the fee is taken only if the swap fills
//
// browser/nearswap.js has the placeholder; every transform that injects it (_neardexasset, _nearintents)
// stamps this value in through stamp(), which refuses a value that is not a NEAR account id.
const NEAR_ROUTER = '';

function stamp(src) {
  if (NEAR_ROUTER && !/^[a-z0-9._-]{2,64}$/.test(NEAR_ROUTER)) throw new Error('near-router.js: "' + NEAR_ROUTER + '" is not a NEAR account id');
  const parts = src.split("'__NEAR_ROUTER__'");
  if (parts.length !== 2) throw new Error('nearswap.js: expected exactly one __NEAR_ROUTER__ placeholder, found ' + (parts.length - 1));
  return parts.join("'" + (NEAR_ROUTER || '__NEAR_ROUTER__') + "'");
}

module.exports = { NEAR_ROUTER, stamp };
