# Deploying the LumosCore factory to mainnet (lumoscore.near)

RAZA runs these himself, in his own terminal. Claude never handles the account's keys.

Factory wasm: contracts/factory/target/near/lumoscore_factory.wasm
sha256 d6735f6763d04874f0b072d993fc0f45b685d2ca06a826e49de775b600c45d9d (19/19 on testnet, 2026-10-21)

Init args (factory-init-args.json):
- owner_id     lumoscore.near        (may call set_min_fee / set_fee_account / set_paused / set_owner)
- fee_account  fees-lumoscore.near
- min_fee      0.5 NEAR              floor for direct contract calls; the page charges max(min_fee, $5 in NEAR)

1. Fund lumoscore.near with ~4 NEAR (≈3.3 locked for code storage, ~0.3 spare for instant refunds, rest gas).
   Below ~3.4 NEAR the deploy itself fails. If a failed launch ever finds the spare short, refund by hand
   with lumoscore.near's full-access key (the page pre-checks the name, so failures should be rare).
2. Give the CLI a key for lumoscore.near (interactive; your seed phrase or wallet login stays on this PC):
   near account import-account network-config mainnet
3. Deploy + initialise in one transaction:
   near contract deploy lumoscore.near use-file C:/LumosCore-NEAR/contracts/factory/target/near/lumoscore_factory.wasm with-init-call new file-args C:/LumosCore-NEAR/contracts/factory-init-args.json prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
