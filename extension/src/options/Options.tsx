import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AUTHOR, AUTHOR_URL } from "../shared/brand";
import { rulesBlock } from "../shared/prompt";
import { normalise, normalisePreset, normalisePresets, type Preset, type Settings, STARTER_PRESETS } from "../shared/types";

const QUICK: { list: "always" | "never"; text: string }[] = [
  { list: "always", text: "Keep replies under 20 words" },
  { list: "always", text: "Write in lowercase, like I do" },
  { list: "always", text: "Use British spelling" },
  { list: "always", text: "Ask a question back when it fits" },
  { list: "always", text: "Mix in Tamil or Hindi words if they do" },
  { list: "never", text: "Agree to plans, money or times on my behalf" },
  { list: "never", text: "Use emojis" },
  { list: "never", text: "Sound formal or like a customer service agent" },
  { list: "never", text: "Share my location, address or schedule" },
  { list: "never", text: "Apologise unless I did something wrong" },
];
const EMOJIS = ["😎", "💼", "🏡", "💫", "✨", "🎓", "🏏", "🧑‍💻", "❤️", "🙏", "🎉", "🌙"];

function ListEditor({ label, hint, items, onChange, placeholder, tone }: { label: string; hint: string; items: string[]; onChange: (xs: string[]) => void; placeholder: string; tone: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  };
  return (
    <section className="card">
      <h2>{label}</h2>
      <p className="hint">{hint}</p>
      <div className="chips">
        {items.map((x) => (
          <span key={x} className={`chip ${tone}`}>
            {x}
            <button aria-label={`Remove ${x}`} onClick={() => onChange(items.filter((y) => y !== x))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} maxLength={200} aria-label={`Add to ${label}`} />
        <button disabled={!draft.trim()}>Add</button>
      </form>
    </section>
  );
}

function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [chatPresets, setChatPresets] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    chrome.storage.local.get(["presets", "settings", "chatNotes", "chatPresets", "chatGoals"]).then(({ presets, settings, chatNotes, chatPresets, chatGoals }) => {
      setGoals((chatGoals as Record<string, string>) ?? {});
      const list = normalisePresets(presets);
      setPresets(list);
      setSelected(new URLSearchParams(location.search).get("preset") ?? list[0]?.id ?? "");
      setSettings(normalise(settings));
      setNotes((chatNotes as Record<string, string>) ?? {});
      setChatPresets((chatPresets as Record<string, string>) ?? {});
      loaded.current = true;
    });
  }, []);

  // Save as you type, with a short debounce.
  useEffect(() => {
    if (!loaded.current) return;
    setSaved(false);
    const t = setTimeout(() => chrome.storage.local.set({ presets: presets.map(normalisePreset) }).then(() => setSaved(true)), 400);
    return () => clearTimeout(t);
  }, [presets]);

  const current = presets.find((p) => p.id === selected);
  const patch = (p: Partial<Preset>) => setPresets((ps) => ps.map((x) => (x.id === selected ? { ...x, ...p } : x)));
  const add = (base?: Preset) => {
    const fresh = normalisePreset({ ...(base ?? { about: "", always: [], never: [], blocked: [] }), id: crypto.randomUUID().slice(0, 8), name: base ? `${base.name} copy` : "New preset", emoji: base?.emoji ?? "✨" });
    setPresets((ps) => [...ps, fresh]);
    setSelected(fresh.id);
  };
  const remove = (id: string) => {
    const left = presets.filter((p) => p.id !== id);
    setPresets(left);
    setSelected(left[0]?.id ?? "");
    if (settings?.preset === id) setDefault("");
  };
  const setDefault = (id: string) => {
    if (!settings) return;
    const next = { ...settings, preset: id };
    setSettings(next);
    chrome.storage.local.set({ settings: next });
  };
  const forgetChat = (chat: string) => {
    const n = { ...notes };
    const c = { ...chatPresets };
    const g = { ...goals };
    delete n[chat];
    delete c[chat];
    delete g[chat];
    setNotes(n);
    setChatPresets(c);
    setGoals(g);
    chrome.storage.local.set({ chatNotes: n, chatPresets: c, chatGoals: g });
  };
  const chats = [...new Set([...Object.keys(notes), ...Object.keys(chatPresets), ...Object.keys(goals)])];

  return (
    <main>
      <header>
        <span className="logo" aria-hidden="true" />
        <div>
          <h1>Voice presets</h1>
          <a className="credit" href={AUTHOR_URL} target="_blank" rel="noreferrer">
            Charmly · designed &amp; built by <b>{AUTHOR}</b>
          </a>
          <p>Each preset tells Charmly who you are in that kind of chat, how you talk, and what it must always or never say. Switch presets from the tray in any chat; Charmly remembers your choice per chat.</p>
        </div>
        <span className={`saved ${saved ? "on" : ""}`}>{saved ? "Saved ✓" : "Saving…"}</span>
      </header>

      <div className="layout">
        <nav className="presets" aria-label="Presets">
          {presets.map((p) => (
            <button key={p.id} className={`preset ${p.id === selected ? "on" : ""}`} onClick={() => setSelected(p.id)}>
              <span className="emoji">{p.emoji}</span>
              <span className="name">
                {p.name}
                {settings?.preset === p.id && <em>default</em>}
              </span>
              <small>{p.always.length + p.never.length} rules{p.blocked.length ? ` · ${p.blocked.length} blocked` : ""}</small>
            </button>
          ))}
          <button className="new" onClick={() => add()}>
            + New preset
          </button>
          <button className="link" onClick={() => setPresets(STARTER_PRESETS.map((p) => ({ ...p })))}>
            Restore starter presets
          </button>
        </nav>

        {current ? (
          <div className="editor">
            <section className="card head">
              <div className="emoji-pick">
                {EMOJIS.map((e) => (
                  <button key={e} className={current.emoji === e ? "on" : ""} onClick={() => patch({ emoji: e })} aria-label={`Use ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
              <input className="title" value={current.name} onChange={(e) => patch({ name: e.target.value })} maxLength={40} aria-label="Preset name" />
              <div className="row-actions">
                <label className="default">
                  <input type="checkbox" checked={settings?.preset === current.id} onChange={(e) => setDefault(e.target.checked ? current.id : "")} />
                  Use for chats without a preset
                </label>
                <span className="spacer" />
                <button className="link" onClick={() => add(current)}>
                  Duplicate
                </button>
                <button className="link danger" onClick={() => remove(current.id)}>
                  Delete
                </button>
              </div>
            </section>

            <section className="card">
              <h2>About you & how you talk</h2>
              <p className="hint">In your own words, for this kind of chat. Charmly treats this as the strongest guidance.</p>
              <textarea
                value={current.about}
                onChange={(e) => patch({ about: e.target.value })}
                rows={5}
                maxLength={1500}
                placeholder={"e.g. I text short and casual, mostly lowercase. I mix in Tamil words (da, machan). Warm but not mushy, a bit of dry humour."}
              />
              <span className="count">{current.about.length}/1500</span>
            </section>

            <section className="card">
              <h2>Quick rules</h2>
              <div className="chips">
                {QUICK.map((q) => {
                  const on = current[q.list].includes(q.text);
                  return (
                    <button key={q.text} className={`chip preset-rule ${q.list} ${on ? "on" : ""}`} onClick={() => patch({ [q.list]: on ? current[q.list].filter((x) => x !== q.text) : [...current[q.list], q.text] })}>
                      {on ? "✓ " : "+ "}
                      {q.list === "never" ? "Never: " : ""}
                      {q.text}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="two">
              <ListEditor label="Always" hint="Every reply should do these." items={current.always} onChange={(always) => patch({ always })} placeholder="e.g. Call my sister 'akka'" tone="always" />
              <ListEditor label="Never" hint="No reply should ever do these." items={current.never} onChange={(never) => patch({ never })} placeholder="e.g. Mention work on weekends" tone="never" />
            </div>
            <ListEditor
              label="Never use these words"
              hint="Enforced in code: a suggestion containing one of these is dropped before you see it, whatever the model writes."
              items={current.blocked}
              onChange={(blocked) => patch({ blocked })}
              placeholder="e.g. babe"
              tone="blocked"
            />

            <section className="card preview">
              <h2>What Charmly tells the model</h2>
              <p className="hint">Added to every request in a chat using this preset.</p>
              <pre>{rulesBlock(current, undefined, current.name) || "Nothing yet."}</pre>
            </section>
          </div>
        ) : (
          <div className="editor empty">No presets. Add one, or restore the starters.</div>
        )}
      </div>

      {chats.length > 0 && (
        <section className="card chats">
          <h2>Your chats</h2>
          <p className="hint">Presets, notes and 🎯 goals you set from the tray. Chat names are stored only in this browser.</p>
          <ul>
            {chats.map((c) => {
              const p = presets.find((x) => x.id === chatPresets[c]);
              return (
                <li key={c}>
                  <b>{c}</b>
                  <span className="tag">{p ? `${p.emoji} ${p.name}` : c in chatPresets ? "No preset" : "Default"}</span>
                  <span className="note">
                    {goals[c] ? `🎯 ${goals[c]}` : ""}
                    {goals[c] && notes[c] ? " · " : ""}
                    {notes[c] ?? ""}
                  </span>
                  <button className="link" onClick={() => forgetChat(c)}>
                    Forget
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
