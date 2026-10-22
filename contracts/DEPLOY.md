# Deploying the LumosCore factory to mainnet (lumoscore.near)

RAZA runs these himself, in his own terminal. Claude never handles the account's keys.

Factory wasm: contracts/factory/target/near/lumoscore_factory.wasm
sha256 42e4621719b89241c09aff9052b63af9e98f012873260ca64ace17d701c7101c (2026-10-22: 15/15 unit tests;
testnet 19/19 public launch + 10/10 owner-only reserved launch, on the same wasm)

Init args (factory-init-args.json):
- owner_id     lumoscore.near        (may call set_min_fee / set_fee_account / set_paused / set_owner,
                                      and create_reserved_token)
- fee_account  fees-lumoscore.near
- min_fee      0.5 NEAR              floor for direct contract calls; the page charges max(min_fee, $5 in NEAR)

1. Fund lumoscore.near with ~4 NEAR (≈3.24 locked for code storage, ~0.3 spare for instant refunds, rest gas).
   Below ~3.35 NEAR the deploy itself fails. If a failed launch ever finds the spare short, refund by hand
   with lumoscore.near's full-access key (the page pre-checks the name, so failures should be rare).
2. Give the CLI a key for lumoscore.near (interactive; your seed phrase or wallet login stays on this PC):
   near account import-account network-config mainnet
3. Deploy + initialise in one transaction:
   near contract deploy lumoscore.near use-file C:/LumosCore-NEAR/contracts/factory/target/near/lumoscore_factory.wasm with-init-call new file-args C:/LumosCore-NEAR/contracts/factory-init-args.json prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send

## Minting LUMOS on NEAR (before release)

`lumos` is a RESERVED name: the public create_token refuses it, so nobody can launch a fake LUMOS. Only the
factory's owner can mint it, through create_reserved_token, as `lumos.lumoscore.near`: the same fixed-supply,
keyless token as any launch, no LumosCore fee, supply sent to the account named in owner_id.

lumos-mint-args.json holds the arguments. TWO VALUES ARE RAZA'S DECISION — edit them before minting:
- owner_id      the treasury that receives the whole supply (placeholder REPLACE-WITH-TREASURY-ACCOUNT.near;
                the call fails on it, so it cannot be minted by accident)
- total_supply  1,000,000,000 LUMOS at 18 decimals as drafted (1e27 in base units); Stellar's LUMOS is 1B
Name LumosCore, symbol LUMOS, decimals 18, icon = lumos-icon.webp.txt (128px WebP, 7,991 chars, under the
contract's 16 KB limit; sha256 a6ec9f04…bd81, made from /assets/tokens/lumos.png).

4. Fund lumoscore.near with ~1.8 NEAR more (storage for the token account is 1.74461 NEAR; any excess of
   the attached deposit over storage goes to fees-lumoscore.near).
5. Mint:
   near contract call-function as-transaction lumoscore.near create_reserved_token file-args C:/LumosCore-NEAR/contracts/lumos-mint-args.json prepaid-gas '150.0 Tgas' attached-deposit '1.75 NEAR' sign-as lumoscore.near network-config mainnet sign-with-keychain send
6. Then in the build: set NEAR_LUMOS = 'lumos.lumoscore.near' in _tools/near-lumos.js (the one switch: card
   link, 0.1% fee tier, discount pieces, LUMOS page), rebuild, and check the token page before deploying.

## The swap router (fee only when the swap succeeds)

contracts/router/target/near/lumoscore_router.wasm, sha256 71d4a5ed904b5881d842eeed514b76ecf459db33f1a2ed6976e8ef679fd12f17
(2026-10-22: 11/11 unit tests; testnet 18/18 against Ref 1.9.19, plus the page's NEAR-input shape at 280 TGas).
It relies on Rhea's swap_out_recipient (probed on testnet; mainnet runs the newer 1.9.20).

Init args (router-init-args.json): owner lumoscore.near, fee_account fees-lumoscore.near, rhea v2.ref-finance.near,
max_fee_bps 20 (the router refuses any fee above 0.2%).

7. Create the router account from lumoscore.near, funded for its code (~1.53 NEAR) plus a margin:
   near account create-account fund-myself router.lumoscore.near '1.7 NEAR' autogenerate-new-keypair save-to-keychain sign-as lumoscore.near network-config mainnet sign-with-keychain send
8. Deploy + initialise:
   near contract deploy router.lumoscore.near use-file C:/LumosCore-NEAR/contracts/router/target/near/lumoscore_router.wasm with-init-call new file-args C:/LumosCore-NEAR/contracts/router-init-args.json prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
9. Register the router on every curated token: the operator page (`node _tools/admin/serve-admin.js`,
   http://localhost:8160/feereg.html), choose "router.lumoscore.near" as the account to register. Any connected
   wallet can pay (about 0.00125 NEAR per token, ~0.09 NEAR for all). The fee account must stay registered too.
10. Then in the build: set NEAR_ROUTER = 'router.lumoscore.near' in _tools/near-router.js, rebuild, deploy.
    Swaps from a token the router is not registered on stay "coming soon" until it is.
