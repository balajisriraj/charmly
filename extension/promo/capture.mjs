// Pass 1 of the promo: drive the real extension with the real on-device model and capture what it suggests.
//
//   node promo/capture.mjs   → promo/script.json
//
// Maya's lines are written for the film; every suggestion is real model output. When a take is weak (junk, or
// asking too early, or not asking on the last step), the director regenerates, as anyone would press ↻.
// Pass 2 (render.mjs) turns the captured data into the film.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = resolve(import.meta.dirname, "..");
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const GOAL = "ask her out for a date night";
export const MAYA = {
  history: [
    ["in", "hey! it's Maya, from Arun's party 👋"],
    ["out", "Maya! hey, so glad you texted"],
  ],
  room: "that was the most fun I've had in ages 😄 your karaoke though…",
  next: "anyway, what are you up to this week?",
  replies: [
    "same old work chaos 😮‍💨 but I found the cutest little Italian place near my office",
    "honestly I could use a proper night off, this week's been a lot",
    "hmm, depends… are you asking? 😏",
    "yes!! friday? 🥰",
  ],
};
// The Messenger-style page (fixtures/bubbles.html) and its conversation.
export const PRIYA = {
  history: [
    ["in", "hey! it was so fun meeting you at Arun's party 😊"],
    ["out", "haha same, your karaoke was legendary"],
    ["in", "omg don't remind me 🙈 what are you up to this week?"],
  ],
};

execFileSync("node", ["build.mjs", "--dev"], { cwd: ROOT, stdio: "ignore" });
const server = createServer((req, res) => {
  const name = /^\/(bubbles)\.html/.exec(req.url ?? "")?.[1] ?? "chat";
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(readFileSync(resolve(ROOT, `fixtures/${name}.html`)));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [resolve(ROOT, "dist")], defaultViewport: { width: 1920, height: 1080 } });
const sw = await browser.waitForTarget((t) => t.type() === "service_worker");
const extId = new URL(sw.url()).host;
const ext = await browser.newPage();
await ext.goto(`chrome-extension://${extId}/popup.html`);
await ext.evaluate(
  async (model, url) => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({
      settings: { ...settings, enabled: true, engine: "local", ollamaModel: model, ollamaUrl: url, auto: true, flirty: true, tone: "warm", preset: "" },
      chatPresets: { Maya: "dating" },
      chatNotes: {},
      chatGoals: {},
    });
    await chrome.storage.local.remove("style");
  },
  MODEL,
  OLLAMA,
);
await fetch(`${OLLAMA}/api/generate`, { method: "POST", body: JSON.stringify({ model: MODEL, prompt: "hi", keep_alive: "30m", options: { num_predict: 1 } }) });

const T = "document.querySelector('charmly-tray').shadowRoot";
const ready = (page) =>
  page.waitForFunction(() => {
    const r = document.querySelector("charmly-tray")?.shadowRoot;
    return r && (r.querySelector(".tray.ready") || r.querySelector(".err"));
  }, { timeout: 120000 });
const read = (page) =>
  page.evaluate(`(() => {
    const r = ${T};
    return {
      vibe: r.querySelector(".vibe")?.textContent.trim() ?? "",
      cards: [...r.querySelectorAll("button.card")].map((c) => ({ tone: c.querySelector(".tag").textContent, text: c.querySelector(".text").textContent, why: c.querySelector(".why").textContent })),
    };
  })()`);

