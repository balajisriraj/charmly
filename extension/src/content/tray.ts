// The suggestion tray: a small glass panel docked above WhatsApp's message box, rendered in a shadow root.
//
// Layout, kept deliberately small:
//   header   Charmly (credit) · the vibe · this chat's setup chip ▾ · ↻ · ×
//   goal     a thin progress line, only while steering toward a goal
//   cards    three suggestions
//   footer   lead tone · polish your draft · what was held back
// Everything per chat (voice preset, goal, note, engine) lives in one sheet behind the setup chip.
import { AUTHOR_URL, CREDIT } from "../shared/brand";
import { type Goal, type GoalRead, PACES, type Pace, PLANS, stepOf } from "../shared/goal";
import { type Engine, type Preset, type Suggestion, type Tone, TONES, type Vibe } from "../shared/types";
import css from "./tray.css";

type State =
  | { kind: "pill"; draft: boolean }
  | { kind: "loading"; vibe: Vibe | null; suggestions: Suggestion[]; polishing: boolean }
  | { kind: "ready"; vibe: Vibe | null; suggestions: Suggestion[]; dropped: number; polishing: boolean }
  | { kind: "error"; message: string };

export type TrayHandlers = {
  chooseEngine: (engine: Engine, model?: string) => void;
  loadModels: () => void;
  choosePreset: (id: string) => void;
  saveNote: (note: string) => void;
  saveGoal: (text: string, pace: Pace) => void;
  goalAction: (action: "skip" | "now" | "again" | "done") => void;
  editPresets: () => void;
  suggest: (tone: Tone) => void;
  polish: () => void;
  insert: (text: string, index: number) => void;
  dismiss: () => void;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const isMac = /Mac/.test(navigator.platform);
const ALT = isMac ? "⌥" : "Alt+";
const EXAMPLES = ["ask them out for coffee", "ask for the money back, gently", "tell them I'm moving to Singapore", "ask for a referral at their company"];

export class Tray {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private state: State = { kind: "pill", draft: false };
  private inserted: number | null = null;
  private panel!: HTMLElement;
  private shown = 0; // cards already on screen, so only new ones animate in

  // Mirrored from settings and this chat by the controller.
  tone: Tone = "warm";
  flirty = false;
  engine: Engine = "demo";
  model = ""; // the local model in use
  hasKey = false;
  models: { name: string; params: string }[] | null = null; // installed local models, once loaded
  modelsError = "";
  presets: Preset[] = [];
  preset = ""; // the preset this chat uses ("" = none)
  note = ""; // this chat's note
  goal: Goal | null = null; // where this chat should slowly head, and which step it's on
  read: GoalRead | null = null; // the latest read: have they brought it up themselves?
  typing = false; // the person is writing their own reply while suggestions are open

  private sheet = false; // the per-chat sheet is open
  private pace: Pace = 4; // chosen in the sheet
  private fields: Record<string, string> = {}; // what's typed in the sheet, kept across re-renders

  constructor(private readonly h: TrayHandlers) {
    this.host = document.createElement("charmly-tray");
    this.host.style.cssText = "position:fixed;z-index:2147483000;left:0;bottom:0;width:0;height:0;";
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${css}</style><div class="tray pill" role="region" aria-label="Charmly reply suggestions"></div>`;
    this.panel = this.root.querySelector(".tray")!;
    document.documentElement.appendChild(this.host);
    this.root.addEventListener("click", (e) => this.click(e as MouseEvent));
    this.root.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.field) this.fields[el.dataset.field] = el.value;
    });
    this.render();
  }

  get open() {
    return this.state.kind !== "pill";
  }

  get suggestions(): Suggestion[] {
    return this.state.kind === "ready" || this.state.kind === "loading" ? this.state.suggestions : [];
  }

  /** Dock above the message box; WhatsApp's layout changes as panels open, so this runs on every render and resize. */
  place(anchor: HTMLElement | null, dark: boolean) {
    const panel = this.panel;
    panel.classList.toggle("dark", dark);
    if (!anchor) {
      panel.style.display = "none";
      return;
    }
    const r = anchor.getBoundingClientRect();
    panel.style.display = "";
    panel.style.left = `${Math.round(r.left + 12)}px`;
    panel.style.width = `${Math.round(Math.min(r.width - 24, 760))}px`;
    panel.style.bottom = `${Math.round(window.innerHeight - r.top + 10)}px`;
  }

  set(state: State) {
    const opening = this.state.kind === "pill" && state.kind !== "pill";
    if (state.kind === "loading" && state.suggestions.length === 0) this.shown = 0;
    this.state = state;
    if (state.kind !== "ready") this.inserted = null;
    this.render();
    if (opening) {
      // Animate the panel only when it opens, not on every streamed update.
      this.panel.classList.remove("enter");
      void this.panel.offsetWidth;
      this.panel.classList.add("enter");
    }
  }

  vibe(v: Vibe) {
    if (this.state.kind === "loading" || this.state.kind === "ready") this.set({ ...this.state, vibe: v });
  }

  add(s: Suggestion) {
    if (this.state.kind === "loading") this.set({ ...this.state, suggestions: [...this.state.suggestions, s] });
  }

  finish(dropped: number) {
    if (this.state.kind === "loading") this.set({ kind: "ready", vibe: this.state.vibe, suggestions: this.state.suggestions, dropped, polishing: this.state.polishing });
  }

  /** Re-render with the current state, e.g. after the model list loads. */
  refresh() {
    this.render(true);
  }

  markInserted(i: number) {
    this.inserted = i;
    this.render();
  }

  private toggleSheet(open = !this.sheet) {
    this.sheet = open;
    this.fields = {};
    this.pace = this.goal?.pace ?? 4;
    if (open) this.h.loadModels();
    this.render(true);
  }

  private click(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const act = target.dataset.act!;
    const field = (name: string) => this.fields[name] ?? this.root.querySelector<HTMLInputElement>(`[data-field="${name}"]`)?.value ?? "";
    switch (act) {
      case "sheet":
        return this.toggleSheet();
      case "preset":
        this.preset = target.dataset.id ?? "";
        this.h.choosePreset(this.preset);
        return this.render(true);
      case "engine":
        this.engine = target.dataset.engine as Engine;
        if (target.dataset.model) this.model = target.dataset.model;
        this.h.chooseEngine(this.engine, target.dataset.model);
        return this.render(true);
      case "edit-presets":
        return this.h.editPresets();
      case "pace":
        this.pace = Number(target.dataset.pace) as Pace;
        return this.render(true);
      case "goal-example":
        this.fields.goal = target.dataset.text ?? "";
        return this.render(true);
      case "save-goal": {
        const text = field("goal").trim();
        if (!text) return;
        this.read = null;
        this.sheet = false;
        this.h.saveGoal(text, this.pace);
        return this.render();
      }
      case "save-note":
        this.note = field("note").trim();
        this.h.saveNote(this.note);
        return this.toggleSheet(false);
      case "goal-skip":
      case "goal-now":
      case "goal-again":
      case "goal-done":
        this.read = null;
        if (act === "goal-done") this.sheet = false;
        return this.h.goalAction(act.slice(5) as "skip" | "now" | "again" | "done");
      case "suggest":
        return this.h.suggest(this.tone);
      case "polish":
        return this.h.polish();
      case "close":
        this.sheet = false;
        return this.h.dismiss();
      case "tone":
        this.tone = target.dataset.tone as Tone;
        return this.h.suggest(this.tone);
      case "insert": {
        const i = Number(target.dataset.i);
        const s = this.suggestions[i];
        if (s) this.h.insert(s.text, i);
      }
    }
  }

  // ---- pieces -------------------------------------------------------------------------------------------

  private brand() {
    return `<span class="mark" aria-hidden="true"></span><b>Charmly</b><a class="by" href="${AUTHOR_URL}" target="_blank" rel="noopener" title="Charmly is designed and built by Balaji Sri Raj">${CREDIT}</a>`;
  }

  private engineLabel() {
    return this.engine === "local" ? `💻 ${this.model || "pick a model"}` : this.engine === "claude" ? "☁ Claude" : "✨ Demo";
  }

  /** One chip that sums up this chat's setup and opens the sheet. */
  private setupChip() {
    const p = this.presets.find((x) => x.id === this.preset);
    const label = `${p ? `${esc(p.emoji)} ${esc(p.name)}` : "No voice"} · ${esc(this.engineLabel())}${this.note ? " · ✎" : ""}`;
    return `<button class="setup ${this.sheet ? "on" : ""}" data-act="sheet" aria-expanded="${this.sheet}" title="Voice, goal, note and engine for this chat">${label} <span class="chev">▾</span></button>`;
  }

  /** The goal in a few characters, for the pill and the header: where it is and whether it's waiting. */
  private goalChip(g: Goal) {
    const { index, total } = stepOf(g);
    const label = g.said ? "said ✓" : `${index + 1}/${total}${g.awaiting ? " · waiting for them" : ""}`;
    return `<button class="goal-chip" data-act="sheet" title="Steering toward: ${esc(g.text)}">🎯 <span>${label}</span></button>`;
  }

  /** The conversation driver, as one line: the plan, where this reply is, and the one action that matters. */
  private goalStrip(g: Goal, paused: boolean) {
    const { index, total, step, final } = stepOf(g);
    const bars = PLANS[g.pace].map((x, i) => `<i class="${g.said || i < index ? "done" : i === index ? "now" : ""}" title="${esc(x.name)}"></i>`).join("");
    const ahead = !!this.read?.ahead && !final && !paused && !g.said;
    const status = g.said
      ? "you said it 🎉"
      : paused
        ? "paused, they may want space"
        : ahead
          ? "they brought it up themselves"
          : g.awaiting
            ? `step ${index + 1} done, next when they reply`
            : `step ${index + 1} of ${total} · ${esc(step.name)}${final ? "" : ", not saying it yet"}`;
    const action = g.said
      ? '<button class="link" data-act="goal-again">Keep going</button><button class="link strong" data-act="goal-done">Done ✓</button>'
      : ahead
        ? '<button class="mini" data-act="goal-now">Say it now ›</button>'
        : final
          ? ""
          : '<button class="link" data-act="goal-skip" title="Move to the next step">Skip ›</button>';
    return `<div class="goal ${paused ? "paused" : ""} ${final && !g.said ? "final" : ""} ${g.said ? "said" : ""}" title="Steering toward: ${esc(g.text)}">
        <span class="g-icon">🎯</span><b>${esc(g.text)}</b><span class="bars" aria-label="step ${index + 1} of ${total}">${bars}</span>
        <span class="g-status">${status}</span>${action}</div>`;
  }

  /** Everything about this chat, in one place. */
  private sheetView() {
    const g = this.goal;
    const goalText = this.fields.goal ?? g?.text ?? "";
    const presets = [
      ...this.presets.map((p) => `<button class="opt ${p.id === this.preset ? "on" : ""}" data-act="preset" data-id="${esc(p.id)}" title="${esc(p.about)}"><span>${esc(p.emoji)}</span>${esc(p.name)}</button>`),
      `<button class="opt ${!this.preset ? "on" : ""}" data-act="preset" data-id=""><span>○</span>None</button>`,
    ].join("");
    const models =
      this.models === null
        ? `<p class="hint">${this.modelsError ? esc(this.modelsError) : "Looking for local models…"}</p>`
        : this.models.length
          ? this.models.map((m) => `<button class="opt ${this.engine === "local" && m.name === this.model ? "on" : ""}" data-act="engine" data-engine="local" data-model="${esc(m.name)}" title="${esc(m.params)}, runs on this laptop"><span>💻</span>${esc(m.name)}</button>`).join("")
          : `<p class="hint">No local models. Run <code>ollama pull llama3.2:3b</code></p>`;
    return `<div class="sheet">
        <section class="s-voice"><h4>Voice</h4><div class="opts">${presets}</div><button class="link" data-act="edit-presets">Edit presets…</button></section>
        <section class="s-goal"><h4>🎯 Steer toward</h4>
          <p class="hint">Charmly gets there slowly, one step per back-and-forth, and only says it on the last step.</p>
          <div class="row"><input data-field="goal" maxlength="160" value="${esc(goalText)}" placeholder="something you want to say or ask, eventually" /></div>
          ${goalText ? "" : `<div class="examples">${EXAMPLES.map((x) => `<button data-act="goal-example" data-text="${esc(x)}">${esc(x)}</button>`).join("")}</div>`}
          <div class="paces" role="radiogroup" aria-label="Pace">${PACES.map((p) => `<button role="radio" aria-checked="${p.pace === this.pace}" class="${p.pace === this.pace ? "on" : ""}" data-act="pace" data-pace="${p.pace}" title="${PLANS[p.pace].map((x) => x.name).join(" → ")}">${p.label} · ${p.pace}</button>`).join("")}</div>
          <div class="row"><button class="primary" data-act="save-goal">${g ? "Restart" : "Start steering"}</button>${g ? '<button class="link" data-act="goal-done">Stop</button>' : ""}</div>
        </section>
        <section class="s-note"><h4>Note for this chat</h4>
          <textarea data-field="note" rows="2" maxlength="400" placeholder="e.g. college friend, roast him freely, Tanglish ok">${esc(this.fields.note ?? this.note)}</textarea>
          <button class="link strong" data-act="save-note">Save note</button>
        </section>
        <section class="s-engine"><h4>Engine</h4><div class="opts">${models}
          <button class="opt ${this.engine === "claude" ? "on" : ""}" data-act="engine" data-engine="claude" ${this.hasKey ? "" : 'disabled title="Add your API key in Charmly\'s popup"'}><span>☁</span>Claude</button>
          <button class="opt ${this.engine === "demo" ? "on" : ""}" data-act="engine" data-engine="demo"><span>✨</span>Demo</button></div>
        </section>
      </div>`;
  }

  private vibeLine(v: Vibe | null, polishing: boolean) {
    if (polishing) return '<span class="vibe"><span class="dot"></span>polishing your draft</span>';
    if (!v) return '<span class="vibe"><span class="dot"></span><span class="shimmer w40"></span></span>';
    return `<span class="vibe ${v.boundary ? "careful" : ""}" title="${v.boundary ? "They may want space, so every option stays gentle" : "How they seem"}"><span class="dot"></span>${esc(v.mood)} · ${esc(v.intent)}${v.language && v.language !== "English" ? ` · ${esc(v.language)}` : ""}${v.boundary ? " · keeping it gentle" : ""}</span>`;
  }

  // ---- render --------------------------------------------------------------------------------------------

  /**
   * While the sheet is open, streamed updates don't re-render it (that would reset what you're typing);
   * the latest suggestions show when it closes. Sheet actions pass `force`.
   */
  private render(force = false) {
    if (this.sheet && !force && this.panel.querySelector(".sheet")) return;
    const s = this.state;
    let body = "";

    if (s.kind === "pill") {
      body = `<div class="bar">${this.brand()}
          <button class="ghost" data-act="suggest">Suggest replies <kbd>${ALT}R</kbd></button>
          ${s.draft ? `<button class="ghost polish" data-act="polish">Polish my draft <kbd>${ALT}P</kbd></button>` : ""}
          ${this.goal ? this.goalChip(this.goal) : ""}
          <span class="spacer"></span>${this.setupChip()}</div>${this.sheet ? this.sheetView() : ""}`;
    } else if (s.kind === "error") {
      body = `<div class="bar">${this.brand()}<span class="spacer"></span><button class="x" data-act="close" aria-label="Close">×</button></div>
        <p class="err">${esc(s.message)}</p>`;
    } else {
      const header = `<div class="bar">${this.brand()}${this.vibeLine(s.vibe, s.polishing)}<span class="spacer"></span>${this.setupChip()}
          <button class="icon" data-act="suggest" aria-label="Regenerate" title="Regenerate (${ALT}R)">↻</button>
          <button class="x" data-act="close" aria-label="Close" title="Hide (Esc)">×</button></div>`;
      if (this.sheet) {
        body = header + this.sheetView();
      } else {
        const goal = this.goal && !s.polishing ? this.goalStrip(this.goal, !!s.vibe?.boundary) : "";
        const cards = s.suggestions
          .map(
            (x, i) => `<button class="card ${this.inserted === i ? "done" : ""} ${i >= this.shown ? "new" : ""}" data-act="insert" data-i="${i}">
              <span class="top"><span class="tag t-${esc(x.tone)}">${esc(x.tone)}</span><kbd>${ALT}${i + 1}</kbd></span>
              <span class="text">${esc(x.text)}</span>
              <span class="why">${this.inserted === i ? "Inserted. Edit it or press Enter to send." : esc(x.why)}</span>
            </button>`,
          )
          .join("");
        const skeletons =
          s.kind === "loading"
            ? Array.from({ length: Math.max(0, 3 - s.suggestions.length) }, () => '<div class="card skeleton"><span class="shimmer w30"></span><span class="shimmer w90"></span><span class="shimmer w60"></span></div>').join("")
            : "";
        const tones = TONES.filter((t) => t.id !== "flirty" || this.flirty)
          .map((t) => `<button data-act="tone" data-tone="${t.id}" class="${t.id === this.tone ? "on" : ""}" title="Lead with ${t.label.toLowerCase()}">${t.emoji} ${t.label}</button>`)
          .join("");
        const held = s.kind === "ready" && s.dropped ? `<span class="held">${s.dropped} held back</span>` : "";
        const polish = this.typing ? `<button class="ghost polish" data-act="polish">✍️ Polish my draft <kbd>${ALT}P</kbd></button>` : "";
        body = `${header}${goal}<div class="cards">${cards}${skeletons}</div>
          <div class="foot"><div class="tones" role="group" aria-label="Lead with">${tones}</div><span class="spacer"></span>${held}${polish}</div>`;
      }
    }
    const keep = ["dark", "enter"].filter((c) => this.panel.classList.contains(c));
    this.panel.className = ["tray", s.kind, this.sheet ? "with-sheet" : "", ...keep].filter(Boolean).join(" ");
    this.panel.innerHTML = body;
    this.shown = s.kind === "loading" || s.kind === "ready" ? s.suggestions.length : 0;
  }
}
