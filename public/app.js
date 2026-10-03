const CONFIG = {
  supabaseUrl: "https://kiaaamxjtvenyaujpysf.supabase.co",
  supabaseAnonKey: "sb_publishable_F3MdZEjCS99N9oY9z7m9PQ_lwY0FUTr"
};

let supabaseClient = null;
let session = null;
let currentConversation = null;
let authMode = "signin";
let historyVisible = true;
let dailyUsage = null;
let usageUserId = null;
let usageCheckVersion = 0;
let usageRefreshTimer = null;
let isSubmitting = false;

const $ = (id) => document.getElementById(id);
const authDialog = $("authDialog");
const authButton = $("authButton");
const authForm = $("authForm");
const authSubmit = $("authSubmit");
const authStatus = $("authStatus");
const chatForm = $("chatForm");
const chatStatus = $("chatStatus");
const uploadStatus = $("uploadStatus");
const attachmentControls = $("attachmentControls");
const attachDocument = $("attachDocument");
const documentFile = $("documentFile");
const sendButton = $("sendButton");
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "odt", "odp", "ods", "odg", "rtf", "csv", "txt", "md",
  "html", "htm", "epub", "tex", "ltx"
]);
const DAILY_LIMIT_MESSAGE = "You've reached today's daily limit. Please come back tomorrow; access resets at 02:00 South African time.";
const UPLOAD_LIMIT_MESSAGE = "You've reached today's document upload limit. Please come back tomorrow; uploads reset at 02:00 South African time.";

function isSupportedDocument(fileName = "") {
  const extension = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(extension);
}

