const CONFIG = {
  supabaseUrl: "https://kiaaamxjtvenyaujpysf.supabase.co",
  supabaseAnonKey: "sb_publishable_F3MdZEjCS99N9oY9z7m9PQ_lwY0FUTr"
};

let supabaseClient = null;
let session = null;
let currentConversation = null;
let authMode = "signin";
let historyVisible = true;

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
const documentFile = $("documentFile");
const sendButton = $("sendButton");

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
const aboutToggle = $("aboutToggle");

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
aboutToggle?.addEventListener("click", () => {
  const about = $("about");
  const show = Boolean(about?.hidden);
  if (about) about.hidden = !show;
  aboutToggle.textContent = show ? "Hide About & privacy" : "About & privacy";
  aboutToggle.setAttribute("aria-expanded", String(show));
  if (show) about?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  if (isMobileSidebar()) setSidebarOpen(false);
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

function clearAttachment() {
  if (documentFile) documentFile.value = "";
  $("moduleCode").value = "";
  $("attachmentName").textContent = "";
  $("attachmentPreview").hidden = true;
  $("moduleCodeControl").hidden = true;
  updateComposerLabel();
}

function updateComposerLabel() {
  const hasFile = Boolean(documentFile?.files?.[0]);
  const hasQuestion = Boolean($("prompt")?.value.trim());
  const label = $("sendLabel");
  if (label && !sendButton.disabled) {
    label.textContent = hasFile ? (hasQuestion ? "Upload & ask" : "Upload & index") : "Ask TMJ AI";
  }
  if (sendButton) sendButton.setAttribute("aria-label", hasFile ? (hasQuestion ? "Upload document and ask question" : "Upload and index document") : "Send message");
}

$("attachDocument").addEventListener("click", () => {
  if (!session) {
    showAuthDialog("Sign in to attach and index your module material.");
    return;
  }
  documentFile.click();
});

documentFile.addEventListener("change", () => {
  const file = documentFile.files?.[0];
  if (!file) {
    clearAttachment();
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    clearAttachment();
    setStatus(uploadStatus, "Maximum file size is 10 MB.");
    return;
  }
  if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
    clearAttachment();
    setStatus(uploadStatus, "Supported files: PDF, DOCX, TXT and MD.");
    return;
  }
  $("attachmentName").textContent = file.name;
  $("attachmentPreview").hidden = false;
  $("moduleCodeControl").hidden = false;
  setStatus(uploadStatus, "Document attached. Submit to upload and index it.", "info");
  updateComposerLabel();
});

$("removeAttachment").addEventListener("click", () => {
  clearAttachment();
  setStatus(uploadStatus, "Attached document removed.", "info");
});

$("prompt").addEventListener("input", updateComposerLabel);

$("messages").addEventListener("click", event => {
  const starter = event.target?.closest?.(".starter-prompt");
  const value = starter?.getAttribute("data-starter-prompt");
  if (!value) return;
  $("prompt").value = value;
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
  clearAttachment();
  renderWelcome();
  setStatus(chatStatus, "", "success");
  setStatus(uploadStatus, "", "info");
  $("prompt").focus();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session) {
    showAuthDialog("Sign in to ask a question, save conversations, or upload documents.");
    return;
  }

  const prompt = $("prompt").value.trim();
  const file = documentFile.files?.[0] || null;
  if (!prompt && !file) {
    setStatus(chatStatus, "Enter an academic question or attach a document first.");
    $("prompt").focus();
    return;
  }
  if (file && file.size > 10 * 1024 * 1024) {
    setStatus(uploadStatus, "Maximum file size is 10 MB.");
    return;
  }
  if (file && !/\.(pdf|docx|txt|md)$/i.test(file.name)) {
    setStatus(uploadStatus, "Supported files: PDF, DOCX, TXT and MD.");
    return;
  }

  sendButton.disabled = true;
  try {
    if (file) {
      $("sendLabel").textContent = "Uploading…";
      setStatus(uploadStatus, "Uploading and indexing your document…", "info");
      const path = `${session.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const upload = await supabaseClient.storage.from("tmj-documents").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false
      });
      if (upload.error) throw upload.error;

      const indexResponse = await fetch("/api/index-document", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ storagePath: path, fileName: file.name, moduleCode: $("moduleCode").value.trim().toUpperCase() })
      });
      const indexData = await readJson(indexResponse);
      if (!indexResponse.ok) throw new Error(indexData.error || `Indexing failed (${indexResponse.status}).`);
      clearAttachment();
      setStatus(uploadStatus, indexData.message || "Document indexed. You can now ask about it.", "success");
      if (!prompt) return;
    }

    $("sendLabel").textContent = "Thinking…";
    setStatus(chatStatus, "Searching current public NWU pages and your relevant study material…", "info");
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
        setStatus(chatStatus, "The answer could not be generated. Your question is still in the text box so you can retry.");
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
      $("prompt").value = "";
      updateComposerLabel();
      setStatus(chatStatus, "Answer ready.", "success");
      await loadConversations();
    } catch {
      answer.textContent = "The agent could not connect. Check your connection and try again.";
      setStatus(chatStatus, "Your question is still in the text box so you can retry.");
      userMessage.setAttribute("data-request-failed", "true");
    }
  } catch (error) {
    setStatus(uploadStatus, error?.message || "Upload failed. Please try again.");
  } finally {
    sendButton.disabled = false;
    updateComposerLabel();
  }
});

async function deleteConversation(id, button) {
  if (!session || !id) return;
  const message = "Delete this conversation and all its messages? This cannot be undone.";
  if (typeof window.confirm === "function" && !window.confirm(message)) return;

  button.disabled = true;
  button.textContent = "Deleting…";
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
    setStatus(chatStatus, "Conversation deleted.", "success");
    await loadConversations();
  } catch (error) {
    setStatus(chatStatus, error?.message || "Could not delete this conversation. Please try again.");
  } finally {
    button.disabled = false;
    button.textContent = "Delete";
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
        loadConversation(conversation.id);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-conversation";
      deleteButton.textContent = "Delete";
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
    const { data, error } = await supabaseClient
      .from("messages")
      .select("role,content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    currentConversation = { id };
    $("messages").replaceChildren();
    for (const message of data || []) addMessage(message.role, message.content);
    setStatus(chatStatus, "Conversation loaded.", "success");
  } catch {
    setStatus(chatStatus, "Could not load that conversation. Please try again.");
  }
}

ready();
