-- Allow up to three successfully completed images per account per UTC day.
-- The account-state counter is authoritative for quota decisions and admin totals;
-- the daily event row remains a best-effort audit summary.
ALTER TABLE daily_image_account_state
  ADD COLUMN generated_date TEXT;

ALTER TABLE daily_image_account_state
  ADD COLUMN generated_count INTEGER NOT NULL DEFAULT 0
  CHECK (generated_count BETWEEN 0 AND 3);

ALTER TABLE daily_image_usage
  ADD COLUMN successful_count INTEGER NOT NULL DEFAULT 1
  CHECK (successful_count BETWEEN 1 AND 3);

-- Before this migration there was a maximum of one successful image per day.
UPDATE daily_image_account_state
SET generated_date = substr(generated_at, 1, 10), generated_count = 1
WHERE generated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS daily_image_account_state_by_generated_date_idx
  ON daily_image_account_state (generated_date, user_id);
