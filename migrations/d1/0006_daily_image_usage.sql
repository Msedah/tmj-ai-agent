-- Successful generated-image allowance, tracked separately from chat/upload counts.
-- Stores account IDs and timestamps only; image prompts and image bytes are never persisted.
CREATE TABLE IF NOT EXISTS daily_image_usage (
  usage_date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  claim_id TEXT NOT NULL UNIQUE,
  requested_at TEXT NOT NULL,
  generated_at TEXT,
  PRIMARY KEY (usage_date, user_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_image_usage_by_day_generated_idx
  ON daily_image_usage (usage_date, generated_at);
