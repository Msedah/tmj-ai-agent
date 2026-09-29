import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

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
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  querySelector() { return new ElementMock(`${this.id}-submit`); }
}

test("classic frontend script boots beside the Supabase CDN global and primary clicks respond", async () => {
  const ids = [
    "authDialog", "authButton", "authForm", "authSubmit", "authStatus", "authToggle",
    "authClose", "authEmail", "authPassword", "authName", "authNameLabel", "authTitle",
    "chatForm", "chatStatus", "prompt", "messages", "newChat", "uploadForm",
    "uploadStatus", "uploadPanel", "conversationList", "appStatus", "documentFile", "moduleCode"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new ElementMock(id)]));
  elements.chatForm.reset = () => { elements.prompt.value = ""; };
  elements.chatForm.querySelector = () => new ElementMock("chat-submit");
  elements.uploadForm.querySelector = () => new ElementMock("upload-submit");

  const sdk = {
    createClient: () => ({
      auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: null }, error: null })
      }
    })
  };
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => new ElementMock(tag)
  };
  const context = vm.createContext({ document, window: { supabase: sdk } });

  // Supabase's UMD script exposes a classic global binding named `supabase`.
  vm.runInContext("var supabase = window.supabase;", context);
  assert.doesNotThrow(() => new vm.Script(source, { filename: "public/app.js" }).runInContext(context));

  await elements.authButton.listeners.get("click")[0]();
  assert.equal(elements.authDialog.open, true, "sign-in button should open the auth dialog");

  elements.authToggle.listeners.get("click")[0]();
  assert.equal(elements.authName.hidden, false, "sign-up should reveal the name field");
  assert.equal(elements.authNameLabel.hidden, false, "sign-up should reveal the name label");

  elements.authClose.listeners.get("click")[0]();
  assert.equal(elements.authDialog.open, false, "close button should close the auth dialog");

  elements.prompt.value = "draft question";
  elements.newChat.listeners.get("click")[0]();
  assert.equal(elements.prompt.value, "", "new conversation should clear the draft");
  assert.match(elements.messages.innerHTML, /What are you studying\?/);
});
