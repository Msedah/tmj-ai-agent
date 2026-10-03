import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import worker from "../src/index.js";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_USER_ID = "8ac58d83-418d-4f41-a2ea-a8f84c7b8d1e";
const adminMarkup = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const adminScript = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
const adminStyles = readFileSync(new URL("../public/admin.css", import.meta.url), "utf8");
const staticHeaders = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const wranglerConfig = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("D1 migration discovery is isolated from root-level Supabase migrations", () => {
  const usageDatabase = wranglerConfig.d1_databases.find(database => database.binding === "USAGE_DB");
  assert.equal(usageDatabase?.migrations_dir, "migrations/d1");
  const d1Migrations = readdirSync(new URL("../migrations/d1/", import.meta.url)).filter(name => name.endsWith(".sql")).sort();
  assert.deepEqual(d1Migrations, ["0001_daily_usage.sql", "0002_upload_bytes.sql", "0003_daily_chat_allocations.sql"]);
  assert.ok(!d1Migrations.includes("0005_tmj_admin_users.sql"), "the PostgreSQL allowlist migration must never be sent to D1");
});

function authenticatedUser(id = ADMIN_ID, email = "owner@example.com") {
  return {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z"
  };
}

function configureSupabaseFetch({ allowAdmin = true, getUser = () => authenticatedUser(ACTIVE_USER_ID, "active@example.com") } = {}) {
  const requests = [];
  const fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    requests.push({ request, url });
    if (url.pathname.endsWith("/auth/v1/user")) {
      return Response.json(authenticatedUser());
    }
    if (url.pathname.endsWith("/rest/v1/tmj_admin_users")) {
      return Response.json(allowAdmin ? [{ user_id: ADMIN_ID }] : []);
    }
    if (url.pathname.includes("/auth/v1/admin/users/")) {
      const user = getUser();
      return Response.json(user ? { user } : { user: null }, { status: user ? 200 : 404 });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.href}`);
  };
  return { fetch, requests };
}

function adminDatabase({ summary, users = [], onRun = () => {} } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...bindings) {
          calls.push({ sql, bindings });
          return {
            first: async () => summary || {
              active_users: users.length,
              total_chats: 15,
              total_uploads: 3,
              total_upload_bytes: 38_328
            },
            all: async () => ({ results: users }),
            run: async () => { onRun(sql, bindings); return { success: true }; }
          };
        }
      };
    }
  };
}

const adminEnv = usageDb => ({
  SUPABASE_URL: "https://tmj-test.supabase.co",
  SUPABASE_ANON_KEY: "test-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  USAGE_DB: usageDb
});

test("admin dashboard rejects unauthenticated requests before touching privileged data", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("No token should mean no Supabase request"); };
  const database = adminDatabase();
  try {
    const response = await worker.fetch(new Request("https://example.test/api/admin/dashboard"), adminEnv(database));
    assert.equal(response.status, 401);
    assert.equal(fetchCalls, 0);
    assert.equal(database.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin dashboard denies signed-in non-admin accounts without reading D1 usage", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch({ allowAdmin: false });
  globalThis.fetch = mock.fetch;
  const database = adminDatabase();
  try {
    const response = await worker.fetch(new Request("https://example.test/api/admin/dashboard", {
      headers: { Authorization: "Bearer user-token" }
    }), adminEnv(database));
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.code, "ADMIN_NOT_ALLOWED");
    assert.equal(payload.userId, ADMIN_ID);
    assert.equal(database.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin dashboard returns app-local totals and only active account usage to an allowlisted admin", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch();
  globalThis.fetch = mock.fetch;
  const database = adminDatabase({
    summary: { active_users: 1, total_chats: 15, total_uploads: 3, total_upload_bytes: 38_328 },
    users: [{ user_id: ACTIVE_USER_ID, chat_count: 7, upload_count: 3, upload_bytes: 38_328, daily_chat_limit: 50 }]
  });
  try {
    const response = await worker.fetch(new Request("https://example.test/api/admin/dashboard", {
      headers: { Authorization: "Bearer owner-token" }
    }), adminEnv(database));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.activeUsers, 1);
    assert.equal(payload.totalChats, 15);
    assert.equal(payload.sharedChatLimit, 350);
    assert.equal(payload.sharedChatsRemaining, 335);
    assert.equal(payload.defaultDailyChatLimit, 60);
    assert.equal(payload.users[0].email, "active@example.com");
    assert.equal(payload.users[0].chatCount, 7);
    assert.equal(payload.users[0].dailyChatLimit, 50);
    assert.equal(payload.users[0].chatsRemaining, 43);
    assert.match(payload.usageNote, /not Cloudflare Neurons/);
    assert.ok(mock.requests.some(({ url }) => url.pathname.includes("/auth/v1/admin/users/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin chat-limit updates reject values above the shared daily ceiling", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch();
  globalThis.fetch = mock.fetch;
  const database = adminDatabase();
  try {
    const response = await worker.fetch(new Request(`https://example.test/api/admin/users/${ACTIVE_USER_ID}/chat-limit`, {
      method: "PUT",
      headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" },
      body: JSON.stringify({ dailyChatLimit: 351 })
    }), adminEnv(database));
    assert.equal(response.status, 400);
    assert.equal(database.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin chat-limit updates save the exact target, allocation and administrator audit ID", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch();
  globalThis.fetch = mock.fetch;
  let saved = null;
  const database = adminDatabase({ onRun: (sql, bindings) => { saved = { sql, bindings }; } });
  try {
    const response = await worker.fetch(new Request(`https://example.test/api/admin/users/${ACTIVE_USER_ID}/chat-limit`, {
      method: "PUT",
      headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" },
      body: JSON.stringify({ dailyChatLimit: 80 })
    }), adminEnv(database));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { userId: ACTIVE_USER_ID, dailyChatLimit: 80 });
    assert.match(saved.sql, /INSERT INTO daily_chat_allocations/);
    assert.deepEqual(saved.bindings.slice(0, 2), [ACTIVE_USER_ID, 80]);
    assert.equal(saved.bindings[3], ADMIN_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin chat-limit updates accept both inclusive bounds, zero and 350", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch();
  globalThis.fetch = mock.fetch;
  try {
    for (const dailyChatLimit of [0, 350]) {
      let saved = null;
      const database = adminDatabase({ onRun: (sql, bindings) => { saved = { sql, bindings }; } });
      const response = await worker.fetch(new Request(`https://example.test/api/admin/users/${ACTIVE_USER_ID}/chat-limit`, {
        method: "PUT",
        headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" },
        body: JSON.stringify({ dailyChatLimit })
      }), adminEnv(database));
      assert.equal(response.status, 200);
      assert.deepEqual(saved.bindings.slice(0, 2), [ACTIVE_USER_ID, dailyChatLimit]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unauthorized admins cannot modify an account allocation", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch({ allowAdmin: false });
  globalThis.fetch = mock.fetch;
  const database = adminDatabase();
  try {
    const response = await worker.fetch(new Request(`https://example.test/api/admin/users/${ACTIVE_USER_ID}/chat-limit`, {
      method: "PUT",
      headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" },
      body: JSON.stringify({ dailyChatLimit: 80 })
    }), adminEnv(database));
    assert.equal(response.status, 403);
    assert.equal(database.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin API requests use the latest access token after Supabase refresh", async () => {
  const elements = new Map();
  const requestTokens = [];
  let authStateCallback;
  const makeElement = () => ({
    hidden: false, value: "", textContent: "", className: "", dataset: {}, listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    replaceChildren() {}, append() {}, setAttribute() {}, reset() {}
  });
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const client = { auth: {
    onAuthStateChange(callback) { authStateCallback = callback; },
    async getSession() { return { data: { session: { access_token: "initial-token" } }, error: null }; }
  } };
  const context = vm.createContext({
    document: { getElementById: getElement, createElement: makeElement },
    window: { supabase: { createClient: () => client } },
    Headers, Response,
    fetch: async (_path, options) => {
      requestTokens.push(options.headers.get("Authorization"));
      return Response.json({ error: "Not authorized", code: "ADMIN_NOT_ALLOWED", userId: ADMIN_ID }, { status: 403 });
    },
    navigator: { clipboard: { writeText: async () => {} } },
    Intl, Date, setTimeout, clearTimeout, console
  });

  vm.runInContext(adminScript, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requestTokens, ["Bearer initial-token"]);
  authStateCallback("TOKEN_REFRESHED", { access_token: "refreshed-token" });
  elements.get("refreshAdminDashboard").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requestTokens, ["Bearer initial-token", "Bearer refreshed-token"]);
});

test("admin allocation page uses existing sign-in only and contains no hard-coded password or service key", () => {
  assert.match(adminMarkup, /<title>TMJ ADMIN/);
  assert.match(adminMarkup, /existing TMJ AI Agent email and password/);
  assert.match(adminMarkup, /src="\/vendor\/supabase-js-2\.117\.2\.js" defer/);
  assert.doesNotMatch(adminMarkup, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/);
  assert.match(staticHeaders, /script-src 'self'/);
  assert.match(staticHeaders, /connect-src 'self' https:\/\/kiaaamxjtvenyaujpysf\.supabase\.co/);
  assert.match(staticHeaders, /\/admin[\s\S]*?frame-ancestors 'none'[\s\S]*?X-Frame-Options: DENY/);
  assert.doesNotMatch(adminMarkup, /Create an account|Sign up/);
  assert.match(adminScript, /signInWithPassword/);
  assert.doesNotMatch(adminScript, /signUp\(/);
  assert.match(adminScript, /\/api\/admin\/dashboard/);
  assert.match(adminScript, /\/chat-limit/);
  assert.match(adminScript, /ADMIN_SHARED_CHAT_LIMIT = 350/);
  assert.doesNotMatch(`${adminMarkup}\n${adminScript}`, /service_role|SUPABASE_SERVICE_ROLE_KEY/i);
  assert.match(adminScript, /auth\.onAuthStateChange/);
  assert.match(adminStyles, /@media \(max-width: 430px\)/);
  assert.match(adminMarkup, /not a Cloudflare AI-points balance or total Neuron usage/);
});
