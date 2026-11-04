// The fast promo: every feature, cut on the beat (120 bpm). A list of shots, each so many beats long: kinetic
// type that snaps in, and punch-ins on Charmly's real Tray component showing real captured suggestions.
// renderAt(t) draws the shot under t, so render.mjs can step through frames deterministically.
import { Tray } from "../src/content/tray";
import { type Goal, newGoal, onMessage, sayNow } from "../src/shared/goal";
import { STARTER_PRESETS, type Suggestion, type Vibe } from "../src/shared/types";

type Card = { tone: string; text: string; why: string };
type Take = { vibe: string; cards: Card[]; pick: number; reply?: string; draft?: string };
type Chat = { name: string; history: [string, string][] };
type Script = {
  model: string;
  goal: string;
  maya: { history: [string, string][]; room: string; next: string; replies: string[] };
  priya: { history: [string, string][] };
  room: Take;
  steps: Take[];
  after: Take;
  anywhere: Take;
  extras: { polish: Chat & { draft: string }; space: Chat; work: Chat; takes: { polish: Take; space: Take; work: Take } };
};
const S = (window as unknown as { SCRIPT: Script }).SCRIPT;
const W = 1920;
const H = 1080;
const BPM = 120;
const BEAT = 60 / BPM;

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const out = (x: number) => 1 - (1 - x) ** 3;
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const vibeOf = (text: string): Vibe => {
  const parts = text.split("·").map((x) => x.trim());
  return { mood: parts[0] || "relaxed", intent: parts[1] || "chatting", language: "English", boundary: /gentle/.test(text) };
};
const asSuggestions = (cards: Card[]): Suggestion[] => cards.map((c, i) => ({ n: i + 1, tone: c.tone, text: c.text, why: c.why }));

// ---- the set ---------------------------------------------------------------------------------------------------
const camera = $("#camera");
const typeLayer = $("#type");
const apps = { wa: $("#wa"), ms: $("#ms") };
$("#cursor").style.display = "none";
$("#card").style.display = "none";
$("#keys").style.display = "none";

const noop = () => {};
const handlers = { chooseEngine: noop, loadModels: noop, choosePreset: noop, saveNote: noop, saveGoal: noop, goalAction: noop, editPresets: noop, suggest: noop, polish: noop, insert: noop, dismiss: noop, moved: noop };
function makeTray(app: HTMLElement) {
  const tray = new Tray(handlers);
  app.appendChild(tray.host);
  const style = document.createElement("style");
  style.textContent = `*, *::before, *::after { animation: none !important; transition: none !important; }
    .tray.firm { --glass: rgba(255, 255, 255, .5); --card: rgba(255, 255, 255, .66); backdrop-filter: blur(8px) saturate(180%) !important; }
    .tray.firm.dark { --glass: rgba(18, 18, 26, .55); --card: rgba(40, 39, 52, .6); }`;
  tray.host.shadowRoot!.appendChild(style);
  Object.assign(tray, { engine: "local", model: S.model, flirty: true, tone: "warm", hasKey: true, presets: STARTER_PRESETS.map((p) => ({ ...p })), models: [{ name: S.model, params: "3.2B" }] });
  return tray;
}
const trays = { wa: makeTray(apps.wa), ms: makeTray(apps.ms) };
const inner = (tray: Tray) => tray as unknown as { sheet: boolean; fields: Record<string, string>; pace: number; panel: HTMLElement };

// The Maya conversation as it builds up, for the shots that show it.
type Line = { dir: "in" | "out"; text: string };
const maya: Line[] = S.maya.history.map(([d, text]) => ({ dir: d as "in" | "out", text }));
maya.push({ dir: "in", text: S.maya.room });
const AFTER_ROOM = maya.length;
maya.push({ dir: "out", text: S.room.cards[S.room.pick].text }, { dir: "in", text: S.maya.next });
const BEFORE_STEP: number[] = [];
for (const step of S.steps) {
  BEFORE_STEP.push(maya.length);
  maya.push({ dir: "out", text: step.cards[step.pick].text }, { dir: "in", text: step.reply ?? "" });
}

