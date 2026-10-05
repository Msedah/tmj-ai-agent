import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, {
  consumeDailyUsage,
  DAILY_CHAT_LIMIT,
  DAILY_LIMIT_MESSAGE,
  DAILY_UPLOAD_LIMIT_MESSAGE,
  DAILY_UPLOAD_LIMIT,
  embedMany,
  extractBearerToken,
  extractDocumentText,
  formatCurrentDateContext,
  generateChatResponse,
  generateImage,
  getDailyUsageStatus,
  getDeveloperIdentityReply,
  getDeveloperIdentityResponse,
  GLOBAL_DAILY_CHAT_LIMIT,
  isSupportedDocument,
  MAX_DAILY_USERS,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_CHUNKS,
  nextUtcResetAt,
  normalizeExtractedText,
  sanitizeAssistantReply,
  shouldSearchNwuLiveSources,
  utcUsageDay
} from "../src/index.js";
import {
  actualChatNeuronsMilli,
  calculateChatNeuronsMilli,
  DailyAiNeuronLimitError,
  DAILY_OWNER_NEURON_LIMIT_MILLI,
  DAILY_USER_IMAGE_NEURON_LIMIT,
  DAILY_USER_IMAGE_NEURON_LIMIT_MILLI,
  DAILY_USER_STANDARD_NEURON_LIMIT_MILLI,
  DAILY_USER_SHARED_NEURON_LIMIT_MILLI,
  estimateChatNeuronsMilli,
  estimateEmbeddingNeuronsMilli,
  IMAGE_NEURON_RESERVATION_MILLI,
  actualImageNeuronsMilli,
  fingerprintUserId,
  reserveDailyAiNeurons,
  runMeteredAi,
  settleDailyAiNeurons
} from "../src/ai-usage.js";
import {
  buildNwuSearchQuery,
  extractPublicPdfLinks,
  isPublicNwuUrl,
  normalizePublicNwuUrl,
  parseNwuSearchResults,
  searchNwuLiveSources
} from "../src/nwu-search.js";

function mockUsageDatabase(firstResult) {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return { first: async () => typeof firstResult === "function" ? firstResult({ sql, bindings }) : firstResult };
        }
      };
    }
  };
}

test("extractBearerToken strips a case-insensitive Bearer prefix", () => {
  assert.equal(extractBearerToken("Bearer abc123"), "abc123");
  assert.equal(extractBearerToken("bearer   abc123  "), "abc123");
});

test("extractBearerToken handles empty and bare values", () => {
  assert.equal(extractBearerToken(""), "");
  assert.equal(extractBearerToken("abc123"), "abc123");
});

test("isSupportedDocument accepts the advertised document formats", () => {
  for (const name of ["notes.pdf", "slides.DOCX", "summary.txt", "module.md"]) {
    assert.equal(isSupportedDocument(name), true, name);
  }
});

test("isSupportedDocument rejects unsupported and misleading extensions", () => {
  for (const name of ["notes.exe", "notes.pdf.exe", "no-extension"]) {
    assert.equal(isSupportedDocument(name), false, name);
  }
});

test("unified parser extracts readable text from every supported office and document format", async () => {
  const formats = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "odp", "ods", "odg", "rtf", "csv", "txt", "md", "html", "htm", "epub", "tex", "ltx"];
  for (const extension of formats) {
    const fileName = `sample.${extension}`;
    const bytes = readFileSync(new URL(`./fixtures/${fileName}`, import.meta.url));
    const text = await extractDocumentText(fileName, bytes);
    assert.match(text, /Academic integrity/i, `${fileName} should yield readable text`);
  }
});

test("normalizeExtractedText collapses whitespace and trims edges", () => {
  assert.equal(normalizeExtractedText("  one\n\t two   three  "), "one two three");
});

test("current date context gives the model a trusted UTC clock and South African local date", () => {
  const context = formatCurrentDateContext(new Date("2026-10-03T23:59:00.000Z"));
  assert.match(context, /UTC 2026-10-03T23:59:00\.000Z/);
  assert.match(context, /South Africa \(Africa\/Johannesburg\)/);
  assert.match(context, /4 October 2026/);
  assert.match(context, /01:59:00/);
});

test("daily usage helpers use UTC dates, return no balances, and parameterize atomic caps", async () => {
  const now = new Date("2026-10-01T23:30:00.000Z");
  const calls = [];
  const database = mockUsageDatabase(({ sql, bindings }) => {
    calls.push({ sql, bindings });
    return sql.includes("INSERT INTO") ? { chat_count: 35, upload_count: 0 } : {
      user_chat_count: 7, user_chat_limit: DAILY_CHAT_LIMIT, user_upload_count: 0, user_upload_bytes: 0, global_chat_count: 349
    };
  });

  assert.equal(utcUsageDay(now), "2026-10-01");
  assert.equal(nextUtcResetAt(now), "2026-10-02T00:00:00.000Z");
  assert.equal(DAILY_CHAT_LIMIT, 60);
  assert.equal(GLOBAL_DAILY_CHAT_LIMIT, 350);
  assert.equal(DAILY_USER_SHARED_NEURON_LIMIT_MILLI, 9_000_000);
  assert.equal(DAILY_OWNER_NEURON_LIMIT_MILLI, 1_000_000);
  assert.equal(DAILY_UPLOAD_LIMIT, 40 * 1024 * 1024);
  assert.equal(MAX_DAILY_USERS, 10);
  assert.equal(MAX_DOCUMENT_BYTES, 40 * 1024 * 1024);
  assert.equal(MAX_DOCUMENT_CHUNKS, 20);

  const status = await getDailyUsageStatus(database, "opaque-user-id", now);
  assert.deepEqual(status, {
    chatAllowed: true,
    uploadAllowed: true,
    aiBudgetAvailable: true,
    uploadCount: 0,
    uploadBytesUsed: 0,
    uploadBytesRemaining: DAILY_UPLOAD_LIMIT,
    resetAt: null
  });
  assert.deepEqual(calls[0].bindings, ["2026-10-01", "opaque-user-id", 60]);
  assert.match(calls[0].sql, /SUM\(chat_count\)/);
  assert.match(calls[0].sql, /upload_bytes/);
  assert.match(calls[0].sql, /daily_ai_neuron_usage/);

  const consumed = await consumeDailyUsage(database, "opaque-user-id", "chat", now);
  assert.equal(consumed.allowed, true);
  assert.deepEqual(calls[1].bindings, ["2026-10-01", "opaque-user-id", "chat", 60, 350, DAILY_UPLOAD_LIMIT, 10, 0]);
  assert.match(calls[1].sql, /ON CONFLICT \(usage_date, user_id\) DO UPDATE/);
  assert.match(calls[1].sql, /RETURNING chat_count, upload_count/);
  assert.match(calls[1].sql, /\?3 = 'upload' OR daily_usage\.chat_count < COALESCE\(\(SELECT chat_limit FROM daily_chat_allocations WHERE user_id = \?2\), \?4\)/);
  assert.match(calls[1].sql, /\?3 = 'chat' OR daily_usage\.upload_bytes \+ \?8 <= \?6/);
  assert.match(calls[1].sql, /COUNT\(\*\).*< \?7/s);

  const fullPilot = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 0, user_upload_count: 0, user_upload_bytes: 0, global_chat_count: 32, user_active: 0, active_users_count: 10
  }), "new-user", now);
  assert.equal(fullPilot.chatAllowed, false);
  assert.equal(fullPilot.uploadAllowed, false);
  assert.equal(fullPilot.resetAt, "2026-10-02T00:00:00.000Z");
  const existingTester = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 0, user_upload_count: 0, user_upload_bytes: 0, global_chat_count: 32, user_active: 1, active_users_count: 10
  }), "active-user", now);
  assert.equal(existingTester.chatAllowed, true);
  assert.equal(existingTester.uploadAllowed, true);
  assert.equal(existingTester.resetAt, null);

  const sharedChatsExhausted = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 35, user_upload_count: 2, user_upload_bytes: 1024, global_chat_count: 350, user_active: 1, active_users_count: 10
  }), "active-user", now);
  assert.equal(sharedChatsExhausted.chatAllowed, false);
  assert.equal(sharedChatsExhausted.uploadAllowed, true, "upload bytes have a separate daily budget from chats");

  const denied = await consumeDailyUsage(mockUsageDatabase(null), "opaque-user-id", "chat", now);
  assert.deepEqual(denied, { allowed: false, resetAt: "2026-10-02T00:00:00.000Z" });
  assert.match(DAILY_LIMIT_MESSAGE, /come back tomorrow/i);
});

