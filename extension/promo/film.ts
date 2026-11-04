// Pass 2 of the promo: the film, as code. A timeline of beats (messages, the tray's states, camera moves, a
// cursor, captions and title cards) and renderAt(t), which sets the page to exactly what frame t should show.
// render.mjs calls renderAt for every frame and encodes the screenshots, so motion is deterministic and every
// frame is sharp at any zoom.
//
// The tray in the film is Charmly's real Tray component, fed the suggestions captured from the real model.
import { Tray } from "../src/content/tray";
import { type Goal, newGoal, onMessage } from "../src/shared/goal";
import { STARTER_PRESETS, type Suggestion, type Vibe } from "../src/shared/types";

type Card = { tone: string; text: string; why: string };
type Take = { vibe: string; cards: Card[]; pick: number; reply?: string };
type Script = {
  model: string;
  goal: string;
  maya: { history: [string, string][]; room: string; next: string; replies: string[] };
  priya: { history: [string, string][] };
  room: Take;
  steps: Take[];
  after: Take;
  anywhere: Take;
};
const S = (window as unknown as { SCRIPT: Script }).SCRIPT;
const W = 1920;
const H = 1080;

// ---- easing and helpers -------------------------------------------------------------------------------------
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const out = (x: number) => 1 - (1 - x) ** 3;
const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const vibeOf = (text: string): Vibe => {
  const [mood = "relaxed", intent = "chatting"] = text.split("·").map((x) => x.trim());
  return { mood, intent, language: "English", boundary: /gentle/.test(text) };
};
const asSuggestions = (cards: Card[]): Suggestion[] => cards.map((c, i) => ({ n: i + 1, tone: c.tone, text: c.text, why: c.why }));

// ---- the set: a WhatsApp-style app and a Messenger-style app, inside a camera ------------------------------
const camera = $("#camera");
const apps = { wa: $("#wa"), ms: $("#ms") };
const overlay = $("#overlay");

type Msg = { t: number; dir: "in" | "out"; text: string; time: string };
const wa = { msgs: [] as Msg[], composer: [] as { t0: number; t1: number; text: string }[], typing: [] as [number, number][] };
const ms = { msgs: [] as Msg[], composer: [] as { t0: number; t1: number; text: string }[] };
let clock = 21 * 60 + 2;
const stamp = () => {
  clock += 1;
  const h = Math.floor(clock / 60) % 12 || 12;
  return `${h}:${String(clock % 60).padStart(2, "0")} pm`;
};
S.maya.history.forEach(([dir, text]) => wa.msgs.push({ t: -1, dir: dir as "in" | "out", text, time: stamp() }));
S.priya.history.forEach(([dir, text]) => ms.msgs.push({ t: -1, dir: dir as "in" | "out", text, time: stamp() }));

// ---- the trays: Charmly's real component, one per app -------------------------------------------------------
const noop = () => {};
const handlers = { chooseEngine: noop, loadModels: noop, choosePreset: noop, saveNote: noop, saveGoal: noop, goalAction: noop, editPresets: noop, suggest: noop, polish: noop, insert: noop, dismiss: noop, moved: noop };
function makeTray(app: HTMLElement) {
  const tray = new Tray(handlers);
  app.appendChild(tray.host);
  // The film drives every frame itself, so the tray's own CSS animations are switched off.
  const still = document.createElement("style");
  // The film shows the tray as it looks under your pointer (its hover glass), which reads cleanly on video.
  still.textContent = `*, *::before, *::after { animation: none !important; transition: none !important; }
    .tray { --glass: rgba(255, 255, 255, .5); --card: rgba(255, 255, 255, .66); backdrop-filter: blur(8px) saturate(180%) !important; }`;
  tray.host.shadowRoot!.appendChild(still);
  Object.assign(tray, { engine: "local", model: S.model, flirty: true, tone: "warm", hasKey: true, presets: STARTER_PRESETS.map((p) => ({ ...p })), models: [{ name: S.model, params: "3.2B" }] });
  return tray;
}
const trays = { wa: makeTray(apps.wa), ms: makeTray(apps.ms) };
const internals = (tray: Tray) => tray as unknown as { sheet: boolean; fields: Record<string, string>; pace: number; panel: HTMLElement };

