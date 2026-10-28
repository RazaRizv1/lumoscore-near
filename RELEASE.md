# NEAR → production (lumoscore.com) release checklist

Written 2026-10-22 against staging `c435a9c6`. Production today serves Stellar + XRPL as ONE combined artifact;
releasing NEAR means that artifact becomes Stellar + XRPL + NEAR. Arc and Hedera are not part of this release.

Tick every box in order. A box that cannot be ticked stops the release; it is never "probably fine".

---

## A. Build work (Claude, before release) — DONE 2026-10-22, staging `21635cfd`

Found while writing this checklist: production users could not FIND NEAR, and search engines saw 8 of its pages.

- [x] **Chain switcher offers NEAR everywhere.** `combine.js` `surfaces()` (agreed with the Arc and Hedera
      sessions; opt-in `surface` per `chains/<id>.js`, patched in the OUTPUT only, every anchor asserted) adds NEAR
      to `lx-mc` on every Stellar, Arc and Hedera page. Verified: Launch App → "Choose a network" lists Stellar,
      XRP Ledger, NEAR, Arc; choosing NEAR lands on /trade/near. XRPL's own pages use their own two-chain
      toggle (`lx-xrplchainswitch`), so they still offer only Stellar — NEAR is reached from Stellar's pages.
- [x] **"Choose a network" cards offer NEAR** on the Trade, Pools, Bridge and Launchpad hubs (and "Upcoming" on
      the LUMOS hub; none on Rewards, per RAZA). Verified on /trade: four cards, NEAR → /trade/near.
- [x] **Sitemap: 127 NEAR urls** (was 8): 72 token pages + 47 Rhea pool pages (>= $25K liquidity), baked by
      `_tools/_nearsitemapgen.js` into `functions/_nearsitemap.js` and wired by `chains/near.js`; NEAR's five
      main routes are in /llms.txt. Re-run the generator after a curation change.
- [x] **Chain-switch targets verified both ways** in every combine (`chains/near.js` `checkRoutes`): NEAR's 7
      surface routes are NEAR pages, the 8 Stellar targets in NEAR's switcher are Stellar pages.

**Production exposure follows the combine's command line:** a production `combine.js xrpl near --write` offers
NEAR and nothing else; Arc and Hedera appear only when RAZA releases them and they are added to that command.

## B. On-chain setup (RAZA) — all commands in `contracts/DEPLOY.md`

- [ ] **Fee account registered on every curated token.** 8 of 73 missing today (IKP, WTH, NEARAGENTS, TRADE,
      RIBBIT, xRHEA, gnear, xREF). Operator page: `node _tools/admin/serve-admin.js` →
      http://localhost:8160/feereg.html, target `fees-lumoscore.near`. ~0.01 NEAR.
      Proof: the monitor bot's "Fee account registered on every curated token" turns ✓.
- [ ] **Launch factory** on `lumoscore.near` (fund ~4 NEAR; DEPLOY.md steps 1–3). Proof: bot fact ✓, and the
      launch button on /launchpad/near reads "Confirm & Launch" instead of "coming soon".
- [ ] **Swap router** on `router.lumoscore.near` (~1.7 NEAR; steps 7–9), registered on every token (~0.094 NEAR),
      then `NEAR_ROUTER = 'router.lumoscore.near'` in `_tools/near-router.js` and rebuild (step 10).
      Optional for release: without it swaps work as today (the fee is kept on a refused swap).
- [ ] **LUMOS on NEAR** — RAZA: "we will do that before release". Decide `owner_id` (treasury) and
      `total_supply` in `contracts/lumos-mint-args.json`, mint (steps 4–5), then `NEAR_LUMOS =
      'lumos.lumoscore.near'` in `_tools/near-lumos.js`, rebuild, and check the token page: the 250K discount
      pieces, the LUMOS / NEAR card link and /lumos/near (which then needs NEAR's own LUMOS data — the
      LUMOS-on-Stellar layer turns itself off).

## C. Real-wallet tests on staging (RAZA) — nothing has been signed for real yet

Small amounts. Desktop AND a real phone (iPhone and Android): mobile wallets behave differently.

- [ ] Connect: HOT, Meteor, MyNearWallet, Intear, NEAR Mobile. The header shows the account, the network logo is NEAR.
- [ ] Wallet page: balances match a NEAR explorer.
- [ ] Swap NEAR → USDC (small). Output arrives; 0.2% reaches `fees-lumoscore.near` (with the router: memo `lx:sw`).
- [ ] Swap a token → NEAR (output arrives as native NEAR).
- [ ] Wallet → Swap dialog (live since 2026-10-24, one step like Stellar): a small swap each way; the fee and
      minimum shown match what arrives; close and reopen clears it. Verified so far only with signing stubbed.
