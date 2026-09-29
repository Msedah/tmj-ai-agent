const CONFIG = {
  supabaseUrl: "https://kiaaamxjtvenyaujpysf.supabaseClient.co",
  supabaseAnonKey: "sb_publishable_F3MdZEjCS99N9oY9z7m9PQ_lwY0FUTr"
};

let supabaseClient = null;
let session = null;
let currentConversation = null;
let authMode = "signin";

const $ = (id) => document.getElementById(id);
const authDialog = $("authDialog");
const authButton = $("authButton");
const authForm = $("authForm");
const authSubmit = $("authSubmit");
const authStatus = $("authStatus");
const chatForm = $("chatForm");
const chatStatus = $("chatStatus");
const uploadForm = $("uploadForm");
const uploadStatus = $("uploadStatus");

function setStatus(element, message, kind = "error") {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
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

function setSidebarOpen(open) {
  document.body?.classList?.toggle("sidebar-open", open);
  sidebarToggle?.setAttribute("aria-expanded", String(open));
  if (sidebarOverlay) sidebarOverlay.hidden = !open;
}

sidebarToggle?.addEventListener("click", () => {
  setSidebarOpen(sidebarToggle.getAttribute("aria-expanded") !== "true");
});
sidebarOverlay?.addEventListener("click", () => setSidebarOpen(false));
$("aboutLink")?.addEventListener("click", () => setSidebarOpen(false));

function updateAuthUI() {
  authButton.textContent = session ? "Sign out" : "Sign in";
  authButton.setAttribute("aria-label", session ? "Sign out of your account" : "Sign in to your account");
  // Starting a new local draft is useful even before sign-in; saving it still requires an account.
  $("newChat").disabled = false;
  $("historyPanel").hidden = !session;
  $("developerAttribution").hidden = !session;
  $("uploadPanel").hidden = !session;

  if (!session) {
    $("conversationList").replaceChildren();
  }
}

function renderWelcome() {
  $("messages").innerHTML = '<div class="welcome"><div class="welcome-mark" aria-hidden="true">T</div><p class="eyebrow">YOUR NWU STUDY PARTNER</p><h2>What are you studying today?</h2><p>Ask a module question, get a clear explanation, or sign in to upload your course material.</p><p class="example-prompt">Try: “Explain my PADM module concept in simple English.”</p></div>';
}

function addMessage(role, text) {
  const element = document.createElement("div");
  element.className = `message ${role}`;
  element.textContent = text;
  element.setAttribute("role", role === "assistant" ? "status" : "note");
  $("messages").appendChild(element);
  $("messages").scrollTop = $("messages").scrollHeight;
  return element;
}

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
    supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
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
  } catch {
    session = null;
    updateAuthUI();
    const message = "Could not connect to account services. Please try again shortly.";
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
  $("authName").hidden = authMode === "signin";
  $("authNameLabel").hidden = authMode === "signin";
  $("authPassword").autocomplete = authMode === "signin" ? "current-password" : "new-password";
  setStatus(authStatus, "", "info");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    setStatus(authStatus, "Account services are not configured yet. Please contact the site administrator.");
    return;
  }

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const name = $("authName").value.trim();
  authSubmit.disabled = true;
  authSubmit.textContent = authMode === "signin" ? "Signing in…" : "Creating account…";
  setStatus(authStatus, "", "info");

  try {
    const result = authMode === "signin"
      ? await supabaseClient.auth.signInWithPassword({ email, password })
      : await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } });

    if (result.error) {
      setStatus(authStatus, result.error.message);
    } else if (result.data.session) {
      authDialog.close();
      setStatus($("appStatus"), "Signed in successfully.", "success");
    } else {
      setStatus(authStatus, "Check your email to confirm your account.", "success");
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
  renderWelcome();
  setStatus(chatStatus, "New conversation ready.", "success");
  $("prompt").focus();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session) {
    showAuthDialog("Sign in to ask a question and save your conversations.");
    return;
  }

  const prompt = $("prompt").value.trim();
  if (!prompt) {
    setStatus(chatStatus, "Enter an academic question first.");
    $("prompt").focus();
    return;
  }

  const submitButton = chatForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Thinking…";
  setStatus(chatStatus, "Searching relevant academic material…", "info");
  const userMessage = addMessage("user", prompt);
  const answer = addMessage("assistant", "Searching relevant academic material…");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
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
    if (data.conversationId) currentConversation = { id: data.conversationId };
    $("prompt").value = "";
    setStatus(chatStatus, "Answer ready.", "success");
    await loadConversations();
  } catch {
    answer.textContent = "The agent could not connect. Check your connection and try again.";
    setStatus(chatStatus, "Your question is still in the text box so you can retry.");
    userMessage.setAttribute("data-request-failed", "true");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Ask TMJ AI";
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || !supabaseClient) {
    showAuthDialog("Sign in to upload and index module material.");
    return;
  }

  const file = $("documentFile").files[0];
  const moduleCode = $("moduleCode").value.trim().toUpperCase();
  if (!file) {
    setStatus(uploadStatus, "Choose a document first.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setStatus(uploadStatus, "Maximum file size is 10 MB.");
    return;
  }
  if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
    setStatus(uploadStatus, "Supported files: PDF, DOCX, TXT and MD.");
    return;
  }

  const submitButton = uploadForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Uploading…";
  setStatus(uploadStatus, "Uploading and indexing…", "info");

  try {
    const path = `${session.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const upload = await supabaseClient.storage.from("tmj-documents").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (upload.error) throw upload.error;

    const response = await fetch("/api/index-document", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ storagePath: path, fileName: file.name, moduleCode })
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || `Indexing failed (${response.status}).`);
    setStatus(uploadStatus, data.message || "Document indexed successfully.", "success");
    uploadForm.reset();
  } catch (error) {
    setStatus(uploadStatus, error?.message || "Upload failed. Please try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Upload & index";
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
