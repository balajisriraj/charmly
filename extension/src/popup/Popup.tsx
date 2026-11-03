import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LocalModel } from "../shared/ollama";
import { DEFAULTS, type Engine, normalise, type Settings, type StyleProfile, TONES } from "../shared/types";

type Health = { chat: boolean; messages: number; composer: boolean } | null;

const ENGINES: { id: Engine; label: string; hint: string }[] = [
  { id: "local", label: "On-device", hint: "Ollama on this laptop. Chats never leave it." },
  { id: "claude", label: "Claude", hint: "Best quality, with your Anthropic key." },
  { id: "demo", label: "Demo", hint: "Sample suggestions to try the experience." },
];

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="row">
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i className="switch" aria-hidden="true" />
    </label>
  );
}

function App() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [style, setStyle] = useState<StyleProfile | null>(null);
  const [health, setHealth] = useState<Health>(null);
  const [key, setKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useCallback((patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      chrome.storage.local.set({ settings: next });
      return next;
    });
  }, []);

  const refreshModels = useCallback(async (url: string) => {
    setLocalError(null);
    const res = await chrome.runtime.sendMessage({ type: "ollama-models", url });
    if (!res.ok) {
      setModels(null);
      setLocalError(res.message);
      return;
    }
    setModels(res.models);
    return res.models as LocalModel[];
  }, []);

  useEffect(() => {
    chrome.storage.local.get(["settings", "style"]).then(async ({ settings, style }) => {
      const merged = normalise(settings);
      setS(merged);
      setKey(merged.apiKey);
      setStyle((style as StyleProfile) ?? null);
      if (merged.engine === "local") {
        const found = await refreshModels(merged.ollamaUrl);
        // First run on-device: pick the smallest installed model so it works straight away.
        if (found?.length && !merged.ollamaModel) save({ ollamaModel: found[0].name });
      }
    });
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "health" }).then(setHealth).catch(() => setHealth(null));
    });
  }, [refreshModels, save]);

  const pickEngine = async (engine: Engine) => {
    save({ engine });
    setNote(null);
    if (engine === "local") {
      const found = await refreshModels(s.ollamaUrl);
      if (found?.length && !s.ollamaModel) save({ ollamaModel: found[0].name });
    }
  };

  const testKey = async () => {
    setNote("Checking…");
    const res = await chrome.runtime.sendMessage({ type: "test-key", apiKey: key.trim() });
    setNote(res.ok ? "Key works ✓" : res.message);
    if (res.ok) save({ apiKey: key.trim(), engine: "claude" });
  };

  const testLocal = async () => {
    setNote(`Loading ${s.ollamaModel}… the first run takes a few seconds.`);
    const res = await chrome.runtime.sendMessage({ type: "ollama-test", url: s.ollamaUrl, model: s.ollamaModel });
    setNote(res.ok ? `✓ Replied in ${(res.ms / 1000).toFixed(1)}s: "${res.sample}"` : res.message);
  };

  const status = !health
    ? "Open web.whatsapp.com to use Charmly"
    : !health.chat
      ? "Open a chat in WhatsApp"
      : !health.composer
        ? "Can't find the message box (WhatsApp may have changed)"
        : `Ready · reading ${health.messages} messages`;
  const engine = ENGINES.find((e) => e.id === s.engine)!;

  return (
    <main>
      <header>
        <span className="logo" aria-hidden="true" />
        <div>
          <h1>Charmly</h1>
          <p>Better replies, in your own voice.</p>
        </div>
        <label className="master" title={s.enabled ? "On" : "Off"}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          <i className="switch big" aria-hidden="true" />
        </label>
      </header>

      <p className={`status ${health?.composer ? "ok" : ""}`}>
        <span className="dot" /> {status}
      </p>

      <section>
        <h2>Engine</h2>
        <div className="seg engines" role="radiogroup" aria-label="Engine">
          {ENGINES.map((e) => (
            <button key={e.id} role="radio" aria-checked={s.engine === e.id} className={s.engine === e.id ? "on" : ""} onClick={() => pickEngine(e.id)}>
              {e.label}
            </button>
          ))}
        </div>
        <small className="hint">{engine.hint}</small>

        {s.engine === "local" && (
          <div className="panel">
            <label className="field">
              <span>Ollama</span>
              <input
                value={s.ollamaUrl}
                onChange={(e) => save({ ollamaUrl: e.target.value })}
                onBlur={() => refreshModels(s.ollamaUrl)}
                spellCheck={false}
                aria-label="Ollama address"
              />
            </label>
            {models && models.length > 0 ? (
              <label className="field">
                <span>Model</span>
                <select value={s.ollamaModel} onChange={(e) => save({ ollamaModel: e.target.value })} aria-label="Local model">
                  {!s.ollamaModel && <option value="">Choose a model</option>}
                  {models.map((m) => (
                    <option key={m.name} value={m.name} title={gb(m.size)}>
                      {m.name}
                      {m.params ? ` · ${m.params}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : models ? (
              <p className="help">
                No models yet. In a terminal run <code>ollama pull llama3.2:3b</code>, then
                <button className="link inline" onClick={() => refreshModels(s.ollamaUrl)}>
                  refresh
                </button>
                .
              </p>
            ) : null}
            {localError && (
              <p className="help warn">
                {localError}
                <button className="link inline" onClick={() => refreshModels(s.ollamaUrl)}>
                  Try again
                </button>
              </p>
            )}
            <div className="actions">
              <button className="btn" onClick={testLocal} disabled={!s.ollamaModel}>
                Test model
              </button>
              <button className="link" onClick={() => refreshModels(s.ollamaUrl)}>
                Refresh list
              </button>
            </div>
          </div>
        )}

        {s.engine === "claude" && (
          <div className="panel">
            <div className="key">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Anthropic API key" spellCheck={false} />
              <button onClick={testKey} disabled={!key.trim()}>
                Save & test
              </button>
            </div>
            <Toggle on={s.fast} onChange={(v) => save({ fast: v })} label="Fast mode" hint="A smaller, quicker Claude model" />
          </div>
        )}
        {note && <small className="test">{note}</small>}
      </section>

      <section>
        <Toggle on={s.auto} onChange={(v) => save({ auto: v })} label="Suggest automatically" hint="When a new message arrives in the open chat" />
        <div className="row stack">
          <b>Lead with</b>
          <div className="seg">
            {TONES.filter((t) => t.id !== "flirty" || s.flirty).map((t) => (
              <button key={t.id} className={s.tone === t.id ? "on" : ""} onClick={() => save({ tone: t.id })}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle on={s.flirty} onChange={(v) => save({ flirty: v, tone: !v && s.tone === "flirty" ? "warm" : s.tone })} label="Allow flirty replies" hint="Switched off automatically if they seem to want space" />
      </section>

      <section>
        <h2>Your voice</h2>
        {style && style.messages >= 3 ? (
          <div className="voice">
            <span>
              <b>{style.medianWords}</b> words
            </span>
            <span>
              <b>{style.topEmojis.join(" ") || "-"}</b> emoji
            </span>
            <span>
              <b>{Math.round(style.lowercaseStart * 100)}%</b> lowercase
            </span>
            <span>
              <b>{style.fillers.slice(0, 2).join(", ") || "-"}</b> phrases
            </span>
          </div>
        ) : (
          <small>Learns from your own sent messages as you chat. Only a summary is kept, in this browser.</small>
        )}
        <button className="link" onClick={() => chrome.storage.local.remove("style").then(() => setStyle(null))}>
          Forget my style
        </button>
      </section>

      <footer>
        {s.engine === "local"
          ? "On-device: your chats are read and answered on this laptop. Nothing is sent anywhere."
          : "Reads only the open chat, replaces names with Them and Me, and never sends anything for you."}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