test("default daily chat limit is 60 requests and allocations remain under the shared cap", async () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const oneRemaining = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 59, user_chat_limit: null, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 200, user_active: 1, active_users_count: 3
  }), "active-user", now);
  assert.equal(oneRemaining.chatAllowed, true, "the default permits the 60th request to be sent");

  const defaultReached = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 60, user_chat_limit: null, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 200, user_active: 1, active_users_count: 3
  }), "active-user", now);
  assert.equal(defaultReached.chatAllowed, false, "the default blocks requests after 60 for the day");

  const allocated = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 60, user_chat_limit: 80, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 200, user_active: 1, active_users_count: 3
  }), "active-user", now);
  assert.equal(allocated.chatAllowed, true, "an allocation above 60 grants that account extra daily requests");

  const reachedAllocation = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 80, user_chat_limit: 80, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 200, user_active: 1, active_users_count: 3
  }), "active-user", now);
  assert.equal(reachedAllocation.chatAllowed, false, "the account is denied after its assigned daily limit");

  const sharedLimitReached = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 10, user_chat_limit: 100, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 350, user_active: 1, active_users_count: 3
  }), "active-user", now);
  assert.equal(sharedLimitReached.chatAllowed, false, "no account allocation bypasses the shared 350-request ceiling");

  const sharedNeuronsExhausted = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 0, user_chat_limit: null, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 0, user_active: 1, active_users_count: 1,
    shared_ai_neurons_milli: 9_000_000, shared_standard_ai_neurons_milli: 8_000_000
  }), "active-user", now);
  assert.equal(sharedNeuronsExhausted.aiBudgetAvailable, false);
  assert.equal(sharedNeuronsExhausted.chatAllowed, false);
  assert.equal(sharedNeuronsExhausted.uploadAllowed, false);

  const imageBudgetUsed = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 0, user_chat_limit: null, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 0, user_active: 1, active_users_count: 1,
    shared_ai_neurons_milli: 1_000_000, shared_standard_ai_neurons_milli: 0
  }), "active-user", now);
  assert.equal(imageBudgetUsed.aiBudgetAvailable, true, "image-specific Neurons do not exhaust the 8,000-Neuron standard allocation");
  assert.equal(imageBudgetUsed.chatAllowed, true);

  const testOwnerId = "synthetic-owner-test-id";
  const testOwnerFingerprint = await fingerprintUserId(testOwnerId);
  const ownerNeuronsExhausted = await getDailyUsageStatus(mockUsageDatabase({
    user_chat_count: 0, user_chat_limit: null, user_upload_count: 0, user_upload_bytes: 0,
    global_chat_count: 0, user_active: 1, active_users_count: 1, owner_ai_neurons_milli: 1_000_000
  }), testOwnerId, now, testOwnerFingerprint);
  assert.equal(ownerNeuronsExhausted.aiBudgetAvailable, false);
  assert.equal(ownerNeuronsExhausted.chatAllowed, false);
  assert.equal(ownerNeuronsExhausted.uploadAllowed, false);
});

test("Workers AI Neuron estimates use published rates and reserve conservative inference ceilings", () => {
  assert.equal(calculateChatNeuronsMilli({ prompt_tokens: 1_000_000, completion_tokens: 0 }), 4_625_000);
  assert.equal(calculateChatNeuronsMilli({ prompt_tokens: 0, completion_tokens: 1_000_000 }), 30_475_000);
  assert.equal(calculateChatNeuronsMilli({ prompt_tokens: 1 }), null, "missing token counts fall back to a conservative reservation");

  const messages = [{ role: "system", content: "System instructions." }, { role: "user", content: "Hello" }];
  const estimate = estimateChatNeuronsMilli(messages, 1200);
  const actualAtOutputCap = calculateChatNeuronsMilli({ prompt_tokens: 80, completion_tokens: 1200 });
  assert.ok(estimate >= actualAtOutputCap, "preflight reservation covers the byte-based prompt upper bound and output cap");
  assert.equal(estimateEmbeddingNeuronsMilli(["x".repeat(5000)]), 943, "BGE's 512-token input ceiling is conservatively reserved");
  assert.ok(estimateEmbeddingNeuronsMilli(["short query"]) > 0);
  assert.equal(DAILY_USER_SHARED_NEURON_LIMIT_MILLI, 9_000_000);
  assert.equal(DAILY_OWNER_NEURON_LIMIT_MILLI, 1_000_000);
});

test("daily Neuron reservations atomically separate the verified owner reserve from the shared user pool", async () => {
  const now = new Date("2026-10-01T23:30:00.000Z");
  const calls = [];
  const database = {
    prepare(sql) {
      return { bind(...bindings) {
        calls.push({ sql, bindings });
        return { first: async () => ({ user_id: bindings[1] }) };
      } };
    }
  };

  assert.deepEqual(await reserveDailyAiNeurons(database, "student-id", 2500, now), { allowed: true, resetAt: null });
  assert.deepEqual(calls[0].bindings, ["2026-10-01", "student-id", "shared", 2500, now.toISOString(), 1_000_000, 9_000_000, DAILY_USER_IMAGE_NEURON_LIMIT_MILLI, DAILY_USER_STANDARD_NEURON_LIMIT_MILLI]);
  assert.match(calls[0].sql, /SUM\(neurons_used_milli \+ neurons_reserved_milli\)/);
  assert.match(calls[0].sql, /budget_pool = 'shared'/);

  assert.deepEqual(await reserveDailyAiNeurons(database, "system:nwu-indexing", 1250, now, "owner"), { allowed: true, resetAt: null });
  assert.deepEqual(calls[1].bindings.slice(1), ["system:nwu-indexing", "owner", 1250, now.toISOString(), 1_000_000, 9_000_000, DAILY_USER_IMAGE_NEURON_LIMIT_MILLI, DAILY_USER_STANDARD_NEURON_LIMIT_MILLI]);
  assert.match(calls[1].sql, /budget_pool = 'owner'/);

  const denied = await reserveDailyAiNeurons({ prepare: () => ({ bind: () => ({ first: async () => null }) }) }, "student-id", 1, now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.resetAt, "2026-10-02T00:00:00.000Z");
});

test("image Neuron reservations use a protected sub-pool and leave the standard shared pool capped at 8,000", async () => {
  const now = new Date("2026-10-01T23:30:00.000Z");
  let call;
  const database = { prepare(sql) { return { bind(...bindings) { call = { sql, bindings }; return { first: async () => ({ user_id: bindings[1] }) }; } }; } };
  assert.deepEqual(await reserveDailyAiNeurons(database, "student-id#image", IMAGE_NEURON_RESERVATION_MILLI, now), { allowed: true, resetAt: null });
  assert.equal(call.bindings[1], "student-id#image");
  assert.equal(call.bindings[5], DAILY_OWNER_NEURON_LIMIT_MILLI);
  assert.equal(call.bindings[6], DAILY_USER_SHARED_NEURON_LIMIT_MILLI);
  assert.equal(call.bindings[7], DAILY_USER_IMAGE_NEURON_LIMIT_MILLI);
  assert.equal(call.bindings[8], DAILY_USER_STANDARD_NEURON_LIMIT_MILLI);
  assert.match(call.sql, /user_id LIKE '%#image'/);
  assert.match(call.sql, /user_id NOT LIKE '%#image'/);
  assert.equal(DAILY_USER_IMAGE_NEURON_LIMIT, 1_000);
  assert.equal(DAILY_USER_STANDARD_NEURON_LIMIT_MILLI, 8_000_000);
  assert.equal(IMAGE_NEURON_RESERVATION_MILLI, 80_000);
  assert.equal(actualImageNeuronsMilli({ image: "/9j/2Q==" }, IMAGE_NEURON_RESERVATION_MILLI), IMAGE_NEURON_RESERVATION_MILLI);
});

