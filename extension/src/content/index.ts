// Content script: watches the open chat, asks for suggestions when a new message arrives, and inserts the one
// you pick into the message box. It never sends anything.
//
// On WhatsApp it runs all the time. Anywhere else it runs on sites you've switched on, or in a tab where you
// pressed Charmly's shortcut (Chrome then lets the extension into that tab, and only that tab).
import { quickVibe } from "../shared/demo";
import { again, type Goal, newGoal, normaliseGoal, onMessage, sayNow, skip } from "../shared/goal";
import { profile } from "../shared/style";
import { type ChatMessage, DEFAULTS, normalise, normalisePresets, type Settings, type StreamEvent, type StyleProfile, type Tone } from "../shared/types";
import { GenericSite, HINTS } from "./generic";
import type { Site } from "./site";
import { same } from "./text";
import { Tray } from "./tray";
import { WhatsApp } from "./whatsapp";

const SHORTCUT = /Mac/.test(navigator.platform) ? "⌥⇧C" : "Alt+Shift+C";

function start() {
  const root = document.documentElement;
  const isWhatsApp = location.host === "web.whatsapp.com" || root.dataset.charmlyFixture === "whatsapp";
  const site: Site = isWhatsApp ? new WhatsApp() : new GenericSite(HINTS[root.dataset.charmlySite ?? location.host] ?? null);

  let settings: Settings = { ...DEFAULTS };
  let port: chrome.runtime.Port | null = null;
  let current: string | null = null; // id of the in-flight request
  let lastKey: string | null = null;
  let lastChat: string | null = null;
  let dismissedFor: string | null = null; // the message the user closed the tray on
  let pending: number | undefined;
  let lastDraft = false;
  let polishedFrom = ""; // the draft the open suggestions were polished from
  let selection = ""; // text you selected on the page to reply to (any site but WhatsApp)
  let lastFocus = 0; // when you were last in a message box (any site but WhatsApp)
  let ready = false;
  let queued = false; // the shortcut fired before settings had loaded

  let chatPresets: Record<string, string> = {};
  let chatNotes: Record<string, string> = {};
  let chatGoals: Record<string, Goal> = {};

  const readGoals = (raw: unknown) =>
    Object.fromEntries(
      Object.entries((raw as Record<string, unknown>) ?? {}).flatMap(([k, v]) => {
        const g = normaliseGoal(v);
        return g ? [[k, g]] : [];
      }),
    ) as Record<string, Goal>;

  /** Save this chat's goal (or clear it) and show it. */
  async function setGoal(goal: Goal | null) {
    const chat = site.chat();
    if (!chat) return;
    chatGoals = { ...chatGoals };
    if (goal) chatGoals[chat] = goal;
    else delete chatGoals[chat];
    tray.goal = goal;
    tray.refresh();
    await chrome.storage.local.set({ chatGoals });
  }

  /** Load this chat's preset, note and goal into the tray. Chat names never leave the browser. */
  function applyChat() {
    const chat = site.chat() ?? "";
    tray.preset = chat in chatPresets ? chatPresets[chat] : settings.preset;
    tray.note = chatNotes[chat] ?? "";
    const goal = chatGoals[chat] ?? null;
    if (goal?.text !== tray.goal?.text) tray.read = null;
    tray.goal = goal;
  }

  const pill = () => tray.set({ kind: "pill", draft: !!site.draft() });

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
      const chat = site.chat();
      if (!chat) return;
      chatPresets = { ...chatPresets, [chat]: id };
      await chrome.storage.local.set({ chatPresets });
      if (tray.open) request(tray.tone);
    },
    saveNote: async (note) => {
      const chat = site.chat();
      if (!chat) return;
      chatNotes = { ...chatNotes };
      if (note) chatNotes[chat] = note;
      else delete chatNotes[chat];
      await chrome.storage.local.set({ chatNotes });
      if (tray.open) request(tray.tone);
    },
    saveGoal: async (text, pace) => {
      await setGoal(text ? newGoal(text, pace) : null);
      if (text && site.messages(1).length) request(tray.tone);
    },
    goalAction: async (action) => {
      const g = tray.goal;
      if (!g) return;
      if (action === "done") return setGoal(null);
      await setGoal(action === "skip" ? skip(g) : action === "now" ? sayNow(g) : again(g));
      if (action !== "again") request(tray.tone);
    },
    editPresets: () => void chrome.runtime.sendMessage({ type: "open-options" }),
    suggest: (tone) => request(tone),
    polish: () => request(tray.tone, site.draft()),
    insert: (text, index) => void put(text, index),
    moved: (offset) => {
      // Remember where you put Charmly, per site.
      void chrome.storage.local.get("trayOffsets").then(({ trayOffsets }) =>
        chrome.storage.local.set({ trayOffsets: { ...((trayOffsets as Record<string, unknown>) ?? {}), [location.host]: offset } }),
      );
    },
    dismiss: () => {
      port?.disconnect();
      port = null;
      dismissedFor = lastKey;
      pill();
    },
  });

  /** Insert a suggestion and say clearly what went wrong if it didn't take. */
  async function put(text: string, index?: number) {
    const result = await site.insert(text);
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
          ? `Can't find ${site.name}'s message box. The text is copied: click into the box and paste.`
          : `${site.name}'s editor didn't accept the text. It's copied: click into the box and paste.`,
    });
  }

  /** Settings the tray mirrors. The tone is only reset when the saved default changes, so a chip you tap sticks. */
  function adopt(next: Settings) {
    if (next.tone !== settings.tone || (tray.tone === "flirty" && !next.flirty)) tray.tone = next.flirty || next.tone !== "flirty" ? next.tone : "warm";
    settings = next;
  }

  /** On other sites the tray only shows while you're using a message box, or while it's showing something. */
  function shown() {
    if (!settings.enabled) return false;
    if (!site.generic) return !!site.main();
    if (tray.open) return true;
    const box = site.composer();
    if (!box) return false;
    if (selection) return true; // offer "Reply to selected text"
    const active = document.activeElement;
    if (active && (box.contains(active) || active === tray.host)) lastFocus = performance.now();
    return performance.now() - lastFocus < 2500;
  }

  function sync() {
    if (!settings.flirty && tray.tone === "flirty") tray.tone = "warm";
    tray.flirty = settings.flirty;
    tray.engine = settings.engine;
    tray.model = settings.ollamaModel;
    tray.hasKey = !!settings.apiKey;
    tray.selection = !!selection;
    tray.host.style.display = shown() ? "" : "none";
    tray.place(site.anchor(), site.dark());
  }

  /** The conversation to answer: what you selected, if anything, else the chat on screen. */
  function conversation(): ChatMessage[] {
    if (site.generic && selection) return [{ speaker: "them", text: selection }];
    return site.messages(settings.contextSize);
  }

  function request(tone: Tone, draft?: string) {
    const chat = conversation();
    if (!chat.length && !draft) {
      if (site.generic) tray.set({ kind: "error", message: `Charmly couldn't read this conversation. Select the message you're replying to, then press ${SHORTCUT} again.` });
      return;
    }
    port?.disconnect();
    port = chrome.runtime.connect({ name: "charmly" });
    const id = crypto.randomUUID();
    current = id;
    tray.tone = tone;
    polishedFrom = draft ?? "";
    tray.typing = false;
    tray.set({ kind: "loading", vibe: null, suggestions: [], polishing: !!draft });
    sync();
    port.onMessage.addListener((e: StreamEvent) => {
      if (e.id !== current) return;
      if (e.type === "vibe") tray.vibe(e.vibe);
      else if (e.type === "goal") {
        tray.read = e.read;
        tray.refresh();
      } else if (e.type === "suggestion") tray.add(e.suggestion);
      else if (e.type === "done") tray.finish(e.dropped);
      else if (e.type === "error") tray.set({ kind: "error", message: e.message });
      sync();
    });
    port.postMessage({ type: "suggest", id, chat, tone, draft: draft || undefined, preset: tray.preset, note: tray.note || undefined, goal: tray.goal ?? undefined });
  }

  /** The shortcut: open Charmly on the box you're in. Reply if there's something to reply to, else polish. */
  function activate() {
    if (!ready) {
      queued = true;
      return;
    }
    if (!settings.enabled) {
      settings = { ...settings, enabled: true };
      void chrome.storage.local.set({ settings });
    }
    lastFocus = performance.now();
    if (!site.composer()) {
      tray.set({ kind: "error", message: `Click into the message box you want help with, then press ${SHORTCUT}.` });
      return sync();
    }
    if (conversation().length) return request(tray.tone);
    if (site.draft()) return request(tray.tone, site.draft());
    request(tray.tone);
  }

  /** Learn the user's style from their own sent messages in the open chat. Only a summary is stored. */
  async function learn() {
    const mine = site.messages(40).filter((m) => m.speaker === "me").map((m) => m.text);
    if (!mine.length) return;
    const { style } = (await chrome.storage.local.get("style")) as { style?: StyleProfile };
    await chrome.storage.local.set({ style: profile(mine, style) });
  }

  function tick() {
    if (!settings.enabled) return;
    sync();
    const chat = site.chat();
    if (chat !== lastChat) {
      lastChat = chat;
      applyChat();
      lastKey = site.lastKey();
      port?.disconnect();
      tray.set({ kind: "pill", draft: false });
      void learn();
      return;
    }
    const key = site.lastKey();
    // On other sites the conversation only becomes readable once you're in a message box. The message already
    // there when that happens isn't new; only what arrives after it is.
    if (key && lastKey === null && site.generic) lastKey = key;
    if (key && key !== lastKey) {
      lastKey = key;
      const incoming = key.startsWith("in:");
      // The conversation driver: your reply finishes this step, their answer starts the next.
      if (tray.goal) {
        const next = onMessage(tray.goal, incoming ? "them" : "me", incoming && quickVibe(site.messages(6)).boundary);
        if (next !== tray.goal) void setGoal(next);
      }
      if (!incoming) {
        void learn();
        tray.set({ kind: "pill", draft: false });
      } else if (settings.auto && dismissedFor !== key && site.composer()) {
        // Wait a moment: people often send several messages in a row.
        clearTimeout(pending);
        pending = window.setTimeout(() => request(tray.tone), 700);
      }
    }
    const text = site.draft();
    if (tray.open) {
      // Typing your own reply while suggestions are up: offer to polish it, but not for a suggestion you just
      // inserted, or for the draft these suggestions already polished.
      const typing = !!text && !same(text, polishedFrom) && !tray.suggestions.some((x) => same(x.text, text));
      if (typing !== tray.typing) {
        tray.typing = typing;
        tray.refresh();
      }
    } else if (!!text !== lastDraft) {
      lastDraft = !!text;
      tray.set({ kind: "pill", draft: lastDraft });
    }
  }

  // WhatsApp re-checks on every animation frame with changes; busier sites get a gentler pace.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      tick();
    };
    if (site.generic) setTimeout(run, 400);
    else requestAnimationFrame(run);
  };
  const observer = new MutationObserver(schedule);
  if (site.generic) {
    document.addEventListener("focusin", schedule, true);
    document.addEventListener("focusout", () => setTimeout(schedule, 2600), true);
    // Select someone's message, anywhere on the page, to reply to just that.
    document.addEventListener("selectionchange", () => {
      const sel = document.getSelection();
      const text = sel?.toString().trim() ?? "";
      const inBox = sel?.anchorNode && site.composer()?.contains(sel.anchorNode);
      const next = text.length > 1 && text.length < 1500 && !inBox ? text : "";
      if (next === selection || (inBox && !next)) return;
      selection = next;
      if (!tray.open) {
        sync();
        pill();
      }
    });
  }

  // Peek: hold Alt on its own (no other key) and the tray fades so you can read the chat behind it.
  let peekTimer: number | undefined;
  const endPeek = () => {
    clearTimeout(peekTimer);
    peekTimer = undefined;
    tray.peek(false);
  };
  document.addEventListener("keyup", (e) => e.key === "Alt" && endPeek(), true);
  window.addEventListener("blur", endPeek);

  document.addEventListener(
    "keydown",
    (e) => {
      if (!settings.enabled) return;
      if (e.key === "Alt") {
        if (tray.open && !e.repeat && peekTimer === undefined) peekTimer = window.setTimeout(() => tray.peek(true), 350);
        return;
      }
      if (peekTimer !== undefined) endPeek();
      if (e.key === "Escape" && tray.open) {
        pill();
        return;
      }
      if (!e.altKey) return;
      // On other sites, Alt+letter belongs to the page (and types characters on a Mac) unless the tray is open.
      if (site.generic && !tray.open) return;
      const k = e.code;
      const digit = /^Digit([1-5])$/.exec(k);
      if (digit && tray.suggestions[Number(digit[1]) - 1]) {
        e.preventDefault();
        const i = Number(digit[1]) - 1;
        void put(tray.suggestions[i].text, i);
      } else if (k === "KeyR") {
        e.preventDefault();
        request(tray.tone);
      } else if (k === "KeyP" && site.draft()) {
        e.preventDefault();
        request(tray.tone, site.draft());
      }
    },
    true,
  );

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "health") reply({ ...site.health(), chat: !!site.main(), site: site.name, generic: site.generic });
    if (msg?.type === "suggest-now") request(tray.tone);
    if (msg?.type === "activate") {
      activate();
      reply({ ok: true });
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) adopt(normalise(changes.settings.newValue));
    if (changes.presets) tray.presets = normalisePresets(changes.presets.newValue);
    if (changes.chatPresets) chatPresets = (changes.chatPresets.newValue as Record<string, string>) ?? {};
    if (changes.chatNotes) chatNotes = (changes.chatNotes.newValue as Record<string, string>) ?? {};
    if (changes.chatGoals) chatGoals = readGoals(changes.chatGoals.newValue);
    if (changes.settings || changes.presets || changes.chatPresets || changes.chatNotes || changes.chatGoals) {
      applyChat();
      sync();
      if (!tray.open) pill();
    }
  });

  window.addEventListener("resize", () => tray.place(site.anchor(), site.dark()));

  chrome.storage.local.get(["settings", "presets", "chatPresets", "chatNotes", "chatGoals", "trayOffsets"]).then(({ settings: saved, presets, chatPresets: cp, chatNotes: cn, chatGoals: cg, trayOffsets }) => {
    const offset = (trayOffsets as Record<string, { x: number; y: number }> | undefined)?.[location.host];
    if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) tray.offset = offset;
    chatGoals = readGoals(cg);
    settings = normalise(saved);
    tray.tone = settings.flirty || settings.tone !== "flirty" ? settings.tone : "warm";
    tray.presets = normalisePresets(presets);
    chatPresets = (cp as Record<string, string>) ?? {};
    chatNotes = (cn as Record<string, string>) ?? {};
    applyChat();
    lastChat = site.chat();
    lastKey = site.lastKey();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    ready = true;
    tick();
    if (queued) activate();
  });
}

// The shortcut can inject this script into a tab that already has it; run once per page.
const flag = globalThis as { __charmly?: boolean };
if (!flag.__charmly) {
  flag.__charmly = true;
  start();
}