type TrayKey = {
  t: number;
  mode: "pill" | "stream" | "sheet";
  take?: Take;
  goal?: Goal | null;
  preset?: string;
  inserted?: number;
  typed?: string; // the goal being typed in the sheet
  draft?: boolean;
  peek?: [number, number];
  complete?: boolean; // already streamed in: show it whole
};
const trayKeys: Record<"wa" | "ms", TrayKey[]> = { wa: [], ms: [] };
const CARD_AT = (i: number) => 0.85 + i * 0.5;

// ---- overlay: captions, title cards, key caps ----------------------------------------------------------------
type Line = { html: string; sub?: boolean; at?: number };
const titleCards: { t0: number; t1: number; dark: boolean; lines: Line[] }[] = [];
const captions: { t0: number; t1: number; eyebrow: string; title: string }[] = [];
const keyCaps: { t0: number; t1: number; keys: string[]; press: number }[] = [];
const showApp: { t: number; app: "wa" | "ms" }[] = [{ t: 0, app: "wa" }];

// ---- camera and cursor ----------------------------------------------------------------------------------------
type Point = { x: number; y: number };
type Target = Point | (() => Point | null);
const camMoves: { t0: number; dur: number; s: number; to: Target; at?: Point }[] = [];
const cursorMoves: { t0: number; dur: number; to: Target; at?: Point }[] = [];
const clicks: number[] = [];

/** Where an element sits in the camera's own coordinates (before zoom). */
function local(el: Element | null | undefined): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const c = camera.getBoundingClientRect();
  const s = c.width / W;
  return { x: (r.left + r.width / 2 - c.left) / s, y: (r.top + r.height / 2 - c.top) / s };
}
const inTray = (app: "wa" | "ms", sel: string) => () => local(trays[app].host.shadowRoot!.querySelector(sel));
const onPage = (sel: string) => () => local(document.querySelector(sel));
const panelOf = (app: "wa" | "ms") => () => local(trays[app].host.shadowRoot!.querySelector(".tray"));
/** Frame the tray with the conversation above it: aim a little up and to the right of the tray's centre. */
const shot = (app: "wa" | "ms") => () => {
  const p = panelOf(app)();
  return p && { x: p.x + 240, y: p.y - 150 };
};

// ---- the script: build the timeline ---------------------------------------------------------------------------
let now = 0;
const at = (t: number) => (now = t);
const wait = (d: number) => (now += d);
const card = (d: number, lines: Line[], dark = false) => {
  titleCards.push({ t0: now, t1: now + d, dark, lines });
  return wait(d);
};
const caption = (d: number, eyebrow: string, title: string) => captions.push({ t0: now, t1: now + d, eyebrow, title });
const zoom = (dur: number, s: number, to: Target) => camMoves.push({ t0: now, dur, s, to });
const move = (dur: number, to: Target) => cursorMoves.push({ t0: now, dur, to });
const click = () => clicks.push(now);
const tray = (app: "wa" | "ms", key: Omit<TrayKey, "t">) => trayKeys[app].push({ t: now, ...key });
const say = (app: typeof wa | typeof ms, dir: "in" | "out", text: string) => app.msgs.push({ t: now, dir, text, time: stamp() });
const typing = (d: number) => wa.typing.push([now, now + d]);
const marks: Record<string, number> = {};

const MAYA_PRESET = "dating";
let goal: Goal | null = null;
tray("wa", { mode: "pill", preset: MAYA_PRESET });
tray("ms", { mode: "pill", preset: "" });
cursorMoves.push({ t0: 0, dur: 0, to: { x: 1500, y: 1180 } });
camMoves.push({ t0: 0, dur: 0, s: 1.08, to: { x: 1180, y: 560 } });

