// Putting text into a message box the way a person would, so the page's own editor keeps its state.
import { same, textOf } from "./text";

export const isField = (el: Element | null): el is HTMLTextAreaElement | HTMLInputElement => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

/** What's typed in a box, for a textarea or a rich editor alike. */
export const valueOf = (box: HTMLElement) => (isField(box) ? box.value : textOf(box));

/**
 * Replace the box's content with `text` without sending anything.
 *
 * Rich editors (Lexical, Slate, Draft, Quill) own their state: writing to the DOM directly is ignored or undone,
 * and text arrives a frame or two after the input event. So: select what's there, go through the editor's own
 * input path (insertText, then a synthetic paste), and wait for it to render before checking.
 */
export async function insertInto(box: HTMLElement, text: string): Promise<"ok" | "not-applied"> {
  const doc = box.ownerDocument;
  const landed = async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 30));
      if (same(valueOf(box), text)) return true;
    }
    return false;
  };

  if (isField(box)) {
    box.focus();
    box.select();
    if (doc.execCommand?.("insertText", false, text) && (await landed())) return "ok";
    // React and friends track the value through the prototype setter, so set it there and announce it.
    const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(box, text);
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return (await landed()) ? "ok" : "not-applied";
  }

  const selectAll = () => {
    box.focus();
    const range = doc.createRange();
    range.selectNodeContents(box);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  selectAll();
  if (doc.execCommand?.("insertText", false, text) && (await landed())) return "ok";

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
  if (!box.matches("[data-lexical-editor], [data-slate-editor], .DraftEditor-root *, .public-DraftEditor-content")) {
    box.textContent = text;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    if (await landed()) return "ok";
  }
  return "not-applied";
}

/** Whether WhatsApp, or any page, is showing a dark theme: the brightness of what's actually behind the box. */
export function darkBehind(start: Element | null, doc: Document = document): boolean {
  const b = doc.body;
  if (b.classList.contains("dark") || b.dataset.theme === "dark" || doc.documentElement.dataset.theme === "dark") return true;
  let el: Element | null = start ?? b;
  while (el) {
    const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number);
    if (m && (m.length < 4 || m[3] > 0.5)) return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.45;
    el = el.parentElement;
  }
  return false;
}
