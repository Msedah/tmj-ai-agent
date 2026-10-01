import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  embedMany,
  extractBearerToken,
  generateChatResponse,
  getDeveloperIdentityReply,
  isSupportedDocument,
  normalizeExtractedText,
  sanitizeAssistantReply
} from "../src/index.js";
import {
  buildNwuSearchQuery,
  extractPublicPdfLinks,
  isPublicNwuUrl,
  normalizePublicNwuUrl,
  parseNwuSearchResults,
  searchNwuLiveSources
} from "../src/nwu-search.js";

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
    const deletion = calls.find(call => call.request.method === "DELETE");
    assert.ok(deletion, "a database delete was issued");
    assert.equal(deletion.url.searchParams.get("id"), `eq.${id}`);
    assert.equal(deletion.url.searchParams.get("user_id"), "eq.student-1", "the signed-in user ID is applied as an owner filter");
    assert.equal(deletion.request.headers.get("Authorization"), "Bearer private-service-key");

    const noServiceRole = await worker.fetch(new Request(`https://example.test/api/conversations/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer student-token" }
    }), { ...env, SUPABASE_SERVICE_ROLE_KEY: "" });
    assert.equal(noServiceRole.status, 503);
    assert.deepEqual(await noServiceRole.json(), { error: "Conversation deletion is not configured." });
    assert.equal(calls.filter(call => call.request.method === "DELETE").length, 1, "missing admin credentials never reach the database delete");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("developer identity is disclosed only on an explicit creator question and without contact details", () => {
  assert.equal(getDeveloperIdentityReply("Who developed this assistant?"), "The developer is T.J. Mailula, from Tzaneen, Limpopo.");
  assert.equal(getDeveloperIdentityReply("Who is the developer?"), "The developer is T.J. Mailula, from Tzaneen, Limpopo.");
  assert.equal(getDeveloperIdentityReply("Explain academic integrity."), null);
  assert.doesNotMatch(getDeveloperIdentityReply("Who developed TMJ AI?"), /@|gmail|email/i);
});

test("assistant reply sanitizer removes unavailable-source notes and trailing source lists", () => {
  const answer = sanitizeAssistantReply("Here is a clear academic explanation.\n\nSource notes: None (no uploaded material found)");
  assert.equal(answer, "Here is a clear academic explanation.");
  assert.doesNotMatch(answer, /no sources available|source notes|no uploaded material/i);
  assert.equal(sanitizeAssistantReply("No sources available."), "I can help explain the academic topic. Please add a little more detail to your question.");
});

test("protected NWU indexing rejects eFundi/private and external URLs before fetching", async () => {
  const env = {
    AI: { async run() { throw new Error("should not be called"); } },
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
      SUPABASE_ANON_KEY: "test-anon-key"
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