// 1. The hook.
at(0.2);
card(2.6, [{ html: "You know what you want to say.", at: 0.3 }]);
card(2.6, [{ html: "Finding the words" }, { html: "is the hard part.", at: 0.5 }]);
marks.reveal = now;
card(3.6, [{ html: '<div class="logo"></div>' }, { html: '<span class="grad">Charmly</span>', at: 0.25 }, { html: "Better replies, in your own voice.", sub: true, at: 0.9 }]);

// 2. It reads the room.
marks.groove = now;
zoom(3.5, 1, { x: W / 2, y: H / 2 });
wait(0.4);
caption(6.3, "Reads the room", "Gets the vibe. Suggests replies that sound like you.");
wait(0.4);
typing(1.1);
wait(1.1);
say(wa, "in", S.maya.room);
wait(1.3);
const room = S.room;
tray("wa", { mode: "stream", take: room, preset: MAYA_PRESET });
wait(0.3);
zoom(1.3, 1.18, shot("wa"));
wait(CARD_AT(room.cards.length - 1) + 0.6);
move(0.9, inTray("wa", `button.card:nth-of-type(${room.pick + 1}) .text`));
wait(1.0);
click();
tray("wa", { mode: "stream", take: room, preset: MAYA_PRESET, inserted: room.pick, complete: true });
wa.composer.push({ t0: now, t1: now + 1.7, text: room.cards[room.pick].text });
wait(0.5);
caption(2.6, "Tap to insert", "You always press send.");
zoom(1.1, 1, { x: W / 2, y: H / 2 });
wait(0.5);
move(0.7, onPage("#wa .send"));
wait(0.8);
click();
say(wa, "out", room.cards[room.pick].text);
tray("wa", { mode: "pill", preset: MAYA_PRESET });
wait(1.5);

// 3. Steer, the hero.
marks.steer = now;
card(3.4, [{ html: "Some messages matter more." }, { html: "They're the hardest to send.", sub: true, at: 0.8 }], true);
card(4.2, [{ html: 'Introducing <span class="grad">Steer</span>.' }, { html: "Say where you want the chat to go. Charmly gets you there, one natural step at a time.", sub: true, at: 0.8 }], true);
say(wa, "in", S.maya.next); // arrives while the title is up
wait(0.3);
caption(5.6, "Steer", "Tell Charmly what you'd like to say, eventually.");
move(0.8, inTray("wa", ".setup"));
wait(0.9);
click();
tray("wa", { mode: "sheet", preset: MAYA_PRESET, typed: "" });
zoom(1.1, 1.38, panelOf("wa"));
wait(0.7);
move(0.6, inTray("wa", "[data-field=goal]"));
wait(0.7);
click();
const typeFrom = now;
for (let i = 1; i <= S.goal.length; i++) tray("wa", { mode: "sheet", preset: MAYA_PRESET, typed: S.goal.slice(0, i) }), (now = typeFrom + i * 0.055);
wait(0.4);
move(0.5, inTray("wa", ".paces [data-pace='4']"));
wait(0.6);
click();
wait(0.3);
move(0.5, inTray("wa", "[data-act=save-goal]"));
wait(0.6);
click();
goal = newGoal(S.goal, 4);
const STEP_NAMES = ["Find common ground", "Bridge to the topic", "Test the water", "Say it"];
for (const [i, step] of S.steps.entries()) {
  const t0 = now;
  caption(i === 3 ? 6.6 : 6.1, `Step ${i + 1} of 4`, STEP_NAMES[i]);
  tray("wa", { mode: "stream", take: step, goal, preset: MAYA_PRESET });
  zoom(1.0, 1.15, shot("wa"));
  wait(CARD_AT(step.cards.length - 1) + 0.55);
  move(0.75, inTray("wa", `button.card:nth-of-type(${step.pick + 1}) .text`));
  wait(0.85);
  click();
  tray("wa", { mode: "stream", take: step, goal, preset: MAYA_PRESET, inserted: step.pick, complete: true });
  wa.composer.push({ t0: now, t1: now + 1.25, text: step.cards[step.pick].text });
  wait(0.35);
  zoom(0.9, 1, { x: W / 2, y: H / 2 });
  move(0.6, onPage("#wa .send"));
  wait(0.9);
  click();
  say(wa, "out", step.cards[step.pick].text);
  goal = onMessage(goal, "me");
  tray("wa", { mode: "pill", goal, preset: MAYA_PRESET });
  if (i === 3) marks.said = now;
  wait(0.5);
  typing(0.9);
  wait(0.9);
  say(wa, "in", step.reply ?? S.maya.replies[i]);
  goal = onMessage(goal, "them");
  wait(1.15); // a beat to read her reply before the next suggestions
  void t0;
}
caption(4.2, "Said", "Naturally, in four messages.");
tray("wa", { mode: "stream", take: S.after, goal, preset: MAYA_PRESET });
zoom(1.0, 1.15, shot("wa"));
wait(4.0);
card(3.4, [{ html: "Not a script." }, { html: '<span class="grad">A path.</span>', at: 0.7 }]);
marks.steerEnd = now;
zoom(0.01, 1, { x: W / 2, y: H / 2 });