test("metered Workers AI settles reported chat tokens and never invokes AI when reservation fails", async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      return { bind(...bindings) {
        calls.push({ sql, bindings });
        return { first: async () => ({ user_id: bindings[1] }) };
      } };
    }
  };
  const usage = { prompt_tokens: 120, completion_tokens: 30 };
  let aiCalls = 0;
  const result = await runMeteredAi("chat-model", { messages: [] }, {
    USAGE_DB: database,
    AI: { async run() { aiCalls += 1; return { response: "answer", usage }; } }
  }, "student-id", 50_000, actualChatNeuronsMilli);
  assert.equal(result.response, "answer");
  assert.equal(aiCalls, 1);
  assert.equal(calls.length, 2, "one atomic reservation and one settlement are recorded");
  assert.match(calls[0].sql, /INSERT INTO daily_ai_neuron_usage/);
  assert.match(calls[1].sql, /UPDATE daily_ai_neuron_usage/);
  assert.equal(calls[0].bindings[2], "shared");
  assert.equal(calls[0].bindings[3], 50_000);
  assert.equal(calls[1].bindings[2], 50_000);
  assert.equal(calls[1].bindings[3], calculateChatNeuronsMilli(usage));

  let deniedAiCalls = 0;
  await assert.rejects(() => runMeteredAi("chat-model", {}, {
    USAGE_DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    AI: { async run() { deniedAiCalls += 1; return {}; } }
  }, "student-id", 1, actualChatNeuronsMilli), DailyAiNeuronLimitError);
  assert.equal(deniedAiCalls, 0, "budget denial happens before Cloudflare AI inference");
});

test("generateImage calls FLUX.1 Schnell with fixed low-step settings and meters the image ledger", async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      return { bind(...bindings) {
        calls.push({ sql, bindings });
        return { first: async () => ({ user_id: bindings[1] }) };
      } };
    }
  };
  let aiCall;
  const image = await generateImage("A quiet mountain lake at sunrise", {
    USAGE_DB: database,
    AI: { async run(model, input) { aiCall = { model, input }; return { image: "/9j/2Q==" }; } }
  }, { userId: "student-id" });
  assert.equal(image, "/9j/2Q==");
  assert.deepEqual(aiCall, {
    model: "@cf/black-forest-labs/flux-1-schnell",
    input: { prompt: "A quiet mountain lake at sunrise", steps: 4 }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bindings[1], "student-id#image");
  assert.equal(calls[0].bindings[2], "shared");
  assert.equal(calls[0].bindings[3], IMAGE_NEURON_RESERVATION_MILLI);
  assert.equal(calls[1].bindings[1], "student-id#image");
  assert.equal(calls[1].bindings[2], IMAGE_NEURON_RESERVATION_MILLI);
  assert.equal(calls[1].bindings[3], IMAGE_NEURON_RESERVATION_MILLI);
  await assert.rejects(() => generateImage("invalid model output", {
    USAGE_DB: database,
    AI: { async run() { return { image: "not-base64" }; } }
  }, { userId: "student-id" }), /invalid image response/);
});

test("a failed AI inference keeps its reservation held conservatively until daily reset", async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      return { bind(...bindings) {
        calls.push({ sql, bindings });
        return { first: async () => ({ user_id: bindings[1] }) };
      } };
    }
  };
  await assert.rejects(() => runMeteredAi("chat-model", {}, {
    USAGE_DB: database,
    AI: { async run() { throw new Error("temporary model failure"); } }
  }, "student-id", 10_000, actualChatNeuronsMilli), /temporary model failure/);
  assert.equal(calls.length, 1, "uncertain provider failure leaves the full reservation held");

  await settleDailyAiNeurons(database, "student-id", 10_000, 0, new Date("2026-10-01T23:30:00Z"));
  assert.equal(calls[1].bindings[2], 10_000);
});

test("health route reports service readiness without exposing values", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    ready: false,
    services: { ai: false, chat: false, documentIndexing: false, imageGeneration: false, nwuIngestion: false, dailyUsage: false }
  });
});

test("health route distinguishes chat readiness from optional indexing configuration", async () => {
  const env = {
    AI: { run() {} },
    SUPABASE_URL: "https://private-project.supabase.co",
    SUPABASE_ANON_KEY: "private-anon-key",
    USAGE_DB: { prepare() {} }
  };
  const response = await worker.fetch(new Request("https://example.test/api/health"), env);
  const payload = await response.text();
  assert.deepEqual(JSON.parse(payload), {
    status: "ok",
    ready: false,
    services: { ai: true, chat: true, documentIndexing: false, imageGeneration: true, nwuIngestion: false, dailyUsage: true }
  });
  assert.doesNotMatch(payload, /private-project|private-anon-key/);
});

test("health route marks configured AI, chat, indexing and NWU ingestion ready", async () => {
  const env = {
    AI: { run() {} }, SUPABASE_URL: "https://private-project.supabase.co",
    SUPABASE_ANON_KEY: "private-anon-key", SUPABASE_SERVICE_ROLE_KEY: "private-service-key",
    NWU_INGEST_SECRET: "private-ingest-secret", USAGE_DB: { prepare() {} }
  };
  const response = await worker.fetch(new Request("https://example.test/api/health"), env);
  const payload = await response.text();
  assert.deepEqual(JSON.parse(payload), {
    status: "ok",
    ready: true,
    services: { ai: true, chat: true, documentIndexing: true, imageGeneration: true, nwuIngestion: true, dailyUsage: true }
  });
  assert.doesNotMatch(payload, /private-project|private-anon-key|private-service-key|private-ingest-secret/);
});

test("health route rejects unsupported methods", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health", { method: "POST" }), {});
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Method not allowed" });
});

test("conversation deletion rejects unsupported methods and malformed IDs", async () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const wrongMethod = await worker.fetch(new Request(`https://example.test/api/conversations/${id}`), {});
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(await wrongMethod.json(), { error: "Method not allowed" });

  const malformed = await worker.fetch(new Request("https://example.test/api/conversations/not-a-uuid", { method: "DELETE" }), {});
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Invalid conversation ID." });

  const unauthenticated = await worker.fetch(new Request(`https://example.test/api/conversations/${id}`, { method: "DELETE" }), {});
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Please sign in first." });
});

