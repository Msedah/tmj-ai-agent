-- Minimal pseudonymous quota state: UTC day, opaque Supabase user ID, and bounded request counters.
CREATE TABLE IF NOT EXISTS daily_usage (
  usage_date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  chat_count INTEGER NOT NULL DEFAULT 0 CHECK (chat_count >= 0),
  upload_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_count >= 0),
  PRIMARY KEY (usage_date, user_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_usage_by_day_idx
  ON daily_usage (usage_date);