const INVITE = /\b(would you|wanna|want to|let me take you|can i take you|how about|shall we|maybe we (could|can)|let'?s|be my|join me|are you free|you free)\b/i;
const ASKS = /\b(date|dinner|drinks?|night out|take you out|go out|friday|saturday|this weekend|tomorrow night)\b/i;
/** The director's eye: natural and complete; before the last step no ask, on the last step a real one. */
const HAPPY = /\b(yes|yay|perfect|can't wait|cannot wait|it's a date|friday|see you|amazing|great)\b/i;
function choose(cards, { final = false, step = false, happy = false } = {}) {
  const fine = cards
    .map((c, i) => ({ t: c.text, i }))
    .filter(({ t }) => t.length >= 14 && t.length <= 140 && t.split(/\s+/).length >= 5 && /[a-z]{3}/i.test(t))
    .filter(({ t }) => !/[[\]*]|^reply|^me:|as an ai|\btone\b|\bthem\b:|\b(girl|guy|boy|man|woman)\b|\bpass\b|\bmyself\b|option \d|^ask\b|\|/i.test(t) && (t.match(/[A-Z]/g) ?? []).length <= (t.match(/[a-z]/g) ?? []).length * 0.25);
  const fits = final ? fine.filter(({ t }) => ASKS.test(t) && INVITE.test(t) && t.includes("?")) : step ? fine.filter(({ t }) => !ASKS.test(t)) : happy ? fine.filter(({ t }) => HAPPY.test(t)) : fine;
  // The lead option (the tone you chose) when it's good; otherwise the most text-sized one.
  return fits.find((x) => x.i === 0)?.i ?? fits.sort((a, b) => Math.abs(a.t.length - 72) - Math.abs(b.t.length - 72))[0]?.i ?? -1;
}
async function take(page, opts, label) {
  for (let tries = 0; tries < 10; tries++) {
    await ready(page);
    await sleep(300);
    const err = await page.evaluate(`${T}.querySelector(".err")?.textContent ?? ""`);
    if (err) throw new Error(`${label}: ${err}`);
    const got = await read(page);
    const pick = choose(got.cards, opts);
    if (pick >= 0) {
      console.log(`${label}: take ${tries + 1} → "${got.cards[pick].text}"`);
      return { ...got, pick };
    }
    await page.evaluate(`${T}.querySelector('[data-act=suggest]').click()`);
    await sleep(500);
  }
  throw new Error(`${label}: no usable take`);
}
async function send(page, i) {
  await page.evaluate(`${T}.querySelector('button.card:nth-of-type(${i + 1})').click()`);
  await sleep(500);
  await page.click(".send");
  await sleep(400);
}
const receive = (page, text) => page.evaluate((t) => window.chat.receive(t), text);

// WhatsApp: Maya.
const chat = await browser.newPage();
await chat.goto(`${base}/chat.html`);
await chat.waitForFunction(() => document.querySelector("charmly-tray"));
await chat.evaluate((h) => window.chat.load("Maya", h.map(([d, t]) => [d, d === "in" ? "Maya" : "Me", t]), ""), MAYA.history);
await sleep(500);
await receive(chat, MAYA.room);
const room = await take(chat, {}, "room");
await send(chat, room.pick);
await receive(chat, MAYA.next);
await ready(chat);
const next = await read(chat);

// Steer: set the goal through the real sheet, then four back-and-forths.
await chat.evaluate(`${T}.querySelector('.setup').click()`);
await sleep(300);
await chat.evaluate((goal) => {
  const r = document.querySelector("charmly-tray").shadowRoot;
  const i = r.querySelector("[data-field=goal]");
  i.value = goal;
  i.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  r.querySelector(".paces [data-pace='4']").click();
  r.querySelector("[data-act=save-goal]").click();
}, GOAL);
await sleep(800);
const steps = [];
for (const [i, reply] of MAYA.replies.entries()) {
  const final = i === MAYA.replies.length - 1;
  const got = await take(chat, { step: !final, final }, `step ${i + 1}`);
  const strip = await chat.evaluate(`${T}.querySelector('.goal .g-status')?.textContent ?? ''`);
  steps.push({ ...got, strip, reply });
  await send(chat, got.pick);
  await receive(chat, reply);
  await sleep(900);
}
const after = await take(chat, { happy: true }, "after");

// Anywhere: a Messenger-style site, opened with the shortcut.
const other = await browser.newPage();
await other.goto(`${base}/bubbles.html`);
await other.waitForFunction(() => document.querySelector("charmly-tray"));
await other.click("[contenteditable]");
const tabId = await ext.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes("bubbles.html"))?.id);
await ext.evaluate((id) => chrome.runtime.sendMessage({ type: "activate-tab", tabId: id }), tabId);
const anywhere = await take(other, {}, "anywhere");

await browser.close();
server.close();
const script = { model: MODEL, goal: GOAL, maya: MAYA, priya: PRIYA, room, next, steps, after, anywhere, capturedAt: new Date().toISOString() };
writeFileSync(resolve(ROOT, "promo/script.json"), JSON.stringify(script, null, 2));
console.log("saved promo/script.json");
