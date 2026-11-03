import type { Suggestion, Vibe } from "./types";

/**
 * The writer streams one record per line, so suggestions can be shown the moment each line completes:
 *   VIBE|mood|intent|language|boundary
 *   1|tone|text|why
 * Lines that don't fit are ignored rather than shown.
 */
export class LineParser {
  private buffer = "";
  constructor(
    private readonly onVibe: (v: Vibe) => void,
    private readonly onSuggestion: (s: Suggestion) => void,
  ) {}

  push(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    lines.forEach((l) => this.line(l));
  }

  end() {
    if (this.buffer.trim()) this.line(this.buffer);
    this.buffer = "";
  }

  private line(raw: string) {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    if (!line) return;
    const parts = line.split("|").map((p) => p.trim());
    if (parts[0].toUpperCase() === "VIBE" && parts.length >= 5) {
      this.onVibe({ mood: parts[1], intent: parts[2], language: parts[3], boundary: /^(yes|true)$/i.test(parts[4]) });
      return;
    }
    const n = Number(parts[0]);
    if (Number.isInteger(n) && n >= 1 && n <= 5 && parts.length >= 3) {
      // Text may itself contain a pipe; everything between tone and the last field is text.
      const why = parts.length >= 4 ? parts[parts.length - 1] : "";
      const text = parts.slice(2, parts.length >= 4 ? -1 : undefined).join(" | ");
      if (text) this.onSuggestion({ n, tone: parts[1].toLowerCase(), text, why });
    }
  }
}
