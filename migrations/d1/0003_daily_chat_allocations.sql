-- Admin-assigned per-account daily chat allocation. The shared 350/day cap remains enforced separately.
CREATE TABLE IF NOT EXISTS daily_chat_allocations (
  user_id TEXT PRIMARY KEY,
  chat_limit INTEGER NOT NULL CHECK (chat_limit >= 0 AND chat_limit <= 350),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) WITHOUT ROWID;
