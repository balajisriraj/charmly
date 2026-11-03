// Background service worker: the only place that talks to Claude. Your API key never touches the page.
import Anthropic from "@anthropic-ai/sdk";
import { demo } from "../shared/demo";
import { LineParser } from "../shared/parse";
import { buildPrompt, SYSTEM } from "../shared/prompt";
import { check } from "../shared/safety";
import { DEFAULTS, type Settings, type StreamEvent, type StyleProfile, type SuggestRequest, type Vibe } from "../shared/types";

const MODEL = { best: "claude-opus-5-5", fast: "claude-haiku-5-5" };

async function load(): Promise<{ settings: Settings; style: StyleProfile | null }> {
  const { settings, style } = await chrome.storage.local.get(["settings", "style"]);
  return { settings: { ...DEFAULTS, ...((settings as Partial<Settings>) ?? {}) }, style: (style as StyleProfile) ?? null };
}

function client(apiKey: string) {
  // Direct browser access is required for calls from an extension; the key stays in this worker and chrome.storage.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

async function run(req: SuggestRequest, post: (e: StreamEvent) => void, signal: AbortSignal) {
  const started = performance.now();
  const { settings, style } = await load();
  let vibe: Vibe | null = null;
  let dropped = 0;
  let n = 0;
  const emitSuggestion = (s: { n: number; tone: string; text: string; why: string }) => {
    const verdict = check(s, vibe, settings.flirty);
    if (!verdict.ok) {
      dropped++;
      return;
    }
    post({ type: "suggestion", id: req.id, suggestion: { ...s, n: ++n, text: verdict.text } });
  };

  if (settings.demo || !settings.apiKey) {
    if (!settings.demo) {
      post({ type: "error", id: req.id, message: "Add your Anthropic API key in Charmly's settings, or switch on Demo mode." });
      return;
    }
    const out = demo(req.chat, req.tone, settings.flirty, req.draft);
    await sleep(350);
    vibe = out.vibe;
    post({ type: "vibe", id: req.id, vibe });
    for (const s of out.suggestions) {
      if (signal.aborted) return;
      await sleep(260);
      emitSuggestion(s);
    }
    post({ type: "done", id: req.id, dropped, ms: Math.round(performance.now() - started) });
    return;
  }

  const parser = new LineParser(
    (v) => {
      vibe = v;
      post({ type: "vibe", id: req.id, vibe: v });
    },
    emitSuggestion,
  );
  const stream = client(settings.apiKey).beta.messages.stream(
    {
      model: settings.fast ? MODEL.fast : MODEL.best,
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildPrompt(req.chat, req.tone, settings.flirty, style, req.draft) }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal },
  );
  stream.on("text", (delta) => parser.push(delta));
  const final = await stream.finalMessage();
  parser.end();
  if (final.stop_reason === "refusal") {
    post({ type: "error", id: req.id, message: "Charmly can't help with this conversation." });
    return;
  }
  post({ type: "done", id: req.id, dropped, ms: Math.round(performance.now() - started) });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(err: unknown): string {
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

// The popup's "Test key" button.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "test-key") return;
  client(msg.apiKey)
    .messages.create({ model: MODEL.fast, max_tokens: 8, messages: [{ role: "user", content: "Say ok." }] })
    .then(() => reply({ ok: true }))
    .catch((err) => reply({ ok: false, message: friendly(err) }));
  return true; // async reply
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings) await chrome.storage.local.set({ settings: { ...DEFAULTS, demo: true } });
  }
});