function setStatus(element, message, kind = "error") {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function shortenEmail(email, maxLength = 25) {
  const value = String(email || "");
  if (value.length <= maxLength) return value;
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return value.slice(0, maxLength - 1) + "…";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const localLength = maxLength - domain.length - 2;
  if (localLength >= 3) return local.slice(0, localLength) + "…@" + domain;
  return value.slice(0, maxLength - 1) + "…";
}

function showAuthDialog(message = "") {
  setStatus(authStatus, message, message ? "info" : "error");
  if (authDialog && !authDialog.open) {
    if (typeof authDialog.showModal === "function") authDialog.showModal();
    else authDialog.setAttribute("open", "");
  }
  $("authEmail")?.focus();
}

const sidebarToggle = $("sidebarToggle");
const sidebarOverlay = $("sidebarOverlay");
const sidebarCollapse = $("sidebarCollapse");

function isMobileSidebar() {
  return Boolean(window.matchMedia?.("(max-width: 800px)").matches);
}

function setSidebarOpen(open) {
  document.body?.classList?.toggle("sidebar-open", open);
  sidebarToggle?.setAttribute("aria-expanded", String(open));
  sidebarToggle?.setAttribute("aria-label", open ? "Close sidebar" : "Open sidebar");
  if (isMobileSidebar()) sidebarCollapse?.setAttribute("aria-expanded", String(open));
  if (sidebarOverlay) sidebarOverlay.hidden = !open;
}

if (isMobileSidebar()) sidebarCollapse?.setAttribute("aria-expanded", "false");

sidebarToggle?.addEventListener("click", () => setSidebarOpen(sidebarToggle.getAttribute("aria-expanded") !== "true"));
sidebarOverlay?.addEventListener("click", () => setSidebarOpen(false));
sidebarCollapse?.addEventListener("click", () => {
  if (isMobileSidebar()) {
    setSidebarOpen(false);
    return;
  }
  const collapsed = !document.body.classList.contains("sidebar-collapsed");
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const label = collapsed ? "Show left panel" : "Hide left panel";
  sidebarCollapse.textContent = label;
  sidebarCollapse.title = label;
  sidebarCollapse.setAttribute("aria-label", label);
  sidebarCollapse.setAttribute("aria-expanded", String(!collapsed));
});
$("historyToggle")?.addEventListener("click", () => {
  historyVisible = !historyVisible;
  $("historyPanel").hidden = !session || !historyVisible;
  const control = $("historyToggle");
  control.textContent = historyVisible ? "Hide history" : "Show history";
  control.setAttribute("aria-expanded", String(Boolean(session && historyVisible)));
});

function updateAuthUI() {
  authButton.textContent = session ? "Sign out" : "Sign in";
  authButton.setAttribute("aria-label", session ? "Sign out of your account" : "Sign in to your account");
  if (session) {
    setStatus(authStatus, "", "info");
    if (authDialog?.open) authDialog.close();
  }
  const accountIdentity = $("accountIdentity");
  const accountEmail = session?.user?.email || "";
  if (accountIdentity) {
    accountIdentity.hidden = !accountEmail;
    accountIdentity.textContent = shortenEmail(accountEmail);
    accountIdentity.title = accountEmail;
    accountIdentity.setAttribute("aria-label", accountEmail ? `Signed in as ${accountEmail}` : "");
  }
  // Start a local draft before sign-in, but keep private history and uploads gated.
  $("newChat").disabled = false;
  $("historyPanel").hidden = !session || !historyVisible;
  const historyToggle = $("historyToggle");
  if (historyToggle) {
    historyToggle.hidden = !session;
    historyToggle.textContent = historyVisible ? "Hide history" : "Show history";
    historyToggle.setAttribute("aria-expanded", String(Boolean(session && historyVisible)));
  }
  if (attachmentControls) attachmentControls.hidden = !session;
  if (!session) $("conversationList").replaceChildren();
  const nextUsageUserId = session?.user?.id || null;
  if (nextUsageUserId !== usageUserId) {
    usageUserId = nextUsageUserId;
    usageCheckVersion += 1;
    clearUsageRefreshTimer();
    dailyUsage = null;
    if (session) void refreshDailyUsage();
  }
  updateComposerLabel();
  if (session && !dailyUsage) void refreshDailyUsage();
}

function renderWelcome() {
  $("messages").innerHTML = '<div class="welcome"><img class="welcome-mark" src="/tmj-mark.svg" alt=""><p class="eyebrow">YOUR NWU STUDY PARTNER</p><h2>What are you studying today?</h2><p>Ask a module question for a clear, structured explanation.</p><div class="starter-prompts" role="group" aria-label="Try a starter prompt"><button class="starter-prompt" type="button" data-starter-prompt="Explain a difficult concept from my module in plain language and give one example.">Explain a concept</button><button class="starter-prompt" type="button" data-starter-prompt="Find the current NWU rule about academic integrity and summarize it with an official source.">Find an NWU rule</button><button class="starter-prompt" type="button" data-starter-prompt="Help me make a one-week study plan for my next test. Ask what subjects and dates you need.">Build a study plan</button><button class="starter-prompt" type="button" data-starter-prompt="Quiz me one question at a time on a topic I am studying. Start by asking me the topic.">Quiz me</button></div></div>';
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function appendAssistantSources(answer, sources = [], nwuSearchUrl = "") {
  const validSources = Array.isArray(sources) ? sources.filter(source => source && source.name) : [];
  const safeSearchUrl = safeHttpsUrl(nwuSearchUrl);
  if (!validSources.length && !safeSearchUrl) return;

  const section = document.createElement("section");
  section.className = "message-sources";
  section.setAttribute("aria-label", "Answer references");

  if (validSources.length) {
    const heading = document.createElement("p");
    heading.className = "sources-heading";
    heading.textContent = "References";
    section.appendChild(heading);
    const list = document.createElement("ul");
    for (const source of validSources) {
      const item = document.createElement("li");
      const href = safeHttpsUrl(source.url);
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = String(source.name).slice(0, 180);
        item.appendChild(link);
      } else {
        item.textContent = String(source.name).slice(0, 180);
      }
      const details = [];
      if (source.module) details.push(`Module ${String(source.module).slice(0, 40)}`);
      if (source.date) details.push(`Listed by NWU ${String(source.date).slice(0, 40)}`);
      if (details.length) {
        const meta = document.createElement("span");
        meta.className = "source-meta";
        meta.textContent = details.join(" · ");
        item.appendChild(meta);
      }
      list.appendChild(item);
    }
    section.appendChild(list);
  }

  if (safeSearchUrl) {
    const more = document.createElement("a");
    more.className = "nwu-search-link";
    more.href = safeSearchUrl;
    more.target = "_blank";
    more.rel = "noopener noreferrer";
    more.textContent = "Search NWU’s public website for more";
    section.appendChild(more);
  }
  answer.appendChild(section);
}

function normalizeDeveloperProfile(value) {
  if (!value || typeof value !== "object") return null;
  const purpose = String(value.purpose || "I’m TJ Mailula, a developer and progressive programmer with a strong interest in practical automation. I created TMJ AI Agent to make helpful AI support accessible for everyday questions and to support NWU students in understanding concepts and working with their own study materials. I hope to use AI and automation to make useful information and guidance easier to access.").trim();
  const name = String(value.name || "").trim();
  const fullName = String(value.fullName || "").trim();
  const initialsMeaning = String(value.initialsMeaning || "").trim();
  const role = String(value.role || "").trim();
  const location = String(value.location || "").trim();
  const email = String(value.email || "").trim();
  const phone = String(value.phone || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");
  if (!name || !fullName || !initialsMeaning || !role || !location ||
      name.length > 100 || fullName.length > 140 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^0\d{9}$/.test(phoneDigits)) return null;
  return {
    name,
    fullName,
    initialsMeaning,
    purpose,
    role,
    location,
    email,
    phone,
    phoneHref: `tel:+27${phoneDigits.slice(1)}`,
    photoUrl: value.photoUrl === "/developer-tj.webp" ? value.photoUrl : "/developer-tj.webp",
    photoAlt: String(value.photoAlt || `Photo of ${name}, developer of TMJ AI Agent`).slice(0, 180)
  };
}

function parseDeveloperProfileReply(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  if (lines[0]?.trim().toLowerCase() !== "developer profile") return null;
  const fields = new Map();
  for (const line of lines.slice(1)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return normalizeDeveloperProfile({
    name: fields.get("name"),
    fullName: fields.get("full name"),
    initialsMeaning: fields.get("tj stands for"),
    purpose: fields.get("purpose for creating tmj ai agent"),
    role: fields.get("role"),
    location: fields.get("location"),
    email: fields.get("email"),
    phone: fields.get("phone"),
    photoUrl: "/developer-tj.webp"
  });
}

function appendProfileText(parent, tagName, className, text) {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = String(text || "");
  parent.appendChild(node);
  return node;
}

function appendDeveloperProfileCard(answer, candidate) {
  const profile = normalizeDeveloperProfile(candidate);
  if (!profile) return false;

  const card = document.createElement("article");
  card.className = "developer-profile-card";
  card.setAttribute("aria-label", "Developer profile");

  const photo = document.createElement("img");
  photo.className = "developer-profile-photo";
  photo.src = profile.photoUrl;
  photo.alt = profile.photoAlt;
  photo.loading = "lazy";
  card.appendChild(photo);

  const body = document.createElement("div");
  body.className = "developer-profile-body";
  appendProfileText(body, "p", "developer-profile-kicker", "Developer identity");
  appendProfileText(body, "h3", "developer-profile-name", profile.name);
  appendProfileText(body, "p", "developer-profile-role", profile.role);
  appendProfileText(body, "p", "developer-profile-purpose-title", "Why I created TMJ AI Agent");
  appendProfileText(body, "p", "developer-profile-purpose", profile.purpose);
  appendProfileText(body, "p", "developer-profile-full-name", `Full name: ${profile.fullName}`);
  appendProfileText(body, "p", "developer-profile-initials", profile.initialsMeaning);
  appendProfileText(body, "p", "developer-profile-location", `Location: ${profile.location}`);

  const contacts = document.createElement("div");
  contacts.className = "developer-profile-contacts";
  contacts.setAttribute("role", "group");
  contacts.setAttribute("aria-label", "Contact the developer");
  const emailLink = document.createElement("a");
  emailLink.className = "developer-contact-link";
  emailLink.href = `mailto:${profile.email}`;
  emailLink.textContent = profile.email;
  emailLink.setAttribute("aria-label", `Email ${profile.name}`);
  contacts.appendChild(emailLink);
  const phoneLink = document.createElement("a");
  phoneLink.className = "developer-contact-link";
  phoneLink.href = profile.phoneHref;
  phoneLink.textContent = profile.phone;
  phoneLink.setAttribute("aria-label", `Call ${profile.phone}`);
  contacts.appendChild(phoneLink);
  body.appendChild(contacts);
  card.appendChild(body);
  answer.appendChild(card);
  return true;
}

function appendAnswerActions(answer, text) {
  const actions = document.createElement("div");
  actions.className = "answer-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Answer actions");

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "answer-action-button answer-copy";
  copy.textContent = "Copy";
  copy.setAttribute("aria-label", "Copy answer");
  copy.addEventListener("click", async () => {
    copy.disabled = true;
    try {
      const clipboard = window.navigator?.clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(String(text || ""));
      } else {
        const field = document.createElement("textarea");
        field.value = String(text || "");
        field.setAttribute("readonly", "");
        field.setAttribute("aria-hidden", "true");
        if (field.style) field.style.position = "fixed";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand?.("copy");
        if (field.remove) field.remove();
        else if (field.parentNode) field.parentNode.removeChild(field);
        if (!copied) throw new Error("Clipboard is unavailable.");
      }
      copy.textContent = "Copied";
      copy.setAttribute("aria-label", "Answer copied to clipboard");
    } catch {
      copy.textContent = "Copy unavailable";
      setStatus(chatStatus, "Could not copy automatically. Select the answer text and copy it manually.", "info");
    } finally {
      copy.disabled = false;
    }
  });
  actions.appendChild(copy);

  const question = document.createElement("span");
  question.className = "answer-feedback-question";
  question.textContent = "Helpful?";
  actions.appendChild(question);

  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "answer-action-button answer-feedback-button";
  yes.textContent = "Yes";
  yes.setAttribute("aria-label", "Mark this answer helpful");
  yes.setAttribute("aria-pressed", "false");

  const no = document.createElement("button");
  no.type = "button";
  no.className = "answer-action-button answer-feedback-button";
  no.textContent = "Not quite";
  no.setAttribute("aria-label", "Mark this answer as needing improvement");
  no.setAttribute("aria-pressed", "false");

  const feedbackStatus = document.createElement("span");
  feedbackStatus.className = "answer-feedback-status";
  feedbackStatus.setAttribute("role", "status");
  feedbackStatus.setAttribute("aria-live", "polite");
  feedbackStatus.hidden = true;
  const setRating = (selected, other, rating) => {
    selected.setAttribute("aria-pressed", "true");
    other.setAttribute("aria-pressed", "false");
    feedbackStatus.hidden = false;
    feedbackStatus.textContent = `Thanks for rating this answer ${rating}. This rating stays on this page and is not sent to TMJ.`;
  };
  yes.addEventListener("click", () => setRating(yes, no, "helpful"));
  no.addEventListener("click", () => setRating(no, yes, "not quite helpful"));
  actions.appendChild(yes);
  actions.appendChild(no);
  actions.appendChild(feedbackStatus);
  answer.appendChild(actions);
}

function addMessage(role, text, sources = [], nwuSearchUrl = "", developerProfile = null) {
  const profile = role === "assistant"
    ? (normalizeDeveloperProfile(developerProfile) || parseDeveloperProfileReply(text))
    : null;
  const element = document.createElement("div");
  element.className = `message ${role}${profile ? " developer-answer" : ""}`;
  if (profile) appendDeveloperProfileCard(element, profile);
  else element.textContent = text;
  element.setAttribute("role", role === "assistant" ? "status" : "note");
  if (role === "assistant" && !profile) appendAssistantSources(element, sources, nwuSearchUrl);
  if (role === "assistant" && String(text).trim() !== "Searching academic material…") appendAnswerActions(element, text);
  $("messages").appendChild(element);
  $("messages").scrollTop = $("messages").scrollHeight;
  return element;
}

function addDocumentMessage(uploadedDocument) {
  const element = document.createElement("article");
  element.className = "message document-message";
  element.setAttribute("role", "note");

  const label = document.createElement("span");
  label.className = "document-message-label";
  label.textContent = "Document in this chat";
  element.appendChild(label);

  const name = document.createElement("strong");
  name.className = "document-message-name";
  name.textContent = String(uploadedDocument?.fileName || uploadedDocument?.file_name || "Uploaded study material");
  element.appendChild(name);

  const moduleCode = String(uploadedDocument?.moduleCode || uploadedDocument?.module_code || "").trim();
  if (moduleCode) {
    const module = document.createElement("span");
    module.className = "document-message-module";
    module.textContent = `Module ${moduleCode}`;
    element.appendChild(module);
  }

  $("messages").appendChild(element);
  $("messages").scrollTop = $("messages").scrollHeight;
  return element;
}

function clearAttachment() {
  if (documentFile) documentFile.value = "";
  $("moduleCode").value = "";
  $("attachmentName").textContent = "";
  $("attachmentPreview").hidden = true;
  $("moduleCodeControl").hidden = true;
  updateComposerLabel();
}

function retainAttachmentFiles(files) {
  if (!files.length) {
    clearAttachment();
    return;
  }
  if (documentFile) {
    try {
      if (typeof DataTransfer === "function") {
        const transfer = new DataTransfer();
        files.forEach(file => transfer.items.add(file));
        documentFile.files = transfer.files;
      } else {
        documentFile.files = files;
      }
    } catch {
      documentFile.files = files;
    }
  }
  $("attachmentName").textContent = files.map(file => file.name).join(", ");
  $("attachmentPreview").hidden = false;
  $("moduleCodeControl").hidden = false;
  updateComposerLabel();
}

function resizePrompt() {
  const textarea = $("prompt");
  if (!textarea?.style) return;
  const maxHeight = 180;
  textarea.style.height = "auto";
  const contentHeight = Math.max(0, Number(textarea.scrollHeight) || 0);
  textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
  textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

function updateComposerLabel() {
  const hasFile = Boolean(documentFile?.files?.length);
  const hasQuestion = Boolean($("prompt")?.value.trim());
  const label = $("sendLabel");
  const chatBlocked = Boolean(session && (!dailyUsage || !dailyUsage.chatAllowed));
  const uploadBlocked = Boolean(session && (!dailyUsage || !dailyUsage.uploadAllowed));
  const usagePending = Boolean(session && !dailyUsage);
  const usageUnavailable = Boolean(session && dailyUsage?.unavailable);
  const blockedLabel = usageUnavailable ? "Access unavailable" : (usagePending ? "Checking access…" : "Limit reached");
  const blockedAriaLabel = usageUnavailable ? "Daily usage check unavailable" : (usagePending ? "Checking daily access" : "Daily message limit reached");
  if (sendButton) {
    sendButton.disabled = isSubmitting || (hasFile ? uploadBlocked || (hasQuestion && chatBlocked) : chatBlocked);
    sendButton.setAttribute("aria-busy", String(isSubmitting));
  }
  if (attachDocument) attachDocument.disabled = uploadBlocked;
  if (documentFile) documentFile.disabled = uploadBlocked;
  if (label && !isSubmitting) {
    label.textContent = hasFile && uploadBlocked ? "Upload limit reached" : (chatBlocked && (!hasFile || hasQuestion) ? blockedLabel : (hasFile ? (hasQuestion ? "Upload & send" : "Upload") : "Send message"));
  }
  if (sendButton) sendButton.setAttribute("aria-label", hasFile && uploadBlocked ? "Daily upload allowance reached" : (chatBlocked && (!hasFile || hasQuestion) ? blockedAriaLabel : (hasFile ? (hasQuestion ? "Upload and send message" : "Upload selected study material") : "Send message")));
}

$("attachDocument").addEventListener("click", () => {
  if (!session) {
    showAuthDialog("Sign in to attach and index your module material.");
    return;
  }
  documentFile.click();
});

documentFile.addEventListener("change", () => {
  const files = Array.from(documentFile.files || []);
  if (!files.length) {
    clearAttachment();
    return;
  }
  const tooLarge = files.find(file => file.size > MAX_UPLOAD_BYTES);
  if (tooLarge) {
    clearAttachment();
    setStatus(uploadStatus, "This file is too large to add.");
    return;
  }
  const unsupported = files.find(file => !isSupportedDocument(file.name));
  if (unsupported) {
    clearAttachment();
    setStatus(uploadStatus, "This file type can't be added.");
    return;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    clearAttachment();
    setStatus(uploadStatus, "This selection is too large to add at once. Try fewer or smaller files.");
    return;
  }
  $("attachmentName").textContent = files.map(file => file.name).join(", ");
  $("attachmentPreview").hidden = false;
  $("moduleCodeControl").hidden = false;
  setStatus(uploadStatus, "", "info");
  updateComposerLabel();
});

$("removeAttachment").addEventListener("click", () => {
  clearAttachment();
  setStatus(uploadStatus, "Attached document removed.", "info");
});

$("prompt").addEventListener("input", () => {
  resizePrompt();
  updateComposerLabel();
});

$("messages").addEventListener("click", event => {
  const starter = event.target?.closest?.(".starter-prompt");
  const value = starter?.getAttribute("data-starter-prompt");
  if (!value) return;
  $("prompt").value = value;
  resizePrompt();
  updateComposerLabel();
  $("prompt").focus();
});

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: `The server returned an unreadable response (${response.status}).` };
  }
}

