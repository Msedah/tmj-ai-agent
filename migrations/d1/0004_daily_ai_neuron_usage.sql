-- Daily app-local Workers AI Neuron estimates and in-flight reservations, kept separate from chat counts.
-- Rows store UTC days, pseudonymous account/system keys, pool labels, and counters; prompt content is never stored.
CREATE TABLE IF NOT EXISTS daily_ai_neuron_usage (
  usage_date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  budget_pool TEXT NOT NULL CHECK (budget_pool IN ('shared', 'owner')),
  neurons_used_milli INTEGER NOT NULL DEFAULT 0 CHECK (neurons_used_milli >= 0),
  neurons_reserved_milli INTEGER NOT NULL DEFAULT 0 CHECK (neurons_reserved_milli >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (usage_date, user_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_ai_neuron_usage_by_day_idx
  ON daily_ai_neuron_usage (usage_date);
