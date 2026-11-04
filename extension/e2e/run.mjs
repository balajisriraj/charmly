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

// Test pages: chat.html (WhatsApp-like) by default, and the other fixtures by name.
const server = createServer((req, res) => {
  const name = /^\/(bubbles|thread|linkedin|plain)\.html/.exec(req.url ?? "")?.[1] ?? "chat";
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(readFileSync(resolve(ROOT, `fixtures/${name}.html`)));
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
  // Hover Charmly's resting dot so it expands into the pill, as a person would.
  const expand = async (p = page) => {
    const at = await p.evaluate(() => {
      const b = document.querySelector("charmly-tray").shadowRoot.querySelector(".tray").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await p.mouse.move(at.x, at.y);
    await sleep(450);
  };
  const away = async (p = page) => {
    await p.mouse.move(4, 4);
    await sleep(800);
  };

  console.log("Charmly end to end");
  await sleep(600);
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.resting .dot")), "rests as a small breathing dot, out of the way");
  const dock = await page.evaluate(() => {
    const t = document.querySelector("charmly-tray").shadowRoot.querySelector(".tray").getBoundingClientRect();
    const f = document.querySelector("#main footer").getBoundingClientRect();
    return { right: f.right - t.right, above: f.top - t.bottom };
  });
  check(dock.right > 0 && dock.right < 40 && dock.above > 0 && dock.above < 30, `docks at the right end of the message box (${Math.round(dock.right)}px in, ${Math.round(dock.above)}px above)`);
  await expand();
  check(await tray(() => /Suggest replies/.test(document.querySelector("charmly-tray").shadowRoot.textContent) && !document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.resting")), "hovering the dot expands it into the pill");
  await away();
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.resting")), "and it settles back into the dot");
  // Drag it out of the way; it stays there, and double-click puts it back.
  const before = await page.evaluate(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".tray").getBoundingClientRect().toJSON());
  await page.mouse.move(before.x + 18, before.y + 18);
  await page.mouse.down();
  await page.mouse.move(before.x - 180, before.y - 260, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const after = await page.evaluate(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".tray").getBoundingClientRect().toJSON());
  // The dot breathes (scales slightly), so allow a few pixels.
  check(Math.abs(before.right - after.right - 198) < 6 && Math.abs(before.bottom - after.bottom - 278) < 6, `drags anywhere (moved ${Math.round(before.right - after.right)}px left, ${Math.round(before.bottom - after.bottom)}px up)`);
  await sleep(400);
  check(await tray(() => !document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.loading, .tray.ready")), "a drag doesn't ask for replies");
  const saved = await (async () => {
    const sw0 = browser.targets().find((t) => t.type() === "service_worker");
    const p = await browser.newPage();
    await p.goto(`chrome-extension://${new URL(sw0.url()).host}/popup.html`);
    const v = await p.evaluate(() => chrome.storage.local.get("trayOffsets"));
    await p.close();
    await page.bringToFront();
    return v.trayOffsets;
  })();
  check(Object.values(saved ?? {}).some((o) => o.x === -198 && o.y === -278), "remembers where you put it, per site");
  await away();
  const moved = await page.evaluate(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".tray").getBoundingClientRect().toJSON());
  await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2, { count: 1 });
  await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2, { count: 2 });
  await sleep(500);
  const reset = await page.evaluate(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".tray").getBoundingClientRect().toJSON());
  check(Math.abs(reset.right - before.right) < 2 && Math.abs(reset.bottom - before.bottom) < 2, "double-click puts it back");
  check(await tray(() => !document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.loading, .tray.ready")), "and a double-click doesn't ask for replies");
  await away();
  await expand();
  check(await tray(() => { const a = document.querySelector("charmly-tray").shadowRoot.querySelector("a.by"); return a?.textContent === "by Balaji Sri Raj" && a.href.startsWith("https://balajisriraj.com"); }), "credits Balaji Sri Raj in the tray");
  await away();
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

  // Peek: hold Alt on its own and the tray fades, so you can read the chat behind it.
  await page.keyboard.down("Alt");
  await sleep(500);
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.peek")), "holding Alt peeks through the tray");
  await page.keyboard.up("Alt");
  await sleep(100);
  check(await tray(() => !document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.peek")), "letting go brings it back");

  // Escape tucks it away; the draft stays.
  await page.keyboard.press("Escape");
  await sleep(100);
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.pill")), "Escape tucks the tray away");
  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".dot .pip")), "the dot shows a pip when there's a draft");
  await expand();
  check(await tray(() => /Polish my draft/.test(document.querySelector("charmly-tray").shadowRoot.textContent)), "and offers to polish it");
  await away();

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

  const sw = browser.targets().find((t) => t.type() === "service_worker");
  const extId = new URL(sw.url()).host;
  const setSettings = async (patch) => {
    const p = await browser.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html`);
    await p.evaluate(async (patch) => {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...settings, ...patch } });
    }, patch);
    await p.close();
    await page.bringToFront();
    await sleep(150);
  };
  const root = (fn, arg) => page.evaluate(fn, arg);
  const clickTone = (label) => root((l) => [...document.querySelector("charmly-tray").shadowRoot.querySelectorAll(".tones button")].find((b) => b.textContent.includes(l)).click(), label);
  const leadAfter = async (label) => {
    await clickTone(label);
    await sleep(50);
    await waitCards(3);
    return root(() => ({
      lead: document.querySelector("charmly-tray").shadowRoot.querySelector(".tag")?.textContent,
      chip: document.querySelector("charmly-tray").shadowRoot.querySelector(".tones button.on")?.textContent.trim(),
    }));
  };

  // Flirt mode, with Flirty as the saved lead: every chip still leads its own suggestions, and the chip sticks.
  await setSettings({ flirty: true, tone: "flirty" });
  await page.evaluate(() => window.chat.receive("we should get drinks this weekend 😏"));
  await waitCards(3);
  for (const [label, tone] of [["Warm", "warm"], ["Direct", "direct"], ["Flirty", "flirty"]]) {
    const r = await leadAfter(label);
    check(r.lead === tone && r.chip?.includes(label), `flirt mode: ${label} leads and stays selected (${r.lead}, chip ${r.chip})`);
  }

  // Typing your own reply while suggestions are open offers Polish right there.
  await page.evaluate(() => {
    const box = document.querySelector("[contenteditable]");
    box.focus();
    document.execCommand("insertText", false, "sure, saturday works");
  });
  await page.waitForFunction(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".foot [data-act=polish]"), { timeout: 3000 }).catch(() => {});
  check(await root(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".tray.ready .foot [data-act=polish]")), "typing while suggestions are open offers Polish");
  await root(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".foot [data-act=polish]").click());
  await waitCards(3);
  const polished = await cards();
  check(polished.every((t) => /saturday/i.test(t)) && (await root(() => !document.querySelector("charmly-tray").shadowRoot.querySelector(".foot [data-act=polish]"))), "polishes that draft, then hides the offer");

  // Steer: a goal reached slowly, one step per back-and-forth, said only on the last step.
  await setSettings({ flirty: false, tone: "warm" });
  await page.evaluate(() => document.querySelector("[contenteditable]").replaceChildren());
  const R = "document.querySelector('charmly-tray').shadowRoot";
  const q = (expr) => page.evaluate(`(() => { const r = ${R}; return ${expr}; })()`);
  const act = (sel) => page.evaluate(`${R}.querySelector(${JSON.stringify(sel)}).click()`);
  const status = () => q("r.querySelector('.goal .g-status')?.textContent ?? ''");
  const chip = async () => {
    await expand(); // the resting dot shows progress as a ring; hovering shows the chip
    return q("r.querySelector('.goal-chip span')?.textContent ?? ''");
  };
  const stepName = async () => (await status()).match(/· (.+?)(,|$)/)?.[1] ?? (await status());
  const setGoal = async (text, pace) => {
    await act(".setup");
    if (pace) await act(`.paces [data-pace='${pace}']`);
    await page.evaluate(`(() => { const i = ${R}.querySelector('[data-field=goal]'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await act("[data-act=save-goal]");
    await sleep(100);
    await waitCards(3);
  };
  const sendLast = async () => {
    // Insert the steering option (the third card), then press WhatsApp's send button, as a person would.
    await act("button.card:nth-of-type(3)");
    await sleep(150);
    await page.evaluate(() => document.querySelector(".send").click());
    await sleep(250);
  };
  const reply = async (text) => {
    await page.evaluate((t) => window.chat.receive(t), text);
    await sleep(800);
    await waitCards(3);
  };

  await act(".setup");
  check(await q("!!r.querySelector('.sheet .s-voice') && !!r.querySelector('.sheet .s-goal') && !!r.querySelector('.sheet .s-note') && !!r.querySelector('.sheet .s-engine')"), "one sheet holds voice, goal, note and engine");
  check(await q("r.querySelectorAll('.paces button').length === 3 && r.querySelector('.paces button.on')?.textContent.includes('Natural')"), "goal pace: Quick, Natural or Slow, Natural by default");
  if (SHOTS) {
    await sleep(300);
    await page.screenshot({ path: resolve(ROOT, "../docs/sheet.png") });
  }
  await act(".s-goal [data-act=goal-example]");
  check((await q("r.querySelector('[data-field=goal]').value")) === "ask them out for coffee", "an example fills the goal");
  await act("[data-act=save-goal]");
  await sleep(100);
  await waitCards(3);
  check((await q("r.querySelectorAll('.goal .bars i').length")) === 4 && (await stepName()) === "find common ground", `starts at step 1 of 4 even in a chat with history ("${await status()}")`);
  check(/not saying it yet/.test(await status()), "holds the ask back");
  check(!(await cards()).some((t) => /just say it/i.test(t)), "no suggestion says it on step 1");
  const journey = [await stepName()];
  await sendLast();
  check((await chip()) === "1/4 · waiting for them", `after you reply, the pill shows "${await chip()}"`);
  await page.evaluate(() => window.chat.send("also, the ending was wild"));
  await sleep(200);
  await reply("haha yes! honestly I've been exploring new places lately");
  journey.push(await stepName());
  check((await stepName()) === "bridge to the topic", "two messages in a row still count as one step");
  check((await q("[...r.querySelectorAll('.card .why')].map((e) => e.textContent).join('|')")).includes("step 2 of 4"), "suggestions take step 2");
  await sendLast();
  await reply("oh nice, what kind of places?");
  journey.push(await stepName());
  await sendLast();
  await reply("haha you've got me curious now");
  journey.push(await stepName());
  check(JSON.stringify(journey) === JSON.stringify(["find common ground", "bridge to the topic", "test the water", "say it"]), `drives the chat step by step: ${journey.join(" → ")}`);
  check((await q("!!r.querySelector('.goal.final')")) && (await cards()).some((t) => /just say it/i.test(t)), "only the last step says it");
  if (SHOTS) {
    await sleep(400);
    await page.screenshot({ path: resolve(ROOT, "../docs/steer.png") });
  }
  await sendLast();
  check((await chip()) === "said ✓", "after you send it, the goal shows as said");
  await act(".goal-chip"); // opens the sheet
  await act(".s-goal [data-act=goal-done]");
  await sleep(150);
  check(!(await q("!!r.querySelector('.goal-chip') || !!r.querySelector('.goal')")), "Stop ends steering");

  // Quick pace, and they bring it up themselves: offer to say it now.
  await reply("so what are you up to this week?");
  await setGoal("ask them out for coffee", 3);
  check((await q("r.querySelectorAll('.goal .bars i').length")) === 3, "Quick pace plans three steps");
  await reply("ugh I need a coffee so badly right now ☕");
  check(await q("!!r.querySelector('[data-act=goal-now]')"), `they mention it first: offers 'Say it now' ("${await status()}")`);
  await act("[data-act=goal-now]");
  await sleep(200);
  await waitCards(3);
  check((await stepName()) === "say it" && (await cards()).some((t) => /just say it/i.test(t)), "Say it now jumps to the last step");

  // They want space: the plan holds. Skip moves on by hand.
  await setGoal("ask them out for coffee", 4);
  await sendLast();
  await reply("honestly so tired, talk later");
  check((await stepName()) === "paused, they may want space" || (await q("!!r.querySelector('.goal.paused')")), `pauses when they want space ("${await status()}")`);
  check((await q("[...r.querySelectorAll('.goal .bars i')].findIndex((i) => i.classList.contains('now'))")) === 0, "and holds the step");
  await act("[data-act=goal-skip]");
  await sleep(150);
  await waitCards(3);
  check((await q("[...r.querySelectorAll('.goal .bars i')].findIndex((i) => i.classList.contains('now'))")) === 1, "Skip › moves on by hand");

  // The step is remembered per chat.
  await page.evaluate(() => window.chat.open("Ananya"));
  await sleep(300);
  check(!(await q("!!r.querySelector('.goal-chip') || !!r.querySelector('.dot.steering')")), "another chat has no goal");
  await page.evaluate(() => window.chat.open("Arjun"));
  await sleep(300);
  check((await chip()) === "2/4", `the goal and its step are remembered for this chat (${await chip()})`);
  await act(".goal-chip");
  await act(".s-goal [data-act=goal-done]");
  await sleep(150);
  await setSettings({ flirty: false, tone: "warm" });

  // On-device engine: switch through the extension's own storage, then trigger a reply.
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
    // A goal on step 2 for this chat, to check the step reaches the on-device model.
    await chrome.storage.local.set({ chatGoals: { Arjun: { text: "ask them out for coffee", pace: 4, step: 1, awaiting: false, said: false } } });
  });
  await setup.close();
  await page.bringToFront();
  await page.keyboard.press("Escape"); // back to the pill, so the wait below sees the new request, not the old tray

  // Voice presets, through the tray: pick Work from the chip menu, then add a note for this chat.
  // Query and click in one step inside the page, so a re-render mid-stream can't detach the node in between.
  const shadow = (sel) => ({
    click: () => page.evaluate((sel) => document.querySelector("charmly-tray").shadowRoot.querySelector(sel).click(), sel),
  });
  await expand();
  await (await shadow(".setup")).click();
  check(await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelectorAll(".sheet [data-act=preset]").length >= 5), "the sheet lists the starter presets");
  await (await shadow('.sheet [data-act=preset][data-id="work"]')).click();
  await sleep(150);
  check((await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".setup").textContent)).includes("Work"), "the chat now shows the Work preset");
  await page.evaluate(() => {
    const t = document.querySelector("charmly-tray").shadowRoot.querySelector(".s-note textarea");
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
  const badge = await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".setup")?.textContent ?? "");
  check(localCards.length >= (process.env.OLLAMA_E2E ? 2 : 1), `on-device replies (${localCards.length}): ${localCards.map((t) => `"${t}"`).join(" · ")}`);
  check(badge.includes(OLLAMA_MODEL), `the tray shows the on-device model (${badge.trim()})`);


  check(await tray(() => !!document.querySelector("charmly-tray").shadowRoot.querySelector(".vibe.careful")), "keeps the space-aware read on-device");
  if (!process.env.OLLAMA_E2E) {
    const sent = ollamaRequests.at(-1);
    check(sent?.model === "tiny:1b" && sent?.stream === true, "sent a streaming chat request to Ollama");
    const prompt = sent?.messages?.[1]?.content ?? "";
    check(prompt.includes("Voice preset: Work") && prompt.includes("- Use emojis"), "the Work preset's rules reach the model");
    check(prompt.includes("my manager, keep it brief"), "the chat note reaches the model");
    check(prompt.includes('Goal for later, not now: "ask them out for coffee"') && prompt.includes("step 2 of 4: bridge to the topic") && prompt.includes("Do not say or ask the goal yet"), "the goal's current step reaches the on-device model");
    check(!localCards.some((t) => /stress/i.test(t)) && /held back/.test(await tray(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".held")?.textContent ?? "")), "a word blocked in the preset is never shown");
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

  // Switch engines from the tray: open the engine menu, see the local models, pick Demo, then back to local.
  await (await shadow(".setup")).click();
  await page.waitForFunction(() => document.querySelector("charmly-tray").shadowRoot.querySelector(".s-engine [data-engine=local]"), { timeout: 10000 });
  const menuModels = await tray(() => [...document.querySelector("charmly-tray").shadowRoot.querySelectorAll(".s-engine [data-engine=local]")].map((b) => b.dataset.model));
  check(menuModels.includes(OLLAMA_MODEL), `the engine menu lists local models (${menuModels.join(", ")})`);
  await (await shadow('.s-engine [data-engine="demo"]')).click();
  await page.waitForFunction(() => /Demo/.test(document.querySelector("charmly-tray").shadowRoot.querySelector(".setup").textContent), { timeout: 5000 });
  check(true, "switches to Demo from the tray");
  await (await shadow(`.s-engine [data-model="${OLLAMA_MODEL}"]`)).click();
  await page.waitForFunction((m) => document.querySelector("charmly-tray").shadowRoot.querySelector(".setup").textContent.includes(m), { timeout: 5000 }, OLLAMA_MODEL);
  check(true, "and back to the local model");

  // ---- Beyond WhatsApp: any messaging site, through the layout reader, site hints, the shortcut and per-site switch.
  console.log("Charmly on other sites");
  const port = server.address().port;
  const lastPrompt = () => ollamaRequests.at(-1)?.messages?.[1]?.content ?? "";
  const transcript = () => lastPrompt().match(/<chat>\n([\s\S]*?)\n<\/chat>/)?.[1] ?? "";
  const fake = !process.env.OLLAMA_E2E;
  const other = await browser.newPage();
  const T = "document.querySelector('charmly-tray')";
  const oq = (expr) => other.evaluate(`(() => { const r = ${T}?.shadowRoot; return ${expr}; })()`);
  const oact = (sel) => other.evaluate(`${T}.shadowRoot.querySelector(${JSON.stringify(sel)}).click()`);
  const trayShown = () => other.evaluate(`!!${T} && ${T}.style.display !== 'none'`);
  const otherReady = () =>
    other.waitForFunction(() => {
      const r = document.querySelector("charmly-tray")?.shadowRoot;
      return r && (r.querySelector(".err") || (r.querySelectorAll("button.card").length >= 1 && !r.querySelector(".skeleton") && r.querySelector(".tray.ready")));
    }, { timeout: 90000 });
  const otherCards = () => oq("[...r.querySelectorAll('button.card .text')].map((e) => e.textContent)");
  const ext = async (fn, ...args) => {
    const p = await browser.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html`);
    const out = await p.evaluate(fn, ...args);
    await p.close();
    await other.bringToFront();
    return out;
  };
  const tabOf = (part) => ext(async (part) => (await chrome.tabs.query({})).find((t) => t.url?.includes(part))?.id, part);

  // A Messenger-style chat with obfuscated markup: read from layout alone.
  await other.goto(`http://127.0.0.1:${port}/bubbles.html`);
  await other.waitForFunction(() => document.querySelector("charmly-tray"), { timeout: 10000 });
  await sleep(500);
  check(!(await trayShown()), "on other sites, stays out of the way until you're in a message box");
  await other.click("[contenteditable]");
  await sleep(700);
  check(await trayShown(), "docks above the box you click into");
  await other.evaluate(() => window.chat.receive("we should totally do karaoke again 😂 are you free friday?"));
  await otherReady();
  if (fake)
    check(
      transcript() === "Them: hey! it was so fun meeting you at Arun's party 😊\nMe: haha same, your karaoke was legendary\nThem: omg don't remind me 🙈 what are you up to this week?\nThem: we should totally do karaoke again 😂 are you free friday?",
      `reads a bubble chat from its layout, sides and all (${JSON.stringify(transcript())})`,
    );
  const bubbleCards = await otherCards();
  check(bubbleCards.length >= 1, `suggests replies automatically on a new message (${bubbleCards.length})`);
  await oact("button.card");
  await sleep(300);
  check((await other.evaluate(() => window.chat.draft())) === bubbleCards[0], "inserts into the site's rich-text box");
  if (SHOTS) {
    await sleep(300);
    await other.screenshot({ path: resolve(ROOT, "../docs/anywhere.png") });
  }

  // A Slack-style channel: everyone on the left, names and times dropped, a plain textarea.
  await other.goto(`http://127.0.0.1:${port}/thread.html`);
  await other.waitForFunction(() => document.querySelector("charmly-tray"), { timeout: 10000 });
  await other.click("textarea");
  await sleep(500);
  await other.evaluate(() => window.chat.receive("does 8 work for everyone?", "Priya Raman"));
  await otherReady();
  if (fake)
    check(
      transcript() === "Them: anyone up for a hike on Saturday?\nThem: I'm in if it's not too early 😅\nThem: 8am start, coffee on the way, promise\nThem: does 8 work for everyone?",
      `reads a channel without names or times (${JSON.stringify(transcript())})`,
    );
  const threadCards = await otherCards();
  await oact("button.card");
  await sleep(300);
  check((await other.evaluate(() => window.chat.draft())) === threadCards[0], "inserts into a plain textarea");
  // Select one message to reply to just that.
  await other.keyboard.press("Escape");
  await other.evaluate(() => {
    const el = document.querySelectorAll(".x")[2];
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await sleep(700);
  check(/Reply to selected text/.test(await oq("r.textContent")), "offers to reply to text you select");
  await oact("[data-act=suggest]");
  await otherReady();
  if (fake) check(transcript() === "Them: 8am start, coffee on the way, promise", `answers just the selection (${JSON.stringify(transcript())})`);

  // LinkedIn's hints: direction from its markup, the chat's name from its header.
  await other.goto(`http://127.0.0.1:${port}/linkedin.html`);
  await other.waitForFunction(() => document.querySelector("charmly-tray"), { timeout: 10000 });
  await other.click(".msg-form__contenteditable");
  await sleep(500);
  await other.evaluate(() => window.chat.receive("Would Thursday at 4 work for a quick call?"));
  await otherReady();
  if (fake)
    check(
      transcript() === "Them: Hi Balaji, loved your talk on agent design last week!\nMe: Thank you Ananya, glad it was useful\nThem: We're hiring for an AI lead role, would you be open to a chat?\nThem: Would Thursday at 4 work for a quick call?",
      `site hints read LinkedIn's thread (${JSON.stringify(transcript())})`,
    );
  const health = await ext(async (id) => chrome.tabs.sendMessage(id, { type: "health" }), await tabOf("linkedin.html"));
  check(health?.site === "LinkedIn" && health.messages === 4, `knows it's on LinkedIn (${health?.site}, ${health?.messages} messages)`);

  // The shortcut, on a site Charmly isn't on: Chrome lets it in for that tab, and it opens on your box.
  await other.goto(`http://localhost:${port}/plain.html`);
  await sleep(500);
  check(!(await other.evaluate(() => !!document.querySelector("charmly-tray"))), "isn't on sites you haven't switched on");
  await other.click("#box");
  await ext(async (id) => chrome.runtime.sendMessage({ type: "activate-tab", tabId: id }), await tabOf("plain.html"));
  await other.waitForFunction(() => document.querySelector("charmly-tray")?.shadowRoot?.querySelector(".err, .card"), { timeout: 30000 });
  check(/Select the message you're replying to/.test(await oq("r.textContent")), "the shortcut loads Charmly into the tab and asks what to reply to when it can't tell");
  await other.keyboard.press("Escape");
  await other.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("q"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await sleep(500);
  await ext(async (id) => chrome.runtime.sendMessage({ type: "activate-tab", tabId: id }), await tabOf("plain.html"));
  await otherReady();
  if (fake) check(transcript() === "Them: Could you send me the deck from Tuesday's review when you get a chance?", "the shortcut replies to the selected message");
  await other.evaluate(() => {
    getSelection().removeAllRanges();
    const box = document.getElementById("box");
    box.focus();
    box.value = "sure will send it tonight";
  });
  await sleep(500);
  await ext(async (id) => chrome.runtime.sendMessage({ type: "activate-tab", tabId: id }), await tabOf("plain.html"));
  await otherReady();
  if (fake) check(lastPrompt().includes('The person has drafted: "sure will send it tonight"'), "with nothing to reply to, the shortcut polishes your draft");

  // Always on this site: registered for that site, so it loads by itself next time; off removes it.
  const origin = `http://localhost:${port}`;
  const on = await ext(async (o) => chrome.runtime.sendMessage({ type: "site", origin: o, on: true }), origin);
  check(on?.ok && on.sites.includes(origin), "switches a site on");
  await other.goto(`http://localhost:${port}/thread.html`);
  await other.waitForFunction(() => document.querySelector("charmly-tray"), { timeout: 10000 }).catch(() => {});
  check(await other.evaluate(() => !!document.querySelector("charmly-tray")), "and loads there by itself");
  await ext(async (o) => chrome.runtime.sendMessage({ type: "site", origin: o, on: false }), origin);
  await other.goto(`http://localhost:${port}/thread.html`);
  await sleep(800);
  check(!(await other.evaluate(() => !!document.querySelector("charmly-tray"))), "switching it off stops it");
  const manifest = await ext(async () => chrome.runtime.getManifest());
  check(manifest.commands?.activate?.suggested_key?.mac === "Alt+Shift+C", "ships the ⌥⇧C shortcut");
  await other.close();

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