// ---- what a UI shot shows ------------------------------------------------------------------------------------
type Point = { x: number; y: number };
type Aim = Point | string; // a point, or "tray:<selector>" / "page:<selector>" / "row:<selector>" (that element's height, the conversation's centre)
type View = {
  app?: "wa" | "ms";
  chat?: { name: string; lines: Line[] };
  composer?: string;
  dark?: boolean;
  tray: {
    kind: "pill" | "ready" | "stream";
    take?: Take;
    inserted?: number;
    polishing?: boolean;
    goal?: Goal | null;
    preset?: string;
    sheet?: { typed: (u: number) => string };
    glass?: boolean; // the tray's real see-through glass, rather than the firmer look under the pointer
    peek?: [number, number]; // seconds into the shot: fade out, back
    insertAt?: number; // seconds into the shot: tap the picked card (it fills the message box)
  };
  caption?: [string, string]; // eyebrow and title, in the pill at the top
  cam: [number, Aim, number, Aim]; // scale and aim at the start, then at the end
};

function local(el: Element | null | undefined): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const c = camera.getBoundingClientRect();
  const s = c.width / W;
  return { x: (r.left + r.width / 2 - c.left) / s, y: (r.top + r.height / 2 - c.top) / s };
}
function aim(app: "wa" | "ms", a: Aim): Point {
  if (typeof a !== "string") return a;
  const [where, sel] = [a.slice(0, a.indexOf(":")), a.slice(a.indexOf(":") + 1)];
  const el = where === "tray" ? trays[app].host.shadowRoot!.querySelector(sel) : document.querySelector(sel);
  const p = local(el) ?? { x: W / 2, y: H / 2 };
  return where === "row" ? { x: (local($(app === "wa" ? "#wa .list" : "#ms .log")) ?? p).x, y: p.y - 40 } : p;
}

let uNow = 0; // seconds into the current shot
function renderChat(app: "wa" | "ms", v: View) {
  if (app === "wa") {
    const chat = v.chat ?? { name: "Maya", lines: maya };
    $("#wa header b").textContent = chat.name;
    document.querySelectorAll("#wa .item").forEach((el) => el.classList.toggle("on", el.querySelector("b")?.textContent === chat.name));
    const html = chat.lines.map((m) => `<div class="row ${m.dir}"><div class="bubble"><span>${esc(m.text)}</span><span class="meta">9:1${m.text.length % 10} pm${m.dir === "out" ? ' <i class="ticks">✓✓</i>' : ""}</span></div></div>`).join("");
    const list = $("#wa .list");
    if (list.dataset.sig !== html) {
      list.dataset.sig = html;
      list.innerHTML = html;
    }
    $("#wa .box").textContent = v.composer ?? "";
    if (v.tray.insertAt !== undefined && v.tray.take) $("#wa .box").textContent = uNow >= v.tray.insertAt ? v.tray.take.cards[v.tray.take.pick].text : "";
    $("#wa .typing").textContent = "online";
    apps.wa.classList.toggle("dark", !!v.dark);
  } else {
    const list = $("#ms .log");
    const html = S.priya.history.map(([d, text]) => `<div class="row ${d}"><div class="bubble">${esc(text)}</div></div>`).join("");
    if (list.dataset.sig !== html) {
      list.dataset.sig = html;
      list.innerHTML = html;
    }
    $("#ms [contenteditable]").textContent = v.composer ?? "";
  }
}

