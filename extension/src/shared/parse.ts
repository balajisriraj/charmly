import type { GoalRead } from "./goal";
import type { Suggestion, Vibe } from "./types";

/**
 * The writer streams one record per line, so suggestions can be shown the moment each line completes:
 *   VIBE|mood|intent|language|boundary
 *   GOAL|ahead|note                 (only when the person set a goal for the chat)
 *   1|tone|text|why
 * Lines that don't fit are ignored rather than shown.
 */
const KNOWN_TONES = /^(warm|playful|flirty|direct|caring|sweet|funny|gentle|honest|casual)$/i;

export class LineParser {
  private buffer = "";
  private count = 0;
  private pendingTone: string | null = null; // "1|playful" with the reply on the next line
  constructor(
    private readonly onVibe: (v: Vibe) => void,
    private readonly onSuggestion: (s: Suggestion) => void,
    private readonly max = 3,
    private readonly onGoal: (g: GoalRead) => void = () => {},
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
      .replace(/^vibe\s*[:|]\s*/i, "VIBE|")
      .replace(/^goal\s*[:|]\s*/i, "GOAL|");
    if (!line) return;
    const parts = line.split("|").map((p) => p.trim());
    if (parts[0].toUpperCase() === "VIBE" && parts.length >= 3) {
      this.vibe(parts.slice(1));
      return;
    }
    if (parts[0].toUpperCase() === "GOAL" && parts.length >= 2) {
      this.onGoal({ ahead: /^(yes|true|ahead)\b/i.test(parts[1]), note: (parts[2] ?? "").slice(0, 80) });
      return;
    }
    const pending = this.pendingTone;
    this.pendingTone = null;
    const n = Number(parts[0]);
    if (Number.isInteger(n) && n >= 1 && n <= 5 && parts.length === 2 && KNOWN_TONES.test(parts[1])) {
      this.pendingTone = parts[1];
      return;
    }
    if (pending && !Number.isInteger(n)) {
      const [text, why = ""] = parts;
      if (text) this.emit(pending, text, parts.length > 1 ? parts[parts.length - 1] : why);
      return;
    }
    if (Number.isInteger(n) && n >= 1 && n <= 5 && parts.length >= 3) {
      const tone = parts[1];
      if (/^tone$/i.test(tone) && /^reply$/i.test(parts[2])) return; // the model echoed the template
      if (/^(tone|reply|why|space|vibe|goal)$/i.test(parts[2].trim())) return;
      if (/^vibe$/i.test(tone)) {
        this.vibe(parts.slice(2));
        return;
      }
      // Replies never contain a pipe (the prompt says so), and small models add extra fields ("…|Friendly|why"),
      // so the reply is the third field and the rest is the why.
      const text = parts[2].replace(/^(reply|text|message)\s*:\s*/i, "").trim();
      const why = parts.slice(3).filter(Boolean).at(-1) ?? "";
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