test("conversation deletion authenticates the owner and scopes service-role delete to their row", async () => {
  const originalFetch = globalThis.fetch;
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    calls.push({ url, request });
    if (url.pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/documents") && request.method === "GET") {
      return new Response(JSON.stringify([{ storage_path: "student-1/study/notes.pdf" }]), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/storage/v1/object/tmj-documents") && request.method === "DELETE") {
      return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/conversations") && request.method === "DELETE") {
      return new Response(JSON.stringify([{ id }]), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected Supabase request: ${request.method} ${url.href}`);
  };

  try {
    const env = {
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "private-service-key"
    };
    const response = await worker.fetch(new Request(`https://example.test/api/conversations/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer student-token" }
    }), env);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, id });
    const userCheck = calls.find(call => call.url.pathname.endsWith("/auth/v1/user"));
    assert.equal(userCheck.request.headers.get("Authorization"), "Bearer student-token");
    const deletion = calls.find(call => call.request.method === "DELETE" && call.url.pathname.endsWith("/rest/v1/conversations"));
    assert.ok(deletion, "a database delete was issued");
    assert.equal(deletion.url.searchParams.get("id"), `eq.${id}`);
    assert.equal(deletion.url.searchParams.get("user_id"), "eq.student-1", "the signed-in user ID is applied as an owner filter");
    assert.equal(deletion.request.headers.get("Authorization"), "Bearer private-service-key");
    const documentLookup = calls.find(call => call.url.pathname.endsWith("/rest/v1/documents"));
    assert.equal(documentLookup.url.searchParams.get("conversation_id"), `eq.${id}`);
    assert.equal(documentLookup.url.searchParams.get("user_id"), "eq.student-1");
    const storageRemoval = calls.find(call => call.url.pathname.endsWith("/storage/v1/object/tmj-documents"));
    assert.ok(storageRemoval, "original private upload file is removed with its conversation");
    assert.deepEqual(JSON.parse(await storageRemoval.request.text()), { prefixes: ["student-1/study/notes.pdf"] });

    const noServiceRole = await worker.fetch(new Request(`https://example.test/api/conversations/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer student-token" }
    }), { ...env, SUPABASE_SERVICE_ROLE_KEY: "" });
    assert.equal(noServiceRole.status, 503);
    assert.deepEqual(await noServiceRole.json(), { error: "Conversation deletion is not configured." });
    assert.equal(calls.filter(call => call.request.method === "DELETE" && call.url.pathname.endsWith("/rest/v1/conversations")).length, 1, "missing admin credentials never reach the conversation delete");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat route returns a clear 503 when required production bindings are absent", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/chat", { method: "POST" }), {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /daily usage service is not configured/);
});

test("usage status requires authentication and returns eligibility without exposing counts", async () => {
  const originalFetch = globalThis.fetch;
  const databaseCalls = [];
  const database = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            first: async () => {
              databaseCalls.push({ method: "first", sql, bindings });
              return {
                user_chat_count: 35, user_upload_count: 1, user_upload_bytes: 0,
                global_chat_count: 350, active_users_count: 0
              };
            },
            run: async () => {
              databaseCalls.push({ method: "run", sql, bindings });
              return { success: true };
            }
          };
        }
      };
    }
  };
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.href}`);
  };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/usage", {
      headers: { Authorization: "Bearer user-token" }
    }), {
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      USAGE_DB: database
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.chatAllowed, false);
    assert.equal(payload.uploadAllowed, true, "a chat limit does not consume the separate upload budget");
    assert.ok(Number.isFinite(Date.parse(payload.resetAt)));
    assert.deepEqual(Object.keys(payload).sort(), ["chatAllowed", "resetAt", "uploadAllowed"]);
    assert.doesNotMatch(JSON.stringify(payload), /count|points|neurons|remaining/i);
    const activity = databaseCalls.find(call => call.method === "run" && call.sql.includes("daily_user_activity"));
    assert.ok(activity, "an authenticated usage check records the signed-in account’s presence");
    assert.match(activity.sql, /ON CONFLICT \(activity_date, user_id\) DO UPDATE/);
    assert.match(activity.sql, /last_seen_at = excluded\.last_seen_at/);
    assert.equal(activity.bindings[0], utcUsageDay(new Date()));
    assert.equal(activity.bindings[1], "student-1");
    assert.ok(Number.isFinite(Date.parse(activity.bindings[2])));
    assert.equal(databaseCalls.some(call => /INSERT INTO daily_usage/.test(call.sql)), false,
      "a sign-in activity record does not consume one of the 10 quota-account slots");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image API requires sign-in, meters one successful image, and hides the repeat allowance detail", async () => {
  const originalFetch = globalThis.fetch;
  const userId = "student-1";
  const imageClaims = new Map();
  const databaseCalls = [];
  let aiCalls = 0;
  const database = {
    prepare(sql) {
      return { bind(...bindings) {
        return {
          first: async () => {
            databaseCalls.push({ method: "first", sql, bindings });
            if (sql.includes("INSERT INTO daily_image_usage")) {
              if (imageClaims.has(bindings[1])) return null;
              imageClaims.set(bindings[1], bindings[2]);
              return { user_id: bindings[1] };
            }
            if (sql.includes("UPDATE daily_image_usage")) return { user_id: bindings[1] };
            if (sql.includes("daily_ai_neuron_usage")) return { user_id: bindings[1] };
            throw new Error(`Unexpected D1 first query: ${sql}`);
          },
          run: async () => {
            databaseCalls.push({ method: "run", sql, bindings });
            if (sql.includes("DELETE FROM daily_image_usage")) imageClaims.delete(bindings[1]);
            return { success: true };
          }
        };
      } };
    }
  };
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: userId, email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected auth request: ${request.method} ${url.href}`);
  };
  const env = {
    AI: { async run(model, input) { aiCalls += 1; assert.equal(model, "@cf/black-forest-labs/flux-1-schnell"); assert.equal(input.steps, 4); return { image: "/9j/2Q==" }; } },
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    USAGE_DB: database
  };
  const createRequest = (authorization = "Bearer user-token") => new Request("https://example.test/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ prompt: "A soft green landscape with a river" })
  });
  try {
    const unauthorized = await worker.fetch(createRequest(""), env);
    assert.equal(unauthorized.status, 401);
    assert.equal(databaseCalls.length, 0, "unsigned requests do not touch the image ledger");

    const generated = await worker.fetch(createRequest(), env);
    const imagePayload = await generated.json();
    assert.equal(generated.status, 200);
    assert.equal(imagePayload.image, "/9j/2Q==");
    assert.equal(imagePayload.contentType, "image/jpeg");
    assert.equal(aiCalls, 1);
    const imageLedgerInsert = databaseCalls.find(call => call.sql.includes("INSERT INTO daily_image_usage"));
    assert.ok(imageLedgerInsert);
    assert.match(imageLedgerInsert.sql, /ON CONFLICT \(usage_date, user_id\) DO NOTHING/);
    assert.equal(databaseCalls.find(call => call.sql.includes("INSERT INTO daily_ai_neuron_usage"))?.bindings[1], `${userId}#image`);
    assert.ok(databaseCalls.some(call => call.sql.includes("UPDATE daily_image_usage") && call.sql.includes("generated_at")));

    const repeated = await worker.fetch(createRequest(), env);
    const repeatedPayload = await repeated.json();
    assert.equal(repeated.status, 429);
    assert.equal(repeatedPayload.code, "IMAGE_DAILY_LIMIT_REACHED");
    assert.equal(repeatedPayload.error, "Image generation is unavailable right now.");
    assert.doesNotMatch(repeatedPayload.error, /per day|today|tomorrow|quota|limit/i);
    assert.equal(aiCalls, 1, "duplicate requests are rejected before a second inference");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed image inference releases its account claim so a later retry can succeed", async () => {
  const originalFetch = globalThis.fetch;
  const imageClaims = new Map();
  let aiCalls = 0;
  let claimReleases = 0;
  const database = {
    prepare(sql) {
      return { bind(...bindings) {
        return {
          first: async () => {
            if (sql.includes("INSERT INTO daily_image_usage")) {
              if (imageClaims.has(bindings[1])) return null;
              imageClaims.set(bindings[1], bindings[2]);
              return { user_id: bindings[1] };
            }
            if (sql.includes("UPDATE daily_image_usage") || sql.includes("daily_ai_neuron_usage")) return { user_id: bindings[1] };
            throw new Error(`Unexpected D1 query: ${sql}`);
          },
          run: async () => {
            if (sql.includes("DELETE FROM daily_image_usage")) {
              claimReleases += 1;
              imageClaims.delete(bindings[1]);
            }
            return { success: true };
          }
        };
      } };
    }
  };
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "student-2", email: "student2@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected auth request");
  };
  const env = {
    AI: { async run() { aiCalls += 1; if (aiCalls === 1) throw new Error("temporary provider failure"); return { image: "/9j/2Q==" }; } },
    SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_ANON_KEY: "test-anon-key", USAGE_DB: database
  };
  const request = () => new Request("https://example.test/api/generate-image", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
    body: JSON.stringify({ prompt: "A quiet forest" })
  });
  try {
    const first = await worker.fetch(request(), env);
    assert.equal(first.status, 503);
    assert.equal(claimReleases, 1);
    const retry = await worker.fetch(request(), env);
    assert.equal(retry.status, 200);
    assert.equal(aiCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat cap is claimed atomically and rejected before retrieval or any AI call", async () => {
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Retrieval must not run after a quota denial: ${request.method} ${url.href}`);
  };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
      body: JSON.stringify({ message: "Explain academic integrity." })
    }), {
      AI: { async run() { aiCalls += 1; throw new Error("AI must not run when over quota"); } },
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      USAGE_DB: mockUsageDatabase(null)
    });
    assert.equal(response.status, 429);
    const payload = await response.json();
    assert.equal(payload.code, "DAILY_LIMIT_REACHED");
    assert.equal(payload.error, DAILY_LIMIT_MESSAGE);
    assert.ok(Number.isFinite(Date.parse(payload.resetAt)));
    assert.equal(aiCalls, 0);
    assert.deepEqual(calls, ["/auth/v1/user"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("document indexing rejects an oversized file and excessive extracted text before consuming quota or AI", async () => {
  const originalFetch = globalThis.fetch;
  const runIndex = async (contents, declaredSize = Buffer.byteLength(contents)) => {
    let usageChecks = 0;
    let usageClaims = 0;
    let aiCalls = 0;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'student-1', email: 'student@nwu.ac.za', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }), { headers: { 'Content-Type': 'application/json' } });
      if (url.pathname.includes('/storage/v1/object/')) return new Response(contents, { headers: { 'Content-Type': 'text/plain' } });
      throw new Error(`Unexpected request: ${request.method} ${url.href}`);
    };
    const response = await worker.fetch(new Request('https://example.test/api/index-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
      body: JSON.stringify({ storagePath: 'student-1/notes.txt', fileName: 'notes.txt', fileSize: declaredSize })
    }), {
      AI: { async run() { aiCalls += 1; return { data: [Array(384).fill(0.01)] }; } },
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      USAGE_DB: {
        prepare(sql) {
          if (sql.includes('INSERT INTO')) usageClaims += 1;
          else usageChecks += 1;
          return { bind() { return { first: async () => ({
            user_chat_count: 0, user_upload_count: 0, user_upload_bytes: 0, global_chat_count: 0, user_active: 0, active_users_count: 0
          }) }; } };
        }
      }
    });
    return { response, usageChecks, usageClaims, aiCalls };
  };
  try {
    const oversized = await runIndex('x', MAX_DOCUMENT_BYTES + 1);
    assert.equal(oversized.response.status, 413);
    assert.equal((await oversized.response.json()).code, 'UPLOAD_TOO_LARGE');
    assert.equal(oversized.usageChecks, 0, 'oversized files are rejected before quota or storage access');
    assert.equal(oversized.usageClaims, 0);
    assert.equal(oversized.aiCalls, 0);

    const excessiveText = await runIndex('a'.repeat(25_001));
    assert.equal(excessiveText.response.status, 413);
    assert.equal((await excessiveText.response.json()).code, 'DOCUMENT_TOO_LONG');
    assert.equal(excessiveText.usageChecks, 1);
    assert.equal(excessiveText.usageClaims, 0);
    assert.equal(excessiveText.aiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('document indexing keeps upload bytes separate from chat and blocks only when the remaining byte budget is too small', async () => {
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  let storageFetchCalls = 0;
  let usageClaims = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'student-1', email: 'student@nwu.ac.za', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.includes('/storage/v1/object/')) { storageFetchCalls += 1; return new Response('A valid set of module notes with enough readable academic text.', { headers: { 'Content-Type': 'text/plain' } }); }
    throw new Error(`Unexpected request: ${request.method} ${url.href}`);
  };
  try {
    const fileSize = Buffer.byteLength('A valid set of module notes with enough readable academic text.');
    const response = await worker.fetch(new Request('https://example.test/api/index-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
      body: JSON.stringify({ storagePath: 'student-1/notes.txt', fileName: 'notes.txt', fileSize })
    }), {
      AI: { async run() { aiCalls += 1; return { data: [Array(384).fill(0.01)] }; } },
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      USAGE_DB: {
        prepare(sql) {
          if (sql.includes('INSERT INTO')) usageClaims += 1;
          return { bind() { return { first: async () => ({
            user_chat_count: 35, user_upload_count: 1, user_upload_bytes: DAILY_UPLOAD_LIMIT - 1,
            global_chat_count: 350, user_active: 1, active_users_count: 10
          }) }; } };
        }
      }
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'UPLOAD_EXCEEDS_DAILY_BUDGET');
    assert.equal(storageFetchCalls, 0, 'a file that cannot fit is rejected before storage is read');
    assert.equal(usageClaims, 0);
    assert.equal(aiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sequential uploads accept real PDF and DOCX after chat points are exhausted', async () => {
  const originalFetch = globalThis.fetch;
  const fixtures = ['sample.pdf', 'sample.docx'].map(name => ({ name, bytes: readFileSync(new URL(`./fixtures/${name}`, import.meta.url)) }));
  let uploadBytes = 0;
  let uploadCount = 0;
  let chatCount = 35;
  let documentCount = 0;
  let chunkBatchCount = 0;
  let conversationInsertCount = 0;
  let conversationId = null;
  const indexedRows = [];
  const createdConversationId = '123e4567-e89b-12d3-a456-426614174001';
  let aiCalls = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'student-1', email: 'student@nwu.ac.za', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/rest/v1/conversations') && request.method === 'POST') {
      conversationInsertCount += 1;
      return new Response(JSON.stringify({ id: createdConversationId }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rest/v1/conversations') && request.method === 'GET') {
      return new Response(JSON.stringify({ id: createdConversationId }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.includes('/storage/v1/object/')) {
      const file = fixtures.find(item => decodeURIComponent(url.pathname).endsWith(item.name));
      return file ? new Response(file.bytes, { headers: { 'Content-Type': 'application/octet-stream' } }) : new Response('Not found', { status: 404 });
    }
    if (url.pathname.endsWith('/rest/v1/documents')) {
      documentCount += 1;
      const row = JSON.parse(await request.text());
      indexedRows.push(row);
      return new Response(JSON.stringify({ id: `document-${documentCount}`, file_name: row.file_name, module_code: row.module_code, created_at: '2026-10-02T00:00:00Z' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rest/v1/document_chunks')) {
      chunkBatchCount += 1;
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.href}`);
  };
  try {
    for (const file of fixtures) {
      const response = await worker.fetch(new Request('https://example.test/api/index-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
        body: JSON.stringify({ storagePath: `student-1/${file.name}`, fileName: file.name, fileSize: file.bytes.byteLength, conversationId })
      }), {
        AI: { async run() { aiCalls += 1; return { data: [Array(384).fill(0.01)] }; } },
        SUPABASE_URL: 'https://test-project.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        USAGE_DB: {
          prepare(sql) {
            return { bind(...bindings) { return { first: async () => {
              if (sql.includes('INSERT INTO daily_ai_neuron_usage') || sql.includes('UPDATE daily_ai_neuron_usage')) {
                return { user_id: bindings[1] };
              }
              if (sql.includes('INSERT INTO daily_usage')) {
                assert.equal(bindings[2], 'upload');
                assert.equal(bindings[7], file.bytes.byteLength);
                if (uploadBytes + bindings[7] > DAILY_UPLOAD_LIMIT) return null;
                uploadBytes += bindings[7];
                uploadCount += 1;
                return { chat_count: chatCount, upload_count: uploadCount };
              }
              return {
                user_chat_count: chatCount, user_upload_count: uploadCount, user_upload_bytes: uploadBytes,
                global_chat_count: 350, user_active: 1, active_users_count: 10
              };
            } }; } };
          }
        }
      });
      assert.equal(response.status, 200, `${file.name} must index successfully`);
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.equal(result.conversationId, createdConversationId);
      conversationId = result.conversationId;
    }
    assert.equal(uploadCount, 2, 'multiple files are counted by bytes, not by a one-file-per-day rule');
    assert.equal(uploadBytes, fixtures.reduce((sum, file) => sum + file.bytes.byteLength, 0));
    assert.equal(chatCount, 35, 'uploading documents does not consume chat points');
    assert.equal(documentCount, 2);
    assert.equal(conversationInsertCount, 1, 'a new conversation is created only once for the upload batch');
    assert.deepEqual(indexedRows.map(row => row.conversation_id), [createdConversationId, createdConversationId]);
    assert.equal(chunkBatchCount, 2);
    assert.equal(aiCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('upload claim denial after preflight prevents embedding and returns the refreshed upload limit', async () => {
  const originalFetch = globalThis.fetch;
  const contents = 'This is a valid module note with enough readable text.';
  const fileSize = Buffer.byteLength(contents);
  let aiCalls = 0;
  let usageChecks = 0;
  let storageFetchCalls = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'student-1', email: 'student@nwu.ac.za', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.includes('/storage/v1/object/')) { storageFetchCalls += 1; return new Response(contents, { headers: { 'Content-Type': 'text/plain' } }); }
    throw new Error(`Unexpected request: ${request.method} ${url.href}`);
  };
  try {
    const response = await worker.fetch(new Request('https://example.test/api/index-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
      body: JSON.stringify({ storagePath: 'student-1/notes.txt', fileName: 'notes.txt', fileSize })
    }), {
      AI: { async run() { aiCalls += 1; return { data: [Array(384).fill(0.01)] }; } },
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      USAGE_DB: {
        prepare(sql) {
          return { bind() { return { first: async () => {
            if (sql.includes('INSERT INTO')) return null;
            usageChecks += 1;
            return usageChecks === 1
              ? { user_chat_count: 0, user_upload_count: 0, user_upload_bytes: 0, global_chat_count: 0, user_active: 0, active_users_count: 0 }
              : { user_chat_count: 35, user_upload_count: 1, user_upload_bytes: DAILY_UPLOAD_LIMIT, global_chat_count: 350, user_active: 1, active_users_count: 10 };
          } }; } };
        }
      }
    });
    assert.equal(response.status, 429);
    const payload = await response.json();
    assert.equal(payload.code, 'DAILY_UPLOAD_LIMIT_REACHED');
    assert.equal(payload.error, DAILY_UPLOAD_LIMIT_MESSAGE);
    assert.equal(usageChecks, 2, 'preflight and denial refresh both read current eligibility');
    assert.equal(storageFetchCalls, 1);
    assert.equal(aiCalls, 0, 'a denied atomic claim never runs embeddings');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed document embeddings refund the atomic upload-byte claim", async () => {
  const originalFetch = globalThis.fetch;
  const file = readFileSync(new URL("./fixtures/sample.pdf", import.meta.url));
  let uploadBytes = 0;
  let uploadCount = 0;
  let aiCalls = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    if (url.pathname.includes("/storage/v1/object/")) return new Response(file);
    throw new Error(`No document should be registered after embedding fails: ${request.method} ${url.href}`);
  };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/index-document", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
      body: JSON.stringify({ storagePath: "student-1/sample.pdf", fileName: "sample.pdf", fileSize: file.byteLength })
    }), {
      AI: { async run() { aiCalls += 1; throw new Error("temporary embedding failure"); } },
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      USAGE_DB: {
        prepare(sql) {
          return { bind(...bindings) {
            if (sql.includes("INSERT INTO daily_ai_neuron_usage") || sql.includes("UPDATE daily_ai_neuron_usage")) {
              return { first: async () => ({ user_id: bindings[1] }) };
            }
            if (sql.includes("INSERT INTO daily_usage")) return { first: async () => {
              uploadBytes += bindings[7];
              uploadCount += 1;
              return { chat_count: 35, upload_count: uploadCount };
            } };
            if (sql.includes("UPDATE daily_usage")) return { run: async () => {
              uploadBytes -= bindings[2];
              uploadCount -= 1;
            } };
            return { first: async () => ({
              user_chat_count: 35, user_upload_count: uploadCount, user_upload_bytes: uploadBytes,
              global_chat_count: 350, user_active: 1, active_users_count: 10
            }) };
          } };
        }
      }
    });
    assert.equal(response.status, 503);
    assert.equal(aiCalls, 1);
    assert.equal(uploadBytes, 0, "a failed embedding does not consume daily upload bytes");
    assert.equal(uploadCount, 0, "failed documents do not count as completed uploads");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("embedMany calls BGE-small and validates 384-dimensional vectors", async () => {
  let call;
  const vector = Array(384).fill(0.125);
  const result = await embedMany(["first", "second"], {
    AI: { async run(model, input) { call = { model, input }; return { data: [vector, vector] }; } }
  });
  assert.equal(result.ok, true);
  assert.equal(call.model, "@cf/baai/bge-small-en-v1.5");
  assert.deepEqual(call.input, { text: ["first", "second"] });
  assert.equal(result.embeddings[0].length, 384);
});