function clearUsageRefreshTimer() {
  if (usageRefreshTimer !== null) window.clearTimeout?.(usageRefreshTimer);
  usageRefreshTimer = null;
}

function scheduleUsageRefresh(resetAt) {
  clearUsageRefreshTimer();
  const resetTime = Date.parse(String(resetAt || ""));
  if (!Number.isFinite(resetTime) || typeof window.setTimeout !== "function") return;
  const delay = Math.max(0, Math.min(resetTime - Date.now() + 500, 2_147_483_647));
  usageRefreshTimer = window.setTimeout(() => {
    usageRefreshTimer = null;
    void refreshDailyUsage();
  }, delay);
}

function applyDailyUsageStatus(payload) {
  dailyUsage = {
    chatAllowed: payload.chatAllowed === true,
    uploadAllowed: payload.uploadAllowed === true,
    resetAt: typeof payload.resetAt === "string" ? payload.resetAt : null
  };
  if (!dailyUsage.chatAllowed) {
    setStatus(chatStatus, DAILY_LIMIT_MESSAGE, "limit");
  } else if (chatStatus?.dataset?.kind === "limit" || chatStatus?.dataset?.kind === "usage") {
    setStatus(chatStatus, "", "success");
  }
  if (!dailyUsage.uploadAllowed) {
    setStatus(uploadStatus, UPLOAD_LIMIT_MESSAGE, "limit");
  } else if (uploadStatus?.dataset?.kind === "limit") {
    setStatus(uploadStatus, "", "success");
  }
  scheduleUsageRefresh(dailyUsage.resetAt);
  updateComposerLabel();
}

