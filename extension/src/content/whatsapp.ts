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

  /** The last `limit` text messages in the open chat, oldest first. Names are never included. */
  messages(limit = 12): ChatMessage[] {
    const nodes = [...this.doc.querySelectorAll<HTMLElement>(SEL.message.join(","))];
    const out: ChatMessage[] = [];
    for (const node of nodes.slice(-limit * 2)) {
      const speaker: Speaker | null = node.closest(".message-out") ? "me" : node.closest(".message-in") ? "them" : null;
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
    const dir = last.closest(".message-out") ? "out" : "in";
    return `${dir}:${last.getAttribute("data-pre-plain-text")}:${textOf(last).slice(0, 80)}`;
  }

  draft(): string {
    const c = this.composer();
    return c ? textOf(c) : "";
  }

  /**
   * Put text in the message box without sending it. WhatsApp's editor keeps its own state, so writing to
   * the DOM directly doesn't stick; insertText (or a synthetic paste) goes through the editor's input path.
   */
  insert(text: string): boolean {
    const box = this.composer();
    if (!box) return false;
    box.focus();
    const selection = this.doc.getSelection();
    const range = this.doc.createRange();
    range.selectNodeContents(box);
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (this.doc.execCommand?.("insertText", false, text) && textOf(box) === text) return true;
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      if (textOf(box) === text) return true;
    } catch {
      /* fall through */
    }
    box.textContent = text;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return textOf(box) === text;
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
