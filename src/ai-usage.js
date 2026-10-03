export const DAILY_USER_SHARED_NEURON_LIMIT = 9_000;
export const DAILY_OWNER_NEURON_LIMIT = 1_000;
export const NEURON_MILLI_SCALE = 1_000;
export const DAILY_USER_SHARED_NEURON_LIMIT_MILLI = DAILY_USER_SHARED_NEURON_LIMIT * NEURON_MILLI_SCALE;
export const DAILY_OWNER_NEURON_LIMIT_MILLI = DAILY_OWNER_NEURON_LIMIT * NEURON_MILLI_SCALE;

// SHA-256 fingerprint of the owner Supabase UUID; the raw account identifier is not stored in public source.
const OWNER_USER_ID_FINGERPRINT = "8892fe53f92c4a0afecf91e7108fed2009006022622c94e66d8927f1328c7b8e";

// Cloudflare published pricing table (checked 2026-10-04): https://developers.cloudflare.com/workers-ai/platform/pricing/
// Rates below are Neurons per million tokens for the models used by TMJ.
const CHAT_INPUT_NEURONS_PER_MILLION = 4_625;
const CHAT_OUTPUT_NEURONS_PER_MILLION = 30_475;
const EMBEDDING_INPUT_NEURONS_PER_MILLION = 1_841;
const EMBEDDING_MAX_INPUT_TOKENS = 512;
const CHAT_MAX_OUTPUT_TOKENS = 1_200;
const RESERVE_DAILY_NEURONS_QUERY = `
  INSERT INTO daily_ai_neuron_usage (usage_date, user_id, budget_pool, neurons_used_milli, neurons_reserved_milli, updated_at)
  SELECT ?1, ?2, ?3, 0, ?4, ?5
  WHERE CASE WHEN ?3 = 'owner'
    THEN COALESCE((SELECT SUM(neurons_used_milli + neurons_reserved_milli)
      FROM daily_ai_neuron_usage WHERE usage_date = ?1 AND budget_pool = 'owner'), 0) + ?4 <= ?6
    ELSE COALESCE((SELECT SUM(neurons_used_milli + neurons_reserved_milli)
      FROM daily_ai_neuron_usage WHERE usage_date = ?1 AND budget_pool = 'shared'), 0) + ?4 <= ?7
  END
  ON CONFLICT (usage_date, user_id) DO UPDATE SET
    budget_pool = excluded.budget_pool,
    neurons_reserved_milli = daily_ai_neuron_usage.neurons_reserved_milli + excluded.neurons_reserved_milli,
    updated_at = excluded.updated_at
  WHERE CASE WHEN excluded.budget_pool = 'owner'
    THEN COALESCE((SELECT SUM(neurons_used_milli + neurons_reserved_milli)
      FROM daily_ai_neuron_usage WHERE usage_date = excluded.usage_date AND budget_pool = 'owner'), 0) + excluded.neurons_reserved_milli <= ?6
    ELSE COALESCE((SELECT SUM(neurons_used_milli + neurons_reserved_milli)
      FROM daily_ai_neuron_usage WHERE usage_date = excluded.usage_date AND budget_pool = 'shared'), 0) + excluded.neurons_reserved_milli <= ?7
  END
  RETURNING user_id
`;
const SETTLE_DAILY_NEURONS_QUERY = `
  UPDATE daily_ai_neuron_usage
  SET neurons_used_milli = neurons_used_milli + ?4,
      neurons_reserved_milli = neurons_reserved_milli - ?3,
      updated_at = ?5
  WHERE usage_date = ?1 AND user_id = ?2 AND neurons_reserved_milli >= ?3
  RETURNING user_id
`;
const encoder = new TextEncoder();

function ceilMilliNeurons(rawNeurons) {
  if (!Number.isFinite(rawNeurons) || rawNeurons < 0) throw new Error("Invalid Workers AI Neuron estimate.");
  const milli = Math.ceil(rawNeurons * NEURON_MILLI_SCALE);
  if (!Number.isSafeInteger(milli)) throw new Error("Workers AI Neuron estimate exceeds safe accounting bounds.");
  return milli;
}

function usableTokenCount(value) {
  const tokens = Number(value);
  return Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null;
}

function getUsage(result) {
  return result?.usage && typeof result.usage === "object" ? result.usage : null;
}

export async function fingerprintUserId(userId) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(userId)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function isOwnerAiBudgetUser(userId, ownerFingerprint = OWNER_USER_ID_FINGERPRINT) {
  return Boolean(userId) && await fingerprintUserId(userId) === ownerFingerprint;
}

export function calculateChatNeuronsMilli(usage) {
  const promptTokens = usableTokenCount(usage?.prompt_tokens);
  const completionTokens = usableTokenCount(usage?.completion_tokens);
  if (promptTokens === null || completionTokens === null) return null;
  return ceilMilliNeurons(
    (promptTokens * CHAT_INPUT_NEURONS_PER_MILLION + completionTokens * CHAT_OUTPUT_NEURONS_PER_MILLION) / 1_000_000
  );
}

