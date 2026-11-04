// The promo: every feature, paced to be read (120 bpm). A list of shots, each so many beats long: kinetic type
// that snaps in, and punch-ins on Charmly's real Tray component showing real captured suggestions.
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
    stagger?: [number, number]; // seconds: when the first card arrives, and the gap to the next
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
    const [first, gap] = t.stagger ?? [0.12, 0.17];
    const at = (k: number) => first + k * gap;
    const shown = take.cards.filter((_, k) => at(k) <= u).length;
    const vibe = u >= 0.05 ? vibeOf(take.vibe) : null;
    tr.set(shown === take.cards.length ? { kind: "ready", vibe, suggestions: asSuggestions(take.cards), dropped: 0, polishing: !!t.polishing } : { kind: "loading", vibe, suggestions: asSuggestions(take.cards.slice(0, shown)), polishing: !!t.polishing });
    if (t.insertAt !== undefined && u >= t.insertAt && shown === take.cards.length) tr.markInserted(take.pick);
    tr.host.shadowRoot!.querySelectorAll<HTMLElement>("button.card").forEach((c, k) => {
      const p = out(clamp((u - at(k)) / (t.stagger ? 0.35 : 0.22)));
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

// Every feature gets the same rhythm: a card that says what it does and why (long enough to read), then the real
// tray doing it, held long enough to take in, with a caption naming it. Quick cuts are kept for accents only.
const SLOW: [number, number] = [0.45, 0.5];
const chips = (...xs: string[]) => `<div class="chips">${xs.map((x) => `<span>${x}</span>`).join("")}</div>`;
const card = (beats: number, title: string, line: string, bg: Bg = "white", extra: Partial<Shot> = {}) => word(beats, `${big(title, "s")}${sub(line)}`, bg, extra);
const roomChat = { name: "Maya", lines: maya.slice(0, AFTER_ROOM) };
const done = () => ({ ...sayNow(newGoal(S.goal, 4)), said: true });

// Hook: the problem.
word(4, `${big("You know what", "m")}${big("you want to say.", "m")}`);
word(5, `${big("Finding the words", "s")}${big("is the hard part.", "s")}${sub("Especially when the message matters.")}`, "white");
// Reveal: the answer.
word(4, `<div class="logo"></div>${big("Charmly")}`, "white", { mark: "reveal", hit: true });
word(5, `${big(`Better replies. In ${grad("your")} voice.`, "s")}${sub("A Chrome extension for WhatsApp Web, and any chat site.")}`, "black");

// 1. It reads the vibe.
card(4, "It reads the vibe.", "Mood, intent and language, from the conversation so far.", "white");
ui(8, { tray: { kind: "ready", take: S.room }, chat: roomChat, cam: [2.3, "tray:.vibe", 2.05, "tray:.vibe"], caption: ["Reads the room", "Mood · intent · language"] });
// 2. Three replies, each with a reason.
card(4, "Then suggests three replies.", "Each in a different tone, each with a line on why.", "black");
ui(10, { tray: { kind: "stream", take: S.room, stagger: SLOW }, chat: roomChat, cam: [1.55, "tray:.cards", 1.75, "tray:.cards"], caption: ["Three replies", "Written for this exact moment"] }, { hit: true });
// 3. Tones.
word(2, big("Warm."), "warm", { mark: "teaserEnd" });
word(2, big("Playful."), "playful");
word(2, big("Direct."), "direct");
word(2, `${big("Flirty.")}${sub("Only if you opt in.")}`, "flirty");
ui(7, { tray: { kind: "ready", take: S.room }, chat: roomChat, cam: [2.6, "tray:.tones", 2.35, "tray:.tones"], caption: ["Your tone", "Switch it in one tap"] });
// 4. Tap to insert; you send.
card(4, "Tap one. It fills your message box.", "Edit it if you like. You press send.", "white");
ui(10, { tray: { kind: "stream", take: S.room, stagger: SLOW, insertAt: 2.6 }, chat: roomChat, cam: [1.6, "tray:.cards", 1.7, { x: 1100, y: 880 }], caption: ["Tap to insert", "Charmly never sends for you"] });
word(6, `${keys("⌥", "1")}${sub("Keyboard first: ⌥1, ⌥2, ⌥3 to insert, ⌥R for new ideas.")}`, "white");

// 5. Polish.
card(4, "Already typed something?", "Polish makes your draft better, and keeps what you meant.", "grad", { hit: true });
const polish = S.extras.takes.polish;
ui(10, { tray: { kind: "stream", take: polish, polishing: true, preset: "friends", stagger: SLOW }, composer: S.extras.polish.draft, chat: { name: "Arun", lines: S.extras.polish.history.map(([d, text]) => ({ dir: d as "in" | "out", text })) }, cam: [1.55, "tray:.cards", 1.75, "tray:.cards"], caption: ["Polish", "Your draft, said better"] });

// 6. Voice presets: who you are in each kind of chat.
word(5, `${big("Your voice, per chat.", "s")}${sub("You don't text your boss like your best friend.")}${chips("😎 Friends", "💼 Work", "🏡 Family", "💫 Dating")}`, "white");
ui(9, { tray: { kind: "pill", sheet: { typed: () => "" } }, cam: [2.1, "tray:.s-voice", 1.9, "tray:.s-voice"], caption: ["Presets", "Pick one for this chat"] });
ui(9, { tray: { kind: "stream", take: S.extras.takes.work, preset: "work", stagger: SLOW }, chat: { name: "Priya (Manager)", lines: S.extras.work.history.map(([d, text]) => ({ dir: d as "in" | "out", text })) }, cam: [1.55, "tray:.cards", 1.75, "tray:.cards"], caption: ["Work preset", "Same chat, office voice"] });
card(4, "Rules it always follows.", "What to always do, what never to do, and words it must never use.", "black");
card(4, "And it learns how you text.", "Length, emoji, lowercase, your “haha”s. Learnt on your laptop.", "white");

// 7. Knows when to back off.
card(4, "It knows when to back off.", "If they seem tired or want space, every option stays gentle.", "black");
ui(9, { tray: { kind: "stream", take: S.extras.takes.space, preset: "friends", stagger: SLOW }, chat: { name: "Sam", lines: S.extras.space.history.map(([d, text]) => ({ dir: d as "in" | "out", text })) }, cam: [2.2, "tray:.vibe", 1.7, "tray:.cards"], caption: ["Reads boundaries", "No pressure. Ever."] });

// 8. Steer: a hush, the drop, then the story, one step at a time.
word(4, `${big("And for the messages", "s")}${big("that matter most…", "s")}`, "black", { mark: "steerIntro" });
word(2, big("Introducing", "m"), "black");
word(4, big(grad("Steer.")), "black", { mark: "steerDrop", hit: true });
card(6, "Say where you want the chat to go.", "Asking someone out. Asking for money back. Charmly gets there one natural step at a time.", "white");
ui(9, { tray: { kind: "pill", sheet: { typed: (u) => S.goal.slice(0, Math.floor(clamp((u - 0.4) / 2.2) * S.goal.length)) } }, chat: { name: "Maya", lines: maya.slice(0, BEFORE_STEP[0]) }, cam: [2.1, "tray:[data-field=goal]", 1.8, "tray:[data-field=goal]"], caption: ["Steer", "Your goal, in your words"] });
word(5, `${big("Pick a pace.", "m")}${chips("Quick · 3", "Natural · 4", "Slow · 5")}`, "white");
const STEP_NAMES = ["Find common ground", "Bridge to the topic", "Test the water", "Say it"];
for (const [i, step] of S.steps.entries()) {
  const goal = i === 3 ? sayNow(newGoal(S.goal, 4)) : steps(i);
  const caption: [string, string] = [`Step ${i + 1} of 4`, STEP_NAMES[i]];
  // The suggestions arrive under the step strip, then the camera settles on the one you pick as it's inserted.
  ui(7, { tray: { kind: "stream", take: step, goal, insertAt: 2.4, stagger: SLOW }, chat: { name: "Maya", lines: maya.slice(0, BEFORE_STEP[i]) }, cam: [1.6, "tray:.goal", 1.85, `tray:button.card:nth-of-type(${step.pick + 1})`], caption }, i === 0 ? { mark: "steerStory" } : {});
  // Then her answer, so every exchange lands.
  const after = maya.slice(0, BEFORE_STEP[i] + 2);
  ui(i === 3 ? 6 : 4, { tray: { kind: "pill", goal: onMessage(onMessage(goal, "me"), "them") }, chat: { name: "Maya", lines: after }, cam: [1.4, "row:#wa .list .row:last-child .bubble", 1.5, "row:#wa .list .row:last-child .bubble"], caption: i === 3 ? ["Said", "Naturally, in four messages."] : caption }, i === 3 ? { hit: true } : {});
}
word(5, `${big(`Not a script. ${grad("A path.")}`, "s")}${sub("No tricks, no pressure. It pauses if they want space.")}`, "black", { mark: "steerEnd" });

// 9. Engines and privacy.
card(4, "Runs on your laptop.", "With a local model, your chats never leave the machine.", "white");
ui(7, { tray: { kind: "ready", take: S.after, goal: done() }, cam: [3.0, "tray:.setup", 2.7, "tray:.setup"], caption: ["On-device", "Private by default"] });
card(4, "Or Claude, when you want the best.", "Your own key. Only the last few messages, with no names.", "black");

// 10. Anywhere.
word(5, `${big("Anywhere you chat.", "s")}${chips("WhatsApp", "Telegram", "Messenger", "Instagram", "LinkedIn", "Slack", "Discord")}`, "grad", { hit: true });
word(5, `${keys("⌥", "⇧", "C")}${sub("On any site: press it in a message box.")}`, "white");
ui(9, { app: "ms", tray: { kind: "stream", take: S.anywhere, preset: "", stagger: SLOW }, cam: [1.55, "tray:.cards", 1.75, "tray:.cards"], caption: ["Any site", "Even one it has never seen"] });

// 11. Out of the way.
card(4, "Out of your way.", "A small dot until you need it. Drag it anywhere.", "black");
ui(7, { tray: { kind: "pill", goal: steps(2) }, chat: { name: "Maya", lines: maya.slice(0, BEFORE_STEP[2]) }, cam: [1.2, { x: 1300, y: 760 }, 1.8, "tray:.dot"], caption: ["Resting", "Just a dot by the message box"] });
ui(8, { tray: { kind: "ready", take: S.after, goal: done(), glass: true, peek: [1.6, 3.0] }, cam: [1.1, { x: 1180, y: 690 }, 1.15, { x: 1180, y: 700 }], caption: ["Clear glass", "Hold ⌥ to peek behind it"] });
ui(6, { dark: true, tray: { kind: "ready", take: S.room }, chat: roomChat, cam: [1.5, "tray:.cards", 1.65, "tray:.cards"], caption: ["Dark mode", "Glass that fits in"] });

// Never sends; outro.
word(4, big("Never sends a thing.", "s"), "white");
word(4, big(grad("You do.")), "black", { hit: true });
word(5, `<div class="logo"></div>${big("Say what you mean.", "s")}`, "white", { mark: "outro" });
word(6, `${big(grad("Charmly"))}${sub("by Balaji Sri Raj")}`, "white");

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

Object.assign(window, { renderAt, DURATION, MARKS: { ...marks, hits, bpm: BPM }, SCENES: { teaser: [0, marks.teaserEnd], steer: [marks.steerIntro, marks.steerEnd + 3 * BEAT] } });