test("embedMany rejects unexpected embedding shape and missing AI binding", async () => {
  const wrongShape = await embedMany(["question"], { AI: { async run() { return { data: [[1, 2, 3]] }; } } });
  assert.equal(wrongShape.ok, false);
  assert.equal(wrongShape.status, 502);
  assert.match(wrongShape.error, /unexpected embedding response/);
  const missing = await embedMany(["question"], {});
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 503);
});

test("generateChatResponse uses the Workers AI chat model and extracts the response", async () => {
  let call;
  const messages = [{ role: "user", content: "Explain osmosis." }];
  const result = await generateChatResponse(messages, {
    AI: { async run(model, input) { call = { model, input }; return { response: " Osmosis is water movement. " }; } }
  });
  assert.equal(result, "Osmosis is water movement.");
  assert.equal(call.model, "@cf/meta/llama-3.2-3b-instruct");
  assert.deepEqual(call.input.messages, messages);
});

test("live NWU search normalizes concise topic keywords and preserves AI as a useful term", () => {
  assert.equal(buildNwuSearchQuery("Could you please explain the NWU academic integrity policy?"), "NWU academic integrity policy");
  assert.equal(buildNwuSearchQuery("How does NWU handle AI use?"), "NWU handle AI");
  assert.ok(buildNwuSearchQuery("academic policy ".repeat(40)).length <= 120);
});

