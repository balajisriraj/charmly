// Charmly on any site: the message box you're typing in, and the conversation above it.
//
// Most messengers draw your messages as bubbles on the right and theirs on the left, so the generic reader
// works from layout rather than markup: it finds the scrolling area above your box, groups its text into
// bubbles (blocks narrower than the conversation), and reads direction from which side each bubble sits on.
// Pages where everyone is on the left (Slack, Discord) still work: every message counts as theirs.
// Known sites add hints (selectors for messages and for "mine"), and fall back to layout when they miss.
import type { ChatMessage, Speaker } from "../shared/types";
import { darkBehind, insertInto, isField, valueOf } from "./insert";
import type { InsertResult, Site } from "./site";
import { textOf } from "./text";

export type Hints = {
  name: string;
  composer?: string; // the message box
  message?: string; // each message's text
  theirs?: string; // closest() match: they sent it (checked first)
  mine?: string; // closest() match: you sent it
  title?: string; // the open chat's name
};

/** Best-effort hints for popular web messengers. Their markup changes; layout is the fallback. */
export const HINTS: Record<string, Hints> = {
  "web.telegram.org": {
    name: "Telegram",
    composer: ".input-message-input[contenteditable='true'], #editable-message-text",
    message: ".bubble .message, .Message .text-content",
    theirs: ".is-in",
    mine: ".is-out, .own",
    title: ".chat-info .peer-title, .ChatInfo .fullName",
  },
  "www.messenger.com": { name: "Messenger", composer: "[role='textbox'][contenteditable='true']" },
  "www.facebook.com": { name: "Messenger", composer: "[role='textbox'][contenteditable='true']" },
  "www.instagram.com": { name: "Instagram", composer: "[role='textbox'][contenteditable='true'], textarea" },
  "www.linkedin.com": {
    name: "LinkedIn",
    composer: ".msg-form__contenteditable",
    message: ".msg-s-event-listitem__body",
    theirs: ".msg-s-event-listitem--other",
    mine: ".msg-s-event-listitem",
    title: ".msg-entity-lockup__entity-title",
  },
  "discord.com": { name: "Discord", composer: "[role='textbox'][data-slate-editor='true']", message: "[id^='message-content-']" },
  "app.slack.com": { name: "Slack", composer: "[data-qa='message_input'] [contenteditable='true'], .ql-editor", message: "[data-qa='message-text'], .c-message_kit__blocks" },
  "chat.google.com": { name: "Google Chat", composer: "[role='textbox'][contenteditable='true']" },
};

