-- Account-wide image claim lock prevents a request crossing UTC midnight from opening a second daily slot.
-- The last successful UTC timestamp is the authoritative source for image access and admin counts.
-- Stores only account IDs and timestamps; prompts and image bytes are never persisted.
CREATE TABLE IF NOT EXISTS daily_image_account_state (
  user_id TEXT PRIMARY KEY,
  claim_id TEXT UNIQUE,
  claimed_at TEXT,
  generated_at TEXT,
  CHECK ((claim_id IS NULL AND claimed_at IS NULL) OR (claim_id IS NOT NULL AND claimed_at IS NOT NULL))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_image_account_state_by_generated_at_idx
  ON daily_image_account_state (generated_at);