async function refreshDailyUsage() {
  if (!session) {
    dailyUsage = null;
    updateComposerLabel();
    return false;
  }
  const version = ++usageCheckVersion;
  if (!dailyUsage) setStatus(chatStatus, "Checking today's daily access…", "info");
  try {
    const response = await fetch("/api/usage", {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const payload = await readJson(response);
    if (!response.ok || typeof payload.chatAllowed !== "boolean" || typeof payload.uploadAllowed !== "boolean") {
      throw new Error(payload.error || "Could not check today's usage.");
    }
    if (version !== usageCheckVersion || !session) return false;
    applyDailyUsageStatus(payload);
    return true;
  } catch {
    if (version === usageCheckVersion && session) {
      dailyUsage = { chatAllowed: false, uploadAllowed: false, resetAt: null, unavailable: true };
      setStatus(chatStatus, "Could not check today's usage. Please try again shortly.", "usage");
      updateComposerLabel();
    }
    return false;
  }
}

window.addEventListener?.("focus", () => {
  if (session) void refreshDailyUsage();
});
document.addEventListener?.("visibilitychange", () => {
  if (session && document.visibilityState === "visible") void refreshDailyUsage();
});

async function ready() {
  updateAuthUI();
  const validUrl = typeof CONFIG.supabaseUrl === "string" && CONFIG.supabaseUrl.startsWith("https://");
  const validKey = typeof CONFIG.supabaseAnonKey === "string" && CONFIG.supabaseAnonKey.length > 10 && !CONFIG.supabaseAnonKey.startsWith("YOUR_");

  if (!validUrl || !validKey) {
    const message = "Account services are not configured yet. Please contact the site administrator.";
    setStatus($("appStatus"), message);
    setStatus(authStatus, message);
    return;
  }
  if (!window.supabase?.createClient) {
    const message = "The sign-in service could not load. Check your connection and try again.";
    setStatus($("appStatus"), message);
    setStatus(authStatus, message);
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      updateAuthUI();
      if (session) loadConversations();
    });
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    session = data.session;
    updateAuthUI();
    if (session) await loadConversations();
    setStatus($("appStatus"), "", "success");
  } catch (error) {
    session = null;
    updateAuthUI();
    const message = error?.message || "Could not connect to account services. Please try again shortly.";
    setStatus($("appStatus"), message);
    setStatus(authStatus, message);
  }
}