function renderTray(app: "wa" | "ms", v: View, u: number) {
  const tr = trays[app];
  const t = v.tray;
  const i = inner(tr);
  tr.preset = t.preset ?? (app === "wa" ? "dating" : "");
  tr.goal = t.goal ?? null;
  tr.read = null;
  i.sheet = false;
  const take = t.take;
  if (t.kind === "stream" && take) {
    const at = (k: number) => 0.12 + k * 0.17;
    const shown = take.cards.filter((_, k) => at(k) <= u).length;
    const vibe = u >= 0.05 ? vibeOf(take.vibe) : null;
    tr.set(shown === take.cards.length ? { kind: "ready", vibe, suggestions: asSuggestions(take.cards), dropped: 0, polishing: !!t.polishing } : { kind: "loading", vibe, suggestions: asSuggestions(take.cards.slice(0, shown)), polishing: !!t.polishing });
    if (t.insertAt !== undefined && u >= t.insertAt && shown === take.cards.length) tr.markInserted(take.pick);
    tr.host.shadowRoot!.querySelectorAll<HTMLElement>("button.card").forEach((c, k) => {
      const p = out(clamp((u - at(k)) / 0.22));
      c.style.opacity = String(p);
      c.style.transform = `translateY(${(1 - p) * 16}px) scale(${0.96 + 0.04 * p})`;
    });
  } else if (t.kind === "ready" && take) {
    tr.set({ kind: "ready", vibe: vibeOf(take.vibe), suggestions: asSuggestions(take.cards), dropped: 0, polishing: !!t.polishing });
    if (t.inserted !== undefined) tr.markInserted(t.inserted);
  } else {
    tr.set({ kind: "pill", draft: false });
  }
  if (t.sheet) {
    i.sheet = true;
    i.fields = { goal: t.sheet.typed(u) };
    i.pace = 4;
    tr.refresh();
  }
  const anchor = $(app === "wa" ? "#wa footer" : "#ms form");
  let x = 0;
  let y = 0;
  for (let e: HTMLElement | null = anchor; e && e !== camera; e = e.offsetParent as HTMLElement | null) {
    x += e.offsetLeft;
    y += e.offsetTop;
  }
  // Docked like the product: at the right end of the message box; the resting dot breathes.
  const open = t.kind !== "pill" || !!t.sheet;
  Object.assign(i.panel.style, { left: "", right: `${W - (x + anchor.offsetWidth) + 12}px`, width: open ? `${Math.min(anchor.offsetWidth - 24, 820)}px` : "", bottom: `${H - y + 12}px`, top: "", transform: "" });
  const dot = tr.host.shadowRoot!.querySelector<HTMLElement>(".dot");
  if (dot) dot.style.transform = `scale(${1 + 0.07 * (0.5 - 0.5 * Math.cos((u / 2.8) * 2 * Math.PI))})`;
  i.panel.classList.toggle("dark", !!v.dark);
  i.panel.classList.toggle("firm", !t.glass);
  let alpha = 1;
  if (t.peek) alpha = 1 - 0.94 * clamp((u - t.peek[0]) / 0.25) * (1 - clamp((u - t.peek[1]) / 0.25));
  i.panel.style.opacity = String(alpha);
}

// ---- shots -----------------------------------------------------------------------------------------------------
type Bg = "black" | "white" | "grad" | "warm" | "playful" | "direct" | "flirty";
const BG: Record<Bg, [string, string]> = {
  black: ["#000", "#f5f5f7"],
  white: ["#fbfbfd", "#1d1d1f"],
  grad: ["linear-gradient(120deg, #ff8a65 0%, #ff5fa2 48%, #8b5cf6 100%)", "#fff"],
  warm: ["#ff7a50", "#fff"],
  playful: ["#7c4dff", "#fff"],
  direct: ["#0a84ff", "#fff"],
  flirty: ["#ff3d8b", "#fff"],
};
type Shot = { beats: number; type?: { html: string; bg: Bg }; view?: View; mark?: string; hit?: boolean };
const shots: Shot[] = [];
const word = (beats: number, html: string, bg: Bg = "black", extra: Partial<Shot> = {}) => shots.push({ beats, type: { html, bg }, ...extra });
const big = (text: string, cls = "") => `<div class="w ${cls}">${text}</div>`;
const sub = (text: string) => `<div class="sub">${text}</div>`;
const grad = (text: string) => `<span class="grad">${text}</span>`;
const keys = (...k: string[]) => `<div>${k.map((x) => `<span class="kc">${x}</span>`).join("")}</div>`;
const ui = (beats: number, view: View, extra: Partial<Shot> = {}) => shots.push({ beats, view, ...extra });
const steps = (n: number) => {
  let g = newGoal(S.goal, 4);
  for (let i = 0; i < n; i++) g = onMessage(onMessage(g, "me"), "them");
  return g;
};

