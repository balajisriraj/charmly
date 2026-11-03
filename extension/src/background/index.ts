// Background service worker: the only code that talks to a model. Three engines share one pipeline:
// stream text → line parser → safety filter → tray.
//   claude: Anthropic's API with your key        local: Ollama on this laptop        demo: built-in samples
import Anthropic from "@anthropic-ai/sdk";
import { demo, quickVibe } from "../shared/demo";
import { makesAsk, quickRead, stepOf } from "../shared/goal";
import { listModels, OllamaError, streamChat } from "../shared/ollama";
import { LineParser, salvage } from "../shared/parse";
import { buildPrompt, LOCAL_SYSTEM, SYSTEM } from "../shared/prompt";
import { check } from "../shared/safety";
import { normalise, normalisePresets, type Preset, type Settings, type StreamEvent, type StyleProfile, type Suggestion, type SuggestRequest, type Vibe } from "../shared/types";

const MODEL = { best: "claude-opus-5-5", fast: "claude-haiku-5-5" };

async function load(presetId?: string): Promise<{ settings: Settings; style: StyleProfile | null; preset: Preset | null }> {
  const { settings: raw, style, presets } = await chrome.storage.local.get(["settings", "style", "presets"]);
  const settings = normalise(raw);
  const id = presetId ?? settings.preset;
  const preset = id ? (normalisePresets(presets).find((p) => p.id === id) ?? null) : null;
  return { settings, style: (style as StyleProfile) ?? null, preset };
}

function claude(apiKey: string) {
  // Direct browser access is required for calls from an extension; the key stays in this worker and chrome.storage.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(req: SuggestRequest, post: (e: StreamEvent) => void, signal: AbortSignal) {
  const started = performance.now();
  const { settings, style, preset } = await load(req.preset);
  // A quick local read is the safety floor: if either it or the model sees them pulling back, stay gentle.
  const floor = quickVibe(req.chat);
  const floorRead = req.goal ? quickRead(req.chat, req.goal) : { ahead: false, note: "" };
  let vibe: Vibe | null = null;
  let dropped = 0;
  let shown = 0;
  // Steering: before the last step, an option that makes the ask is held back, unless they opened the door.
  const holdAsk = !!req.goal && !req.draft && !stepOf(req.goal).final && !floorRead.ahead;
  const emit = (s: Suggestion) => {
    const verdict = check(s, vibe ?? floor, settings.flirty, preset?.blocked ?? []);
    if (verdict.ok && holdAsk && req.goal && makesAsk(verdict.text, req.goal)) verdict.ok = false;
    if (!verdict.ok) {
      dropped++;
      return;
    }
    post({ type: "suggestion", id: req.id, suggestion: { ...s, n: ++shown, text: verdict.text } });
  };
  const done = () => post({ type: "done", id: req.id, dropped, ms: Math.round(performance.now() - started) });

  if (settings.engine === "demo") {
    const out = demo(req.chat, req.tone, settings.flirty, req.draft, req.goal);
    await sleep(350);
    vibe = out.vibe;
    post({ type: "vibe", id: req.id, vibe });
    if (out.read) post({ type: "goal", id: req.id, read: out.read });
    for (const s of out.suggestions) {
      if (signal.aborted) return;
      await sleep(260);
      emit(s);
    }
    return done();
  }

  let parsed = 0;
  let raw = "";
  const parser = new LineParser(
    (v) => {
      // Small local models sometimes fill the vibe with sentences; keep their read only when it's a crisp label.
      const crisp = [v.mood, v.intent, v.language].every((x) => x && x.split(/\s+/).length <= 5);
      const base = settings.engine === "local" && !crisp ? floor : v;
      vibe = { ...base, boundary: v.boundary || floor.boundary };
      post({ type: "vibe", id: req.id, vibe });
    },
    (s) => {
      parsed++;
      emit(s);
    },
    3,
    (read) => post({ type: "goal", id: req.id, read: { ...read, ahead: read.ahead || floorRead.ahead } }),
  );
  // When they seem to want space, don't even ask for a flirty line: the filter would only drop it.
  const prompt = buildPrompt(req.chat, req.tone, settings.flirty && !floor.boundary, style, req.draft, preset, req.note, preset?.name, req.goal, settings.engine === "local");

  if (settings.engine === "local") {
    if (!settings.ollamaModel) throw new OllamaError("Pick an on-device model in Charmly's settings.");
    // Small models often skip the vibe line, so show the local read straight away; the model's can replace it.
    vibe = floor;
    post({ type: "vibe", id: req.id, vibe });
    if (req.goal && !req.draft) post({ type: "goal", id: req.id, read: floorRead });
    await streamChat({ url: settings.ollamaUrl, model: settings.ollamaModel, system: LOCAL_SYSTEM, prompt, signal }, (t) => {
      raw += t;
      parser.push(t);
    });
    parser.end();
    if (!parsed) salvage(raw).forEach(emit);
    return done();
  }

  if (!settings.apiKey) {
    post({ type: "error", id: req.id, message: "Add your Anthropic API key in Charmly's settings, or switch to On-device or Demo." });
    return;
  }
  const stream = claude(settings.apiKey).beta.messages.stream(
    {
      model: settings.fast ? MODEL.fast : MODEL.best,
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal },
  );
  stream.on("text", (delta) => {
    raw += delta;
    parser.push(delta);
  });
  const final = await stream.finalMessage();
  parser.end();
  if (final.stop_reason === "refusal") {
    post({ type: "error", id: req.id, message: "Charmly can't help with this conversation." });
    return;
  }
  if (!parsed) salvage(raw).forEach(emit);
  done();
}

