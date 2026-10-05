import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const markup = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const aboutMarkup = readFileSync(new URL("../public/about.html", import.meta.url), "utf8");
const aboutScript = readFileSync(new URL("../public/about.js", import.meta.url), "utf8");
const communityMarkup = readFileSync(new URL("../public/community.html", import.meta.url), "utf8");
const communityScript = readFileSync(new URL("../public/community.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

 test("Supabase client uses the standard project API hostname", () => {
  const match = source.match(/supabaseUrl:\s*"([^"]+)"/);
  assert.ok(match, "Supabase project URL should be configured");
  assert.match(new URL(match[1]).hostname, /^[a-z0-9-]+\.supabase\.co$/);
});

test("document attachment is inside the message composer and developer contact is absent", () => {
  assert.match(markup, /src="\/vendor\/supabase-js-2\.117\.2\.js" defer/);
  assert.match(markup, /src="\/app\.js" defer/);
  assert.ok(markup.indexOf("/vendor/supabase-js-2.117.2.js") < markup.indexOf("/app.js"), "the pinned client loads before the student app");
  assert.doesNotMatch(markup, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/);
  const composer = markup.match(/<form id="chatForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(composer, /id="documentFile"/);
  assert.match(composer, /id="attachDocument"/);
  assert.match(composer, /id="imageModeToggle"/);
  assert.match(composer, /Create image/);
  assert.match(source, /fetch\("\/api\/generate-image"/);
  assert.match(styles, /\.generated-image/);
  assert.match(composer, /id="sendButton"/);
  assert.ok(markup.indexOf('id="chatStatus"') < markup.indexOf('<form id="chatForm"'), "chat feedback appears above the composer");
  assert.ok(markup.indexOf('id="uploadStatus"') < markup.indexOf('<form id="chatForm"'), "upload feedback appears above the composer");
  assert.doesNotMatch(markup.slice(markup.indexOf("</form>")), /id="chatStatus"|id="uploadStatus"|class="disclaimer"/);
  assert.doesNotMatch(source, /Answer ready\./i);
  assert.doesNotMatch(source, /setStatus\(chatStatus,\s*["']Conversation deleted\./);
  assert.match(markup, /id="sidebarCollapse"[^>]*aria-label="Hide left panel"/);
  const sidebar = markup.match(/<aside[^>]*id="appSidebar"[\s\S]*?<\/aside>/)?.[0] || "";
  assert.match(sidebar, /<a class="about-link" href="\/about\.html"[^>]*>About<\/a>/);
  assert.ok(sidebar.indexOf('class="about-link"') > sidebar.indexOf('id="sidebarCollapse"'), "About sits at the bottom of the left panel");
  assert.match(markup, /<textarea id="prompt" rows="1"/);
  assert.match(markup, /id="sendLabel">Send message<\/span>/);
  assert.doesNotMatch(markup, /class="disclaimer"/);
  assert.doesNotMatch(markup, /id="aboutToggle"|id="aboutInfoTitle"/);
  assert.match(markup, /src="\/tmj-mark\.svg"/);
  assert.match(markup, /class="starter-prompt"/);
  assert.doesNotMatch(markup, /upload-hint|2\s*MiB|40\s*MiB|one document per day|Supported formats:/i);
  assert.doesNotMatch(markup, /uploadPanel|uploadForm|developerAttribution|Developed by|mailulajosep@gmail\.com|TJ Mailula/i);
  assert.match(aboutMarkup, /<h1>About<\/h1>/);
  assert.match(aboutMarkup, /<a class="about-back-button" href="\/" data-about-back[^>]*>[\s\S]*?<span>Back<\/span>/);
  assert.match(aboutMarkup, /independent general-purpose assistant/i);
  assert.match(markup, /General AI help, with a focus on Sekororo and Limpopo/);
  assert.match(markup, /id="responseLanguage"/);
  assert.match(markup, /value="sepedi"/);
  assert.match(markup, /value="xitsonga"/);
  assert.match(markup, /value="tshivenda"/);
  assert.match(aboutMarkup, /Deleting that conversation also deletes its uploads and indexed text/i);
  assert.match(aboutMarkup, /stay with the conversation where they were added/i);
  assert.match(aboutMarkup, /Cloudflare Workers AI/);
  assert.match(aboutMarkup, /Image prompts are processed by Cloudflare Workers AI/);
  assert.match(aboutMarkup, /not saved to TMJ conversation history/);
  assert.match(aboutMarkup, /daily usage counter linked to your account/i);
  assert.match(aboutMarkup, /not question text or an AI-points balance/i);
  assert.match(aboutMarkup, /00:00 UTC \(02:00 South African time\)/);
  assert.match(aboutMarkup, /Helpful\/not-helpful selections stay on this page and are not sent/i);
  assert.match(aboutMarkup, /question itself out of the outgoing page URLs and request parameters/i);
  assert.match(aboutMarkup, /representative Ga-Sekororo locality point/i);
  assert.match(aboutMarkup, /edge-cached for up to 15 minutes/i);
  assert.doesNotMatch(aboutMarkup, /NWU|North-West University|eFundi/i);
  assert.match(communityMarkup, /Official records also use Ga-Sekororo/);
  assert.match(communityMarkup, /South African Post Office record lists a Moetladimo Branch, not a branch named “Metz Post Office\.”/);
  assert.match(communityMarkup, /Weather around Ga-Sekororo/);
  assert.match(communityMarkup, /Open-Meteo/);
  assert.match(communityMarkup, /Mahlakung Shopping Centre/);
  assert.match(communityMarkup, /not a live confirmation of opening hours or service availability/);
  assert.doesNotMatch(communityMarkup, /NWU|North-West University|eFundi/i);
  assert.match(communityScript, /\/api\/weather/);
  assert.match(communityScript, /\/api\/community\/sources/);
  assert.match(aboutScript, /window\.history\.back\(\)/);
  assert.match(aboutScript, /cameFromChat/);
  assert.match(styles, /\.delete-conversation:focus-visible/);
  assert.match(styles, /\.send-button:focus-visible/);
  assert.match(styles, /\.about-back-button:focus-visible/);
  assert.match(styles, /\.composer textarea[^\n]*resize: none/);
  assert.match(source, /deleteIcon\.className = "delete-icon"/);
});

test("About Back returns to the originating chat and falls back home for direct visits", () => {
  const runBack = (referrer, historyLength) => {
    const listeners = new Map();
    const history = { length: historyLength, backCount: 0, back() { this.backCount += 1; } };
    const link = { addEventListener(name, handler) { listeners.set(name, handler); } };
    const context = vm.createContext({
      document: { referrer, querySelector: () => link },
      window: { location: { origin: "https://tmj-ai-agent.example" }, history },
      URL
    });
    vm.runInContext(aboutScript, context);
    let prevented = false;
    listeners.get("click")({ preventDefault() { prevented = true; } });
    return { backCount: history.backCount, prevented };
  };

  assert.deepEqual(runBack("https://tmj-ai-agent.example/?utm_source=test", 2), { backCount: 1, prevented: true });
  assert.deepEqual(runBack("https://external.example/", 1), { backCount: 0, prevented: false });
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
    this.style = {};
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
    "attachmentControls", "documentFile", "imageModeToggle", "imageModeLabel", "attachDocument", "attachmentPreview", "attachmentName",
    "removeAttachment", "moduleCodeControl", "moduleCode", "sendButton", "sendLabel",
    "historyPanel", "conversationList", "appStatus", "sidebarToggle", "sidebarOverlay", "sidebarCollapse", "historyToggle"
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new ElementMock(id)]));
  elements.sidebarCollapse.textContent = "Hide left panel";
  elements.chatForm.reset = () => {
    elements.prompt.value = "";
    elements.documentFile.value = "";
    elements.moduleCode.value = "";
  };

  let authStateListener;
  let clientOptions;
  const authCalls = [];
  const uploadCalls = [];
  const removeCalls = [];
  const fetchCalls = [];
  const clipboardCalls = [];
  const deleteRequests = [];
  const confirmationMessages = [];
  let confirmResponse = true;
  let savedConversations = [
    { id: "conversation-1", title: "Biology study" },
    { id: "conversation-2", title: "Research methods" }
  ];
  let savedMessages = [];
  let savedDocuments = [];
  let indexedDocuments = 0;
  let imageRequests = 0;
  let usageSnapshot = { chatAllowed: true, uploadAllowed: true };
  let rejectNextIndex = false;
  let failUsageCheck = false;
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
            return {
              async upload(path, file, options) { uploadCalls.push({ bucket, path, file, options }); return { error: null }; },
              async remove(paths) { removeCalls.push({ bucket, paths }); return { data: paths, error: null }; }
            };
          }
        },
        from(table) {
          if (table === "conversations") {
            return {
              select() { return this; },
              order() { return this; },
              async limit() { return { data: savedConversations.map(conversation => ({ ...conversation })), error: null }; }
            };
          }
          if (table === "messages") {
            return {
              select() { return this; },
              eq() { return this; },
              async order() { return { data: savedMessages.map(message => ({ ...message })), error: null }; }
            };
          }
          if (table === "documents") {
            let selectedConversationId = null;
            const query = {
              select() { return this; },
              eq(column, value) { if (column === "conversation_id") selectedConversationId = value; return this; },
              async order() { return { data: savedDocuments.filter(document => document.conversation_id === selectedConversationId).map(document => ({ ...document })), error: null }; }
            };
            return query;
          }
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
    createElement: tag => new ElementMock(tag),
    visibilityState: "visible",
    addEventListener(name, handler) { (documentListeners.get(name) || documentListeners.set(name, []).get(name)).push(handler); }
  };
  const windowListeners = new Map();
  const documentListeners = new Map();
  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === "/api/usage") return failUsageCheck
      ? { ok: false, status: 503, json: async () => ({ error: "Could not check today's usage." }) }
      : { ok: true, status: 200, json: async () => ({ ...usageSnapshot }) };
    if (url === "/api/generate-image") {
      imageRequests += 1;
      if (imageRequests > 1) return { ok: false, status: 429, json: async () => ({ error: "Image generation is unavailable right now.", code: "IMAGE_DAILY_LIMIT_REACHED" }) };
      return { ok: true, status: 200, json: async () => ({ image: "/9j/2Q==", contentType: "image/jpeg" }) };
    }
    if (url.startsWith("/api/conversations/")) {
      const id = url.slice("/api/conversations/".length);
      deleteRequests.push({ url, options });
      savedConversations = savedConversations.filter(conversation => conversation.id !== id);
      return { ok: true, status: 200, json: async () => ({ ok: true, id }) };
    }
    if (url === "/api/index-document") {
      if (rejectNextIndex) {
        rejectNextIndex = false;
        return { ok: false, status: 422, json: async () => ({ error: "The document could not be extracted." }) };
      }
      const requestBody = JSON.parse(options.body || "{}");
      const conversationId = requestBody.conversationId || "conversation-uploads";
      const document = {
        file_name: requestBody.fileName,
        module_code: requestBody.moduleCode,
        conversation_id: conversationId,
        created_at: `2026-10-02T00:00:0${indexedDocuments++}.000Z`
      };
      savedDocuments.push(document);
      return { ok: true, status: 200, json: async () => ({ message: "Document added to this conversation.", conversationId, document: { fileName: document.file_name, moduleCode: document.module_code, createdAt: document.created_at } }) };
    }
    if (url === "/api/chat") {
      const question = JSON.parse(options.body || "{}").message || "";
      if (/developer|creator|created|developed/i.test(question)) return {
        ok: true,
        status: 200,
        json: async () => ({
          reply: "Developer profile\nName: TJ Mailula\nFull name: Tshepo Joseph Mailula\nTJ stands for: Tshepo Joseph\nRole: Developer and creator of TMJ AI Agent\nLocation: Tzaneen, Limpopo, South Africa\nEmail: mailulajosep@gmail.com\nPhone: 0718452020",
          developerProfile: {
            name: "TJ Mailula",
            fullName: "Tshepo Joseph Mailula",
            initialsMeaning: "TJ stands for Tshepo Joseph",
            role: "Developer and creator of TMJ AI Agent",
            location: "Tzaneen, Limpopo, South Africa",
            email: "mailulajosep@gmail.com",
            phone: "0718452020",
            photoUrl: "/developer-tj.webp",
            photoAlt: "Photo of TJ Mailula, developer of TMJ AI Agent"
          },
          conversationId: "conversation-1",
          sources: [],
          communitySearchUrl: null
        })
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          reply: "The Maruleng Local Municipality vacancy page lists an advert closing on 7 October 2026.",
          conversationId: "conversation-1",
          sources: [{ name: "Maruleng Local Municipality — Vacancies", url: "https://www.maruleng.gov.za/pages/vacancies.php", type: "official_public", date: "2026-10-07", checkedAt: "2026-10-05T15:35:00.000Z" }],
          communitySearchUrl: "/community.html"
        })
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  const context = vm.createContext({ document, window: {
    supabase: sdk,
    navigator: { clipboard: { async writeText(value) { clipboardCalls.push(value); } } },
    matchMedia: () => ({ matches: mobileViewport }),
    confirm: message => { confirmationMessages.push(message); return confirmResponse; },
    addEventListener(name, handler) { (windowListeners.get(name) || windowListeners.set(name, []).get(name)).push(handler); },
    setTimeout: () => 1,
    clearTimeout() {}
  }, fetch, URL, crypto: { randomUUID: () => "uuid-1" }, console });

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

  elements.authEmail.value = "  student@example.org  ";
  elements.authPassword.value = "a-valid-password";
  elements.authForm.validity = true;
  await elements.authForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(authCalls[0].method, "signUp");
  assert.equal(authCalls[0].credentials.email, "student@example.org");
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
  assert.match(elements.messages.innerHTML, /What can I help with today\?/);
  const starterButton = new ElementMock("button");
  starterButton.setAttribute("data-starter-prompt", "Explain a difficult concept from my module in plain language and give one example.");
  elements.messages.listeners.get("click")[0]({ target: { closest: () => starterButton } });
  assert.equal(elements.prompt.value, starterButton.getAttribute("data-starter-prompt"), "starter chips fill the composer without auto-sending");
  assert.equal(fetchCalls.filter(call => call.url === "/api/chat").length, 0);

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
  const usageChecksBeforeSignIn = fetchCalls.filter(call => call.url === "/api/usage").length;
  authStateListener("SIGNED_IN", { access_token: "test-token", user: { id: "test-user", email: "averyveryverylongemailaddress@example.com" } });
  assert.equal(elements.sendButton.disabled, true, "message sending waits until daily access can be checked");
  assert.equal(elements.sendLabel.textContent, "Checking access…");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(fetchCalls.filter(call => call.url === "/api/usage").length > usageChecksBeforeSignIn, "sign-in automatically loads daily access without waiting for a focus event");
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
  elements.imageModeToggle.listeners.get("click")[0]();
  assert.equal(elements.imageModeToggle.getAttribute("aria-pressed"), "true");
  assert.equal(elements.prompt.placeholder, "Describe the image you want to create…");
  elements.prompt.value = "A soft green landscape with a river";
  elements.prompt.listeners.get("input")[0]();
  assert.equal(elements.sendLabel.textContent, "Generate image");
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(imageRequests, 1);
  const generatedImageAnswer = elements.messages.children.at(-1);
  assert.equal(generatedImageAnswer.className, "message assistant");
  const generatedFigure = generatedImageAnswer.children[0];
  assert.equal(generatedFigure.className, "generated-image");
  assert.equal(generatedFigure.children[0].src, "data:image/jpeg;base64,/9j/2Q==");
  assert.equal(generatedFigure.children[1].download, "tmj-ai-generated-image.jpg");
  assert.equal(elements.prompt.value, "", "the image prompt clears only after successful generation");

  elements.prompt.value = "Try to generate another image";
  elements.prompt.listeners.get("input")[0]();
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(imageRequests, 2);
  assert.match(elements.chatStatus.textContent, /Image generation is unavailable right now/i);
  assert.doesNotMatch(elements.chatStatus.textContent, /per day|today|tomorrow|quota|limit/i,
    "a repeated attempt is stopped without telling the user about the daily allowance");
  elements.imageModeToggle.listeners.get("click")[0]();
  assert.equal(elements.imageModeToggle.getAttribute("aria-pressed"), "false");
  assert.equal(elements.prompt.placeholder, "Message TMJ AI…");

  elements.prompt.scrollHeight = 32;
  elements.prompt.value = "";
  elements.prompt.listeners.get("input")[0]();
  assert.equal(elements.prompt.style.height, "32px", "the empty composer stays compact at one line");
  assert.equal(elements.prompt.style.overflowY, "hidden");
  assert.equal(elements.sendLabel.textContent, "Send message");
  elements.prompt.value = "A longer message wraps onto multiple lines";
  elements.prompt.scrollHeight = 96;
  elements.prompt.listeners.get("input")[0]();
  assert.equal(elements.prompt.style.height, "96px", "the composer grows to fit typed text");
  elements.prompt.scrollHeight = 260;
  elements.prompt.listeners.get("input")[0]();
  assert.equal(elements.prompt.style.height, "180px", "the composer caps its height for very long messages");
  assert.equal(elements.prompt.style.overflowY, "auto", "very long messages scroll inside the capped composer");
  elements.prompt.value = "";
  elements.prompt.scrollHeight = 32;
  elements.prompt.listeners.get("input")[0]();
  elements.attachDocument.listeners.get("click")[0]();
  assert.equal(elements.documentFile.clickCount, 1, "attach button opens the native file picker");
  elements.documentFile.files = [{ name: "too-large.pdf", size: 40 * 1024 * 1024 + 1, type: "application/pdf" }];
  elements.documentFile.listeners.get("change")[0]();
  assert.match(elements.uploadStatus.textContent, /too large to add/i);
  assert.equal(uploadCalls.length, 0, "oversize files never leave the browser");
  elements.attachDocument.listeners.get("click")[0]();
  elements.documentFile.files = [{ name: "PADM101.pdf", size: 2 * 1024 * 1024 + 1, type: "application/pdf" }];
  elements.documentFile.listeners.get("change")[0]();
  assert.equal(elements.attachmentPreview.hidden, false);
  assert.equal(elements.attachmentName.textContent, "PADM101.pdf");
  assert.equal(elements.moduleCodeControl.hidden, false);
  assert.equal(elements.sendLabel.textContent, "Upload");
  elements.moduleCode.value = "padm101";

  rejectNextIndex = true;
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(uploadCalls.length, 1, "the first attempt uploads the selected file");
  assert.equal(removeCalls.length, 1, "a rejected staged file is removed from private storage");
  assert.match(elements.uploadStatus.textContent, /could not be extracted/i);
  assert.equal(elements.attachmentPreview.hidden, false, "the user can retry after fixing or replacing a rejected file");

  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(uploadCalls.length, 2, "the attachment can be retried in the private Supabase bucket");
  assert.equal(uploadCalls[0].bucket, "tmj-documents");
  const indexCall = fetchCalls.find(call => call.url === "/api/index-document");
  assert.ok(indexCall, "indexing runs from the same composer submit");
  assert.equal(JSON.parse(indexCall.options.body).moduleCode, "PADM101");
  assert.equal(JSON.parse(indexCall.options.body).conversationId, null, "first upload creates a new conversation on the server");
  assert.equal(elements.attachmentPreview.hidden, true, "successful indexing clears the attachment chip");
  assert.equal(elements.uploadStatus.textContent, "", "successful indexing does not leave status clutter by the composer");
  assert.match(elements.messages.children.at(-1).textContent, /Upload complete.*ask a question/i, "upload-only indexing receives a visible chat acknowledgment");
  assert.equal(elements.attachDocument.disabled, false, "successful indexing does not exhaust the daily upload budget");
  assert.equal(elements.sendButton.disabled, false, "document uploads do not block chat");
  const uploadCallsForFirstBatch = fetchCalls.filter(call => call.url === "/api/index-document").map(call => JSON.parse(call.options.body));
  assert.equal(uploadCallsForFirstBatch[0].conversationId, null);
  assert.equal(uploadCallsForFirstBatch[1].conversationId, null, "the first successful retry creates its conversation on the server");

  elements.documentFile.files = [
    { name: "PADM101-slides.pptx", size: 4096, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    { name: "PADM101-notes.xlsx", size: 3072, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  ];
  elements.documentFile.listeners.get("change")[0]();
  assert.match(elements.attachmentName.textContent, /PADM101-slides\.pptx.*PADM101-notes\.xlsx/);
  assert.doesNotMatch(elements.attachmentName.textContent, /KiB|MiB/);
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(uploadCalls.length, 4, "multiple selected files are uploaded and indexed one at a time");
  const uploadBodiesAfterBatch = fetchCalls.filter(call => call.url === "/api/index-document").map(call => JSON.parse(call.options.body));
  assert.equal(uploadBodiesAfterBatch[2].conversationId, "conversation-uploads");
  assert.equal(uploadBodiesAfterBatch[3].conversationId, "conversation-uploads", "all files in one batch remain attached to the same conversation");
  assert.equal(elements.messages.children.filter(child => child.className === "message document-message").length, 3, "each uploaded file appears in the current conversation transcript");
  assert.match(elements.messages.children.at(-1).textContent, /Upload complete.*ask a question/i, "multi-file upload receives the same clear completion feedback");

  const callsBeforeChatLockedUpload = fetchCalls.filter(call => call.url === "/api/index-document").length;
  usageSnapshot = { chatAllowed: false, uploadAllowed: true, resetAt: "2026-10-02T00:00:00.000Z" };
  windowListeners.get("focus")[0]();
  await new Promise(resolve => setImmediate(resolve));
  elements.documentFile.files = [{ name: "chat-limit-does-not-block.pdf", size: 1024, type: "application/pdf" }];
  elements.documentFile.listeners.get("change")[0]();
  assert.equal(elements.sendButton.disabled, false, "document-only indexing remains available after chats are exhausted");
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(fetchCalls.filter(call => call.url === "/api/index-document").length, callsBeforeChatLockedUpload + 1);
  assert.equal(fetchCalls.filter(call => call.url === "/api/chat").length, 0, "upload-only submit does not accidentally consume or send a chat");
  usageSnapshot = { chatAllowed: true, uploadAllowed: true };
  windowListeners.get("focus")[0]();
  await new Promise(resolve => setImmediate(resolve));

  elements.prompt.value = "Find a current Maruleng public vacancy and include its closing date.";
  const sendPromise = elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(elements.sendButton.getAttribute("aria-busy"), "true", "send immediately exposes its in-progress state");
  assert.match(elements.sendLabel.textContent, /Thinking|Sending/);
  assert.equal(elements.messages.children.at(-2).textContent, "Find a current Maruleng public vacancy and include its closing date.", "the user's message appears before the network response");
  await sendPromise;
  const chatCall = fetchCalls.find(call => call.url === "/api/chat");
  assert.ok(chatCall, "academic question reaches the Worker");
  assert.match(chatCall.options.headers.Authorization, /^Bearer test-token$/);
  assert.equal(JSON.parse(chatCall.options.body).conversationId, "conversation-uploads", "questions after upload target the conversation that owns the files");
  const assistant = elements.messages.children.at(-1);
  assert.match(assistant.textContent, /vacancy page lists an advert closing on 7 October 2026/);
  assert.equal(assistant.children.length, 2, "citations and accessible answer actions are separate from the AI answer text");
  const sourceSection = assistant.children[0];
  const referencesList = sourceSection.children.find(child => child.id === "ul");
  assert.ok(referencesList);
  assert.equal(referencesList.children[0].children[0].href, "https://www.maruleng.gov.za/pages/vacancies.php");
  assert.match(referencesList.children[0].children[1].textContent, /Date shown near item 2026-10-07/);
  assert.match(referencesList.children[0].children[1].textContent, /Fetched by TMJ/);
  assert.equal(sourceSection.children.at(-1).href, "/community.html");
  assert.match(sourceSection.children.at(-1).textContent, /Browse official and community sources/);
  assert.doesNotMatch(assistant.textContent, /No sources available|Source notes:\s*None/i);
  assert.doesNotMatch(assistant.className, /developer-answer/, "ordinary academic answers do not render the developer profile");
  const answerActions = assistant.children[1];
  const copyButton = answerActions.children.find(child => child.className === "answer-action-button answer-copy");
  await copyButton.listeners.get("click")[0]();
  assert.equal(clipboardCalls[0], "The Maruleng Local Municipality vacancy page lists an advert closing on 7 October 2026.");
  assert.equal(copyButton.textContent, "Copied");
  const ratingButtons = answerActions.children.filter(child => child.className === "answer-action-button answer-feedback-button");
  ratingButtons[0].listeners.get("click")[0]();
  assert.equal(ratingButtons[0].getAttribute("aria-pressed"), "true");
  assert.equal(ratingButtons[1].getAttribute("aria-pressed"), "false");
  assert.match(answerActions.children.find(child => child.className === "answer-feedback-status").textContent, /not sent to TMJ/);

  elements.prompt.value = "Who developed TMJ AI Agent?";
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  const developerAnswer = elements.messages.children.at(-1);
  assert.equal(developerAnswer.className, "message assistant developer-answer");
  assert.equal(developerAnswer.children.length, 2, "developer cards retain copy and feedback actions without changing the on-demand profile");
  const profileCard = developerAnswer.children[0];
  assert.equal(profileCard.className, "developer-profile-card");
  const descendants = root => [root, ...root.children.flatMap(descendants)];
  const profileNodes = descendants(profileCard);
  const photo = profileNodes.find(node => node.id === "img");
  assert.equal(photo.src, "/developer-tj.webp");
  assert.match(photo.alt, /TJ Mailula/);
  const profileText = profileNodes.map(node => node.textContent).join(" ");
  assert.match(profileText, /TJ Mailula/);
  assert.match(profileText, /Tshepo Joseph Mailula/);
  assert.match(profileText, /TJ stands for Tshepo Joseph/);
  assert.match(profileText, /Tzaneen, Limpopo, South Africa/);
  assert.match(profileText, /mailulajosep@gmail\.com/);
  assert.match(profileText, /0718452020/);
  const contactLinks = profileNodes.filter(node => node.id === "a");
  assert.equal(contactLinks.length, 2);
  assert.equal(contactLinks[0].href, "mailto:mailulajosep@gmail.com");
  assert.equal(contactLinks[1].href, "tel:+27718452020");

  usageSnapshot = { chatAllowed: false, uploadAllowed: false, resetAt: "2026-10-02T00:00:00.000Z" };
  windowListeners.get("focus")[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.sendButton.disabled, true, "daily-limit refresh disables message sending");
  assert.equal(elements.sendLabel.textContent, "Limit reached");
  assert.match(elements.chatStatus.textContent, /reached today's daily limit.*come back tomorrow/i);
  assert.doesNotMatch(elements.chatStatus.textContent, /points|neurons|tokens|8\/80/i, "the quota and point balances remain hidden");
  const chatsBeforeLimitSubmit = fetchCalls.filter(call => call.url === "/api/chat").length;
  elements.prompt.value = "This must not be sent after the limit.";
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(fetchCalls.filter(call => call.url === "/api/chat").length, chatsBeforeLimitSubmit);
  elements.newChat.listeners.get("click")[0]();
  assert.match(elements.chatStatus.textContent, /reached today's daily limit/i, "New chat does not hide the locked state");

  usageSnapshot = { chatAllowed: true, uploadAllowed: true };
  windowListeners.get("focus")[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.sendButton.disabled, false, "the next daily status check restores access");
  assert.equal(elements.attachDocument.disabled, false);

  failUsageCheck = true;
  windowListeners.get("focus")[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.sendButton.disabled, true, "the UI fails closed when the quota service is unavailable");
  assert.equal(elements.sendLabel.textContent, "Access unavailable", "a service outage is not mislabeled as an exhausted limit");
  assert.match(elements.chatStatus.textContent, /Could not check today's usage/i);
  elements.imageModeToggle.listeners.get("click")[0]();
  elements.prompt.value = "A small cabin in a pine forest";
  elements.prompt.listeners.get("input")[0]();
  assert.equal(elements.sendButton.disabled, false, "image access uses its own backend ledger rather than the regular chat status check");
  await elements.chatForm.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(imageRequests, 3, "image mode reaches its independently checked endpoint during a chat-status outage");
  elements.imageModeToggle.listeners.get("click")[0]();
  failUsageCheck = false;
  windowListeners.get("focus")[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.sendButton.disabled, false, "a successful status retry restores access after an outage");

  savedMessages = [
    { role: "user", content: "Who is the developer?", created_at: "2026-10-02T00:00:01.000Z" },
    { role: "assistant", content: "Developer profile\nName: TJ Mailula\nFull name: Tshepo Joseph Mailula\nTJ stands for: Tshepo Joseph\nRole: Developer and creator of TMJ AI Agent\nLocation: Tzaneen, Limpopo, South Africa\nEmail: mailulajosep@gmail.com\nPhone: 0718452020", created_at: "2026-10-02T00:00:02.000Z" }
  ];
  savedDocuments = [{ file_name: "Biology-guide.pdf", module_code: "BIOL101", conversation_id: "conversation-1", created_at: "2026-10-02T00:00:00.500Z" }];
  await elements.conversationList.children[0].children[0].listeners.get("click")[0]();
  assert.equal(elements.messages.children.at(-1).className, "message assistant developer-answer", "saved profile answers reconstruct the card on history reload");
  assert.ok(elements.messages.children.some(child => child.className === "message document-message"), "opening a recent conversation restores its uploaded document card");
  const restoredDocument = elements.messages.children.find(child => child.className === "message document-message");
  assert.match(restoredDocument.children.map(child => child.textContent).join(" "), /Biology-guide\.pdf/);
  assert.match(restoredDocument.children.map(child => child.textContent).join(" "), /BIOL101/);

  assert.equal(elements.conversationList.children.length, 2, "signed-in history renders each recent conversation after refresh");
  const firstConversationRow = elements.conversationList.children[0];
  assert.equal(firstConversationRow.className, "conversation-row");
  assert.equal(firstConversationRow.children.length, 2, "each history row ends with a separate Delete button");
  assert.equal(firstConversationRow.children[1].className, "delete-conversation");
  assert.equal(firstConversationRow.children[1].textContent, "Delete");
  assert.equal(firstConversationRow.children[1].children[0].className, "delete-icon");
  assert.equal(firstConversationRow.children[1].getAttribute("aria-label"), "Delete conversation: Biology study");
  const deleteButton = elements.conversationList.children[0].children[1];
  const clickEvent = { preventDefault() {}, stopPropagation() {} };
  await deleteButton.listeners.get("click")[0](clickEvent);
  assert.equal(confirmationMessages.length, 0, "deletion must not show a confirmation dialog");
  assert.equal(deleteRequests.length, 1);
  assert.equal(deleteRequests[0].url, "/api/conversations/conversation-1");
  assert.equal(deleteRequests[0].options.method, "DELETE");
  assert.equal(deleteRequests[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(deleteButton.textContent, "Delete");
  assert.equal(deleteButton.children[0].className, "delete-icon", "the trash icon returns after the request completes");
  assert.equal(elements.conversationList.children.length, 1, "successful deletion refreshes the history list");
  assert.equal(elements.conversationList.children[0].children[0].textContent, "Research methods");
  assert.notEqual(elements.chatStatus.textContent, "Conversation deleted.", "successful deletion does not display a toast message");
  assert.match(elements.messages.innerHTML, /What can I help with today\?/, "deleting the open conversation clears it from the chat view");

  authStateListener("SIGNED_OUT", null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.historyPanel.hidden, true, "history hides again on sign-out");
  assert.equal(elements.attachmentControls.hidden, true, "upload control hides again on sign-out");
  assert.equal(elements.accountIdentity.hidden, true);
  assert.equal(elements.historyToggle.hidden, true);
  assert.doesNotMatch(source, /Signed in successfully\.|New conversation ready\./);
});
