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
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