test("only public NWU HTTPS hosts are eligible and eFundi/external URLs are rejected", () => {
  assert.equal(isPublicNwuUrl("https://www.nwu.ac.za/policy.pdf"), true);
  assert.equal(isPublicNwuUrl("https://library.nwu.ac.za/research-policies"), true);
  assert.equal(isPublicNwuUrl("http://www.nwu.ac.za/policy.pdf"), false);
  assert.equal(isPublicNwuUrl("https://efundi.nwu.ac.za/portal"), false);
  assert.equal(isPublicNwuUrl("https://intranet.nwu.ac.za/"), false);
  assert.equal(isPublicNwuUrl("https://example.com/policy.pdf"), false);
  assert.equal(normalizePublicNwuUrl("http://www.nwu.ac.za/policy.pdf"), "https://www.nwu.ac.za/policy.pdf");
  assert.equal(normalizePublicNwuUrl("https://example.com/policy.pdf"), null);
});

test("NWU search result parser extracts only official titles, URLs, dates and snippets", () => {
  const html = `
    <div class="search-scr views-row">
      <h3 class="search-h3"><a href="http://www.nwu.ac.za/governance-and-management/academic-policies">Academic Policies</a></h3>
      <span class="date-src"><i>2026-08-21</i></span>
      <span class="content">Current Academic Integrity Policy and rules.</span>
    </div>
    <div class="search-scr views-row">
      <h3 class="search-h3"><a href="https://example.com/not-nwu">External</a></h3>
      <span class="content">Not an NWU page.</span>
    </div>`;
  const results = parseNwuSearchResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Academic Policies");
  assert.equal(results[0].url, "https://www.nwu.ac.za/governance-and-management/academic-policies");
  assert.equal(results[0].date, "2026-08-21");
  assert.match(results[0].snippet, /Academic Integrity Policy/);
});

test("linked PDF discovery accepts current NWU documents but excludes non-NWU links", () => {
  const html = `<p><a href="/documents/2026-senate-rules.pdf">Senate Rules on Academic Integrity</a> Section 5: Responsible and Ethical Use of Artificial Intelligence.</p>
    <a href="https://example.com/private.pdf">External PDF</a><a href="https://efundi.nwu.ac.za/course.pdf">Private course</a>`;
  const links = extractPublicPdfLinks(html, "https://www.nwu.ac.za/governance-and-management/academic-policies");
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://www.nwu.ac.za/documents/2026-senate-rules.pdf");
  assert.match(links[0].snippet, /Responsible and Ethical Use of Artificial Intelligence/);
});

test("live NWU search fetches and cites a current linked Senate Rules PDF", async () => {
  const searchHtml = `<div class="search-scr views-row"><h3 class="search-h3"><a href="https://www.nwu.ac.za/governance-and-management/academic-policies">Academic Policies</a></h3><span class="date-src"><i>2026-09-30</i></span><span class="content">Senate Rules on Academic Integrity. Section 5 covers responsible and ethical AI use.</span></div>`;
  const policyHtml = `<main><h1>Academic Policies</h1><p><a href="https://www.nwu.ac.za/documents/2025-academic-integrity.pdf">Academic Integrity Policy</a></p><p><a href="https://www.nwu.ac.za/documents/2026-senate-rules.pdf">Senate Rules on Academic Integrity</a> Section 5: Responsible and Ethical Use of Artificial Intelligence.</p></main>`;
  const calls = [];
  const fetcher = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/multisite-search?")) return new Response(searchHtml, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/governance-and-management/academic-policies")) return new Response(policyHtml, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/documents/2026-senate-rules.pdf")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/pdf" } });
    throw new Error(`Unexpected URL requested: ${url}`);
  };
  const result = await searchNwuLiveSources("NWU Senate Rules responsible ethical AI use", {
    fetcher,
    async pdfParser() { return { text: "2026 NWU Senate Rules. Section 5: Responsible and ethical use of Artificial Intelligence in teaching and learning." }; }
  });
  assert.ok(calls.some(url => url.includes("/multisite-search?")));
  assert.ok(calls.includes("https://www.nwu.ac.za/documents/2026-senate-rules.pdf"));
  const document = result.sources.find(source => source.url.endsWith("2026-senate-rules.pdf"));
  assert.ok(document, "the current rules PDF is returned as a clickable citation");
  assert.match(document.content, /Responsible and ethical use of Artificial Intelligence/);
  assert.equal(document.type, "nwu_official_live");
});