// Hook.
word(1, big("You know", "m"));
word(1, big("what you want", "m"));
word(2, big("to say.", "m"));
word(1.5, big("Finding the words", "s"), "white");
word(2.5, big("is the hard part.", "s"), "white");
// Reveal.
word(4, `<div class="logo"></div>${big("Charmly")}`, "white", { mark: "reveal", hit: true });
word(1.5, big("Better replies.", "m"), "black");
word(2.5, big(`In ${grad("your")} voice.`, "m"), "black");
// It reads the vibe; three replies.
word(1, big("It reads", "m"), "white");
word(1, big(grad("the vibe."), "m"), "white");
ui(2, { tray: { kind: "ready", take: S.room }, chat: { name: "Maya", lines: maya.slice(0, AFTER_ROOM) }, cam: [2.7, "tray:.vibe", 2.35, "tray:.vibe"] });
word(1, big("Three replies.", "m"), "black");
ui(3, { tray: { kind: "stream", take: S.room }, chat: { name: "Maya", lines: maya.slice(0, AFTER_ROOM) }, cam: [1.3, "tray:.cards", 1.18, "tray:.cards"] });
// Tones.
word(1, big("Warm."), "warm");
word(1, big("Playful."), "playful");
word(1, big("Direct."), "direct");
word(1, big("Flirty."), "flirty");
ui(1.5, { tray: { kind: "ready", take: S.room }, chat: { name: "Maya", lines: maya.slice(0, AFTER_ROOM) }, cam: [3.1, "tray:.tones", 2.7, "tray:.tones"] });
// Tap to insert; keys.
word(1, big("Tap."), "black");
ui(2, { tray: { kind: "ready", take: S.room, inserted: S.room.pick }, composer: S.room.cards[S.room.pick].text, chat: { name: "Maya", lines: maya.slice(0, AFTER_ROOM) }, cam: [1.35, { x: 1100, y: 900 }, 1.55, { x: 1050, y: 920 }] });
word(2, big("You press send.", "m"), "white");
for (const k of ["1", "2", "3", "R"]) word(0.5, keys("⌥", k), "white");
// Polish.
word(2, big("Polish my draft.", "s"), "grad", { hit: true });
const polish = S.extras.takes.polish;
ui(3, { tray: { kind: "stream", take: polish, polishing: true, preset: "friends" }, composer: S.extras.polish.draft, chat: { name: "Arun", lines: S.extras.polish.history.map(([d, text]) => ({ dir: d as "in" | "out", text })) }, cam: [1.3, "tray:.cards", 1.18, "tray:.cards"] });
// Voice presets, rules, notes, style.
word(1, big("Your voice.", "m"), "white");
ui(2, { tray: { kind: "pill", sheet: { typed: () => "" } }, cam: [2.4, "tray:.s-voice", 2.1, "tray:.s-voice"] });
word(0.5, big("Friends."), "black");
word(0.5, big("Work."), "white");
word(0.5, big("Family."), "black");
word(0.5, big("Dating."), "white");
ui(2.5, { tray: { kind: "stream", take: S.extras.takes.work, preset: "work" }, chat: { name: "Priya (Manager)", lines: S.extras.work.history.map(([d, text]) => ({ dir: d as "in" | "out", text })) }, cam: [1.3, "tray:.cards", 1.18, "tray:.cards"] });
word(1, big("Always."), "black");
word(1, big("Never."), "white");
word(2, big(`Words it ${grad("never")} uses.`, "s"), "black");
word(2, big("A note for every chat.", "s"), "white");
word(2, big("Learns how you text.", "s"), "black");
word(0.5, big("lowercase.", "m"), "white");
word(0.5, big("😂", "m"), "white");
word(1, big("short & sweet.", "m"), "white");
// Space.
word(2, big("Knows when to back off.", "s"), "black");
ui(2.5, { tray: { kind: "stream", take: S.extras.takes.space, preset: "friends" }, chat: { name: "Sam", lines: S.extras.space.history.map(([d, text]) => ({ dir: d as "in" | "out", text })) }, cam: [2.2, "tray:.vibe", 1.2, "tray:.cards"] });
word(2, big("No pressure. Ever.", "s"), "white");
// Steer: a hush, the drop, then a slower story section so each step registers.
word(1.5, big("And for the messages", "s"), "black", { mark: "steerIntro" });
word(2.5, big("that matter most…", "s"), "black");
word(1.5, big("Introducing", "m"), "black");
word(2.5, big(grad("Steer.")), "black", { mark: "steerDrop", hit: true });
word(3, `${big("Say where you want the chat to go.", "s")}${sub("Charmly gets there slowly, one natural step at a time.")}`, "white");
ui(4, { tray: { kind: "pill", sheet: { typed: (u) => S.goal.slice(0, Math.floor(clamp((u - 0.3) / 1.3) * S.goal.length)) } }, chat: { name: "Maya", lines: maya.slice(0, BEFORE_STEP[0]) }, cam: [2.2, "tray:[data-field=goal]", 1.85, "tray:[data-field=goal]"], caption: ["Steer", "Your goal, in your words"] });
word(0.5, big("Quick."), "white");
word(0.5, big("Natural."), "black");
word(1, big("Slow."), "white");
const STEP_NAMES = ["Find common ground", "Bridge to the topic", "Test the water", "Say it"];
for (const [i, step] of S.steps.entries()) {
  const goal = i === 3 ? sayNow(newGoal(S.goal, 4)) : steps(i);
  const caption: [string, string] = [`Step ${i + 1} of 4`, STEP_NAMES[i]];
  // The suggestions arrive under the step strip, then the camera settles on the one you pick as it's inserted.
  ui(4, { tray: { kind: "stream", take: step, goal, insertAt: 1.15 }, chat: { name: "Maya", lines: maya.slice(0, BEFORE_STEP[i]) }, cam: [1.3, "tray:.goal", 1.55, `tray:button.card:nth-of-type(${step.pick + 1})`], caption }, i === 0 ? { mark: "steerStory" } : {});
  // Then her answer, so every exchange lands.
  const after = maya.slice(0, BEFORE_STEP[i] + 2);
  ui(i === 3 ? 4 : 2.5, { tray: { kind: "pill", goal: onMessage(onMessage(goal, "me"), "them") }, chat: { name: "Maya", lines: after }, cam: [1.42, "row:#wa .list .row:last-child .bubble", 1.6, "row:#wa .list .row:last-child .bubble"], caption: i === 3 ? ["Said", "Naturally, in four messages."] : caption }, i === 3 ? { hit: true } : {});
}
word(1.5, big("Not a script.", "m"), "black", { mark: "steerEnd" });
word(1.5, big(grad("A path."), "m"), "black");
// Engines.
word(1.5, big("On your laptop.", "m"), "white");
ui(1.5, { tray: { kind: "ready", take: S.after, goal: { ...sayNow(newGoal(S.goal, 4)), said: true } }, cam: [3.4, "tray:.setup", 3.0, "tray:.setup"] });
word(1, big("Private."), "black");
word(1, big("Or Claude,", "m"), "white");
word(2, big("when you want the best.", "s"), "white");
// Anywhere.
word(2, big("Anywhere."), "grad", { hit: true });
for (const [i, name] of ["WhatsApp", "Telegram", "Messenger", "Instagram", "LinkedIn", "Slack", "Discord"].entries()) word(0.5, big(name, "m"), i % 2 ? "white" : "black");
word(1, big("Any site.", "m"), "grad");
word(2, keys("⌥", "⇧", "C"), "white");
ui(2.5, { app: "ms", tray: { kind: "stream", take: S.anywhere, preset: "" }, cam: [1.3, "tray:.cards", 1.18, "tray:.cards"] });
word(2, big("Reply to anything you select.", "s"), "black");
// Glass, peek, light and dark.
word(1.5, big("Out of your way.", "m"), "black");
ui(2.5, { tray: { kind: "pill", goal: steps(2) }, chat: { name: "Maya", lines: maya.slice(0, BEFORE_STEP[2]) }, cam: [1.25, { x: 1300, y: 760 }, 1.9, "tray:.dot"] });
word(1.5, big("Drag it anywhere.", "m"), "white");
word(1, big("Clear glass.", "m"), "white");
ui(2, { tray: { kind: "ready", take: S.after, goal: { ...sayNow(newGoal(S.goal, 4)), said: true }, glass: true }, cam: [1.05, { x: 1180, y: 640 }, 1.2, { x: 1180, y: 700 }] });
word(1.5, big("Hold ⌥ to peek.", "m"), "black");
ui(2, { tray: { kind: "ready", take: S.after, goal: { ...sayNow(newGoal(S.goal, 4)), said: true }, glass: true, peek: [0.25, 0.8] }, cam: [1.15, { x: 1180, y: 700 }, 1.15, { x: 1180, y: 700 }] });
word(1, big("Light."), "white");
ui(1, { tray: { kind: "ready", take: S.room }, chat: { name: "Maya", lines: maya.slice(0, AFTER_ROOM) }, cam: [1.3, "tray:.cards", 1.18, "tray:.cards"] });
word(1, big("Dark."), "black");
ui(1, { dark: true, tray: { kind: "ready", take: S.room }, chat: { name: "Maya", lines: maya.slice(0, AFTER_ROOM) }, cam: [1.3, "tray:.cards", 1.18, "tray:.cards"] });
// Never sends; outro.
word(2, big("Never sends a thing.", "s"), "white");
word(2, big(grad("You do.")), "black", { hit: true });
word(4, `<div class="logo"></div>${big("Say what you mean.", "s")}`, "white", { mark: "outro" });
word(4, `${big(grad("Charmly"))}${sub("by Balaji Sri Raj")}`, "white");

