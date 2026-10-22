#!/usr/bin/env bash
# Build the LumosCore NEAR contracts. The token MUST be built first: the factory embeds its wasm.
#   needs: rustup (stable, wasm32-unknown-unknown), cargo-near 0.22.0
# --no-abi: the ABI step builds a host DLL, which needs a full Windows linker; the wasm is unaffected.
set -euo pipefail
cd "$(dirname "$0")"
(cd token && cargo near build non-reproducible-wasm --no-abi)
(cd factory && cargo near build non-reproducible-wasm --no-abi)
(cd router && cargo near build non-reproducible-wasm --no-abi)
sha256sum token/target/near/lumoscore_token.wasm factory/target/near/lumoscore_factory.wasm router/target/near/lumoscore_router.wasm