export function estimateChatNeuronsMilli(messages, maxOutputTokens = CHAT_MAX_OUTPUT_TOKENS) {
  const safeMaxOutputTokens = usableTokenCount(maxOutputTokens);
  if (safeMaxOutputTokens === null) throw new Error("Invalid maximum output token count.");
  const serializedInputBytes = encoder.encode(JSON.stringify(messages)).byteLength;
  // Byte length plus framing slack is a conservative pre-inference token upper bound.
  const promptTokenUpperBound = serializedInputBytes + Math.max(64, messages.length * 32);
  return ceilMilliNeurons(
    (promptTokenUpperBound * CHAT_INPUT_NEURONS_PER_MILLION + safeMaxOutputTokens * CHAT_OUTPUT_NEURONS_PER_MILLION) / 1_000_000
  );
}

export function estimateEmbeddingNeuronsMilli(inputs) {
  const tokenUpperBound = inputs.reduce((sum, value) => {
    const bytes = encoder.encode(String(value)).byteLength;
    return sum + Math.min(EMBEDDING_MAX_INPUT_TOKENS, bytes + 8);
  }, 0);
  return ceilMilliNeurons(tokenUpperBound * EMBEDDING_INPUT_NEURONS_PER_MILLION / 1_000_000);
}

function calculateActualEmbeddingNeuronsMilli(result, fallbackMilli) {
  const promptTokens = usableTokenCount(getUsage(result)?.prompt_tokens);
  return promptTokens === null
    ? fallbackMilli
    : ceilMilliNeurons(promptTokens * EMBEDDING_INPUT_NEURONS_PER_MILLION / 1_000_000);
}

export async function reserveDailyAiNeurons(database, userId, requestedMilli, now = new Date(), poolOverride = null) {
  if (!database || typeof database.prepare !== "function") throw new Error("Daily AI usage database is not configured.");
  if (!Number.isSafeInteger(requestedMilli) || requestedMilli < 1) throw new Error("A positive AI Neuron reservation is required.");
  const accountId = String(userId);
  const budgetPool = poolOverride === "owner" || poolOverride === "shared"
    ? poolOverride
    : await isOwnerAiBudgetUser(accountId) ? "owner" : "shared";
  const timestamp = new Date(now);
  const row = await database.prepare(RESERVE_DAILY_NEURONS_QUERY)
    .bind(
      timestamp.toISOString().slice(0, 10),
      accountId,
      budgetPool,
      requestedMilli,
      timestamp.toISOString(),
      DAILY_OWNER_NEURON_LIMIT_MILLI,
      DAILY_USER_SHARED_NEURON_LIMIT_MILLI
    )
    .first();
  return { allowed: Boolean(row), resetAt: row ? null : new Date(Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate() + 1)).toISOString() };
}

export async function settleDailyAiNeurons(database, userId, reservedMilli, actualMilli, now = new Date()) {
  if (!database || typeof database.prepare !== "function") throw new Error("Daily AI usage database is not configured.");
  if (!Number.isSafeInteger(reservedMilli) || reservedMilli < 1 || !Number.isSafeInteger(actualMilli) || actualMilli < 0) {
    throw new Error("Invalid Workers AI Neuron settlement.");
  }
  const timestamp = new Date(now);
  const row = await database.prepare(SETTLE_DAILY_NEURONS_QUERY)
    .bind(timestamp.toISOString().slice(0, 10), String(userId), reservedMilli, actualMilli, timestamp.toISOString())
    .first();
  if (!row) throw new Error("Workers AI Neuron reservation could not be settled.");
}

export class DailyAiNeuronLimitError extends Error {
  constructor() {
    super("The daily AI allowance has been reached.");
    this.name = "DailyAiNeuronLimitError";
  }
}

export async function runMeteredAi(model, input, env, userId, estimateMilli, getActualMilli, poolOverride = null) {
  let reservedMilli = null;
  const reservedAt = new Date();
  if (userId) {
    const reservation = await reserveDailyAiNeurons(env.USAGE_DB, userId, estimateMilli, reservedAt, poolOverride);
    if (!reservation.allowed) throw new DailyAiNeuronLimitError();
    reservedMilli = estimateMilli;
  }

  let result;
  try {
    result = await env.AI.run(model, input);
  } catch (error) {
    if (reservedMilli !== null) console.warn("Workers AI failed after budget reservation; the conservative hold remains until daily reset.");
    throw error;
  }

  if (reservedMilli !== null) {
    const reportedMilli = getActualMilli(result, reservedMilli);
    if (reportedMilli > reservedMilli) console.error("Workers AI usage exceeded its conservative reservation; account and future requests are being charged the reported usage.");
    // If this accounting write fails, keep the conservative reservation instead of releasing unaccounted usage.
    try { await settleDailyAiNeurons(env.USAGE_DB, userId, reservedMilli, reportedMilli, reservedAt); }
    catch { console.warn("Workers AI usage settlement failed; the conservative reservation remains held until daily reset."); }
  }
  return result;
}

export function actualChatNeuronsMilli(result, fallbackMilli) {
  return calculateChatNeuronsMilli(getUsage(result)) ?? fallbackMilli;
}

export function actualEmbeddingNeuronsMilli(result, fallbackMilli) {
  return calculateActualEmbeddingNeuronsMilli(result, fallbackMilli);
}
