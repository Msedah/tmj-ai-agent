import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const markup = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

 test("Supabase client uses the standard project API hostname", () => {
  const match = source.match(/supabaseUrl:\s*"([^"]+)"/);
  assert.ok(match, "Supabase project URL should be configured");
  assert.match(new URL(match[1]).hostname, /^[a-z0-9-]+\.supabase\.co$/);
});

test("document attachment is inside the message composer and developer contact is absent", () => {
  const composer = markup.match(/<form id="chatForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(composer, /id="documentFile"/);
  assert.match(composer, /id="attachDocument"/);
  assert.match(composer, /id="sendButton"/);
  assert.match(markup, /id="sidebarCollapse"[^>]*aria-label="Hide left panel"/);
  assert.match(markup, /id="aboutToggle"[^>]*aria-expanded="false"/);
  assert.match(markup, /<section id="about"[^>]*hidden>/);
  assert.doesNotMatch(markup, /id="aboutLink"/);
  assert.doesNotMatch(markup, /uploadPanel|uploadForm|developerAttribution|Developed by|mailulajosep@gmail\.com|TJ Mailula/i);
  assert.match(markup, /NWU’s public website/);
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
    this.files = [];
    this.textContent = "";
    this.innerHTML = "";
    this.scrollHeight = 0;
    this.clickCount = 0;
    this._value = "";
  }

  get value() { return this._value; }
  set value(next) {
    this._value = next;
    if (this.id === "documentFile" && next === "") this.files = [];
  }

  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) || [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() {}
  scrollIntoView() {}
  click() { this.clickCount += 1; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  reportValidity() { return this.validity !== false; }
}

test("classic frontend boots; auth, history, composer uploads and citations respond", async () => {
  const ids = [
    "authDialog", "authButton", "authForm", "authSubmit", "authStatus", "authToggle",
    "authClose", "authEmail", "authPassword", "authTitle", "accountIdentity",
    "chatForm", "chatStatus", "uploadStatus", "prompt", "messages", "newChat",
    "attachmentControls", "documentFile", "attachDocument", "attachmentPreview", "attachmentName",
    "removeAttachment", "moduleCodeControl", "moduleCode", "sendButton", "sendLabel",
    "historyPanel", "conversationList", "appStatus", "sidebarToggle", "sidebarOverlay", "sidebarCollapse", "aboutToggle", "about", "historyToggle"
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new ElementMock(id)]));
  elements.about.hidden = true;
  elements.sidebarCollapse.textContent = "Hide left panel";
  elements.aboutToggle.textContent = "About TMJ AI";
  elements.chatForm.reset = () => {
    elements.prompt.value = "";
    elements.documentFile.value = "";
    elements.moduleCode.value = "";
  };

  let authStateListener;
  let clientOptions;
  const authCalls = [];
  const uploadCalls = [];
  const fetchCalls = [];
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
          },
          async signOut() { return { error: null }; }
        },
        storage: {
          from(bucket) {
            return { async upload(path, file, options) { uploadCalls.push({ bucket, path, file, options }); return { error: null }; } };
          }
        },
        from() {
          const query = {
            select() { return this; },
            order() { return this; },
            eq() { return this; },
            async limit() { return { data: [], error: null }; }
          };
          return query;
        }
      };
    }
  };
  const bodyClasses = new Set();
  let mobileViewport = true;
  const document = {
    body: { classList: { toggle: (name, force) => force ? bodyClasses.add(name) : bodyClasses.delete(name), contains: name => bodyClasses.has(name) } },
    getElementById: id => elements[id] || null,
    createElement: tag => new ElementMock(tag)
  };
  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === "/api/index-document") return { ok: true, status: 200, json: async () => ({ message: "Document indexed successfully." }) };
    if (url === "/api/chat") return {
      ok: true,
      status: 200,
      json: async () => ({
        reply: "Academic integrity is supported by the current NWU rules.",
        conversationId: "conversation-1",
        sources: [{ name: "NWU Senate Rules on Academic Integrity", url: "https://www.nwu.ac.za/published-rules.pdf", type: "nwu_official_live", date: "2026-08-20" }],
        nwuSearchUrl: "https://www.nwu.ac.za/multisite-search?search_api_fulltext=academic%20integrity"
      })
    };
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  const context = vm.createContext({ document, window: { supabase: sdk, matchMedia: () => ({ matches: mobileViewport }) }, fetch, URL, crypto: { randomUUID: () => "uuid-1" }, console });

  // Supabase's UMD script exposes a classic global binding named `supabase`.
  vm.runInContext("var supabase = window.supabase;", context);
  assert.doesNotThrow(() => new vm.Script(source, { filename: "public/app.js" }).runInContext(context));
  assert.equal(clientOptions.auth.persistSession, true);
  assert.equal(clientOptions.auth.autoRefreshToken, true);
  assert.equal(clientOptions.auth.detectSessionInUrl, true);
  assert.equal(elements.historyPanel.hidden, true, "saved conversation history stays private when signed out");
  assert.equal(elements.historyToggle.hidden, true, "history toggle stays private when signed out");
  assert.equal(elements.attachmentControls.hidden, true, "private uploads are hidden when signed out");
  assert.equal(elements.accountIdentity.hidden, true, "account identity stays hidden when signed out");
  assert.doesNotMatch(source, /developerAttribution|mailulajosep@gmail\.com|Developed by/i);
  assert.equal(elements.sidebarCollapse.getAttribute("aria-expanded"), "false", "the mobile sidebar starts closed");

  elements.sidebarToggle.listeners.get("click")[0]();
  assert.equal(bodyClasses.has("sidebar-open"), true, "mobile menu opens the sidebar");
  assert.equal(elements.sidebarOverlay.hidden, false);
  assert.equal(elements.sidebarCollapse.getAttribute("aria-expanded"), "true");
  elements.sidebarOverlay.listeners.get("click")[0]();
  assert.equal(bodyClasses.has("sidebar-open"), false, "overlay closes the sidebar");
  assert.equal(elements.sidebarCollapse.getAttribute("aria-expanded"), "false");
  elements.sidebarToggle.listeners.get("click")[0]();
  elements.sidebarCollapse.listeners.get("click")[0]();
  assert.equal(bodyClasses.has("sidebar-open"), false, "the bottom sidebar control closes the mobile menu");
  elements.sidebarToggle.listeners.get("click")[0]();
  elements.aboutToggle.listeners.get("click")[0]();
  assert.equal(elements.about.hidden, false, "About is revealed only after the explicit toggle");
  assert.equal(elements.aboutToggle.textContent, "Hide About TMJ AI");
  assert.equal(elements.aboutToggle.getAttribute("aria-expanded"), "true");
  assert.equal(bodyClasses.has("sidebar-open"), false, "opening About closes the mobile menu");
  elements.aboutToggle.listeners.get("click")[0]();
  assert.equal(elements.about.hidden, true, "the About toggle hides the information again");

  mobileViewport = false;
  elements.sidebarCollapse.listeners.get("click")[0]();
  assert.equal(bodyClasses.has("sidebar-collapsed"), true, "the desktop sidebar collapses to a narrow rail");
  assert.equal(elements.sidebarCollapse.textContent, "Show left panel");
  assert.equal(elements.sidebarCollapse.getAttribute("aria-expanded"), "false");
  elements.sidebarCollapse.listeners.get("click")[0]();
  assert.equal(bodyClasses.has("sidebar-collapsed"), false, "the bottom rail control restores the left panel");
  assert.equal(elements.sidebarCollapse.textContent, "Hide left panel");
  mobileViewport = true;

  await elements.authButton.listeners.get("click")[0]();
  assert.equal(elements.authDialog.open, true);
  elements.authToggle.listeners.get("click")[0]();
  assert.equal(elements.authTitle.textContent, "Create account");
  assert.equal(elements.authToggle.textContent, "Already have an account? Sign in");
  assert.doesNotMatch(source, /authName|full_name/);

  elements.authEmail.value = "not-an-email";
  elements.authPassword.value = "a-valid-password";
  elements.authForm.validity = false;
  await elements.authForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(authCalls.length, 0, "invalid email/password does not call Supabase");
  assert.match(elements.authStatus.textContent, /valid email address and password/);

  elements.authEmail.value = "  student@nwu.ac.za  ";
  elements.authPassword.value = "a-valid-password";
  elements.authForm.validity = true;
  await elements.authForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(authCalls[0].method, "signUp");
  assert.equal(authCalls[0].credentials.email, "student@nwu.ac.za");
  assert.equal(authCalls[0].credentials.password, "a-valid-password");
  assert.equal(Object.hasOwn(authCalls[0].credentials, "options"), false);

  elements.authToggle.listeners.get("click")[0]();
  assert.equal(elements.authTitle.textContent, "Sign in");
  elements.authClose.listeners.get("click")[0]();
  assert.equal(elements.authDialog.open, false);

  elements.prompt.value = "draft question";
  elements.newChat.listeners.get("click")[0]();
  assert.equal(elements.prompt.value, "");
  assert.equal(elements.chatStatus.textContent, "", "new chat does not display a promotional success notice");
  assert.match(elements.messages.innerHTML, /What are you studying today\?/);

  elements.prompt.value = "Explain a first-year biology concept.";
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(elements.authDialog.open, true, "signed-out chat submit asks the student to sign in");
  assert.match(elements.authStatus.textContent, /Sign in to ask a question/);
  elements.authClose.listeners.get("click")[0]();

  elements.attachDocument.listeners.get("click")[0]();
  assert.equal(elements.authDialog.open, true, "signed-out attachment action asks the student to sign in");
  assert.match(elements.authStatus.textContent, /Sign in to attach/);
  elements.authClose.listeners.get("click")[0]();

  elements.authDialog.open = true;
  authStateListener("SIGNED_IN", { access_token: "test-token", user: { id: "test-user", email: "averyveryverylongemailaddress@example.com" } });
  await Promise.resolve();
  assert.equal(elements.authDialog.open, false, "sign-in state closes an open auth dialog");
  assert.equal(elements.historyPanel.hidden, false);
  assert.equal(elements.historyToggle.hidden, false);
  assert.equal(elements.historyToggle.textContent, "Hide history");
  elements.historyToggle.listeners.get("click")[0]();
  assert.equal(elements.historyPanel.hidden, true);
  assert.equal(elements.historyToggle.textContent, "Show history");
  elements.historyToggle.listeners.get("click")[0]();
  assert.equal(elements.historyPanel.hidden, false);
  assert.equal(elements.attachmentControls.hidden, false, "composer attachments are available after sign-in");
  assert.equal(elements.accountIdentity.hidden, false);
  assert.ok(elements.accountIdentity.textContent.length <= 25);
  assert.equal(elements.accountIdentity.title, "averyveryverylongemailaddress@example.com");

  elements.prompt.value = "";
  elements.prompt.listeners.get("input")[0]();
  elements.attachDocument.listeners.get("click")[0]();
  assert.equal(elements.documentFile.clickCount, 1, "attach button opens the native file picker");
  elements.documentFile.files = [{ name: "PADM101.pdf", size: 2048, type: "application/pdf" }];
  elements.documentFile.listeners.get("change")[0]();
  assert.equal(elements.attachmentPreview.hidden, false);
  assert.equal(elements.attachmentName.textContent, "PADM101.pdf");
  assert.equal(elements.moduleCodeControl.hidden, false);
  assert.equal(elements.sendLabel.textContent, "Upload & index");
  elements.moduleCode.value = "padm101";

  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(uploadCalls.length, 1, "attachment uploads to the private Supabase bucket");
  assert.equal(uploadCalls[0].bucket, "tmj-documents");
  assert.equal(fetchCalls[0].url, "/api/index-document", "indexing runs from the same composer submit");
  assert.equal(JSON.parse(fetchCalls[0].options.body).moduleCode, "PADM101");
  assert.equal(elements.attachmentPreview.hidden, true, "successful indexing clears the attachment chip");
  assert.match(elements.uploadStatus.textContent, /Document indexed successfully/);

  elements.prompt.value = "What does NWU publish about academic integrity?";
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  const chatCall = fetchCalls.find(call => call.url === "/api/chat");
  assert.ok(chatCall, "academic question reaches the Worker");
  assert.match(chatCall.options.headers.Authorization, /^Bearer test-token$/);
  const assistant = elements.messages.children.at(-1);
  assert.match(assistant.textContent, /Academic integrity is supported/);
  assert.equal(assistant.children.length, 1, "citations are appended separately from the AI answer text");
  const sourceSection = assistant.children[0];
  const referencesList = sourceSection.children.find(child => child.id === "ul");
  assert.ok(referencesList);
  assert.equal(referencesList.children[0].children[0].href, "https://www.nwu.ac.za/published-rules.pdf");
  assert.match(sourceSection.children.at(-1).textContent, /Search NWU’s public website/);
  assert.doesNotMatch(assistant.textContent, /No sources available|Source notes:\s*None/i);

  authStateListener("SIGNED_OUT", null);
  await Promise.resolve();
  assert.equal(elements.historyPanel.hidden, true, "history hides again on sign-out");
  assert.equal(elements.attachmentControls.hidden, true, "upload control hides again on sign-out");
  assert.equal(elements.accountIdentity.hidden, true);
  assert.equal(elements.historyToggle.hidden, true);
  assert.doesNotMatch(source, /Signed in successfully\.|New conversation ready\./);
});