// 4. Your voice, and peek.
caption(5.3, "Your voice", "Presets for every kind of chat, with rules it never breaks.");
move(0.8, inTray("wa", ".setup"));
wait(0.9);
click();
tray("wa", { mode: "sheet", take: S.after, goal, preset: MAYA_PRESET, typed: S.goal });
zoom(1.0, 1.25, panelOf("wa"));
wait(0.6);
move(0.6, inTray("wa", '.sheet [data-act=preset][data-id="friends"]'));
wait(0.7);
click();
tray("wa", { mode: "sheet", take: S.after, goal, preset: "friends", typed: S.goal });
wait(0.6);
move(0.5, inTray("wa", '.sheet [data-act=preset][data-id="dating"]'));
wait(0.6);
click();
tray("wa", { mode: "sheet", take: S.after, goal, preset: MAYA_PRESET, typed: S.goal });
wait(0.5);
move(0.6, inTray("wa", ".setup"));
wait(0.7);
click();
tray("wa", { mode: "stream", take: S.after, goal, preset: MAYA_PRESET, complete: true });
zoom(0.9, 1, { x: W / 2, y: H / 2 });
wait(1.0);
caption(3.6, "Peek", "Hold ⌥ to read the chat behind it.");
move(0.6, { x: 1700, y: 1160 });
keyCaps.push({ t0: now + 0.2, t1: now + 2.8, keys: ["⌥"], press: now + 0.6 });
trayKeys.wa.at(-1)!.peek = [now + 0.65, now + 2.4];
wait(3.6);
marks.anywhereCard = now;
card(3.0, [{ html: "Anywhere you message." }, { html: "Telegram, Messenger, LinkedIn, Slack, or any site in Chrome.", sub: true, at: 0.6 }]);
showApp.push({ t: now - 1.2, app: "ms" });

// 5. Anywhere: a Messenger-style site Charmly has no special support for, opened with the shortcut.
marks.anywhere = now;
caption(7.4, "Anywhere", "Click into any message box. Press ⌥ ⇧ C.");
wait(1.0); // read Priya's message first
move(0.8, onPage("#ms [contenteditable]"));
wait(0.9);
click();
keyCaps.push({ t0: now + 0.3, t1: now + 1.9, keys: ["⌥", "⇧", "C"], press: now + 0.9 });
wait(1.3);
tray("ms", { mode: "stream", take: S.anywhere, preset: "" });
zoom(1.1, 1.15, shot("ms"));
wait(CARD_AT(S.anywhere.cards.length - 1) + 0.7);
move(0.8, inTray("ms", `button.card:nth-of-type(${S.anywhere.pick + 1}) .text`));
wait(0.9);
click();
tray("ms", { mode: "stream", take: S.anywhere, preset: "", inserted: S.anywhere.pick, complete: true });
ms.composer.push({ t0: now, t1: 999, text: S.anywhere.cards[S.anywhere.pick].text });
wait(1.6);