// ---- timing and rendering -----------------------------------------------------------------------------------
const starts: number[] = [];
let total = 0;
for (const s of shots) {
  starts.push(total);
  total += s.beats * BEAT;
}
const DURATION = total + 0.6;
const marks: Record<string, number> = {};
const hits: number[] = [];
shots.forEach((s, i) => {
  if (s.mark) marks[s.mark] = starts[i];
  if (s.hit) hits.push(starts[i]);
});

const captionEl = $("#caption");
function renderCaption(c: [string, string] | undefined, u: number) {
  if (!c) {
    captionEl.style.opacity = "0";
    return;
  }
  const sig = c.join("|");
  if (captionEl.dataset.sig !== sig) {
    captionEl.dataset.sig = sig;
    captionEl.dataset.since = String(uNow);
    captionEl.innerHTML = `<div class="eyebrow">${c[0]}</div><div class="title">${c[1]}</div>`;
  }
  // A caption carried across shots stays put; a new one rises in.
  const p = captionEl.dataset.fresh === "1" ? out(clamp(u / 0.3)) : 1;
  captionEl.style.opacity = String(p);
  captionEl.style.transform = `translate(-50%, ${(1 - p) * -14}px)`;
}

function renderType(s: Shot, u: number, dur: number) {
  renderCaption(undefined, u);
  const { html, bg } = s.type!;
  typeLayer.style.display = "grid";
  camera.style.display = "none";
  if (typeLayer.dataset.sig !== html + bg) {
    typeLayer.dataset.sig = html + bg;
    typeLayer.innerHTML = html;
  }
  const [background, color] = BG[bg];
  typeLayer.style.background = background;
  typeLayer.style.color = color;
  // Snap in, then a slow push: the beat is the cut, the push keeps it alive.
  const snap = out(clamp(u / 0.16));
  const push = u / dur;
  const scale = 1.1 - 0.1 * snap + 0.035 * push;
  typeLayer.querySelectorAll<HTMLElement>(":scope > *").forEach((el, k) => {
    const delay = k * 0.07;
    // On the beat the type is already there (no blank frame), then it settles in.
    const p = 0.45 + 0.55 * out(clamp((u - delay) / 0.14));
    el.style.opacity = String(p);
    el.style.transform = `scale(${scale}) translateY(${(1 - p) * 20}px)`;
  });
  // Grad text on a grad background would vanish: use plain white there.
  typeLayer.querySelectorAll<HTMLElement>(".grad").forEach((el) => (el.style.webkitTextFillColor = bg === "grad" ? "#fff" : ""));
}

