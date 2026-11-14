# LumosCore on NEAR

The NEAR Protocol build of **LumosCore**, a non-custodial, multi-network DeFi platform: trading, liquidity pools,
cross-chain transfers, a wallet view, a token launchpad and rewards, served as a static site from Cloudflare Pages.

Live at **<https://lumoscore.com>**. Pick NEAR in the network chooser, or open <https://lumoscore.com/trade/near>.

## Networks

| Network | Status | Where it is built |
|---|---|---|
| **Stellar** | Live on mainnet | [RazaRizv1/lumoscore](https://github.com/RazaRizv1/lumoscore), which also holds the shared edge Functions |
| **XRPL** | Live on mainnet | Its own repository |
| **NEAR** | Live on mainnet | **This repository** |

One site serves every network. Each network's front-end is built in its own repository and the builds are combined
into one deployable tree, with NEAR's pages served under `/near/` and routes such as `/trade/near`, `/pools/near` and
`/bridge/near`.

**Non-custodial throughout.** Every transaction is signed in the user's own NEAR wallet (HOT, Meteor, NEAR Mobile or
Intear, connected through NEAR Connect). LumosCore never holds keys, never takes custody, and runs no account system.

## What's in it

| Section | What it does on NEAR |
|---|---|
| **Dashboard** | Network stats, markets, Platform Activity (transactions made through LumosCore) |
| **Trade** | Token pages with price, chart, holders, pools and recent trades; swaps and limit orders |
| **Pools** | Every curated pool with liquidity, volume and fees; the Rewarded Pools tab; create a pool, add or withdraw liquidity |
| **Bridge** | Cross-chain transfers over NEAR Intents, Omni Bridge and Wormhole, with claims for routes that need one |
| **Wallet** | Balances, send and receive, open orders (cancel, collect and claim), LP positions, activity |
| **Launchpad** | Create a NEAR token end to end |
| **Rewards** | The LUMOS reward programmes on NEAR |
| **LUMOS** | The platform token's page: `lumos.lumoscore.near` |

Every figure is read at runtime from the chain or a public source: NEAR RPC and FastNEAR's indexes, the
`v2.ref-finance.near` and `dclv2.ref-labs.near` exchange contracts, DexScreener, GeckoTerminal, Intear's price index,
NearBlocks and the bridges' own APIs. A figure that could not be read is shown as unknown, never as zero.

## Repository layout

| Path | What it holds |
|---|---|
| `_tools/` | The build: `rebuild.js` runs the transform chain (`_near*.js`) over the design containers; `extract_site.js` writes the site |
| `_tools/browser/` | The page layers injected into each page (swap, bridge, pools, wallet, search, charts...) |
| `functions/lxapi/near*.js` | NEAR's Cloudflare Pages Functions: markets, tokens, pools, holders, trades, activity, bridge status, rewarded pools |
| `workers/near-pool-indexer/` | A Cloudflare Worker that records every pool's swaps, deposits and withdrawals into D1, minute by minute |
| `contracts/` | The NEAR contracts used by the launchpad (token, factory, router), with their build and deploy notes |
| `assets/` | Self-hosted logos, the NEAR Connect bundle and the pinned wallet list |
| `RELEASE.md` | The production release checklist |

## How the build works

The site starts from a set of **design containers** (large HTML files holding every page) shared with the Stellar
build. Transforms rewrite them for NEAR, then the extractor writes `dist/near/`. The containers are not in this
repository (`.gitignore`): they are around 120 MB and are the product's design source. So a full build needs them
and a checkout of the Stellar repository, whose shared Functions are kept in step by `shared-functions.json`.

```bash
npm run rebuild          # every NEAR transform, in order, over the containers
npm run build            # shared Functions, baked data, then dist/near
npm run predeploy        # pre-deploy checks
npm run idem             # two consecutive runs must be byte-identical
```

The combined tree that is deployed is assembled outside this repository, together with the Stellar and XRPL builds.

## Security

- No secrets live in this repository. Keys and API tokens are Cloudflare secrets set with `wrangler secret put`,
  and `.env*` files are ignored.
- Nothing here can move funds: every write is a transaction the user approves in their own wallet.
- Token names and symbols come from contracts anyone can deploy, so they are treated as hostile input and rendered as
  text, never as HTML.

## License

[MIT](LICENSE)
