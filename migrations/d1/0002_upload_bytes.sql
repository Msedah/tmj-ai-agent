-- Track cumulative uploaded bytes independently from chat request counts.
ALTER TABLE daily_usage
  ADD COLUMN upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (upload_bytes >= 0);
