// The suggestion tray: a small glass panel docked above WhatsApp's message box, rendered in a shadow root.
import { type Engine, type Preset, TONES, type Suggestion, type Tone, type Vibe } from "../shared/types";
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
  editPresets: () => void;
  suggest: (tone: Tone) => void;
  polish: () => void;
  insert: (text: string, index: number) => void;
  dismiss: () => void;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const isMac = /Mac/.test(navigator.platform);
const ALT = isMac ? "⌥" : "Alt+";

export class Tray {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private state: State = { kind: "pill", draft: false };
  private inserted: number | null = null;
  private panel!: HTMLElement;
  private shown = 0; // cards already on screen, so only new ones animate in
  tone: Tone = "warm";
  flirty = false;
  engine: Engine = "demo";
  model = ""; // the local model in use
  hasKey = false;
  models: { name: string; params: string }[] | null = null; // installed local models, once loaded
  modelsError = "";
  private engineMenu = false;
  presets: Preset[] = [];
  preset = ""; // the preset this chat uses ("" = none)
  note = ""; // this chat's note
  private menu = false;
  private editingNote = false;

  constructor(private readonly h: TrayHandlers) {
    this.host = document.createElement("charmly-tray");
    this.host.style.cssText = "position:fixed;z-index:2147483000;left:0;bottom:0;width:0;height:0;";
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${css}</style><div class="tray pill" role="region" aria-label="Charmly reply suggestions"></div>`;
    this.panel = this.root.querySelector(".tray")!;
    document.documentElement.appendChild(this.host);
    this.root.addEventListener("click", (e) => this.click(e as MouseEvent));
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
    this.render();
  }

  markInserted(i: number) {
    this.inserted = i;
    this.render();
  }

  private click(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const act = target.dataset.act!;
    if (act === "menu") {
      this.menu = !this.menu;
      this.engineMenu = false;
      this.editingNote = false;
      return this.render();
    }
    if (act === "engine-menu") {
      this.engineMenu = !this.engineMenu;
      this.menu = false;
      this.editingNote = false;
      if (this.engineMenu) this.h.loadModels();
      return this.render();
    }
    if (act === "engine") {
      this.engineMenu = false;
      const engine = target.dataset.engine as Engine;
      this.engine = engine;
      if (target.dataset.model) this.model = target.dataset.model;
      this.h.chooseEngine(engine, target.dataset.model);
      return this.render();
    }
    if (act === "preset") {
      this.menu = false;
      this.preset = target.dataset.id ?? "";
      this.h.choosePreset(this.preset);
      return this.render();
    }
    if (act === "edit-presets") {
      this.menu = false;
      this.render();
      return this.h.editPresets();
    }
    if (act === "note") {
      this.editingNote = !this.editingNote;
      this.menu = false;
      this.render();
      if (this.editingNote) this.root.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      return;
    }
    if (act === "save-note") {
      this.note = this.root.querySelector<HTMLTextAreaElement>("textarea")?.value.trim() ?? "";
      this.editingNote = false;
      this.h.saveNote(this.note);
      return this.render();
    }
    if (act === "suggest") this.h.suggest(this.tone);
    else if (act === "polish") this.h.polish();
    else if (act === "close") this.h.dismiss();
    else if (act === "tone") {
      this.tone = target.dataset.tone as Tone;
      this.h.suggest(this.tone);
    } else if (act === "insert") {
      const i = Number(target.dataset.i);
      const s = this.suggestions[i];
      if (s) this.h.insert(s.text, i);
    }
  }

  private render() {
    const s = this.state;
    const tones = TONES.filter((t) => t.id !== "flirty" || this.flirty);
    const toneBar = `<div class="tones" role="group" aria-label="Tone">${tones
      .map((t) => `<button data-act="tone" data-tone="${t.id}" class="${t.id === this.tone ? "on" : ""}">${t.emoji} ${t.label}</button>`)
      .join("")}</div>`;
    const engineLabel = this.engine === "local" ? `💻 ${this.model || "pick a model"}` : this.engine === "claude" ? "☁ Claude" : "Demo";
    const models = this.models === null
      ? `<p class="menu-note">${this.modelsError ? esc(this.modelsError) : "Looking for local models…"}</p>`
      : this.models.length
        ? this.models.map((m) => `<button role="menuitemradio" aria-checked="${this.engine === "local" && m.name === this.model}" data-act="engine" data-engine="local" data-model="${esc(m.name)}" class="${this.engine === "local" && m.name === this.model ? "on" : ""}"><span>💻</span>${esc(m.name)}<em>${esc(m.params)} · runs on this laptop</em></button>`).join("")
        : `<p class="menu-note">No local models yet. Run <code>ollama pull llama3.2:3b</code></p>`;
    const engineMenu = this.engineMenu
      ? `<div class="menu engine-menu" role="menu">
          <p class="menu-head">On-device · private</p>${models}
          <p class="menu-head">Cloud</p>
          <button role="menuitemradio" aria-checked="${this.engine === "claude"}" data-act="engine" data-engine="claude" class="${this.engine === "claude" ? "on" : ""}" ${this.hasKey ? "" : "disabled"}><span>☁</span>Claude<em>${this.hasKey ? "best quality, uses your API key" : "add your API key in Charmly's popup"}</em></button>
          <button role="menuitemradio" aria-checked="${this.engine === "demo"}" data-act="engine" data-engine="demo" class="${this.engine === "demo" ? "on" : ""}"><span>✨</span>Demo<em>sample suggestions</em></button>
        </div>`
      : "";
    const brand = `<span class="mark" aria-hidden="true"></span><b>Charmly</b><span class="persona"><button class="engine-chip ${this.engine}" data-act="engine-menu" aria-haspopup="menu" aria-expanded="${this.engineMenu}" title="Switch between on-device and Claude">${esc(engineLabel)} ▾</button>${engineMenu}</span>`;
    const current = this.presets.find((p) => p.id === this.preset);
    const persona = `<span class="persona">
        <button class="preset-chip ${current ? "set" : ""}" data-act="menu" aria-haspopup="menu" aria-expanded="${this.menu}" title="Voice preset for this chat">${current ? `${esc(current.emoji)} ${esc(current.name)}` : "Voice: none"} ▾</button>
        <button class="icon note-btn ${this.note ? "has" : ""}" data-act="note" title="${this.note ? "Edit this chat's note" : "Add a note for this chat"}" aria-label="Chat note">✎</button>
        ${this.menu ? `<div class="menu" role="menu">
          ${this.presets.map((p) => `<button role="menuitemradio" aria-checked="${p.id === this.preset}" data-act="preset" data-id="${esc(p.id)}" class="${p.id === this.preset ? "on" : ""}"><span>${esc(p.emoji)}</span>${esc(p.name)}<em>${esc(p.about.slice(0, 48))}${p.about.length > 48 ? "…" : ""}</em></button>`).join("")}
          <button role="menuitemradio" aria-checked="${!this.preset}" data-act="preset" data-id="" class="${!this.preset ? "on" : ""}"><span>○</span>No preset<em>just your learnt style</em></button>
          <button class="edit" data-act="edit-presets">Edit presets…</button>
        </div>` : ""}
      </span>`;
    const noteEditor = this.editingNote
      ? `<div class="note-edit"><textarea rows="2" maxlength="400" placeholder="A note for this chat, e.g. 'college friend, roast him freely, Tanglish ok' or 'my manager: keep it formal'">${esc(this.note)}</textarea><button class="ghost polish" data-act="save-note">Save note</button></div>`
      : "";
    let body = "";

    if (s.kind === "pill") {
      body = `<div class="pill">${brand}${persona}
        <button class="ghost" data-act="suggest">Suggest replies <kbd>${ALT}R</kbd></button>
        ${s.draft ? `<button class="ghost polish" data-act="polish">Polish my draft <kbd>${ALT}P</kbd></button>` : ""}</div>${noteEditor}`;
    } else if (s.kind === "error") {
      body = `<header>${brand}<span class="spacer"></span><button class="x" data-act="close" aria-label="Close">×</button></header>
        <p class="err">${esc(s.message)}</p>`;
    } else {
      const v = s.vibe;
      const vibe = v
        ? `<div class="vibe ${v.boundary ? "careful" : ""}"><span class="dot"></span>${esc(v.mood)} · ${esc(v.intent)} · ${esc(v.language)}${v.boundary ? '<em>they may want space, keeping it gentle</em>' : ""}</div>`
        : `<div class="vibe loading"><span class="dot"></span><span class="shimmer w40"></span></div>`;
      const cards = s.suggestions
        .map(
          (x, i) => `<button class="card ${this.inserted === i ? "done" : ""} ${i >= this.shown ? "new" : ""}" data-act="insert" data-i="${i}">
            <span class="top"><span class="tag t-${esc(x.tone)}">${esc(x.tone)}</span><kbd>${ALT}${i + 1}</kbd></span>
            <span class="text">${esc(x.text)}</span>
            <span class="why">${this.inserted === i ? "Inserted. Edit it or press Enter to send." : esc(x.why)}</span>
          </button>`,
        )
        .join("");
      const skeletons = s.kind === "loading" ? Array.from({ length: Math.max(0, 3 - s.suggestions.length) }, () => '<div class="card skeleton"><span class="shimmer w30"></span><span class="shimmer w90"></span><span class="shimmer w60"></span></div>').join("") : "";
      const foot = s.kind === "ready" && s.dropped ? `<p class="note">${s.dropped} option${s.dropped === 1 ? "" : "s"} held back by the kindness filter.</p>` : "";
      body = `<header>${brand}${persona}${s.polishing ? '<span class="sub">polishing your draft</span>' : ""}<span class="spacer"></span>${toneBar}
          <button class="icon" data-act="suggest" aria-label="Regenerate" title="Regenerate (${ALT}R)">↻</button>
          <button class="x" data-act="close" aria-label="Close" title="Hide (Esc)">×</button></header>
        ${noteEditor}${vibe}<div class="cards">${cards}${skeletons}</div>${foot}`;
    }
    const keep = ["dark", "enter"].filter((c) => this.panel.classList.contains(c));
    this.panel.className = ["tray", s.kind, ...keep].join(" ");
    this.panel.innerHTML = body;
    this.shown = s.kind === "loading" || s.kind === "ready" ? s.suggestions.length : 0;
  }
}
