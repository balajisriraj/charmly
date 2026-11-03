import type { Suggestion, Vibe } from "./types";

/**
 * The writer streams one record per line, so suggestions can be shown the moment each line completes:
 *   VIBE|mood|intent|language|boundary
 *   1|tone|text|why
 * Lines that don't fit are ignored rather than shown.
 */
const KNOWN_TONES = /^(warm|playful|flirty|direct|caring|sweet|funny|gentle|honest|casual)$/i;

export class LineParser {
  private buffer = "";
  private count = 0;
  constructor(
    private readonly onVibe: (v: Vibe) => void,
    private readonly onSuggestion: (s: Suggestion) => void,
    private readonly max = 3,
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

  get suggestions() {
    return this.count;
  }

  private emit(tone: string, text: string, why: string) {
    if (this.count >= this.max) return;
    this.onSuggestion({ n: ++this.count, tone: tone.toLowerCase(), text, why });
  }

  private line(raw: string) {
    // Small models drift from the format: "1. warm | …", "**1**|…", "VIBE: …", "Warm: …". Normalise the common ones.
    const line = raw
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/^(\d)\s*[.)]\s*\|?\s*/, "$1|")
      .replace(/^vibe\s*[:|]\s*/i, "VIBE|");
    if (!line) return;
    const parts = line.split("|").map((p) => p.trim());
    if (parts[0].toUpperCase() === "VIBE" && parts.length >= 3) {
      this.vibe(parts.slice(1));
      return;
    }
    const n = Number(parts[0]);
    if (Number.isInteger(n) && n >= 1 && n <= 5 && parts.length >= 3) {
      const tone = parts[1];
      if (/^tone$/i.test(tone) && /^reply$/i.test(parts[2])) return; // the model echoed the template
      if (/^vibe$/i.test(tone)) {
        this.vibe(parts.slice(2));
        return;
      }
      // Text may itself contain a pipe; everything between tone and the last field is text.
      const why = parts.length >= 4 ? parts[parts.length - 1] : "";
      const text = parts.slice(2, parts.length >= 4 ? -1 : undefined).join(" | ");
      if (text) this.emit(KNOWN_TONES.test(tone) ? tone : "warm", text, why);
      return;
    }
    // Un-numbered "Warm|reply|why" or "Warm: reply".
    const labelled = line.match(/^([A-Za-z]+)\s*[|:]\s*(.+)$/);
    if (labelled && KNOWN_TONES.test(labelled[1])) {
      const [text, why = ""] = labelled[2].split("|").map((x) => x.trim());
      if (text) this.emit(labelled[1], text, why);
    }
  }

  private vibe(parts: string[]) {
    const [mood = "", intent = "", language = "", boundary = "no"] = parts;
    this.onVibe({ mood, intent, language: language || "English", boundary: /^(yes|true)$/i.test(boundary) });
  }
}
