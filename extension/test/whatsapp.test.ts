import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { textOf, WhatsApp } from "../src/content/whatsapp";

// Load the test page's markup (without running its script) and build messages the same way it does.
function page(messages: [string, string, string][]) {
  const html = readFileSync(resolve(process.cwd(), "fixtures/chat.html"), "utf8").replace(/<script>[\s\S]*<\/script>/, "");
  document.documentElement.innerHTML = html;
  const list = document.getElementById("list")!;
  messages.forEach(([dir, name, text], i) => {
    list.insertAdjacentHTML(
      "beforeend",
      `<div role="row"><div class="message-${dir}"><div class="copyable-text" data-pre-plain-text="[10:0${i}, 03/11/2026] ${name}: "><span class="selectable-text"><span>${text}</span></span></div><span class="meta">10:0${i}</span></div></div>`,
    );
  });
}

describe("WhatsApp adapter", () => {
  beforeEach(() =>
    page([
      ["out", "Me", "hey!"],
      ["in", "Ananya", 'guess what <img class="emoji" alt="🥳">'],
      ["in", "Ananya", "I got the job"],
    ]),
  );

  it("reads messages with direction and emoji, oldest first, without names", () => {
    const wa = new WhatsApp(document);
    expect(wa.messages()).toEqual([
      { speaker: "me", text: "hey!", time: "10:00" },
      { speaker: "them", text: "guess what 🥳", time: "10:01" },
      { speaker: "them", text: "I got the job", time: "10:02" },
    ]);
    expect(JSON.stringify(wa.messages())).not.toContain("Ananya");
  });

  it("limits context and keys the latest message by direction", () => {
    const wa = new WhatsApp(document);
    expect(wa.messages(2).map((m) => m.text)).toEqual(["guess what 🥳", "I got the job"]);
    expect(wa.lastKey()).toMatch(/^in:/);
  });

  it("finds the chat, the composer and reports health", () => {
    const wa = new WhatsApp(document);
    expect(wa.chat()).toBe("Ananya");
    expect(wa.composer()?.getAttribute("role")).toBe("textbox");
    expect(wa.health()).toEqual({ chat: true, messages: 3, composer: true });
  });

  it("inserts into the composer without sending", async () => {
    const wa = new WhatsApp(document);
    expect(await wa.insert("on my way 😊")).toBe("ok");
    expect(wa.draft()).toBe("on my way 😊");
    expect(wa.messages()).toHaveLength(3);
  });

  it("degrades to an empty, unhealthy view when the page isn't a chat", async () => {
    document.body.innerHTML = "<div>login screen</div>";
    const wa = new WhatsApp(document);
    expect(wa.messages()).toEqual([]);
    expect(wa.health()).toEqual({ chat: false, messages: 0, composer: false });
    expect(await wa.insert("x")).toBe("no-box");
  });

  it("reads direction from tail icons when the old classes are gone", () => {
    document.body.innerHTML = `<div id="main"><header><span dir="auto">x</span></header>
      <div data-id="A1"><div data-testid="msg-container"><span data-icon="tail-out"></span><div data-pre-plain-text="[10:00, 03/11/2026] Me: "><span class="selectable-text">sent one</span></div></div></div>
      <div data-id="B2"><div data-testid="msg-container"><span data-icon="tail-in"></span><div data-pre-plain-text="[10:01, 03/11/2026] X: "><span class="selectable-text">got one</span></div></div></div>
      <footer><div contenteditable="true" role="textbox" data-lexical-editor="true"><p class="selectable-text"><br></p></div></footer></div>`;
    const wa = new WhatsApp(document);
    expect(wa.messages().map((m) => `${m.speaker}:${m.text}`)).toEqual(["me:sent one", "them:got one"]);
    expect(wa.lastKey()).toMatch(/^in:/);
  });

  it("extracts text with line breaks and strips direction marks", () => {
    const el = document.createElement("span");
    el.innerHTML = "‎line one<br>line two";
    expect(textOf(el)).toBe("line one\nline two");
  });
});

describe("generic sites", () => {
  it("keeps the words and drops names, times and delivery states", async () => {
    const { clean } = await import("../src/content/generic");
    expect(clean("Priya Raman\n10:42 AM\nanyone up for a hike?")).toBe("anyone up for a hike?");
    expect(clean("omg same 😂\n10:41")).toBe("omg same 😂");
    expect(clean("Today")).toBe("");
    expect(clean("Seen")).toBe("");
    expect(clean("I'm in, see you at 8")).toBe("I'm in, see you at 8");
  });
  it("knows a message box from a search field", async () => {
    const { isMessageBox } = await import("../src/content/generic");
    document.body.innerHTML = `<textarea id="a" placeholder="Message #general"></textarea><textarea id="b" placeholder="Search messages"></textarea><div id="c" contenteditable="true" aria-label="Write a message"></div><input id="d" type="text">`;
    // jsdom has no layout, so give the boxes a size.
    for (const el of document.querySelectorAll<HTMLElement>("textarea, div, input")) el.getBoundingClientRect = () => ({ width: 400, height: 40 }) as DOMRect;
    const el = (id: string) => document.getElementById(id);
    expect(isMessageBox(el("a"))).toBe(true);
    expect(isMessageBox(el("b"))).toBe(false);
    expect(isMessageBox(el("d"))).toBe(false); // single-line inputs are forms, not chats
  });
});