test("developer questions return the exact structured profile only when explicitly requested", () => {
  const identity = getDeveloperIdentityResponse("Who developed TMJ AI Agent?");
  assert.deepEqual(identity.profile, {
    name: "TJ Mailula",
    fullName: "Tshepo Joseph Mailula",
    initialsMeaning: "TJ stands for Tshepo Joseph",
    role: "Developer, progressive programmer, and creator of TMJ AI Agent",
    purpose: "I’m TJ Mailula, a developer and progressive programmer with a strong interest in practical automation. I created TMJ AI Agent to make helpful AI support accessible for everyday questions and to support NWU students in understanding concepts and working with their own study materials. I hope to use AI and automation to make useful information and guidance easier to access.",
    location: "Tzaneen, Limpopo, South Africa",
    email: "mailulajosep@gmail.com",
    phone: "0718452020",
    phoneHref: "tel:+27718452020",
    photoUrl: "/developer-tj.webp",
    photoAlt: "Photo of TJ Mailula, developer of TMJ AI Agent"
  });
  assert.match(identity.reply, /Full name: Tshepo Joseph Mailula/);
  assert.match(identity.reply, /TJ stands for: Tshepo Joseph/);
  assert.match(identity.reply, /Purpose for creating TMJ AI Agent: I’m TJ Mailula, a developer and progressive programmer with a strong interest in practical automation\./);
  assert.match(identity.reply, /Location: Tzaneen, Limpopo, South Africa/);
  assert.match(identity.reply, /Email: mailulajosep@gmail\.com/);
  assert.match(identity.reply, /Phone: 0718452020/);
  assert.equal(getDeveloperIdentityReply("Who is the developer?"), identity.reply);
  assert.ok(getDeveloperIdentityResponse("What is the developer's email?"));
  assert.ok(getDeveloperIdentityResponse("How can I contact the creator?"));
  assert.ok(getDeveloperIdentityResponse("Who is T.J. Mailula?"));
  assert.match(getDeveloperIdentityResponse("Why did you develop TMJ AI Agent?").reply, /support NWU students/);
  assert.match(getDeveloperIdentityResponse("What was the purpose of creating this app?").profile.purpose, /everyday questions/);
  assert.equal(getDeveloperIdentityResponse("Why did you develop a study plan?"), null);
  assert.equal(getDeveloperIdentityResponse("What is the purpose of artificial intelligence?"), null);
  assert.equal(getDeveloperIdentityResponse("Explain academic integrity."), null);
  assert.equal(getDeveloperIdentityReply("What are NWU's developer tools?"), null);
});