// 6. Private by design, and the outro.
marks.outro = now;
card(4.6, [{ html: "Private by design." }, { html: "Runs on your laptop with on-device models.<br>Or Claude, when you want the best.", sub: true, at: 0.7 }, { html: "And you always press send.", sub: true, at: 1.9 }]);
card(5.2, [{ html: '<div class="logo"></div>' }, { html: "Say what you mean.", at: 0.35 }, { html: '<span class="grad">Charmly</span> &nbsp;·&nbsp; by Balaji Sri Raj', sub: true, at: 1.2 }]);
const DURATION = now + 0.2;
for (const k of Object.values(trayKeys)) k.sort((a, b) => a.t - b.t);

// ---- rendering ------------------------------------------------------------------------------------------------
function latest<T extends { t: number }>(list: T[], t: number): T | undefined {
  let found: T | undefined;
  for (const x of list) if (x.t <= t) found = x;
  return found;
}

function renderMessages(app: "wa" | "ms", t: number) {
  const data = app === "wa" ? wa : ms;
  const list = $(app === "wa" ? "#wa .list" : "#ms .log");
  const shown = data.msgs.filter((m) => m.t <= t);
  if (list.childElementCount !== shown.length) {
    list.innerHTML = shown
      .map((m) =>
        app === "wa"
          ? `<div class="row ${m.dir}"><div class="bubble"><span>${esc(m.text)}</span><span class="meta">${m.time}${m.dir === "out" ? ' <i class="ticks">✓✓</i>' : ""}</span></div></div>`
          : `<div class="row ${m.dir}"><div class="bubble">${esc(m.text)}</div></div>`,
      )
      .join("");
  }
  const last = list.lastElementChild as HTMLElement | null;
  const m = shown.at(-1);
  if (last && m && m.t >= 0) {
    const p = out(clamp((t - m.t) / 0.3));
    last.style.opacity = String(p);
    last.style.transform = `translateY(${(1 - p) * 10}px) scale(${0.97 + 0.03 * p})`;
  }
  const box = $(app === "wa" ? "#wa .box" : "#ms [contenteditable]");
  const draft = data.composer.find((c) => c.t0 <= t && t < c.t1)?.text ?? "";
  if (box.textContent !== draft) box.textContent = draft;
  if (app === "wa") $("#wa .typing").textContent = wa.typing.some(([a, b]) => a <= t && t < b) ? "typing…" : "online";
}

