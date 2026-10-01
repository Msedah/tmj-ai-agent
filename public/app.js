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
  aboutToggle.textContent = show ? "Hide About TMJ AI" : "About TMJ AI";
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
  $("messages").innerHTML = '<div class="welcome"><div class="welcome-mark" aria-hidden="true">T</div><p class="eyebrow">YOUR NWU STUDY PARTNER</p><h2>What are you studying today?</h2><p>Ask a module question for a clear, structured explanation.</p></div>';
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

function addMessage(role, text, sources = [], nwuSearchUrl = "") {
  const element = document.createElement("div");
  element.className = `message ${role}`;
  element.textContent = text;
  element.setAttribute("role", role === "assistant" ? "status" : "note");
  if (role === "assistant") appendAssistantSources(element, sources, nwuSearchUrl);
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

      answer.textContent = data.reply || "No response was returned.";
      appendAssistantSources(answer, data.sources, data.nwuSearchUrl);
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
      const item = document.createElement("button");
      item.type = "button";
      item.className = "conversation";
      item.textContent = conversation.title || "New conversation";
      item.addEventListener("click", () => loadConversation(conversation.id));
      list.appendChild(item);
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