test("developer chat returns the profile and does not call AI, embeddings, or NWU retrieval", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const savedMessages = [];
  let aiCalls = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    calls.push({ url, request });
    if (url.pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/conversations")) {
      return new Response(JSON.stringify({ id: "conversation-profile" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/messages")) {
      savedMessages.push(JSON.parse(await request.text()));
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.href}`);
  };

  try {
    const env = {
      AI: { async run() { aiCalls += 1; throw new Error("AI must not be called for the fixed identity response"); } },
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      USAGE_DB: mockUsageDatabase({ chat_count: 1, upload_count: 0 })
    };
    const response = await worker.fetch(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
    body: JSON.stringify({ message: "Who is the developer?" })
    }), env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.developerProfile.email, "mailulajosep@gmail.com");
    assert.equal(payload.developerProfile.phone, "0718452020");
    assert.equal(payload.developerProfile.photoUrl, "/developer-tj.webp");
    assert.match(payload.developerProfile.role, /progressive programmer/);
    assert.match(payload.developerProfile.purpose, /practical automation/);
    assert.deepEqual(payload.sources, []);
    assert.equal(payload.nwuSearchUrl, null);
    assert.equal(aiCalls, 0);
    assert.equal(calls.some(call => call.url.pathname.includes("multisite-search") || call.url.pathname.includes("/rpc/")), false);
    assert.match(savedMessages[0][1].content, /mailulajosep@gmail\.com/);
    assert.match(savedMessages[0][1].content, /0718452020/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assistant reply sanitizer removes unavailable-source notes and trailing source lists", () => {
  const answer = sanitizeAssistantReply("Here is a clear academic explanation.\n\nSource notes: None (no uploaded material found)");
  assert.equal(answer, "Here is a clear academic explanation.");
  assert.doesNotMatch(answer, /no sources available|source notes|no uploaded material/i);
  assert.equal(sanitizeAssistantReply("No sources available."), "I can help with that. Please add a little more detail to your question.");
});

test("NWU live search is reserved for explicit NWU requests and does not override an active upload chat", () => {
  assert.equal(shouldSearchNwuLiveSources("What does this document say about assessment?", true), false);
  assert.equal(shouldSearchNwuLiveSources("How do I plan my weekly budget?", false), false);
  assert.equal(shouldSearchNwuLiveSources("What is today's date?", false), false, "the runtime date reference handles this without academic search");
  assert.equal(shouldSearchNwuLiveSources("When does student registration open?", false), true);
  assert.equal(shouldSearchNwuLiveSources("What date is my assignment due?", true), false, "an active upload chat stays scoped to its own evidence");
  assert.equal(shouldSearchNwuLiveSources("Find the current NWU registration rule.", true), true);
  assert.equal(shouldSearchNwuLiveSources("What is the official university exam timetable?", false), true);
});

test("conversation document migration removes the unscoped vector RPC and filters student uploads by chat", () => {
  const migration = readFileSync(new URL("../migrations/0003_conversation_scoped_documents.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public\.conversations\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.match_document_chunks_cloudflare\(vector, integer\)/i);
  assert.match(migration, /target_conversation_id uuid DEFAULT NULL/i);
  assert.match(migration, /d\.source_type = 'student_upload'\s+AND d\.conversation_id = target_conversation_id/is);
  assert.doesNotMatch(migration, /c\.user_id = auth\.uid\(\)\s+OR d\.source_type/i, "the old across-all-conversations retrieval predicate is removed");
});

test("conversation upload retrieval reserves most result slots for the active chat before adding official NWU results", () => {
  const migration = readFileSync(new URL("../migrations/0004_prioritize_conversation_uploads.sql", import.meta.url), "utf8");
  assert.match(migration, /d\.conversation_id = target_conversation_id/i);
  assert.match(migration, /LIMIT LEAST\(match_count, 8\)/i);
  assert.match(migration, /LIMIT GREATEST\(match_count - LEAST\(match_count, 8\), 0\)/i);
  assert.match(migration, /ORDER BY CASE WHEN source_type = 'student_upload' THEN 0 ELSE 1 END/i);
});

test("chat retrieval is limited to the active conversation and retains recent turns", async () => {
  const originalFetch = globalThis.fetch;
  const conversationId = "123e4567-e89b-12d3-a456-426614174000";
  const previousTurns = [
    { role: "user", content: "I uploaded my biology study guide." },
    { role: "assistant", content: "I can answer questions from the study guide in this chat." }
  ];
  let rpcArguments;
  let modelMessages;
  let embeddingText;
  let aiCalls = 0;
  const searchRequests = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/multisite-search")) searchRequests.push(url.href);
    if (url.pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/conversations") && request.method === "GET") {
      const owned = url.searchParams.get("id") === `eq.${conversationId}`;
      return new Response(JSON.stringify(owned ? { id: conversationId } : []), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rpc/match_document_chunks_cloudflare")) {
      rpcArguments = JSON.parse(await request.text());
      return new Response(JSON.stringify([
        { id: 1, content: "The study guide describes the stages of cellular respiration.", similarity: 0.11, source_name: "Biology-study-guide.pdf", source_type: "student_upload", source_url: "" },
        { id: 2, content: "NWU policy describes module registration dates.", similarity: 0.92, source_name: "NWU Registration Policy", source_type: "nwu_official", source_url: "https://www.nwu.ac.za/registration" }
      ]), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/documents") && request.method === "GET") {
      return new Response(JSON.stringify([{ file_name: "Biology-study-guide.pdf", module_code: "BIOL123" }]), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/messages") && request.method === "GET") {
      return new Response(JSON.stringify([...previousTurns].reverse()), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/messages") && request.method === "POST") return new Response(null, { status: 201 });
    throw new Error(`Unexpected request: ${request.method} ${url.href}`);
  };

  try {
    const env = {
      AI: {
        async run(model, input) {
          aiCalls += 1;
          if (model === "@cf/baai/bge-small-en-v1.5") {
            embeddingText = input.text[0];
            return { data: [Array(384).fill(0.01)] };
          }
          modelMessages = input.messages;
          return { response: "The biology guide in this chat describes cell structure." };
        }
      },
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      USAGE_DB: mockUsageDatabase({ chat_count: 1, upload_count: 0 })
    };
    const response = await worker.fetch(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
      body: JSON.stringify({ message: "Explain that in more detail.", conversationId })
    }), env);
    assert.equal(response.status, 200);
    assert.equal(rpcArguments.target_conversation_id, conversationId);
    assert.equal(rpcArguments.match_count, 12);
    assert.match(embeddingText, /Explain that in more detail/);
    assert.match(embeddingText, /Biology-study-guide\.pdf/);
    assert.match(modelMessages.at(-1).content, /Source 1 \| student-uploaded material \| Biology-study-guide\.pdf/);
    assert.match(modelMessages.at(-1).content, /stages of cellular respiration/);
    assert.match(modelMessages.at(-1).content, /CURRENT DATE\/TIME REFERENCE \(trusted runtime clock\)/);
    assert.match(modelMessages[0].content, /capable, friendly general-purpose assistant/i);
    assert.doesNotMatch(modelMessages[0].content, /politely decline and explain that this assistant is for academic support/i);
    assert.equal(modelMessages[1].content, previousTurns[0].content);
    assert.equal(modelMessages[2].content, previousTurns[1].content);
    assert.match(modelMessages.at(-1).content, /Explain that in more detail/);

    const beforeForeignConversation = aiCalls;
    const foreignResponse = await worker.fetch(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
      body: JSON.stringify({ message: "Use another student's study guide.", conversationId: "123e4567-e89b-12d3-a456-426614174099" })
    }), env);
    assert.equal(foreignResponse.status, 404);
    assert.equal(aiCalls, beforeForeignConversation, "a conversation the user does not own never reaches retrieval or AI");
    assert.equal(searchRequests.length, 0, "an uploaded-document follow-up does not retrieve unrelated live NWU pages");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("protected NWU indexing rejects eFundi/private and external URLs before fetching", async () => {
  const env = {
    AI: { async run() { throw new Error("should not be called"); } },
    USAGE_DB: { prepare() { throw new Error("invalid URLs must be rejected before usage access"); } },
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    NWU_INGEST_SECRET: "ingest-secret"
  };
  for (const url of ["https://efundi.nwu.ac.za/course", "https://example.com/document.pdf"]) {
    const response = await worker.fetch(new Request("https://example.test/api/index-nwu", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tmj-ingest-secret": "ingest-secret" },
      body: JSON.stringify({ url })
    }), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /public HTTPS URL on an NWU-owned host/);
  }
});


test("chat returns live NWU citations when Supabase vector search is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let chatInput;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push(url.href);
    if (url.pathname.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/multisite-search")) {
      const html = `<div class="search-scr views-row"><h3 class="search-h3"><a href="https://www.nwu.ac.za/governance-and-management/academic-policies">NWU Academic Policies</a></h3><span class="date-src"><i>2026-09-30</i></span><span class="content">The Academic Integrity Policy describes academic honesty, attribution and plagiarism.</span></div>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }
    if (url.pathname.endsWith("/governance-and-management/academic-policies")) {
      return new Response("<html><main><h1>NWU Academic Policies</h1><p>The current Academic Integrity Policy requires academic honesty, proper attribution and correct referencing. Students should consult the current study guide.</p></main></html>", { headers: { "Content-Type": "text/html" } });
    }
    if (url.pathname.endsWith("/rpc/match_document_chunks_cloudflare")) {
      return new Response(JSON.stringify({ code: "PGRST202", message: "Function not found in schema cache" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/conversations")) {
      return new Response(JSON.stringify({ id: "conversation-1" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/messages")) return new Response(null, { status: 201 });
    throw new Error(`Unexpected mocked request: ${url.href}`);
  };

  try {
    const env = {
      AI: {
        async run(model, input) {
          if (model === "@cf/baai/bge-small-en-v1.5") return { data: [Array(384).fill(0.01)] };
          chatInput = input;
          return { response: "Academic integrity requires honest work and correct attribution.\n\nSource notes: None (no uploaded material found)" };
        }
      },
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      USAGE_DB: mockUsageDatabase({ chat_count: 1, upload_count: 0 })
    };
    const response = await worker.fetch(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
      body: JSON.stringify({ message: "What does NWU publish about academic integrity?" })
    }), env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.reply, /correct attribution/);
    assert.doesNotMatch(payload.reply, /source notes|no sources available|no uploaded material found/i);
    assert.ok(payload.sources.some(source => source.name === "NWU Academic Policies" && source.url.startsWith("https://www.nwu.ac.za/")));
    assert.match(payload.nwuSearchUrl, /multisite-search/);
    assert.match(chatInput.messages[1].content, /current Academic Integrity Policy/);
    assert.match(chatInput.messages[1].content, /NWU search listing date 2026-09-30/);
    assert.doesNotMatch(chatInput.messages[1].content, /NWU page date/);
    assert.ok(calls.some(url => url.includes("match_document_chunks_cloudflare")), "the configured vector RPC was attempted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("document indexing rejects an over-budget file and excessive extracted text before consuming quota or AI", async () => {
  const originalFetch = globalThis.fetch;
  const runIndex = async (contents, declaredSize = Buffer.byteLength(contents)) => {
    let usageChecks = 0;
    let usageClaims = 0;
    let aiCalls = 0;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "student-1", email: "student@nwu.ac.za", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }), { headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname.includes("/storage/v1/object/")) {
        return new Response(contents, { headers: { "Content-Type": "text/plain" } });
      }
      throw new Error(`Unexpected request: ${request.method} ${url.href}`);
    };
    const response = await worker.fetch(new Request("https://example.test/api/index-document", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer user-token" },
      body: JSON.stringify({ storagePath: "student-1/notes.txt", fileName: "notes.txt", fileSize: declaredSize })
    }), {
      AI: { async run() { aiCalls += 1; return { data: [Array(384).fill(0.01)] }; } },
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      USAGE_DB: {
        prepare(sql) {
          if (sql.includes("INSERT INTO")) usageClaims += 1;
          else usageChecks += 1;
          return { bind() { return { first: async () => ({
            user_chat_count: 0, user_upload_count: 0, user_upload_bytes: 0, global_chat_count: 0, user_active: 0, active_users_count: 0
          }) }; } };
        }
      }
    });
    return { response, usageChecks, usageClaims, aiCalls };
  };
  try {
    const oversized = await runIndex("x", MAX_DOCUMENT_BYTES + 1);
    assert.equal(oversized.response.status, 413);
    assert.equal((await oversized.response.json()).code, "UPLOAD_TOO_LARGE");
    assert.equal(oversized.usageChecks, 0, "oversized files are rejected before quota or storage access");
    assert.equal(oversized.usageClaims, 0, "invalid files never consume the upload allowance");
    assert.equal(oversized.aiCalls, 0);

    const excessiveText = await runIndex("a".repeat(25_001));
    assert.equal(excessiveText.response.status, 413);
    assert.equal((await excessiveText.response.json()).code, "DOCUMENT_TOO_LONG");
    assert.equal(excessiveText.usageChecks, 1);
    assert.equal(excessiveText.usageClaims, 0);
    assert.equal(excessiveText.aiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