// Text that is chrome, not conversation: times, dates, delivery states, unread markers.
const CHROME = /^(\d{1,2}[:.]\d{2}(\s?[ap]\.?m\.?)?|today|yesterday|seen|delivered|read|sent|edited|new messages?|\d+ new messages?|typing…?|online|last seen.*|(mon|tue|wed|thu|fri|sat|sun)\w*|\w+ \d{1,2}(, \d{4})?)$/i;
const NOT_A_MESSAGE_BOX = /search|find|filter|subject|\bto\b|password|email|url|address/i;

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** A box someone writes a message in: a textarea or a rich editor, not a search field. */
export function isMessageBox(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("charmly-tray")) return false;
  const editable = el instanceof HTMLTextAreaElement || (el.isContentEditable && el.getAttribute("contenteditable") !== "false");
  if (!editable) return false;
  const label = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("type") ?? ""} ${el.getAttribute("role") === "searchbox" ? "search" : ""}`;
  if (NOT_A_MESSAGE_BOX.test(label)) return false;
  return el.getBoundingClientRect().width >= 150;
}

/** The outermost editable, so a rich editor's inner paragraphs resolve to the box itself. */
const rootEditable = (el: HTMLElement) => {
  let box = el;
  while (box.parentElement?.isContentEditable) box = box.parentElement;
  return box;
};

export class GenericSite implements Site {
  readonly generic = true;
  readonly name: string;
  private active: HTMLElement | null = null; // the last message box you used
  private area: { el: HTMLElement; box: HTMLElement; at: number } | null = null;

  constructor(
    private readonly hints: Hints | null = HINTS[location.host] ?? null,
    private readonly doc: Document = document,
  ) {
    this.name = hints?.name ?? location.host.replace(/^www\./, "");
    doc.addEventListener("focusin", (e) => {
      const el = e.target as HTMLElement;
      if (isMessageBox(el)) this.active = rootEditable(el);
    }, true);
  }

  composer(): HTMLElement | null {
    if (this.active?.isConnected && visible(this.active)) return this.active;
    const focused = this.doc.activeElement;
    if (isMessageBox(focused)) return (this.active = rootEditable(focused));
    if (this.hints?.composer) {
      const hinted = [...this.doc.querySelectorAll<HTMLElement>(this.hints.composer)].find(visible);
      if (hinted) return hinted;
    }
    return null;
  }

  main(): HTMLElement | null {
    return this.composer();
  }

  /** Dock above the box's own frame (its form or footer), not the bare text field. */
  anchor(): HTMLElement | null {
    const box = this.composer();
    if (!box) return null;
    const frame = box.closest<HTMLElement>("form, footer, [role='form']");
    return frame && frame.getBoundingClientRect().height < 260 ? frame : box;
  }

  chat(): string | null {
    const title = this.hints?.title ? this.doc.querySelector(this.hints.title)?.textContent?.trim() : "";
    const name = title || this.doc.title.replace(/^\(\d+\)\s*/, "").trim() || location.pathname;
    return `${this.name}: ${name}`.slice(0, 120);
  }

  draft(): string {
    const box = this.composer();
    return box ? valueOf(box) : "";
  }

  async insert(text: string): Promise<InsertResult> {
    const box = this.composer();
    return box ? insertInto(box, text) : "no-box";
  }

  dark(): boolean {
    return darkBehind(this.anchor(), this.doc);
  }

  health() {
    return { chat: !!this.composer(), messages: this.messages(50).length, composer: !!this.composer() };
  }

  lastKey(): string | null {
    const last = this.messages(1)[0];
    return last ? `${last.speaker === "me" ? "out" : "in"}:${last.text.slice(0, 80)}` : null;
  }

  messages(limit = 12): ChatMessage[] {
    const box = this.composer();
    if (!box) return [];
    const area = this.conversation(box);
    if (!area) return [];
    const hinted = this.hints?.message ? this.fromHints(area) : [];
    const out = hinted.length ? hinted : this.fromLayout(area, box);
    return out.slice(-limit);
  }

  /**
   * The conversation: the scrolling region just above the message box. Probing the points just above the box
   * finds it directly (and cheaply, even on huge apps); cached for a few seconds.
   */
  conversation(box: HTMLElement): HTMLElement | null {
    if (this.area && this.area.box === box && this.area.el.isConnected && performance.now() - this.area.at < 4000) return this.area.el;
    const b = this.anchor()?.getBoundingClientRect() ?? box.getBoundingClientRect();
    const y = b.top - 40;
    let found: HTMLElement | null = null;
    let fallback: HTMLElement | null = null;
    if (y > 0) {
      for (const x of [b.left + b.width / 2, b.left + b.width * 0.2, b.left + b.width * 0.8]) {
        for (const el of this.doc.elementsFromPoint(x, y)) {
          if (!(el instanceof HTMLElement) || el.closest("charmly-tray") || el.contains(box) || el === this.doc.body || el === this.doc.documentElement) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 120) continue;
          if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.getAttribute("role") === "log") {
            found = el;
            break;
          }
          fallback ??= el;
        }
        if (found) break;
      }
    }
    const el = found ?? fallback;
    if (el) this.area = { el, box, at: performance.now() };
    return el;
  }

  private fromHints(area: HTMLElement): ChatMessage[] {
    const nodes = [...area.querySelectorAll<HTMLElement>(this.hints!.message!)].filter(visible).slice(-60);
    const out: ChatMessage[] = [];
    const sides: (Speaker | null)[] = nodes.map((n) => this.hintedSpeaker(n));
    const fallback = this.sides(nodes, area);
    nodes.forEach((n, i) => {
      const text = clean(textOf(n));
      if (text) out.push({ speaker: sides[i] ?? fallback[i], text });
    });
    return out;
  }

  private hintedSpeaker(n: Element): Speaker | null {
    if (this.hints?.theirs && n.closest(this.hints.theirs)) return "them";
    if (this.hints?.mine && n.closest(this.hints.mine)) return "me";
    return null;
  }

  /**
   * Group the conversation's text into bubbles. A bubble is the widest ancestor of a piece of text that is
   * still clearly narrower than the conversation; on full-width layouts, it's the row the text sits in.
   */
  private fromLayout(area: HTMLElement, box: HTMLElement): ChatMessage[] {
    const width = area.getBoundingClientRect().width;
    const walker = this.doc.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    const pieces: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      if (!t.data.trim() || !t.parentElement || t.parentElement.closest("script, style, button, [contenteditable='true'], textarea, charmly-tray")) continue;
      if (box.contains(t)) continue;
      pieces.push(t);
    }
    const groups = new Map<HTMLElement, string[]>();
    for (const t of pieces.slice(-600)) {
      const el = t.parentElement!;
      if (!visible(el)) continue;
      // The box the text sits in (skipping inline wrappers like <b> or <span>).
      let block: HTMLElement = el;
      while (block.parentElement && block !== area && /^(inline|contents)$/.test(getComputedStyle(block).display)) block = block.parentElement;
      let bubble = block;
      if (block.getBoundingClientRect().width < width * 0.8) {
        // A bubble: the widest box around it that is still clearly narrower than the conversation.
        for (let up = block.parentElement; up && up !== area; up = up.parentElement) {
          const r = up.getBoundingClientRect();
          if (r.width >= width * 0.8 || r.height > 400) break;
          bubble = up;
        }
      } else {
        // Full-width rows (everyone on the left): the row is the message.
        for (let up = block.parentElement; up && up !== area; up = up.parentElement) {
          if (up.getBoundingClientRect().height > 160) break;
          bubble = up;
        }
      }
      const list = groups.get(bubble) ?? [];
      list.push(t.data);
      groups.set(bubble, list);
    }
    // Drop bubbles nested inside other bubbles (keep the outer one), and pure chrome.
    const bubbles = [...groups.keys()].filter((b) => ![...groups.keys()].some((o) => o !== b && o.contains(b)));
    const entries = bubbles
      .map((b) => ({ b, text: clean([...groups.entries()].filter(([k]) => b.contains(k)).flatMap(([, v]) => v).join("\n")) }))
      .filter((x) => x.text);
    const sides = this.sides(entries.map((x) => x.b), area);
    return entries.map((x, i) => ({ speaker: sides[i], text: x.text }));
  }

  /** Which side each bubble sits on. If nothing sits on the right, it's an everyone-on-the-left layout. */
  private sides(nodes: Element[], area: HTMLElement): Speaker[] {
    const a = area.getBoundingClientRect();
    const rtl = getComputedStyle(area).direction === "rtl";
    const raw = nodes.map((n) => {
      const r = n.getBoundingClientRect();
      const left = r.left - a.left;
      const right = a.right - r.right;
      if (Math.abs(left - right) < 24) return null; // centred: a date or system line
      return right < left !== rtl ? "me" : "them";
    });
    const anyMine = raw.includes("me");
    return raw.map((s) => (anyMine ? (s ?? "them") : "them"));
  }
}

/** Keep the words, drop times, dates and delivery states; drop a leading name on multi-line rows. */
export function clean(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/[‎‏]/g, "").trim())
    .filter((l) => l && !CHROME.test(l));
  if (lines.length > 1 && /^[A-Z][\p{L}'.-]*( [A-Z][\p{L}'.-]*){0,2}$/u.test(lines[0]) && lines[0].length < 30) lines.shift();
  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 1200);
}

export { isField };
