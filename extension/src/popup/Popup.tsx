import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULTS, type Settings, type StyleProfile, TONES } from "../shared/types";

type Health = { chat: boolean; messages: number; composer: boolean } | null;

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
  const [test, setTest] = useState<string | null>(null);

  useEffect(() => {
    chrome.storage.local.get(["settings", "style"]).then(({ settings, style }) => {
      const merged = { ...DEFAULTS, ...((settings as Partial<Settings>) ?? {}) };
      setS(merged);
      setKey(merged.apiKey);
      setStyle((style as StyleProfile) ?? null);
    });
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "health" }).then(setHealth).catch(() => setHealth(null));
    });
  }, []);

  const save = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    chrome.storage.local.set({ settings: next });
  };

  const testKey = async () => {
    setTest("Checking…");
    const res = await chrome.runtime.sendMessage({ type: "test-key", apiKey: key.trim() });
    setTest(res.ok ? "Key works ✓" : res.message);
    if (res.ok) save({ apiKey: key.trim(), demo: false });
  };

  const status = !health ? "Open web.whatsapp.com to use Charmly" : !health.chat ? "Open a chat in WhatsApp" : !health.composer ? "Can't find the message box (WhatsApp may have changed)" : `Ready · reading ${health.messages} messages`;

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
        <Toggle on={s.fast} onChange={(v) => save({ fast: v })} label="Fast mode" hint="A smaller, quicker model" />
      </section>

      <section>
        <h2>Claude</h2>
        <div className="key">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Anthropic API key" spellCheck={false} />
          <button onClick={testKey} disabled={!key.trim()}>
            Save & test
          </button>
        </div>
        {test && <small className="test">{test}</small>}
        <Toggle on={s.demo} onChange={(v) => save({ demo: v })} label="Demo mode" hint="Sample suggestions, no key needed" />
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
          <small>Learns from your own sent messages as you chat. Nothing leaves your browser except as guidance in a request.</small>
        )}
        <button className="link" onClick={() => chrome.storage.local.remove("style").then(() => setStyle(null))}>
          Forget my style
        </button>
      </section>

      <footer>
        Reads only the open chat, replaces names with Them and Me, and never sends anything for you.
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
