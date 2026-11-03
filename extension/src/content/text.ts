// Reading text out of chat markup.

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
