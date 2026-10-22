# NEAR → production (lumoscore.com) release checklist

Written 2026-10-22 against staging `c435a9c6`. Production today serves Stellar + XRPL as ONE combined artifact;
releasing NEAR means that artifact becomes Stellar + XRPL + NEAR. Arc and Hedera are not part of this release.

Tick every box in order. A box that cannot be ticked stops the release; it is never "probably fine".

---

## A. Build work still open (Claude, before release) — BLOCKERS

Found by checking staging, 2026-10-22. Production users must be able to FIND NEAR, and search engines must see
its pages. Today neither is true:

- [ ] **Stellar's chain switcher does not list NEAR.** Stellar pages carry `ORDER=["stellar","xrpl"]` in `lx-mc`,
      so from lumoscore.com nobody can switch to NEAR. XRPL is offered through its combine hook
      (`C:\LumosCore-Deploy\chains\xrpl.js`, `afterStatic` + `checkRoutes`). NEAR needs the same in
      `chains\near.js`. Arc and Hedera have the same gap, so agree one approach with those sessions first.
      Never by editing C:\LumosCore.
- [ ] **Stellar's "Choose a network" cards do not offer NEAR** (the Trade page has an XRPL card, no NEAR card).
      Same hook, same rule.
- [ ] **Sitemap: 8 NEAR urls vs 933 XRPL.** NEAR token and pool pages are missing. XRPL adds them through a
      sitemap module (`functions/_xrplsitemap.js` wired by its hook). NEAR needs `functions/_nearsitemap.js` built
      from the curated list and its pools, wired in `chains\near.js`, and the same for `llms.txt`.
- [ ] **Chain-switch targets verified both ways** (the `checkRoutes` hook XRPL has): every NEAR page's Stellar
      counterpart exists and vice versa.

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
2. [ ] `node C:\LumosCore-Deploy\combine.js xrpl near --write` (no arc, no hedera). Dry run (without --write)
       passed on 2026-10-22: 12 generic fork rules, 85 of the 100 redirect rules Pages honours.
3. [ ] Prove only the intended change ships — the deploy-only-your-change method: compare our own
       `<script id="lx-*">` blocks (sha1 per id) of every page in `.deploy/dist` against what lumoscore.com
       serves now. Stellar and XRPL pages: no differences except middleware-injected `lx-ld-core` and the
       NEAR entries in the chain switcher / chooser. NEAR: all new. List `functions/` files against
       production's: new = NEAR's (`nearmarket`, `nearpools`, `neartoken`, `nearoneclick`, `_nearcurated`, the
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
