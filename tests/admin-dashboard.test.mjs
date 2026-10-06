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
  assert.deepEqual(d1Migrations, ["0001_daily_usage.sql", "0002_upload_bytes.sql", "0003_daily_chat_allocations.sql", "0004_daily_ai_neuron_usage.sql", "0005_daily_user_activity.sql", "0006_daily_image_usage.sql", "0007_daily_image_account_state.sql", "0008_three_daily_images.sql"]);
  assert.ok(!d1Migrations.includes("0005_tmj_admin_users.sql"), "the PostgreSQL allowlist migration must never be sent to D1");
});

function authenticatedUser(id = ADMIN_ID, email = "mailulajosep@gmail.com", emailConfirmedAt = "2026-09-29T04:50:02.813Z") {
  return {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: emailConfirmedAt,
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z"
  };
}

function configureSupabaseFetch({
  allowAdmin = true,
  adminUser = authenticatedUser(),
  getUser = () => authenticatedUser(ACTIVE_USER_ID, "active@example.com")
} = {}) {
  const requests = [];
  const fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    requests.push({ request, url });
    if (url.pathname.endsWith("/auth/v1/user")) {
      return Response.json(adminUser);
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
              total_upload_bytes: 38_328,
              total_images: 0
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

test("admin dashboard requires the allowlisted account to use the exact verified owner email", async () => {
  const originalFetch = globalThis.fetch;
  const rejectedUsers = [
    authenticatedUser(ADMIN_ID, "someone-else@example.com"),
    authenticatedUser(ADMIN_ID, "Mailulajosep@gmail.com"),
    authenticatedUser(ADMIN_ID, " mailulajosep@gmail.com "),
    authenticatedUser(ADMIN_ID, "mailulajosep@gmail.com", null)
  ];
  try {
    for (const adminUser of rejectedUsers) {
      const mock = configureSupabaseFetch({ adminUser, allowAdmin: true });
      globalThis.fetch = mock.fetch;
      const database = adminDatabase();
      const response = await worker.fetch(new Request("https://example.test/api/admin/dashboard", {
        headers: { Authorization: "Bearer owner-token" }
      }), adminEnv(database));
      const payload = await response.json();
      assert.equal(response.status, 403);
      assert.equal(payload.code, "ADMIN_NOT_ALLOWED");
      assert.equal(database.calls.length, 0);
      assert.equal(mock.requests.some(({ url }) => url.pathname.endsWith("/rest/v1/tmj_admin_users")), false,
        "wrong or unverified email is denied before the privileged UUID allowlist is queried");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin dashboard unions signed-in and usage-only accounts while preserving app-local totals", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch();
  globalThis.fetch = mock.fetch;
  const database = adminDatabase({
    summary: {
      active_users: 3, total_chats: 15, total_uploads: 3, total_upload_bytes: 38_328, total_images: 4,
      shared_ai_neurons_committed_milli: 1_250_000, owner_ai_neurons_committed_milli: 25_500
    },
    users: [{
      user_id: ACTIVE_USER_ID, first_seen_at: "2026-10-04T08:00:00.000Z", last_seen_at: "2026-10-04T09:00:00.000Z",
      chat_count: 7, upload_count: 3, upload_bytes: 38_328,
      daily_chat_limit: 50, ai_neurons_used_milli: 45_000, ai_neurons_reserved_milli: 5_000, image_count: 3
    }, {
      user_id: "9bc49c73-c388-4299-8f0c-3c21aa20c8f1", first_seen_at: "2026-10-04T08:30:00.000Z", last_seen_at: "2026-10-04T08:30:00.000Z",
      chat_count: 0, upload_count: 0, upload_bytes: 0, daily_chat_limit: 60,
      ai_neurons_used_milli: 0, ai_neurons_reserved_milli: 0
    }, {
      user_id: "c1a9c76b-98f4-4e7f-b581-83ca6332531a", first_seen_at: null, last_seen_at: null,
      chat_count: 8, upload_count: 0, upload_bytes: 0, daily_chat_limit: 45,
      ai_neurons_used_milli: 0, ai_neurons_reserved_milli: 0
    }]
  });
  try {
    const response = await worker.fetch(new Request("https://example.test/api/admin/dashboard", {
      headers: { Authorization: "Bearer owner-token" }
    }), adminEnv(database));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.activeUsers, 3);
    assert.equal(payload.activeUserLimit, 10, "the pilot quota cap remains separate from the signed-in count");
    assert.equal(payload.userListLimit, 100);
    assert.equal(payload.usersTruncated, false);
    assert.equal(payload.totalChats, 15);
    assert.equal(payload.totalImages, 4);
    assert.equal(payload.sharedChatLimit, 350);
    assert.equal(payload.sharedChatsRemaining, 335);
    assert.equal(payload.defaultDailyChatLimit, 60);
    assert.deepEqual(payload.estimatedNeurons, {
      sharedCommitted: 1250,
      sharedLimit: 9000,
      sharedRemaining: 7750,
      ownerCommitted: 25.5,
      ownerLimit: 1000,
      ownerRemaining: 974.5
    });
    assert.equal(payload.users[0].email, "active@example.com");
    assert.equal(payload.users[0].firstSeenAt, "2026-10-04T08:00:00.000Z");
    assert.equal(payload.users[0].lastSeenAt, "2026-10-04T09:00:00.000Z");
    assert.equal(payload.users[0].chatCount, 7);
    assert.equal(payload.users[0].dailyChatLimit, 50);
    assert.equal(payload.users[0].chatsRemaining, 43);
    assert.equal(payload.users[0].aiNeuronsUsed, 45);
    assert.equal(payload.users[0].aiNeuronsReserved, 5);
    assert.equal(payload.users[0].imageCount, 3);
    assert.equal(payload.users[1].chatCount, 0, "a signed-in account with no chat row is still listed");
    assert.equal(payload.users[1].dailyChatLimit, 60);
    assert.equal(payload.users[2].chatCount, 8, "a usage-only row remains visible without an activity row");
    assert.equal(payload.users[2].dailyChatLimit, 45);
    assert.equal(payload.users[2].lastSeenAt, null, "legacy usage-only rows have no fabricated activity timestamp");
    assert.match(database.calls[0].sql, /SELECT user_id FROM daily_user_activity[\s\S]*?UNION[\s\S]*?SELECT user_id FROM daily_usage[\s\S]*?UNION[\s\S]*?daily_image_account_state/);
    assert.match(database.calls[0].sql, /SUM\(generated_count\) FROM daily_image_account_state WHERE generated_date = \?1/);
    assert.match(database.calls[0].sql, /SUM\(chat_count\) FROM daily_usage/);
    assert.match(database.calls[1].sql, /WITH ai_account_usage AS[\s\S]*?active_accounts AS/);
    assert.match(database.calls[1].sql, /FROM daily_image_account_state AS image[\s\S]*?image\.generated_date = \?1/);
    assert.match(database.calls[1].sql, /NOT EXISTS/);
    assert.match(database.calls[1].sql, /COALESCE\(activity\.last_seen_at, ''\) DESC/);
    assert.equal(database.calls[1].bindings[2], 100, "the activity list is not limited by the 10-account quota cap");
    assert.match(database.calls[1].sql, /LEFT JOIN daily_chat_allocations AS allocation ON allocation\.user_id = activity\.user_id/);
    assert.match(payload.usageNote, /TMJ-only estimates/);
    assert.ok(mock.requests.some(({ url }) => url.pathname.includes("/auth/v1/admin/users/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin dashboard includes more than ten activity-only accounts without charging quota slots", async () => {
  const originalFetch = globalThis.fetch;
  const mock = configureSupabaseFetch();
  globalThis.fetch = mock.fetch;
  const users = Array.from({ length: 11 }, (_, index) => ({
    user_id: `activity-only-${index + 1}`,
    first_seen_at: `2026-10-04T08:${String(index).padStart(2, "0")}:00.000Z`,
    last_seen_at: `2026-10-04T09:${String(index).padStart(2, "0")}:00.000Z`,
    chat_count: 0, upload_count: 0, upload_bytes: 0, daily_chat_limit: 60,
    ai_neurons_used_milli: 0, ai_neurons_reserved_milli: 0
  }));
  const database = adminDatabase({
    summary: { active_users: 11, total_chats: 0, total_uploads: 0, total_upload_bytes: 0 },
    users
  });
  try {
    const response = await worker.fetch(new Request("https://example.test/api/admin/dashboard", {
      headers: { Authorization: "Bearer owner-token" }
    }), adminEnv(database));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.activeUsers, 11);
    assert.equal(payload.activeUserLimit, 10);
    assert.equal(payload.users.length, 11);
    assert.equal(payload.usersTruncated, false);
    assert.equal(database.calls[1].bindings[2], 100);
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
  assert.match(adminScript, /30_000/);
  assert.match(adminScript, /last active/);
  assert.match(adminMarkup, /adminUserListCaption/);
  assert.match(adminScript, /unsavedAdminLimits/);
  assert.match(adminStyles, /@media \(max-width: 430px\)/);
  assert.match(adminMarkup, /Neuron figures are TMJ-only estimates/);
  assert.match(adminMarkup, /sharedNeuronsValue/);
  assert.match(adminMarkup, /ownerNeuronsValue/);
  assert.match(adminMarkup, /totalImagesValue/);
});

test("admin dashboard refreshes activity automatically and reflects saved limits after reload", async () => {
  const elements = new Map();
  let intervalCallback = null;
  let dashboardReads = 0;
  let savedLimit = 60;
  const makeElement = () => ({
    hidden: false, value: "", textContent: "", className: "", dataset: {}, listeners: {}, children: [],
    addEventListener(type, handler) { this.listeners[type] = handler; },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute() {}, reset() {},
    querySelector() { return this.children[1] || null; }
  });
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const documentListeners = {};
  const windowListeners = {};
  let deferNextRead = false;
  let releaseDeferredRead = null;
  const client = { auth: {
    onAuthStateChange() {},
    async getSession() { return { data: { session: { access_token: "owner-token" } }, error: null }; }
  } };
  const context = vm.createContext({
    document: {
      getElementById: getElement, createElement: makeElement,
      visibilityState: "visible", activeElement: null,
      addEventListener(type, handler) { documentListeners[type] = handler; }
    },
    window: {
      supabase: { createClient: () => client },
      addEventListener(type, handler) { windowListeners[type] = handler; }
    },
    Headers, Response,
    fetch: async (path, options = {}) => {
      if (options.method === "PUT") {
        savedLimit = JSON.parse(options.body).dailyChatLimit;
        return Response.json({ userId: ACTIVE_USER_ID, dailyChatLimit: savedLimit });
      }
      dashboardReads += 1;
      const activeUsers = Math.min(dashboardReads, 2);
      const payload = {
        utcDay: "2026-10-04", resetsAt: "2026-10-05T00:00:00.000Z",
        activeUsers, activeUserLimit: 10, userListLimit: 100, usersTruncated: false, totalChats: 0, totalImages: 0,
        sharedChatLimit: 350, sharedChatsRemaining: 350, defaultDailyChatLimit: 60,
        estimatedNeurons: { sharedCommitted: 0, sharedLimit: 9000, sharedRemaining: 9000, ownerCommitted: 0, ownerLimit: 1000, ownerRemaining: 1000 },
        totalUploads: 0, totalUploadBytes: 0,
        users: [{
          userId: ACTIVE_USER_ID, email: "student@example.com", chatCount: 0,
          dailyChatLimit: savedLimit, chatsRemaining: savedLimit, aiNeuronsUsed: 0, imageCount: 1,
          aiNeuronsReserved: 0, uploadCount: 0, uploadBytes: 0,
          lastSeenAt: `2026-10-04T0${dashboardReads}:00:00.000Z`
        }, ...(activeUsers > 1 ? [{
          userId: "signin-only-user", email: "new-student@example.com", chatCount: 0,
          dailyChatLimit: 60, chatsRemaining: 60, aiNeuronsUsed: 0,
          aiNeuronsReserved: 0, uploadCount: 0, uploadBytes: 0, lastSeenAt: null
        }] : [])]
      };
      if (deferNextRead) {
        deferNextRead = false;
        return new Promise(resolve => { releaseDeferredRead = () => resolve(Response.json(payload)); });
      }
      return Response.json(payload);
    },
    navigator: { clipboard: { writeText: async () => {} } },
    Intl, Date, setTimeout, clearTimeout, console,
    setInterval(callback, milliseconds) {
      assert.equal(milliseconds, 30_000);
      intervalCallback = callback;
      return 1;
    }
  });

  vm.runInContext(adminScript, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dashboardReads, 1);
  assert.equal(getElement("activeUsersValue").textContent, "1");
  assert.equal(getElement("totalImagesValue").textContent, "0");
  assert.match(getElement("activeUsersCaption").textContent, /active today/);
  assert.match(getElement("adminUserListCaption").textContent, /accounts active today/);
  assert.equal(typeof intervalCallback, "function");

  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dashboardReads, 2);
  assert.equal(getElement("activeUsersValue").textContent, "2");
  const accountCard = getElement("adminUsers").children[0];
  assert.match(accountCard.children[0].children[0].children[1].textContent, /last active/);
  assert.equal(getElement("adminUsers").children.length, 2, "a new sign-in appears in the refreshed account list");

  deferNextRead = true;
  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dashboardReads, 3);
  context.document.activeElement = { closest: selector => selector === ".admin-limit-form" };
  releaseDeferredRead();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getElement("activeUsersValue").textContent, "2", "an in-flight poll cannot replace an actively edited form");
  intervalCallback();
  windowListeners.focus();
  documentListeners.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dashboardReads, 3, "poll, focus, and visibility refreshes pause while a limit form is focused");
  context.document.activeElement = null;

  let form = getElement("adminUsers").children[0].children[2];
  let limitInput = form.children[0].children[0];
  form.elements = { dailyChatLimit: limitInput };
  limitInput.value = "42";
  getElement("adminUsers").listeners.input({ target: { closest: () => form } });
  intervalCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dashboardReads, 4);
  form = getElement("adminUsers").children[0].children[2];
  limitInput = form.children[0].children[0];
  assert.equal(limitInput.value, "42", "an unsaved draft remains intact across a background dashboard re-render");

  limitInput.value = "45";
  form.elements = { dailyChatLimit: limitInput };
  getElement("adminUsers").listeners.input({ target: { closest: () => form } });
  await getElement("adminUsers").listeners.submit({ target: { closest: () => form }, preventDefault() {} });
  assert.equal(savedLimit, 45);
  assert.equal(dashboardReads, 5, "the dashboard reloads after the limit save");
  const refreshedForm = getElement("adminUsers").children[0].children[2];
  assert.equal(refreshedForm.children[0].children[0].value, "45");
  assert.match(getElement("adminStatus").textContent, /saved and reflected/);
});
