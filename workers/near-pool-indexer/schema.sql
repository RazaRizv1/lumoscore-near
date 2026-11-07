-- NEAR pool indexer (workers/near-pool-indexer). Apply with:
--   npx wrangler d1 execute lumoscore-near-pooltxs --remote --file=workers/near-pool-indexer/schema.sql
CREATE TABLE IF NOT EXISTS txs (
  id    TEXT PRIMARY KEY,      -- receipt id : action index [: swap action index]
  pool  INTEGER NOT NULL,      -- Rhea pool id
  kind  TEXT NOT NULL,         -- swap | add | remove
  block INTEGER NOT NULL,
  ts    INTEGER NOT NULL,      -- ms, interpolated from block headers
  tx    TEXT,                  -- transaction hash
  who   TEXT,                  -- the trader / provider (sender_id of an ft_transfer_call, else the caller)
  ta    TEXT, aa TEXT,         -- swap: token in, raw amount in
  tb    TEXT, ab TEXT,         -- swap: token out, raw amount out
  extra TEXT                   -- add/remove: {"shares": "...", "tokens": [{"t": token, "a": raw}]}
);
CREATE INDEX IF NOT EXISTS txs_pool_block ON txs (pool, block DESC);
CREATE INDEX IF NOT EXISTS txs_ts ON txs (ts);
CREATE INDEX IF NOT EXISTS txs_who ON txs (who, kind);   -- /who: an account's pools
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
-- Hourly USD prices from Rhea's price list, for the Trade page's day high/low and 7-day curve on tokens CoinGecko
-- does not list. Only tokens a page has asked for (pxwatch) are kept, 8 days of them.
CREATE TABLE IF NOT EXISTS px (t TEXT NOT NULL, h INTEGER NOT NULL, usd REAL NOT NULL, PRIMARY KEY (t, h));
CREATE TABLE IF NOT EXISTS pxwatch (t TEXT PRIMARY KEY, seen INTEGER NOT NULL);
-- How many accounts hold each pool (lpJob). n NULL = not read yet; a = 1 = approximate; at = when last claimed.
CREATE TABLE IF NOT EXISTS lpn (pool INTEGER PRIMARY KEY, n INTEGER, a INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS lpn_at ON lpn (at);
-- A big pool's holder check in progress: its candidate list, the cursor, the running count (lpJob, lpBatch).
CREATE TABLE IF NOT EXISTS lpv (pool INTEGER PRIMARY KEY, list TEXT NOT NULL, pos INTEGER NOT NULL, run INTEGER NOT NULL, st INTEGER NOT NULL, fail INTEGER NOT NULL);
-- Trades per pool per 5-minute window, from DexScreener's rolling m5 (trJob). trw: the pools sampled, first = when it began.
CREATE TABLE IF NOT EXISTS trc (pool TEXT NOT NULL, b INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (pool, b));
CREATE TABLE IF NOT EXISTS trw (pool TEXT PRIMARY KEY, first INTEGER NOT NULL, seen INTEGER NOT NULL);
-- One row per sampling run, b = the window it read: ok 1 when every batch answered. No row, or ok 0: a window nobody saw.
CREATE TABLE IF NOT EXISTS trr (b INTEGER PRIMARY KEY, ok INTEGER NOT NULL);
-- Token logos as the contract publishes them (icon()); u '' = the token publishes none.
CREATE TABLE IF NOT EXISTS icn (t TEXT PRIMARY KEY, u TEXT NOT NULL);
-- pools no list knows the holders of, worked through in liquidity order; lpc is who was found, recounted with the rest
CREATE TABLE IF NOT EXISTS lpx (pool INTEGER PRIMARY KEY, rank INTEGER NOT NULL DEFAULT 99999, tries INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, t TEXT);
CREATE INDEX IF NOT EXISTS lpx_next ON lpx (done, rank);
CREATE TABLE IF NOT EXISTS lpc (pool INTEGER NOT NULL, who TEXT NOT NULL, PRIMARY KEY (pool, who));