authButton.addEventListener("click", async () => {
  setSidebarOpen(false);
  if (!session) {
    showAuthDialog();
    return;
  }
  authButton.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    session = null;
    currentConversation = null;
    updateAuthUI();
    renderWelcome();
    setStatus($("appStatus"), "You are signed out.", "success");
  } catch {
    setStatus($("appStatus"), "Sign-out failed. Please try again.");
  } finally {
    authButton.disabled = false;
  }
});

$("authClose").addEventListener("click", () => authDialog.close());

$("authToggle").addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  $("authTitle").textContent = authMode === "signin" ? "Sign in" : "Create account";
  authSubmit.textContent = authMode === "signin" ? "Sign in" : "Create account";
  $("authToggle").textContent = authMode === "signin" ? "Create an account" : "Already have an account? Sign in";
  $("authPassword").autocomplete = authMode === "signin" ? "current-password" : "new-password";
  setStatus(authStatus, "", "info");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const emailInput = $("authEmail");
  emailInput.value = emailInput.value.trim();
  if (typeof authForm.reportValidity === "function" && !authForm.reportValidity()) {
    setStatus(authStatus, "Enter a valid email address and password.");
    return;
  }
  if (!supabaseClient) {
    setStatus(authStatus, "Account services are not configured yet. Please contact the site administrator.");
    return;
  }

  const email = emailInput.value;
  const password = $("authPassword").value;
  authSubmit.disabled = true;
  authSubmit.textContent = authMode === "signin" ? "Signing in…" : "Creating account…";
  setStatus(authStatus, "", "info");

  try {
    const result = authMode === "signin"
      ? await supabaseClient.auth.signInWithPassword({ email, password })
      : await supabaseClient.auth.signUp({ email, password });

    if (result.error) {
      setStatus(authStatus, result.error.message);
    } else if (result.data.session) {
      authDialog.close();
      setStatus($("appStatus"), "", "success");
    } else {
      setStatus(authStatus, "Account created, but no session was returned. Check whether email confirmation is still enabled in Supabase.");
    }
  } catch {
    setStatus(authStatus, "Could not reach the sign-in service. Please try again.");
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === "signin" ? "Sign in" : "Create account";
  }
});