- [ ] Limit order: place, see it in the book, cancel it. First order shows the ~0.5 NEAR order-book deposit.
- [ ] Send a token to an account that never held it (registration added in the same transaction).
- [ ] Bridge: a small NEAR → USDC (Base or Ethereum) via NEAR Intents. Delivered; the row appears under recent
      bridges, and still appears from a different browser (recovered from chain).
- [ ] Launch (after B): a tiny test token → `<ticker>.lumoscore.near`; pool created and seeded; confirm page
      truthful. (It is a real token on mainnet: choose a name you are happy to keep.)
- [ ] Add and remove liquidity on one pool.

## D. Release-day gates (Claude)

- [ ] `C:\LumosCore-NEAR`: `git status` clean; `node _tools/rebuild.js --base` (the canonical build, not
      incremental) + `npm run build` + `node _tools/predeploy_check.js` = PASS.
- [ ] Both switches set as intended (`_tools/near-lumos.js`, `_tools/near-router.js`), and the built pages agree:
      `grep -oh "var LUMOS = '[^']*'\|ROUTER_STAMP = '[^']*'" dist/near/lumoscore-dex-asset.html`.
- [ ] Monitor bot clean on the final staging build: `cd C:\LumosCore-Monitor && node run.js --net near`
      (full, not --quick): 0 ✕; the only ! allowed are facts for contracts deliberately not deployed.
- [ ] `chains/near.js` hooks (section A) pass inside the combine: it dies on any failure.

## E. The release (Claude, only on RAZA's explicit "release NEAR")

Production already carries Stellar + XRPL. Add ONLY NEAR — not Arc, not Hedera, not other sessions' unreleased work.

1. [ ] Announce to the Arc and Hedera sessions: production deploy starting; hold staging deploys.
2. [ ] **Empty `C:\LumosCore-Deploy\.deploy` first.** combine.js adds and overwrites but NEVER deletes, and
       every staging build is four-way: without this, Arc's and Hedera's page folders and their Functions
       (19 fork Functions, seen 2026-10-26) ride into production, unreachable only until a routing change.
       Then `node C:\LumosCore-Deploy\combine.js xrpl near --write` (no arc, no hedera). Dry run (without
       --write) passed on 2026-10-22: 12 generic fork rules, 85 of the 100 redirect rules Pages honours.
       Check, which must print NOTHING: `ls C:/LumosCore-Deploy/.deploy/dist | grep -E "^(arc|hedera)$"` and
       `ls C:/LumosCore-Deploy/.deploy/functions/lxapi | grep -E "^(arc|hedera)"`.
3. [ ] Prove only the intended change ships — the deploy-only-your-change method: compare our own
       `<script id="lx-*">` blocks (sha1 per id) of every page in `.deploy/dist` against what lumoscore.com
       serves now. Stellar and XRPL pages: no differences except middleware-injected `lx-ld-core` and the
       NEAR entries in the chain switcher / chooser. NEAR: all new. List `functions/` files against
       production's: new = NEAR's (`nearmarket`, `nearpools`, `neartoken`, `nearoneclick`, `nearstats`, `neartrades`, `_nearcurated`, the
       NEAR sitemap module) and nothing else. Any other difference → stop.
4. [ ] Note the current production deployment id (the rollback target):
       `npx wrangler pages deployment list --project-name=lumoscore | head -6`
5. [ ] Upload:
       `npx wrangler pages deploy dist --cwd C:/LumosCore-Deploy/.deploy --project-name=lumoscore --branch=main --commit-dirty=true`
6. [ ] Verify on the PER-DEPLOYMENT url first (the lumoscore.com alias can lag minutes), then on lumoscore.com:
       /trade/near, a token page, /pools/near, /bridge/near, /launchpad/near, /lumos/near, /wallet (as NEAR),
       and Stellar + XRPL pages unchanged. Then flip the monitor: `COMBINED = true` in
       `C:\LumosCore-Monitor\networks\near.js`, run `node run.js --net near`.
7. [ ] `ONECLICK_JWT` is bound on the production project (`npx wrangler pages secret list --project-name=lumoscore`,
       names only — it was there on 2026-10-22); the bridge reports `keyed: true` at /lxapi/nearoneclick?op=tokens.
8. [ ] Tell the Arc and Hedera sessions production moved, and record the release (deployment id + rollback id)
       in the NEAR memory notes.

## F. Rollback

If anything is wrong after step 5: Cloudflare dashboard → Pages → `lumoscore` → Deployments → the id noted in
step 4 → "Rollback to this deployment". Instant, no rebuild. Then fix on staging and start section D again.
Nothing on-chain is rolled back by this (contracts, registrations and the LUMOS mint stay), and none of it needs to be.
