import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("Supabase client uses the standard project API hostname", () => {
  const match = source.match(/supabaseUrl:\s*"([^"]+)"/);
  assert.ok(match, "Supabase project URL should be configured");
  assert.match(new URL(match[1]).hostname, /^[a-z0-9-]+\.supabase\.co$/);
});

class ElementMock {
  constructor(id) {
    this.id = id;
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.value = "";
    this.files = [];
    this.textContent = "";
    this.innerHTML = "";
    this.scrollHeight = 0;
  }

  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) || [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  querySelector() { return new ElementMock(`${this.id}-submit`); }
  reportValidity() { return this.validity !== false; }
}

test("classic frontend script boots beside Supabase and dashboard controls respond", async () => {
  const ids = [
    "authDialog", "authButton", "authForm", "authSubmit", "authStatus", "authToggle",
    "authClose", "authEmail", "authPassword", "authTitle", "accountIdentity",
    "chatForm", "chatStatus", "prompt", "messages", "newChat", "uploadForm",
    "uploadStatus", "uploadPanel", "historyPanel", "conversationList", "appStatus", "documentFile", "moduleCode",
    "developerAttribution", "sidebarToggle", "sidebarOverlay", "aboutLink", "historyToggle"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new ElementMock(id)]));
  elements.chatForm.reset = () => { elements.prompt.value = ""; };
  elements.chatForm.querySelector = () => new ElementMock("chat-submit");
  elements.uploadForm.querySelector = () => new ElementMock("upload-submit");

  let authStateListener;
  const authCalls = [];
  let clientOptions;
  const sdk = {
    createClient: (_url, _key, options) => {
      clientOptions = options;
      return {
        auth: {
          onAuthStateChange(listener) { authStateListener = listener; },
          getSession: async () => ({ data: { session: null }, error: null }),
          async signUp(credentials) {
            authCalls.push({ method: "signUp", credentials });
            return { data: { session: { access_token: "signup-token", user: { id: "new-user", email: credentials.email } } }, error: null };
          },
          async signInWithPassword(credentials) {
            authCalls.push({ method: "signInWithPassword", credentials });
            return { data: { session: { access_token: "signin-token", user: { id: "new-user", email: credentials.email } } }, error: null };
          }
        }
      };
    }
  };
  const bodyClasses = new Set();
  const document = {
    body: { classList: { toggle: (name, force) => force ? bodyClasses.add(name) : bodyClasses.delete(name) } },
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => new ElementMock(tag)
  };
  const context = vm.createContext({ document, window: { supabase: sdk } });

  // Supabase's UMD script exposes a classic global binding named `supabase`.
  vm.runInContext("var supabase = window.supabase;", context);
  assert.doesNotThrow(() => new vm.Script(source, { filename: "public/app.js" }).runInContext(context));
  assert.equal(clientOptions.auth.persistSession, true, "Supabase should persist signed-in sessions");
  assert.equal(clientOptions.auth.autoRefreshToken, true, "Supabase should refresh session tokens");
  assert.equal(clientOptions.auth.detectSessionInUrl, true, "Supabase should handle auth callback URLs");
  assert.equal(elements.developerAttribution.hidden, true, "developer attribution should be hidden when signed out");
  assert.equal(elements.historyPanel.hidden, true, "saved conversation history should be hidden when signed out");
  assert.equal(elements.historyToggle.hidden, true, "history visibility control should be private when signed out");
  assert.equal(elements.uploadPanel.hidden, true, "private module uploads should be hidden when signed out");
  assert.equal(elements.accountIdentity.hidden, true, "account email should be hidden when signed out");

  elements.sidebarToggle.listeners.get("click")[0]();
  assert.equal(bodyClasses.has("sidebar-open"), true, "mobile menu should open the sidebar");
  assert.equal(elements.sidebarOverlay.hidden, false, "opening the mobile sidebar should show its overlay");
  elements.sidebarOverlay.listeners.get("click")[0]();
  assert.equal(bodyClasses.has("sidebar-open"), false, "sidebar overlay should close the mobile menu");
  assert.equal(elements.sidebarOverlay.hidden, true, "closing the mobile menu should hide its overlay");

  await elements.authButton.listeners.get("click")[0]();
  assert.equal(elements.authDialog.open, true, "sign-in button should open the auth dialog");

  elements.authToggle.listeners.get("click")[0]();
  assert.equal(elements.authTitle.textContent, "Create account");
  assert.equal(elements.authToggle.textContent, "Already have an account? Sign in");
  assert.doesNotMatch(source, /authName|full_name/, "signup should not collect or submit a separate name");

  elements.authEmail.value = "not-an-email";
  elements.authPassword.value = "a-valid-password";
  elements.authForm.validity = false;
  await elements.authForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(authCalls.length, 0, "invalid email/password form should not call Supabase");
  assert.match(elements.authStatus.textContent, /valid email address and password/);

  elements.authEmail.value = "  student@nwu.ac.za  ";
  elements.authPassword.value = "a-valid-password";
  elements.authForm.validity = true;
  await elements.authForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(authCalls[0].method, "signUp");
  assert.equal(authCalls[0].credentials.email, "student@nwu.ac.za");
  assert.equal(authCalls[0].credentials.password, "a-valid-password");
  assert.equal(Object.hasOwn(authCalls[0].credentials, "options"), false, "signup should not submit a separate name payload");

  elements.authToggle.listeners.get("click")[0]();
  assert.equal(elements.authTitle.textContent, "Sign in");
  assert.equal(elements.authToggle.textContent, "Create an account");

  elements.authClose.listeners.get("click")[0]();
  assert.equal(elements.authDialog.open, false, "close button should close the auth dialog");

  elements.prompt.value = "draft question";
  elements.newChat.listeners.get("click")[0]();
  assert.equal(elements.prompt.value, "", "new conversation should clear the draft");
  assert.equal(elements.chatStatus.textContent, "", "new conversation should not show a success notice");
  assert.match(elements.messages.innerHTML, /What are you studying today\?/);
  assert.doesNotMatch(elements.messages.innerHTML, /sign in to upload your course material|Try:/i, "welcome copy should not show signup prompts or sample text");

  elements.prompt.value = "Explain a first-year biology concept.";
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(elements.authDialog.open, true, "signed-out chat submit should open the sign-in dialog");
  assert.match(elements.authStatus.textContent, /Sign in to ask a question/);
  elements.authClose.listeners.get("click")[0]();

  await elements.uploadForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(elements.authDialog.open, true, "signed-out upload submit should open the sign-in dialog");
  assert.match(elements.authStatus.textContent, /Sign in to upload/);
  elements.authClose.listeners.get("click")[0]();

  elements.authDialog.open = true;
  authStateListener("SIGNED_IN", { access_token: "test-token", user: { id: "test-user", email: "averyveryverylongemailaddress@example.com" } });
  await Promise.resolve();
  assert.equal(elements.authDialog.open, false, "sign-in state should close an open auth dialog");
  assert.equal(elements.developerAttribution.hidden, false, "developer attribution should be visible after sign-in");
  assert.equal(elements.historyPanel.hidden, false, "saved conversation history should be available after sign-in");
  assert.equal(elements.historyToggle.hidden, false, "history visibility control should be available after sign-in");
  assert.equal(elements.historyToggle.textContent, "Hide history");
  assert.equal(elements.historyToggle.getAttribute("aria-expanded"), "true");
  elements.historyToggle.listeners.get("click")[0]();
  assert.equal(elements.historyPanel.hidden, true, "history button should hide the conversation list");
  assert.equal(elements.historyToggle.textContent, "Show history");
  assert.equal(elements.historyToggle.getAttribute("aria-expanded"), "false");
  elements.historyToggle.listeners.get("click")[0]();
  assert.equal(elements.historyPanel.hidden, false, "history button should restore the conversation list");
  assert.equal(elements.historyToggle.getAttribute("aria-expanded"), "true");
  assert.equal(elements.uploadPanel.hidden, false, "module uploads should be available after sign-in");
  assert.equal(elements.accountIdentity.hidden, false, "account email should be shown after sign-in");
  assert.ok(elements.accountIdentity.textContent.length <= 25, "long email should be minimized in the sidebar");
  assert.equal(elements.accountIdentity.title, "averyveryverylongemailaddress@example.com", "full email remains available as a title");
  authStateListener("SIGNED_OUT", null);
  await Promise.resolve();
  assert.equal(elements.developerAttribution.hidden, true, "developer attribution should be hidden again after sign-out");
  assert.equal(elements.historyPanel.hidden, true, "saved conversation history should be hidden again after sign-out");
  assert.equal(elements.uploadPanel.hidden, true, "module uploads should be hidden again after sign-out");
  assert.equal(elements.accountIdentity.hidden, true, "account email should be hidden again after sign-out");
  assert.equal(elements.historyToggle.hidden, true, "history visibility control should hide again after sign-out");
  assert.doesNotMatch(source, /Signed in successfully\.|New conversation ready\./, "transient success notices should not be displayed");
});