$("newChat").addEventListener("click", () => {
  setSidebarOpen(false);
  currentConversation = null;
  chatForm.reset();
  resizePrompt();
  clearAttachment();
  renderWelcome();
  if (session && dailyUsage && !dailyUsage.chatAllowed) setStatus(chatStatus, DAILY_LIMIT_MESSAGE, "limit");
  else setStatus(chatStatus, "", "success");
  if (session && dailyUsage && !dailyUsage.uploadAllowed) setStatus(uploadStatus, UPLOAD_LIMIT_MESSAGE, "limit");
  else setStatus(uploadStatus, "", "info");
  $("prompt").focus();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session) {
    showAuthDialog("Sign in to ask a question, save conversations, or upload documents.");
    return;
  }

  const prompt = $("prompt").value.trim();
  const files = Array.from(documentFile.files || []);
  if (!prompt && !files.length) {
    setStatus(chatStatus, "Enter a question or attach a document first.");
    $("prompt").focus();
    return;
  }
  if (!dailyUsage) await refreshDailyUsage();
  if (dailyUsage?.unavailable) {
    setStatus(chatStatus, "Could not check today's usage. Please try again shortly.", "usage");
    return;
  }
  if (prompt && !dailyUsage?.chatAllowed) {
    setStatus(chatStatus, DAILY_LIMIT_MESSAGE, "limit");
    return;
  }
  if (files.length && !dailyUsage.uploadAllowed) {
    setStatus(uploadStatus, UPLOAD_LIMIT_MESSAGE, "limit");
    return;
  }
  const tooLarge = files.find(file => file.size > MAX_UPLOAD_BYTES);
  if (tooLarge) {
    setStatus(uploadStatus, "This file is too large to add.");
    return;
  }
  const unsupported = files.find(file => !isSupportedDocument(file.name));
  if (unsupported) {
    setStatus(uploadStatus, "This file type can't be added.");
    return;
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES) {
    setStatus(uploadStatus, "This selection is too large to add at once. Try fewer or smaller files.");
    return;
  }

  isSubmitting = true;
  updateComposerLabel();
  if (!files.length) {
    $("sendLabel").textContent = "Sending…";
    setStatus(chatStatus, "Sending your question…", "info");
  }
  try {
    if (files.length) {
      let indexedCount = 0;
      const uploadErrors = [];
      const failedFiles = [];
      let uploadLimitReached = false;
      let aiNeuronLimitReached = false;
      for (const [index, file] of files.entries()) {
        let stagedUploadPath = null;
        $("sendLabel").textContent = `Uploading ${index + 1}/${files.length}…`;
        setStatus(uploadStatus, `Uploading and indexing ${file.name} (${index + 1} of ${files.length})…`, "info");
        try {
          const path = `${session.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const upload = await supabaseClient.storage.from("tmj-documents").upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false
          });
          if (upload.error) throw upload.error;
          stagedUploadPath = path;

          const indexResponse = await fetch("/api/index-document", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ storagePath: path, fileName: file.name, fileSize: file.size, moduleCode: $("moduleCode").value.trim().toUpperCase(), conversationId: currentConversation?.id || null })
          });
          const indexData = await readJson(indexResponse);
          if (!indexResponse.ok) {
            if (indexData.code === "DAILY_AI_NEURON_LIMIT_REACHED") {
              applyDailyUsageStatus({ chatAllowed: false, uploadAllowed: false, resetAt: indexData.resetAt });
              setStatus(chatStatus, DAILY_LIMIT_MESSAGE, "limit");
              setStatus(uploadStatus, DAILY_LIMIT_MESSAGE, "limit");
              aiNeuronLimitReached = true;
              failedFiles.push(...files.slice(index));
              uploadLimitReached = true;
              break;
            }
            if (indexData.code === "DAILY_LIMIT_REACHED") {
              applyDailyUsageStatus({ chatAllowed: false, uploadAllowed: dailyUsage?.uploadAllowed === true, resetAt: indexData.resetAt });
              setStatus(chatStatus, DAILY_LIMIT_MESSAGE, "limit");
              failedFiles.push(...files.slice(index));
              uploadLimitReached = true;
              break;
            }
            if (indexData.code === "DAILY_UPLOAD_LIMIT_REACHED") {
              applyDailyUsageStatus({ chatAllowed: dailyUsage?.chatAllowed === true, uploadAllowed: false, resetAt: indexData.resetAt });
              setStatus(uploadStatus, UPLOAD_LIMIT_MESSAGE, "limit");
              failedFiles.push(...files.slice(index));
              uploadLimitReached = true;
              break;
            }
            uploadErrors.push(`${file.name}: ${indexData.error || `Indexing failed (${indexResponse.status}).`}`);
            failedFiles.push(file);
            continue;
          }
          stagedUploadPath = null;
          if (indexData.conversationId) currentConversation = { id: indexData.conversationId };
          addDocumentMessage(indexData.document || { fileName: file.name, moduleCode: $("moduleCode").value.trim().toUpperCase() });
          indexedCount += 1;
        } catch (error) {
          uploadErrors.push(`${file.name}: ${error?.message || "Upload failed."}`);
          failedFiles.push(file);
        } finally {
          if (stagedUploadPath) {
            try { await supabaseClient.storage.from("tmj-documents").remove([stagedUploadPath]); } catch {}
          }
        }
      }
      retainAttachmentFiles(failedFiles);
      if (indexedCount) {
        await Promise.all([refreshDailyUsage(), loadConversations()]);
      }
      if (aiNeuronLimitReached) {
        setStatus(uploadStatus, DAILY_LIMIT_MESSAGE, "limit");
      } else if (uploadLimitReached && !dailyUsage?.uploadAllowed) {
        setStatus(uploadStatus, `${indexedCount} of ${files.length} selected ${files.length === 1 ? "document was" : "documents were"} indexed. ${UPLOAD_LIMIT_MESSAGE}`, "limit");
      } else if (uploadErrors.length) {
        const prefix = indexedCount ? `${indexedCount} of ${files.length} selected documents were indexed. ` : "";
        setStatus(uploadStatus, `${prefix}${uploadErrors[0]}${uploadErrors.length > 1 ? ` (${uploadErrors.length - 1} more issue(s)).` : ""}`, "error");
      } else if (indexedCount) {
        setStatus(uploadStatus, "", "success");
      }
      if (indexedCount && (!prompt || !dailyUsage?.chatAllowed)) {
        addMessage("assistant", "Upload complete. Ask a question about your study material to get a response.");
      }
      if (!prompt || !dailyUsage?.chatAllowed) return;
    }

    $("sendLabel").textContent = "Thinking…";
    setStatus(chatStatus, "Looking in this chat’s uploads and other relevant sources…", "info");
    const userMessage = addMessage("user", prompt);
    const answer = addMessage("assistant", "Searching academic material…");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ message: prompt, conversationId: currentConversation?.id || null })
      });
      const data = await readJson(response);
      if (!response.ok) {
        answer.textContent = data.error || `The request failed (${response.status}).`;
        if (data.code === "DAILY_AI_NEURON_LIMIT_REACHED") {
          applyDailyUsageStatus({ chatAllowed: false, uploadAllowed: false, resetAt: data.resetAt });
          setStatus(chatStatus, DAILY_LIMIT_MESSAGE, "limit");
          setStatus(uploadStatus, DAILY_LIMIT_MESSAGE, "limit");
        } else if (data.code === "DAILY_LIMIT_REACHED") {
          applyDailyUsageStatus({ chatAllowed: false, uploadAllowed: dailyUsage?.uploadAllowed === true, resetAt: data.resetAt });
          setStatus(chatStatus, DAILY_LIMIT_MESSAGE, "limit");
        } else if (data.code === "DAILY_USAGE_UNAVAILABLE") {
          await refreshDailyUsage();
        } else {
          setStatus(chatStatus, "The answer could not be generated. Your question is still in the text box so you can retry.");
        }
        userMessage.setAttribute("data-request-failed", "true");
        return;
      }

      const developerProfile = normalizeDeveloperProfile(data.developerProfile) || parseDeveloperProfileReply(data.reply);
      answer.replaceChildren();
      if (developerProfile) {
        answer.className = "message assistant developer-answer";
        appendDeveloperProfileCard(answer, developerProfile);
      } else {
        answer.className = "message assistant";
        answer.textContent = data.reply || "No response was returned.";
        appendAssistantSources(answer, data.sources, data.nwuSearchUrl);
      }
      appendAnswerActions(answer, data.reply || "No response was returned.");
      if (data.conversationId) currentConversation = { id: data.conversationId };
      if ($("prompt").value.trim() === prompt) {
        $("prompt").value = "";
        resizePrompt();
      }
      updateComposerLabel();
      setStatus(chatStatus, "", "success");
      await loadConversations();
      await refreshDailyUsage();
    } catch {
      answer.textContent = "The agent could not connect. Check your connection and try again.";
      setStatus(chatStatus, "Your question is still in the text box so you can retry.");
      userMessage.setAttribute("data-request-failed", "true");
    }
  } catch (error) {
    setStatus(uploadStatus, error?.message || "Upload failed. Please try again.");
  } finally {
    isSubmitting = false;
    updateComposerLabel();
  }
});

function setDeleteButtonState(button, label) {
  button.replaceChildren();
  button.textContent = label;
  if (label === "Delete") {
    const deleteIcon = document.createElement("span");
    deleteIcon.className = "delete-icon";
    deleteIcon.setAttribute("aria-hidden", "true");
    button.appendChild(deleteIcon);
  }
}

async function deleteConversation(id, button) {
  if (!session || !id) return;
  button.disabled = true;
  setDeleteButtonState(button, "Deleting…");
  try {
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || `Could not delete this conversation (${response.status}).`);

    if (currentConversation?.id === id) {
      currentConversation = null;
      $("messages").replaceChildren();
      renderWelcome();
    }
    await loadConversations();
  } catch (error) {
    setStatus(chatStatus, error?.message || "Could not delete this conversation. Please try again.");
  } finally {
    button.disabled = false;
    setDeleteButtonState(button, "Delete");
  }
}

async function loadConversations() {
  if (!supabaseClient || !session) return;
  try {
    const { data, error } = await supabaseClient
      .from("conversations")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw error;

    const list = $("conversationList");
    list.replaceChildren();
    if (!data?.length) {
      list.innerHTML = '<p class="muted">No saved conversations yet.</p>';
      return;
    }
    for (const conversation of data) {
      const row = document.createElement("div");
      row.className = "conversation-row";
      row.setAttribute("role", "listitem");

      const title = conversation.title || "New conversation";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "conversation";
      openButton.textContent = title;
      openButton.setAttribute("aria-label", `Open conversation: ${title}`);
      openButton.addEventListener("click", () => {
        setSidebarOpen(false);
        return loadConversation(conversation.id);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-conversation";
      setDeleteButtonState(deleteButton, "Delete");
      deleteButton.setAttribute("aria-label", `Delete conversation: ${title}`);
      deleteButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        return deleteConversation(conversation.id, deleteButton);
      });

      row.appendChild(openButton);
      row.appendChild(deleteButton);
      list.appendChild(row);
    }
  } catch {
    $("conversationList").innerHTML = '<p class="status">Could not load conversations. Please refresh or sign in again.</p>';
  }
}

async function loadConversation(id) {
  if (!supabaseClient || !session) return;
  try {
    const [messageResult, documentResult] = await Promise.all([
      supabaseClient.from("messages")
        .select("role,content,created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true }),
      supabaseClient.from("documents")
        .select("file_name,module_code,created_at")
        .eq("conversation_id", id)
        .eq("source_type", "student_upload")
        .order("created_at", { ascending: true })
    ]);
    if (messageResult.error) throw messageResult.error;
    if (documentResult.error) throw documentResult.error;
    currentConversation = { id };
    $("messages").replaceChildren();
    const timeline = [
      ...(messageResult.data || []).map(item => ({ ...item, kind: "message" })),
      ...(documentResult.data || []).map(item => ({ ...item, kind: "document" }))
    ].sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0));
    for (const item of timeline) {
      if (item.kind === "document") addDocumentMessage(item);
      else addMessage(item.role, item.content);
    }
    setStatus(chatStatus, "Conversation loaded.", "success");
  } catch {
    setStatus(chatStatus, "Could not load that conversation. Please try again.");
  }
}

ready();