function renderView(s: Shot, u: number, dur: number) {
  const v = s.view!;
  const app = v.app ?? "wa";
  typeLayer.style.display = "none";
  camera.style.display = "";
  apps.wa.style.display = app === "wa" ? "" : "none";
  apps.ms.style.display = app === "ms" ? "" : "none";
  uNow = u;
  renderChat(app, v);
  renderTray(app, v, u);
  renderCaption(v.caption, u);
  // A punch-in: start close, ease out; aim points come from the laid-out set (before the camera transform).
  camera.style.transform = "none";
  const [s0, a0, s1, a1] = v.cam;
  const p0 = aim(app, a0);
  const p1 = aim(app, a1);
  const p = inOut(clamp(u / dur));
  const sc = s0 + (s1 - s0) * p;
  const cx = Math.min(Math.max(p0.x + (p1.x - p0.x) * p, W / (2 * sc)), W - W / (2 * sc));
  const cy = Math.min(Math.max(p0.y + (p1.y - p0.y) * p, H / (2 * sc)), H - H / (2 * sc));
  camera.style.transform = `translate(${W / 2 - cx * sc}px, ${H / 2 - cy * sc}px) scale(${sc})`;
}

function renderAt(t: number) {
  let i = starts.length - 1;
  while (i > 0 && starts[i] > t) i--;
  const s = shots[i];
  const u = t - starts[i];
  const prev = shots[i - 1]?.view?.caption?.join("|");
  captionEl.dataset.fresh = s.view?.caption && s.view.caption.join("|") !== prev ? "1" : "0";
  const dur = s.beats * BEAT;
  if (s.type) renderType(s, u, dur);
  else renderView(s, u, dur);
  // The very end fades to white.
  document.body.style.opacity = String(1 - clamp((t - total) / 0.5));
}

Object.assign(window, { renderAt, DURATION, MARKS: { ...marks, hits, bpm: BPM }, SCENES: { teaser: [0, marks.steerIntro], steer: [marks.steerIntro, marks.steerEnd + 3 * BEAT] } });
