import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  embedMany,
  extractBearerToken,
  generateChatResponse,
  isSupportedDocument,
  normalizeExtractedText
} from "../src/index.js";

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
  for (const name of ["notes.csv", "notes.pdf.exe", "no-extension"]) {
    assert.equal(isSupportedDocument(name), false, name);
  }
});

test("normalizeExtractedText collapses whitespace and trims edges", () => {
  assert.equal(normalizeExtractedText("  one\n\t two   three  "), "one two three");
});

test("health route reports service readiness without exposing values", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    ready: false,
    services: { ai: false, chat: false, documentIndexing: false, nwuIngestion: false }
  });
});

test("health route distinguishes chat readiness from optional indexing configuration", async () => {
  const env = {
    AI: { run() {} },
    SUPABASE_URL: "https://private-project.supabase.co",
    SUPABASE_ANON_KEY: "private-anon-key"
  };
  const response = await worker.fetch(new Request("https://example.test/api/health"), env);
  const payload = await response.text();
  assert.deepEqual(JSON.parse(payload), {
    status: "ok",
    ready: false,
    services: { ai: true, chat: true, documentIndexing: false, nwuIngestion: false }
  });
  assert.doesNotMatch(payload, /private-project|private-anon-key/);
});

test("health route marks configured AI, chat, indexing and NWU ingestion ready", async () => {
  const env = {
    AI: { run() {} }, SUPABASE_URL: "https://private-project.supabase.co",
    SUPABASE_ANON_KEY: "private-anon-key", SUPABASE_SERVICE_ROLE_KEY: "private-service-key",
    NWU_INGEST_SECRET: "private-ingest-secret"
  };
  const response = await worker.fetch(new Request("https://example.test/api/health"), env);
  const payload = await response.text();
  assert.deepEqual(JSON.parse(payload), {
    status: "ok",
    ready: true,
    services: { ai: true, chat: true, documentIndexing: true, nwuIngestion: true }
  });
  assert.doesNotMatch(payload, /private-project|private-anon-key|private-service-key|private-ingest-secret/);
});

test("health route rejects unsupported methods", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health", { method: "POST" }), {});
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Method not allowed" });
});

test("chat route returns a clear 503 when required production bindings are absent", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/chat", { method: "POST" }), {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /AI or database service is not configured/);
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
