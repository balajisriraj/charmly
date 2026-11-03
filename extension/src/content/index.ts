// Content script: watches the open WhatsApp chat, asks for suggestions when a new message arrives,
// and inserts the one you pick into the message box. It never sends anything.
import { profile } from "../shared/style";
import { DEFAULTS, normalise, normalisePresets, type Settings, type StreamEvent, type StyleProfile, type Tone } from "../shared/types";
import { Tray } from "./tray";
import { WhatsApp } from "./whatsapp";

const wa = new WhatsApp();
let settings: Settings = { ...DEFAULTS };
let port: chrome.runtime.Port | null = null;
let current: string | null = null; // id of the in-flight request
let lastKey: string | null = null;
let lastChat: string | null = null;
let dismissedFor: string | null = null; // the message the user closed the tray on
let pending: number | undefined;
let lastDraft = false;

let chatPresets: Record<string, string> = {};
let chatNotes: Record<string, string> = {};

/** Load this chat's preset and note into the tray. Chat names never leave the browser. */
function applyChat() {
  const chat = wa.chat() ?? "";
  tray.preset = chat in chatPresets ? chatPresets[chat] : settings.preset;
  tray.note = chatNotes[chat] ?? "";
}

const tray = new Tray({
  chooseEngine: async (engine, model) => {
    settings = { ...settings, engine, ...(model ? { ollamaModel: model } : {}) };
    await chrome.storage.local.set({ settings });
    if (tray.open) request(tray.tone);
  },
  loadModels: async () => {
    const res = await chrome.runtime.sendMessage({ type: "ollama-models", url: settings.ollamaUrl }).catch(() => null);
    tray.models = res?.ok ? res.models.map((m: { name: string; params: string }) => ({ name: m.name, params: m.params })) : null;
    tray.modelsError = res?.ok ? "" : (res?.message ?? "Can't reach Ollama.");
    tray.refresh();
  },
  choosePreset: async (id) => {
    const chat = wa.chat();
    if (!chat) return;
    chatPresets = { ...chatPresets, [chat]: id };
    await chrome.storage.local.set({ chatPresets });
    if (tray.open) request(tray.tone);
  },
  saveNote: async (note) => {
    const chat = wa.chat();
    if (!chat) return;
    chatNotes = { ...chatNotes };
    if (note) chatNotes[chat] = note;
    else delete chatNotes[chat];
    await chrome.storage.local.set({ chatNotes });
    if (tray.open) request(tray.tone);
  },
  editPresets: () => void chrome.runtime.sendMessage({ type: "open-options" }),
  suggest: (tone) => request(tone),
  polish: () => request(tray.tone, wa.draft()),
  insert: (text, index) => void put(text, index),
  dismiss: () => {
    port?.disconnect();
    port = null;
    dismissedFor = lastKey;
    tray.set({ kind: "pill", draft: !!wa.draft() });
  },
});

/** Insert a suggestion and say clearly what went wrong if it didn't take. */
async function put(text: string, index?: number) {
  const result = await wa.insert(text);
  if (result === "ok") {
    if (index !== undefined) tray.markInserted(index);
    return;
  }
  // Leave the suggestions on screen, and copy the text so it's one paste away.
  await navigator.clipboard?.writeText(text).catch(() => {});
  tray.set({
    kind: "error",
    message:
      result === "no-box"
        ? "Can't find WhatsApp's message box on this page. The text is copied: click into the box and paste."
        : "WhatsApp's editor didn't accept the text. It's copied: click into the box and paste.",
  });
}

function sync() {
  tray.tone = settings.tone;
  tray.flirty = settings.flirty;
  tray.engine = settings.engine;
  tray.model = settings.ollamaModel;
  tray.hasKey = !!settings.apiKey;
  tray.host.style.display = settings.enabled && wa.main() ? "" : "none";
  tray.place(wa.footer(), wa.dark());
}

