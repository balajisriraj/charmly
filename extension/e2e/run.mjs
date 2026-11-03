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

  // The popup, rendered as a page for the screenshot.
  if (SHOTS) {
    const sw = browser.targets().find((t) => t.type() === "service_worker");
    const id = new URL(sw.url()).host;
    const popup = await browser.newPage();
    await popup.setViewport({ width: 360, height: 760, deviceScaleFactor: 2 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await sleep(400);
    await popup.screenshot({ path: resolve(ROOT, "../docs/popup.png") });
  }
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