function friendly(err: unknown): string {
  if (err instanceof OllamaError) return err.message;
  const status = (err as { status?: number }).status;
  if (status === 401) return "That API key was rejected. Check it in Charmly's settings.";
  if (status === 429) return "Rate limited. Give it a few seconds.";
  if (status && status >= 500) return "Claude is having a moment. Try again shortly.";
  return "Couldn't get suggestions. Check your connection and try again.";
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "charmly") return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((req: SuggestRequest) => {
    if (req.type !== "suggest") return;
    const post = (e: StreamEvent) => {
      if (!controller.signal.aborted) port.postMessage(e);
    };
    run(req, post, controller.signal).catch((err) => {
      if (!controller.signal.aborted) post({ type: "error", id: req.id, message: friendly(err) });
    });
  });
});

/**
 * Charmly beyond WhatsApp. Two ways in, both your choice:
 *   - the shortcut (⌥⇧C by default): Chrome lets the extension into the current tab for that moment
 *     (activeTab), so Charmly loads there and opens on the box you're in. No site permission needed.
 *   - "Always on this site" in the popup: Chrome asks once for that site, and Charmly registers itself there.
 */
async function activate(tabId: number) {
  const ping = () => chrome.tabs.sendMessage(tabId, { type: "activate" });
  try {
    await ping();
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await ping();
    } catch {
      /* a page Chrome doesn't let extensions into, like chrome:// or the Web Store */
    }
  }
}
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "activate" && tab?.id) void activate(tab.id);
});

const SITES_SCRIPT = "charmly-sites";
const pattern = (origin: string) => `${origin}/*`;

/** Register the content script on the sites you switched on (and still allow). */
async function syncSites() {
  const { sites } = (await chrome.storage.local.get("sites")) as { sites?: string[] };
  const allowed: string[] = [];
  for (const o of sites ?? []) if (await chrome.permissions.contains({ origins: [pattern(o)] })) allowed.push(o);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SITES_SCRIPT] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SITES_SCRIPT] });
  if (allowed.length) await chrome.scripting.registerContentScripts([{ id: SITES_SCRIPT, matches: allowed.map(pattern), js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }]);
  return allowed;
}

async function setSite(origin: string, on: boolean, tabId?: number) {
  const { sites } = (await chrome.storage.local.get("sites")) as { sites?: string[] };
  const next = new Set(sites ?? []);
  if (on) next.add(origin);
  else next.delete(origin);
  await chrome.storage.local.set({ sites: [...next] });
  if (!on) await chrome.permissions.remove({ origins: [pattern(origin)] }).catch(() => false);
  const allowed = await syncSites();
  if (on && tabId && allowed.includes(origin)) await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
  return allowed;
}

// Popup helpers: test a Claude key, list and test local models; the tray's "Edit presets…"; sites.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "site") {
    setSite(msg.origin, !!msg.on, msg.tabId)
      .then((sites) => reply({ ok: true, sites }))
      .catch((err) => reply({ ok: false, message: String(err?.message ?? err) }));
    return true;
  }
  if (msg?.type === "activate-tab" && msg.tabId) {
    activate(msg.tabId).then(() => reply({ ok: true }));
    return true;
  }
  if (msg?.type === "open-options") {
    void chrome.runtime.openOptionsPage();
    return;
  }
  if (msg?.type === "test-key") {
    claude(msg.apiKey)
      .messages.create({ model: MODEL.fast, max_tokens: 8, messages: [{ role: "user", content: "Say ok." }] })
      .then(() => reply({ ok: true }))
      .catch((err) => reply({ ok: false, message: friendly(err) }));
    return true;
  }
  if (msg?.type === "ollama-models") {
    listModels(msg.url)
      .then((models) => reply({ ok: true, models }))
      .catch((err) => reply({ ok: false, message: friendly(err) }));
    return true;
  }
  if (msg?.type === "ollama-test") {
    const started = performance.now();
    let text = "";
    streamChat(
      { url: msg.url, model: msg.model, system: "Reply with one short friendly sentence.", prompt: "Say hi.", signal: AbortSignal.timeout(60000) },
      (t) => (text += t),
    )
      .then(() => reply({ ok: true, ms: Math.round(performance.now() - started), sample: text.trim().slice(0, 80) }))
      .catch((err) => reply({ ok: false, message: friendly(err) }));
    return true;
  }
});

/**
 * Ollama rejects chat requests that carry an extension Origin unless OLLAMA_ORIGINS is configured. Rather than
 * ask people to restart Ollama with an environment variable, drop the Origin header on requests that Charmly
 * itself sends to localhost (initiatorDomains limits the rule to this extension; no web page can use it).
 */
async function allowLocalModels() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        condition: {
          requestDomains: ["localhost", "127.0.0.1"],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
        },
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [{ header: "origin", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }],
        },
      },
    ],
  });
}
chrome.runtime.onStartup.addListener(() => {
  void allowLocalModels();
  void syncSites();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await allowLocalModels();
  await syncSites();
  if (reason === "install") {
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings) await chrome.storage.local.set({ settings: normalise({ engine: "demo" }), presets: normalisePresets(null) });
  }
});
