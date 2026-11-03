// End to end: load the built extension into Chrome, open the chat test page, simulate incoming messages
// and check the whole experience. `--shots` also saves README screenshots to ../docs.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS = process.argv.includes("--shots");
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");

const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(readFileSync(resolve(ROOT, "fixtures/chat.html")));
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/chat.html`;

// On-device engine: a stand-in that speaks Ollama's API and answers in the messy format small models produce.
// Set OLLAMA_E2E=http://localhost:11434 (and OLLAMA_MODEL) to run against a real Ollama instead.
const ollamaRequests = [];
const fakeOllama = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "tiny:1b", size: 8e8, details: { parameter_size: "1B" } }] }));
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    ollamaRequests.push(JSON.parse(body));
    const reply = "1|tone|reply|why\nWarm|aww no stress, get some proper rest tonight\nPlayful: recharge mode activated 🔋 talk tomorrow?\n3|direct|all good, message me whenever|clear";
    res.setHeader("content-type", "application/x-ndjson");
    for (const piece of reply.match(/[\s\S]{1,12}/g)) res.write(JSON.stringify({ message: { content: piece }, done: false }) + "\n");
    res.end(JSON.stringify({ done: true }) + "\n");
  });
}).listen(0);
const OLLAMA = process.env.OLLAMA_E2E ?? `http://127.0.0.1:${fakeOllama.address().port}`;
const OLLAMA_MODEL = process.env.OLLAMA_E2E ? (process.env.OLLAMA_MODEL ?? "llama3.2:3b") : "tiny:1b";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  enableExtensions: [resolve(ROOT, "dist")],
  args: ["--no-first-run", "--window-size=1440,900", ...(process.env.CI ? ["--no-sandbox"] : [])],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("charmly-tray")?.shadowRoot?.querySelector(".tray"), { timeout: 10000 });
  const tray = (fn) => page.evaluate(fn);
  const cards = () => tray(() => [...document.querySelector("charmly-tray").shadowRoot.querySelectorAll("button.card .text")].map((e) => e.textContent));
  const waitCards = (n) =>
    page.waitForFunction((n) => document.querySelector("charmly-tray").shadowRoot.querySelectorAll("button.card").length >= n && !document.querySelector("charmly-tray").shadowRoot.querySelector(".skeleton"), { timeout: 10000 }, n);
  const outgoing = () => page.evaluate(() => document.querySelectorAll(".message-out").length);

  console.log("Charmly end to end");
  check(await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.pill") !== null), "docks as a small pill above the message box");
  const sentBefore = await outgoing();

  // A new incoming message triggers suggestions automatically.
  await page.evaluate(() => window.chat.receive("guess what!! I got the job 🥳"));
  await waitCards(3);
  const texts = await cards();
  check(texts.length === 3, `streams three suggestions (${texts.length})`);
  const vibe = await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".vibe")?.textContent ?? "");
  check(/excited/i.test(vibe), `reads the vibe: "${vibe.trim()}"`);
  check(await tray(() => !document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.dark")), "matches the chat's light theme");
  if (SHOTS) {
    await sleep(700); // let the entrance animation settle
    await page.screenshot({ path: resolve(ROOT, "../docs/suggestions.png") });
  }

  // Tap to insert: text lands in the message box, nothing is sent.
  await page.evaluate(() => document.querySelector("charmly-tray").shadowRoot.querySelector("button.card").click());
  await sleep(150);
  check((await page.evaluate(() => window.chat.draft())) === texts[0], "tapping a card inserts it into the message box");
  check((await outgoing()) === sentBefore, "nothing is sent automatically");
  const inserted = await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".card.done .why")?.textContent ?? "");
  check(/Enter to send/.test(inserted), "confirms the insert and hands control back");

  // Keyboard: Alt+2 replaces the draft with the second option.
  await page.keyboard.down("Alt");
  await page.keyboard.press("Digit2");
  await page.keyboard.up("Alt");
  await sleep(150);
  check((await page.evaluate(() => window.chat.draft())) === texts[1], "Alt+2 inserts the second option");

  // Escape tucks it away; the draft stays.
  await page.keyboard.press("Escape");
  await sleep(100);
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.pill")), "Escape tucks the tray away");
  check(await tray(() => /Polish my draft/.test(document.querySelector("charmly-tray").shadowRoot.textContent)), "offers to polish the draft you have");

  // When they want space, Charmly stays gentle and never flirts.
  await page.evaluate(() => window.chat.receive("honestly I'm exhausted, can we talk later"));
  await waitCards(3);
  const careful = await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".vibe.careful"));
  const tones = await tray(() => [...document.querySelector("charmly-tray").shadowRoot.querySelectorAll(".tag")].map((t) => t.textContent));
  check(careful, "notices they may want space");
  check(!tones.includes("flirty"), `keeps every option gentle (${tones.join(", ")})`);

  // Tone chips regenerate with a different lead.
  await page.evaluate(() => [...document.querySelector("charmly-tray").shadowRoot.querySelectorAll(".tones button")].find((b) => /Playful/.test(b.textContent)).click());
  await waitCards(3);
  const lead = await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".tag")?.textContent);
  check(lead === "playful", `tone chips change the lead option (${lead})`);

  // Dark mode follows the page.
  await page.evaluate(() => {
    window.chat.dark(true);
    window.chat.open("Arjun");
  });
  await sleep(300);
  await page.evaluate(() => window.chat.receive("dinner after? that new place near the station 😄"));
  await waitCards(3);
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.dark")), "follows the dark theme");
  if (SHOTS) {
    await sleep(700);
    await page.screenshot({ path: resolve(ROOT, "../docs/suggestions-dark.png") });
  }

  // On-device engine: switch through the extension's own storage, then trigger a reply.
  const sw = browser.targets().find((t) => t.type() === "service_worker");
  const extId = new URL(sw.url()).host;
  const popupPage = await browser.newPage();
  await popupPage.goto(`chrome-extension://${extId}/popup.html`);
  await popupPage.evaluate(async (ollamaUrl, ollamaModel) => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, engine: "local", ollamaUrl, ollamaModel } });
  }, OLLAMA, OLLAMA_MODEL);
  const listed = await popupPage.evaluate((url) => chrome.runtime.sendMessage({ type: "ollama-models", url }), OLLAMA);
  check(listed.ok && listed.models.some((m) => m.name === OLLAMA_MODEL), `lists local models (${listed.ok ? listed.models.map((m) => m.name).join(", ") : listed.message})`);
  await popupPage.close();
  // Block a word in the Work preset, so the stand-in's first reply ("no stress…") must be held back.
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/popup.html`);
  await setup.evaluate(async () => {
    const { presets } = await chrome.storage.local.get("presets");
    await chrome.storage.local.set({ presets: presets.map((p) => (p.id === "work" ? { ...p, blocked: [...p.blocked, "stress"] } : p)) });
  });
  await setup.close();
  await page.bringToFront();
  await page.keyboard.press("Escape"); // back to the pill, so the wait below sees the new request, not the old tray

  // Voice presets, through the tray: pick Work from the chip menu, then add a note for this chat.
  const shadow = (sel) => page.evaluateHandle((sel) => document.querySelector("charmly-tray").shadowRoot.querySelector(sel), sel);
  await (await shadow(".preset-chip")).click();
  check(await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelectorAll(".menu [data-act=preset]").length >= 5), "preset menu lists the starter presets");
  if (SHOTS) {
    await sleep(300);
    await page.screenshot({ path: resolve(ROOT, "../docs/presets-menu.png") });
  }
  await (await shadow('.menu [data-id="work"]')).click();
  await sleep(150);
  check((await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".preset-chip").textContent)).includes("Work"), "the chat now shows the Work preset");
  await (await shadow(".note-btn")).click();
  await page.evaluate(() => {
    const t = document.querySelector("charmly-tray").shadowRoot.querySelector(".note-edit textarea");
    t.value = "my manager, keep it brief";
  });
  await (await shadow('[data-act="save-note"]')).click();
  await sleep(200);

  await page.waitForFunction(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.pill"));
  await page.evaluate(() => window.chat.receive("honestly so tired today, can we talk tomorrow"));
  await page.waitForFunction(
    () => {
      const r = document.querySelector("charmly-tray").shadowRoot;
      return r.querySelector(".err") || (r.querySelectorAll("button.card").length >= 2 && !r.querySelector(".skeleton") && r.querySelector(".tray.ready"));
    },
    { timeout: 90000 },
  );
  const localErr = await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".err")?.textContent ?? null);
  check(!localErr, localErr ? `on-device error: ${localErr}` : "on-device engine streams suggestions");
  const localCards = await cards();
  const badge = await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".demo")?.textContent);
  check(localCards.length >= (process.env.OLLAMA_E2E ? 2 : 1), `on-device replies (${localCards.length}): ${localCards.map((t) => `"${t}"`).join(" · ")}`);
  check(badge === "on-device", `labels the tray on-device (${badge})`);
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".vibe.careful")), "keeps the space-aware read on-device");
  if (!process.env.OLLAMA_E2E) {
    const sent = ollamaRequests.at(-1);
    check(sent?.model === "tiny:1b" && sent?.stream === true, "sent a streaming chat request to Ollama");
    const prompt = sent?.messages?.[1]?.content ?? "";
    check(prompt.includes("Voice preset: Work") && prompt.includes("- Use emojis"), "the Work preset's rules reach the model");
    check(prompt.includes("my manager, keep it brief"), "the chat note reaches the model");
    check(!localCards.some((t) => /stress/i.test(t)) && /held back/.test(await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".note")?.textContent ?? "")), "a word blocked in the preset is never shown");
    const remembered = await (async () => {
      const p = await browser.newPage();
      await p.goto(`chrome-extension://${extId}/popup.html`);
      const v = await p.evaluate(() => chrome.storage.local.get(["chatPresets", "chatNotes"]));
      await p.close();
      return v;
    })();
    check(Object.values(remembered.chatPresets ?? {}).includes("work") && Object.values(remembered.chatNotes ?? {}).includes("my manager, keep it brief"), "preset and note are remembered for this chat");
    await page.bringToFront();
  }

  // The popup, rendered as a page for the screenshot.
  if (SHOTS) {
    const id = extId;
    const popup = await browser.newPage();
    await popup.setViewport({ width: 360, height: 760, deviceScaleFactor: 2 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await sleep(400);
    await popup.screenshot({ path: resolve(ROOT, "../docs/popup.png") });
    const options = await browser.newPage();
    await options.setViewport({ width: 1280, height: 1180, deviceScaleFactor: 2 });
    await options.goto(`chrome-extension://${id}/options.html?preset=work`);
    await sleep(500);
    await options.screenshot({ path: resolve(ROOT, "../docs/presets.png") });
  }
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
  server.close();
  fakeOllama.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
