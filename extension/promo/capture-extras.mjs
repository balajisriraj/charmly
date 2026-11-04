// Extra real takes for the fast promo (blink.ts): polishing a draft, staying gentle when someone wants space,
// and a reply in the Work preset. Same rules as capture.mjs: the real extension, the real on-device model,
// written incoming lines, and a director who regenerates weak takes. Merges into promo/script.json as "extras".
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = resolve(import.meta.dirname, "..");
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const EXTRAS = {
  polish: { name: "Arun", history: [["in", "machan are we still on for saturday? 🏏"]], draft: "cant make it sat, work stuff came up sorry" },
  space: { name: "Sam", history: [["out", "hey! did you see the match?"], ["in", "honestly so tired today, can we talk tomorrow?"]] },
  work: { name: "Priya (Manager)", history: [["in", "Hi! Could you send me the deck before 5 today?"]] },
};

execFileSync("node", ["build.mjs", "--dev"], { cwd: ROOT, stdio: "ignore" });
const server = createServer((_q, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(readFileSync(resolve(ROOT, "fixtures/chat.html")));
}).listen(0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [resolve(ROOT, "dist")], defaultViewport: { width: 1920, height: 1080 } });
const sw = await browser.waitForTarget((t) => t.type() === "service_worker");
const ext = await browser.newPage();
await ext.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
await ext.evaluate(
  async (model, url, work) => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({
      settings: { ...settings, enabled: true, engine: "local", ollamaModel: model, ollamaUrl: url, auto: true, flirty: false, tone: "warm", preset: "" },
      chatPresets: { Arun: "friends", Sam: "friends", [work]: "work" },
      chatGoals: {},
    });
  },
  MODEL,
  OLLAMA,
  EXTRAS.work.name,
);

const T = "document.querySelector('charmly-tray').shadowRoot";
const ready = (page) => page.waitForFunction(() => {
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
const clean = ({ text: t }) =>
  t.length >= 10 && t.length <= 130 && t.split(/\s+/).length >= 4 && !/[[\]*|]|^me:|as an ai|option \d/i.test(t) && (t.match(/[A-Z]/g) ?? []).length <= (t.match(/[a-z]/g) ?? []).length * 0.25;

async function take(page, label, ok = () => true, again = () => page.evaluate(`${T}.querySelector('[data-act=suggest]')?.click()`)) {
  for (let tries = 0; tries < 10; tries++) {
    await ready(page);
    await sleep(300);
    const got = await read(page);
    const good = got.cards.filter((c) => clean(c) && ok(c));
    if (got.cards.length >= 2 && good.length >= 2) {
      got.cards = got.cards.filter((c) => clean(c) && ok(c));
      console.log(`${label}: take ${tries + 1} → ${got.vibe} | ${got.cards.map((c) => c.text).join(" / ")}`);
      return { ...got, pick: 0 };
    }
    await again();
    await sleep(500);
  }
  throw new Error(`${label}: no usable take`);
}

const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/chat.html`);
await page.waitForFunction(() => document.querySelector("charmly-tray"));
const load = (e) => page.evaluate((e) => window.chat.load(e.name, e.history.map(([d, t]) => [d, d === "in" ? e.name : "Me", t]), ""), e);
const out = {};

// Polish: a rough draft, made kind and clear in your voice.
await load(EXTRAS.polish);
await sleep(600);
await page.click("[contenteditable]");
await page.keyboard.type(EXTRAS.polish.draft, { delay: 8 });
await sleep(900);
await page.evaluate(`${T}.querySelector('[data-act=polish]').click()`);
await sleep(400);
// A retry polishes again (Alt+P), rather than asking for fresh replies.
const repolish = async () => {
  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyP");
  await page.keyboard.up("Alt");
};
const polished = (c) => /sorry|can'?t|cannot|won'?t/i.test(c.text) && /sat|saturday|work/i.test(c.text);
out.polish = { ...(await take(page, "polish", polished, repolish)), draft: EXTRAS.polish.draft };
await page.evaluate(() => (document.querySelector("[contenteditable]").textContent = ""));

// Space: they're tired; every option stays gentle, flirty is off.
await load(EXTRAS.space);
await sleep(600);
await page.evaluate(`${T}.querySelector('[data-act=suggest]').click()`);
out.space = await take(page, "space", (c) => !/!!|come on|come (over|round|ovr)|wanna|chill|tonight/i.test(c.text) && /rest|sleep|tomorrow|no worries|take care|whenever|of course|sure/i.test(c.text));

// Work preset: the same Charmly, a different voice.
await load(EXTRAS.work);
await sleep(600);
await page.evaluate(`${T}.querySelector('[data-act=suggest]').click()`);
out.work = await take(page, "work", (c) => !/😂|🤣|lol|haha/i.test(c.text));

await browser.close();
server.close();
const path = resolve(ROOT, "promo/script.json");
const script = JSON.parse(readFileSync(path, "utf8"));
script.extras = { ...EXTRAS, takes: out };
writeFileSync(path, JSON.stringify(script, null, 2));
console.log("merged extras into promo/script.json");
