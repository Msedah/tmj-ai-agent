const ADMIN_CONFIG = {
  supabaseUrl: "https://kiaaamxjtvenyaujpysf.supabase.co",
  supabaseAnonKey: "sb_publishable_F3MdZEjCS99N9oY9z7m9PQ_lwY0FUTr"
};

const adminEl = id => document.getElementById(id);
const adminLoginPanel = adminEl("adminLoginPanel");
const adminApp = adminEl("adminApp");
const adminLoginForm = adminEl("adminLoginForm");
const adminLoginButton = adminEl("adminLoginButton");
const adminLoginStatus = adminEl("adminLoginStatus");
const adminStatus = adminEl("adminStatus");
const adminAccessNotice = adminEl("adminAccessNotice");
const adminDashboardContent = adminEl("adminDashboardContent");
const adminUsers = adminEl("adminUsers");
const ADMIN_DEFAULT_CHAT_LIMIT = 35;
const ADMIN_SHARED_CHAT_LIMIT = 350;
let adminSupabase = null;
let adminSession = null;

function setAdminStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.className = `admin-status${type ? ` ${type}` : ""}`;
}

async function parseAdminResponse(response) {
  let payload = {};
  try { payload = await response.json(); } catch { /* Keep a useful generic error below. */ }
  if (!response.ok) {
    const error = new Error(payload.error || "The admin request could not be completed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function adminRequest(path, options = {}) {
  if (!adminSession?.access_token) throw new Error("Sign in to continue.");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${adminSession.access_token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  return parseAdminResponse(await fetch(path, { ...options, headers }));
}

function showSignedInView() {
  adminLoginPanel.hidden = true;
  adminApp.hidden = false;
}

function showSignedOutView() {
  adminLoginPanel.hidden = false;
  adminApp.hidden = true;
  adminSession = null;
  adminDashboardContent.hidden = true;
  adminAccessNotice.hidden = true;
  setAdminStatus(adminStatus, "");
}

function formatMiB(byteCount) {
  return `${(Number(byteCount || 0) / (1024 * 1024)).toFixed(2)} MiB`;
}

function renderUsers(users) {
  adminUsers.replaceChildren();
  if (!users.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty-state";
    empty.textContent = "No accounts have used TMJ today.";
    adminUsers.append(empty);
    return;
  }

  for (const account of users) {
    const card = document.createElement("article");
    card.className = "admin-user-card";

    const heading = document.createElement("div");
    heading.className = "admin-user-heading";
    const identity = document.createElement("div");
    const email = document.createElement("h3");
    email.textContent = account.email || `Account ${String(account.userId).slice(0, 8)}`;
    const details = document.createElement("p");
    details.className = "admin-user-details";
    details.textContent = `${account.chatCount} chat requests used · ${account.uploadCount} uploads · ${formatMiB(account.uploadBytes)}`;
    identity.append(email, details);

    const ratio = document.createElement("strong");
    ratio.className = "admin-user-ratio";
    ratio.textContent = `${account.chatCount} / ${account.dailyChatLimit}`;
    heading.append(identity, ratio);

    const progress = document.createElement("progress");
    progress.className = "admin-user-progress";
    progress.max = Math.max(1, Number(account.dailyChatLimit));
    progress.value = Math.min(progress.max, Number(account.chatCount));
    progress.setAttribute("aria-label", `${account.chatCount} of ${account.dailyChatLimit} daily chat requests used`);

    const form = document.createElement("form");
    form.className = "admin-limit-form";
    form.dataset.userId = account.userId;
    const label = document.createElement("label");
    label.textContent = "Daily chat limit";
    const input = document.createElement("input");
    input.name = "dailyChatLimit";
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.max = String(ADMIN_SHARED_CHAT_LIMIT);
    input.step = "1";
    input.required = true;
    input.value = String(Number.isInteger(account.dailyChatLimit) ? account.dailyChatLimit : ADMIN_DEFAULT_CHAT_LIMIT);
    input.setAttribute("aria-label", `Daily chat limit for ${account.email || "this account"}`);
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "admin-primary-button admin-save-button";
    save.textContent = "Save limit";
    label.append(input);
    form.append(label, save);
    card.append(heading, progress, form);
    adminUsers.append(card);
  }
}

function renderDashboard(data) {
  adminAccessNotice.hidden = true;
  adminDashboardContent.hidden = false;
  adminEl("activeUsersValue").textContent = `${data.activeUsers} / ${data.activeUserLimit}`;
  adminEl("activeUsersCaption").textContent = `of ${data.activeUserLimit} daily accounts`;
  adminEl("totalChatsValue").textContent = `${data.totalChats} / ${data.sharedChatLimit}`;
  adminEl("totalChatsCaption").textContent = `of ${data.sharedChatLimit} shared per day`;
  adminEl("sharedRemainingValue").textContent = String(data.sharedChatsRemaining);
  adminEl("uploadsValue").textContent = String(data.totalUploads);
  adminEl("uploadsCaption").textContent = formatMiB(data.totalUploadBytes);
  const day = new Date(`${data.utcDay}T00:00:00Z`);
  adminEl("adminDateCaption").textContent = `${new Intl.DateTimeFormat("en-ZA", { dateStyle: "full", timeZone: "UTC" }).format(day)} · resets at 02:00 South African time.`;
  renderUsers(Array.isArray(data.users) ? data.users : []);
}

async function loadAdminDashboard() {
  adminDashboardContent.hidden = true;
  adminAccessNotice.hidden = true;
  setAdminStatus(adminStatus, "Loading today’s usage…", "info");
  try {
    const data = await adminRequest("/api/admin/dashboard");
    renderDashboard(data);
    setAdminStatus(adminStatus, "Usage refreshed.", "success");
  } catch (error) {
    if (error.status === 403 && error.payload?.code === "ADMIN_NOT_ALLOWED") {
      adminEl("adminAccountId").textContent = String(error.payload.userId || "Unavailable");
      adminAccessNotice.hidden = false;
      setAdminStatus(adminStatus, "Sign-in succeeded; this account still needs explicit admin authorization.", "warning");
      return;
    }
    setAdminStatus(adminStatus, error.message || "Could not load the dashboard. Try again.", "error");
  }
}

adminLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const email = adminEl("adminEmail").value.trim();
  const password = adminEl("adminPassword").value;
  adminLoginButton.disabled = true;
  adminLoginButton.textContent = "Signing in…";
  setAdminStatus(adminLoginStatus, "");
  try {
    const { data, error } = await adminSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session) throw new Error("No sign-in session was returned.");
    adminSession = data.session;
    showSignedInView();
    await loadAdminDashboard();
  } catch (error) {
    setAdminStatus(adminLoginStatus, error.message || "Sign-in failed. Check your details and try again.", "error");
  } finally {
    adminLoginButton.disabled = false;
    adminLoginButton.textContent = "Sign in";
  }
});