function request(tone: Tone, draft?: string) {
  const chat = wa.messages(settings.contextSize);
  if (!chat.length && !draft) return;
  port?.disconnect();
  port = chrome.runtime.connect({ name: "charmly" });
  const id = crypto.randomUUID();
  current = id;
  tray.tone = tone;
  tray.set({ kind: "loading", vibe: null, suggestions: [], polishing: !!draft });
  sync();
  port.onMessage.addListener((e: StreamEvent) => {
    if (e.id !== current) return;
    if (e.type === "vibe") tray.vibe(e.vibe);
    else if (e.type === "suggestion") tray.add(e.suggestion);
    else if (e.type === "done") tray.finish(e.dropped);
    else if (e.type === "error") tray.set({ kind: "error", message: e.message });
    sync();
  });
  port.postMessage({ type: "suggest", id, chat, tone, draft: draft || undefined, preset: tray.preset, note: tray.note || undefined });
}

/** Learn the user's style from their own sent messages in the open chat. Only a summary is stored. */
async function learn() {
  const mine = wa.messages(40).filter((m) => m.speaker === "me").map((m) => m.text);
  if (!mine.length) return;
  const { style } = (await chrome.storage.local.get("style")) as { style?: StyleProfile };
  await chrome.storage.local.set({ style: profile(mine, style) });
}

function tick() {
  if (!settings.enabled) return;
  sync();
  const chat = wa.chat();
  if (chat !== lastChat) {
    lastChat = chat;
    applyChat();
    lastKey = wa.lastKey();
    port?.disconnect();
    tray.set({ kind: "pill", draft: false });
    void learn();
    return;
  }
  const key = wa.lastKey();
  if (key && key !== lastKey) {
    lastKey = key;
    const incoming = key.startsWith("in:");
    if (!incoming) {
      void learn();
      tray.set({ kind: "pill", draft: false });
    } else if (settings.auto && dismissedFor !== key) {
      // Wait a moment: people often send several messages in a row.
      clearTimeout(pending);
      pending = window.setTimeout(() => request(tray.tone), 700);
    }
  }
  if (!tray.open) {
    const hasDraft = !!wa.draft();
    if (hasDraft !== lastDraft) {
      lastDraft = hasDraft;
      tray.set({ kind: "pill", draft: hasDraft });
    }
  }
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    tick();
  });
});

document.addEventListener(
  "keydown",
  (e) => {
    if (!settings.enabled) return;
    if (e.key === "Escape" && tray.open) {
      tray.set({ kind: "pill", draft: !!wa.draft() });
      return;
    }
    if (!e.altKey) return;
    const k = e.code;
    const digit = /^Digit([1-5])$/.exec(k);
    if (digit && tray.suggestions[Number(digit[1]) - 1]) {
      e.preventDefault();
      const i = Number(digit[1]) - 1;
      void put(tray.suggestions[i].text, i);
    } else if (k === "KeyR") {
      e.preventDefault();
      request(tray.tone);
    } else if (k === "KeyP" && wa.draft()) {
      e.preventDefault();
      request(tray.tone, wa.draft());
    }
  },
  true,
);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "health") reply({ ...wa.health(), chat: !!wa.main() });
  if (msg?.type === "suggest-now") request(tray.tone);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) settings = normalise(changes.settings.newValue);
  if (changes.presets) tray.presets = normalisePresets(changes.presets.newValue);
  if (changes.chatPresets) chatPresets = (changes.chatPresets.newValue as Record<string, string>) ?? {};
  if (changes.chatNotes) chatNotes = (changes.chatNotes.newValue as Record<string, string>) ?? {};
  if (changes.settings || changes.presets || changes.chatPresets || changes.chatNotes) {
    applyChat();
    sync();
    if (!tray.open) tray.set({ kind: "pill", draft: !!wa.draft() });
  }
});

window.addEventListener("resize", () => tray.place(wa.footer(), wa.dark()));

chrome.storage.local.get(["settings", "presets", "chatPresets", "chatNotes"]).then(({ settings: saved, presets, chatPresets: cp, chatNotes: cn }) => {
  settings = normalise(saved);
  tray.presets = normalisePresets(presets);
  chatPresets = (cp as Record<string, string>) ?? {};
  chatNotes = (cn as Record<string, string>) ?? {};
  applyChat();
  lastChat = wa.chat();
  lastKey = wa.lastKey();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  tick();
});
