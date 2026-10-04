-- Daily authenticated activity used only by the owner-only admin dashboard.
-- Store account IDs and server timestamps; never store email addresses or prompt content.
CREATE TABLE IF NOT EXISTS daily_user_activity (
  activity_date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (activity_date, user_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_user_activity_by_day_last_seen_idx
  ON daily_user_activity (activity_date, last_seen_at);
