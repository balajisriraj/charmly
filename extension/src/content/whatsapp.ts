// Everything Charmly knows about WhatsApp Web's page lives here, so a markup change means editing one file.
// Selectors prefer long-lived hooks (ids, roles, data attributes) and fall back gracefully.
import type { ChatMessage, Speaker } from "../shared/types";

const SEL = {
  main: ["#main", "[data-testid='conversation-panel-wrapper']"],
  title: ["#main header span[title]", "#main header [dir='auto']", "#main header"],
  message: ["#main [data-pre-plain-text]"],
  composer: [
    "#main footer div[contenteditable='true'][role='textbox']",
    "#main footer div[contenteditable='true'][data-tab]",
    "#main footer div[contenteditable='true']",
  ],
  footer: ["#main footer"],
};

const first = <T extends Element>(root: ParentNode, selectors: string[]): T | null => {
  for (const s of selectors) {
    const el = root.querySelector<T>(s);
    if (el) return el;
  }
  return null;
};

/** Compare composer text loosely: editors add non-breaking spaces, trailing newlines and zero-width marks. */
export const same = (a: string, b: string) => {
  const norm = (x: string) => x.replace(/[\u00a0\u202f]/g, " ").replace(/[\u200b-\u200f\ufeff]/g, "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
};

/** Text of a message, keeping emoji (WhatsApp renders them as <img alt="😂">) and dropping UI chrome. */
export function textOf(el: Element): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? "";
    else if (node instanceof HTMLImageElement) out += node.alt ?? "";
    else if (node instanceof HTMLBRElement) out += "\n";
    else node.childNodes.forEach(walk);
  };
  walk(el);
  return out.replace(/‎|‏/g, "").trim();
}

export class WhatsApp {
  constructor(private readonly doc: Document = document) {}

  main(): HTMLElement | null {
    return first(this.doc, SEL.main);
  }

  /** The open chat's name, used only to keep per-chat state in the browser. */
  chat(): string | null {
    const el = first<HTMLElement>(this.doc, SEL.title);
    return el ? (el.getAttribute("title") || el.textContent || "").trim() || null : null;
  }

  composer(): HTMLElement | null {
    return first(this.doc, SEL.composer);
  }

  footer(): HTMLElement | null {
    return first(this.doc, SEL.footer);
  }

  /**
   * Who sent a message. WhatsApp has changed this markup over time, so the checks go from most to least explicit:
   * the old .message-in/.message-out classes, then the bubble's tail icon (tail-out / tail-in, present on the first
   * message of a group), then the bubble's side of the conversation (sent messages sit on the right, mirrored in RTL).
   */
  speakerOf(node: Element): Speaker | null {
    if (node.closest(".message-out")) return "me";
    if (node.closest(".message-in")) return "them";
    const row = node.closest("[data-id]") ?? node.closest("[data-testid='msg-container']") ?? node.parentElement;
    if (row?.querySelector("[data-icon='tail-out']")) return "me";
    if (row?.querySelector("[data-icon='tail-in']")) return "them";
    const main = this.main();
    const bubble = node.closest("[data-testid='msg-container']") ?? node;
    const r = bubble.getBoundingClientRect();
    const m = main?.getBoundingClientRect();
    if (!m || !m.width || !r.width) return null;
    const right = (r.left + r.right) / 2 - m.left > m.width / 2;
    const rtl = getComputedStyle(main!).direction === "rtl";
    return right !== rtl ? "me" : "them";
  }

  /** The last `limit` text messages in the open chat, oldest first. Names are never included. */
  messages(limit = 12): ChatMessage[] {
    const nodes = [...this.doc.querySelectorAll<HTMLElement>(SEL.message.join(","))];
    const out: ChatMessage[] = [];
    for (const node of nodes.slice(-limit * 2)) {
      const speaker = this.speakerOf(node);
      if (!speaker) continue;
      const body = node.querySelector(".selectable-text") ?? node;
      const text = textOf(body);
      if (!text) continue;
      const time = node.getAttribute("data-pre-plain-text")?.match(/\[([^,\]]+)/)?.[1]?.trim();
      out.push({ speaker, text, time });
    }
    return out.slice(-limit);
  }

  /** A key for the latest message, so the observer can tell when something new arrived. */
  lastKey(): string | null {
    const nodes = this.doc.querySelectorAll<HTMLElement>(SEL.message.join(","));
    const last = nodes[nodes.length - 1];
    if (!last) return null;
    const dir = this.speakerOf(last) === "me" ? "out" : "in";
    return `${dir}:${last.getAttribute("data-pre-plain-text")}:${textOf(last).slice(0, 80)}`;
  }

  draft(): string {
    const c = this.composer();
    return c ? textOf(c) : "";
  }

  /**
   * Put text in the message box without sending it.
   *
   * WhatsApp's editor (Lexical) owns its own state: writing to the DOM directly is ignored or undone, and
   * text arrives a frame or two after the input event. So: select what's there, go through the editor's own
   * input path (insertText, then a synthetic paste), and wait for the editor to render before checking.
   */
  async insert(text: string): Promise<"ok" | "no-box" | "not-applied"> {
    const box = this.composer();
    if (!box) return "no-box";
    const landed = async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 30));
        if (same(textOf(box), text)) return true;
      }
      return false;
    };
    const selectAll = () => {
      box.focus();
      const range = this.doc.createRange();
      range.selectNodeContents(box);
      const selection = this.doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    selectAll();
    if (this.doc.execCommand?.("insertText", false, text) && (await landed())) return "ok";

    selectAll();
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      if (await landed()) return "ok";
    } catch {
      /* ClipboardEvent construction can fail in some contexts */
    }

    // Plain contenteditable (no editor framework): writing the text and announcing it is enough.
    if (!box.hasAttribute("data-lexical-editor")) {
      box.textContent = text;
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      if (await landed()) return "ok";
    }
    return "not-applied";
  }

  /**
   * Whether WhatsApp is showing its dark theme. Users can override the system setting inside WhatsApp, so
   * this reads what's actually on screen: the brightness of the chat's own background.
   */
  dark(): boolean {
    const b = this.doc.body;
    if (b.classList.contains("dark") || b.dataset.theme === "dark") return true;
    let el: Element | null = this.footer() ?? this.main() ?? b;
    while (el) {
      const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number);
      if (m && (m.length < 4 || m[3] > 0.5)) return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.45;
      el = el.parentElement;
    }
    return false;
  }

  /** What Charmly can see right now, shown in the popup so a WhatsApp redesign is obvious rather than silent. */
  health() {
    return { chat: !!this.main(), messages: this.messages(50).length, composer: !!this.composer() };
  }
}