adminUsers.addEventListener("submit", async event => {
  const form = event.target.closest(".admin-limit-form");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const input = form.elements.dailyChatLimit;
  const dailyChatLimit = Number(input.value);
  if (!Number.isInteger(dailyChatLimit) || dailyChatLimit < 0 || dailyChatLimit > ADMIN_SHARED_CHAT_LIMIT) {
    setAdminStatus(adminStatus, `Enter a whole-number limit from 0 to ${ADMIN_SHARED_CHAT_LIMIT}.`, "error");
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  setAdminStatus(adminStatus, "Saving account limit…", "info");
  try {
    await adminRequest(`/api/admin/users/${encodeURIComponent(form.dataset.userId)}/chat-limit`, {
      method: "PUT",
      body: JSON.stringify({ dailyChatLimit })
    });
    await loadAdminDashboard();
    setAdminStatus(adminStatus, "Daily message limit saved.", "success");
  } catch (error) {
    setAdminStatus(adminStatus, error.message || "Could not save the limit.", "error");
    button.disabled = false;
    button.textContent = "Save limit";
  }
});

adminEl("refreshAdminDashboard").addEventListener("click", () => void loadAdminDashboard());
adminEl("adminSignOut").addEventListener("click", async () => {
  let signOutFailed = false;
  try {
    const { error } = await adminSupabase.auth.signOut();
    if (error) throw error;
  } catch {
    signOutFailed = true;
    try { await adminSupabase.auth.signOut({ scope: "local" }); } catch { /* Clear the local view even if storage is unavailable. */ }
  }
  showSignedOutView();
  adminLoginForm.reset();
  setAdminStatus(adminLoginStatus, signOutFailed ? "Signed out on this device; the server could not confirm the request." : "You are signed out.", signOutFailed ? "warning" : "success");
});
adminEl("copyAdminAccountId").addEventListener("click", async event => {
  const id = adminEl("adminAccountId").textContent;
  try {
    await navigator.clipboard.writeText(id);
    event.currentTarget.textContent = "Copied";
    setTimeout(() => { event.currentTarget.textContent = "Copy ID"; }, 1800);
  } catch {
    setAdminStatus(adminStatus, "Select and copy the account ID shown above.", "warning");
  }
});

async function initializeAdmin() {
  if (!window.supabase?.createClient) {
    setAdminStatus(adminLoginStatus, "The sign-in service could not load. Check your connection and try again.", "error");
    return;
  }
  try {
    adminSupabase = window.supabase.createClient(ADMIN_CONFIG.supabaseUrl, ADMIN_CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    adminSupabase.auth.onAuthStateChange((_event, nextSession) => {
      adminSession = nextSession;
      if (!nextSession && _event === "SIGNED_OUT") showSignedOutView();
      else if (nextSession && !adminLoginPanel.hidden) showSignedInView();
    });
    const { data, error } = await adminSupabase.auth.getSession();
    if (error) throw error;
    adminSession = data.session;
    if (adminSession) {
      showSignedInView();
      await loadAdminDashboard();
    }
  } catch {
    setAdminStatus(adminLoginStatus, "Could not connect to account services. Try again shortly.", "error");
  }
}

void initializeAdmin();