function renderTray(app: "wa" | "ms", t: number) {
  const tr = trays[app];
  const key = latest(trayKeys[app], t);
  if (!key) return;
  const dt = key.complete ? 99 : t - key.t;
  const inner = internals(tr);
  tr.preset = key.preset ?? "";
  tr.goal = key.goal ?? null;
  tr.read = null;
  let shown = 0;
  if (key.mode === "stream" && key.take) {
    const take = key.take;
    shown = take.cards.filter((_, i) => CARD_AT(i) <= dt).length;
    const done = shown === take.cards.length && dt >= CARD_AT(take.cards.length - 1) + 0.15;
    const vibe = dt >= 0.4 ? vibeOf(take.vibe) : null;
    inner.sheet = false;
    tr.set(done ? { kind: "ready", vibe, suggestions: asSuggestions(take.cards), dropped: 0, polishing: false } : { kind: "loading", vibe, suggestions: asSuggestions(take.cards.slice(0, shown)), polishing: false });
    if (key.inserted !== undefined) tr.markInserted(key.inserted);
  } else if (key.mode === "sheet") {
    if (key.take) tr.set({ kind: "ready", vibe: vibeOf(key.take.vibe), suggestions: asSuggestions(key.take.cards), dropped: 0, polishing: false });
    else tr.set({ kind: "pill", draft: false });
    inner.sheet = true;
    inner.fields = { goal: key.typed ?? "" };
    inner.pace = 4;
    tr.refresh();
  } else {
    inner.sheet = false;
    tr.set({ kind: "pill", draft: !!key.draft });
  }
  // Dock above the message box, in the app's own coordinates.
  const anchor = $(app === "wa" ? "#wa footer" : "#ms form");
  const a = { x: 0, y: 0, w: anchor.offsetWidth };
  for (let e: HTMLElement | null = anchor; e && e !== camera; e = e.offsetParent as HTMLElement | null) {
    a.x += e.offsetLeft;
    a.y += e.offsetTop;
  }
  const panel = inner.panel;
  // Docked like the product: at the right end of the message box.
  const open = key.mode !== "pill";
  const width = Math.min(a.w - 24, 820);
  Object.assign(panel.style, { left: "", right: `${W - (a.x + a.w) + 12}px`, width: open ? `${width}px` : "", bottom: `${H - a.y + 12}px`, top: "" });
  panel.classList.toggle("dark", false);
  // Motion the tray's CSS would have done: the panel rising in, each card arriving.
  let alpha = 1;
  if (key.mode === "stream" && dt < 0.35 && !(trayKeys[app].indexOf(key) > 0 && trayKeys[app][trayKeys[app].indexOf(key) - 1].mode === "stream")) {
    const p = out(clamp(dt / 0.35));
    alpha = p;
    panel.style.transform = `translateY(${(1 - p) * 14}px)`;
  } else panel.style.transform = "";
  if (key.peek) {
    const [p0, p1] = key.peek;
    const p = clamp((t - p0) / 0.25) * (1 - clamp((t - p1) / 0.25));
    alpha *= 1 - 0.94 * p;
  }
  panel.style.opacity = String(alpha);
  if (key.mode === "stream") {
    tr.host.shadowRoot!.querySelectorAll<HTMLElement>("button.card").forEach((c, i) => {
      const p = out(clamp((dt - CARD_AT(i)) / 0.35));
      c.style.opacity = String(p);
      c.style.transform = `translateY(${(1 - p) * 10}px)`;
    });
  }
}

function resolve(target: Target, cache: { at?: Point }): Point {
  if (cache.at) return cache.at;
  const p = typeof target === "function" ? target() : target;
  if (p) cache.at = p;
  return p ?? { x: W / 2, y: H / 2 };
}
function pathAt<T extends { t0: number; dur: number; to: Target; at?: Point }>(moves: T[], t: number, value: (m: T) => number = () => 0) {
  let from = resolve(moves[0].to, moves[0]);
  let fromV = value(moves[0]);
  let pos = from;
  let v = fromV;
  for (const m of moves.slice(1)) {
    if (t < m.t0) break;
    const to = resolve(m.to, m);
    const p = ease(clamp(m.dur ? (t - m.t0) / m.dur : 1));
    pos = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
    v = fromV + (value(m) - fromV) * p;
    if (p >= 1) {
      from = to;
      fromV = value(m);
    } else break;
  }
  return { pos, v };
}

function renderCamera(t: number) {
  const { pos, v: s } = pathAt(camMoves, t, (m) => m.s);
  // Keep the frame inside the set.
  const cx = Math.min(Math.max(pos.x, W / (2 * s)), W - W / (2 * s));
  const cy = Math.min(Math.max(pos.y, H / (2 * s)), H - H / (2 * s));
  camera.style.transform = `translate(${W / 2 - cx * s}px, ${H / 2 - cy * s}px) scale(${s})`;
}

