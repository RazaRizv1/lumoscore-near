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
6. Then in the build: set NEAR_LUMOS = 'lumos.lumoscore.near' in _tools/_nearad.js, and do the rest of the
   LUMOS-on-NEAR switch (fee tier, Rewards, the LUMOS page) recorded in the NEAR scope notes.