function renderCursor(t: number) {
  const { pos } = pathAt(cursorMoves, t);
  const cursor = $("#cursor");
  cursor.style.transform = `translate(${pos.x - 4}px, ${pos.y - 2}px)`;
  const c = clicks.filter((x) => x <= t && t - x < 0.5).at(-1);
  const ripple = $("#ripple");
  if (c === undefined) ripple.style.opacity = "0";
  else {
    const p = (t - c) / 0.5;
    Object.assign(ripple.style, { opacity: String(1 - p), transform: `translate(${pos.x - 22}px, ${pos.y - 22}px) scale(${0.3 + 1.3 * p})` });
  }
  cursor.style.opacity = t < 9 ? "0" : "1";
}

function renderOverlay(t: number) {
  const c = titleCards.find((x) => x.t0 - 0.01 <= t && t < x.t1);
  const el = $("#card");
  if (!c) {
    // Fade out after the last card.
    const prev = [...titleCards].reverse().find((x) => x.t1 <= t);
    const p = prev ? clamp((t - prev.t1) / 0.6) : 1;
    el.style.opacity = String(1 - p);
    if (p >= 1) el.innerHTML = "";
  } else {
    const prev = titleCards[titleCards.indexOf(c) - 1];
    const joined = prev && Math.abs(prev.t1 - c.t0) < 0.05 && prev.dark === c.dark;
    el.className = c.dark ? "dark" : "";
    const sig = `${c.t0}`;
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = c.lines.map((l) => `<div class="line ${l.sub ? "sub" : ""}">${l.html}</div>`).join("");
    }
    el.style.opacity = String(joined ? 1 : out(clamp((t - c.t0) / 0.6)));
    el.querySelectorAll<HTMLElement>(".line").forEach((line, i) => {
      const fadeOut = 1 - clamp((t - (c.t1 - 0.45)) / 0.45);
      const p = out(clamp((t - c.t0 - (c.lines[i].at ?? i * 0.5)) / 0.9));
      line.style.opacity = String(p * (titleCards[titleCards.indexOf(c) + 1]?.t0 === c.t1 ? fadeOut : 1));
      line.style.transform = `translateY(${(1 - p) * 22}px)`;
    });
  }
  const cap = captions.filter((x) => x.t0 <= t && t < x.t1).at(-1);
  const ce = $("#caption");
  if (cap) {
    const p = out(clamp((t - cap.t0) / 0.45)) * (1 - clamp((t - (cap.t1 - 0.4)) / 0.4));
    if (ce.dataset.sig !== `${cap.t0}`) {
      ce.dataset.sig = `${cap.t0}`;
      ce.innerHTML = `<div class="eyebrow">${cap.eyebrow}</div><div class="title">${cap.title}</div>`;
    }
    ce.style.opacity = String(p);
    ce.style.transform = `translate(-50%, ${(1 - p) * -14}px)`;
  } else ce.style.opacity = "0";
  const k = keyCaps.find((x) => x.t0 <= t && t < x.t1);
  const ke = $("#keys");
  if (k) {
    const p = out(clamp((t - k.t0) / 0.3)) * (1 - clamp((t - (k.t1 - 0.3)) / 0.3));
    if (ke.dataset.sig !== `${k.t0}`) {
      ke.dataset.sig = `${k.t0}`;
      ke.innerHTML = k.keys.map((x) => `<span>${x}</span>`).join("");
    }
    ke.style.opacity = String(p);
    ke.classList.toggle("press", t >= k.press && t < k.press + 0.5);
  } else ke.style.opacity = "0";
}

function renderAt(t: number) {
  const app = latest(showApp, t)!.app;
  apps.wa.style.display = app === "wa" ? "" : "none";
  apps.ms.style.display = app === "ms" ? "" : "none";
  renderMessages(app, t);
  renderTray(app, t);
  renderCamera(t);
  renderCursor(t);
  renderOverlay(t);
}

Object.assign(window, { renderAt, DURATION, MARKS: marks, SCENES: { room: [0, marks.steer], steer: [marks.steer, marks.steerEnd], anywhere: [marks.anywhereCard, marks.outro] } });
