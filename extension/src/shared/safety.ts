import type { Suggestion, Vibe } from "./types";

// Lines no suggestion should ever contain, whatever the tone.
const NEVER = [
  /\b(send|show) (me )?(nudes?|pics? of you)\b/i,
  /\b(stupid|idiot|dumb|ugly|fat|loser|crazy)\b/i,
  // Pressure, not ordinary phrasing: "you must be so relieved" is fine, "you must reply" is not.
  /\b(you owe me|or else|why are(n't| you not) you replying|(you have to|you must|you need to) (reply|answer|respond|text me|call me|see me))\b/i,
  /\b(f+u+c+k+|s+h+i+t+|b+i+t+c+h+)\b/i,
];
// Pressure that is fine in banter but not when the other person is pulling back.
const PUSHY = [/\b(come on|just one|please please|don'?t be like that|why not|give me a chance)\b/i, /!{2,}/];
const INVENTED = [/\+?\d[\d\s-]{7,}\d/, /[\w.+-]+@[\w-]+\.[\w.]+/, /\b\d{1,5} [A-Z][a-z]+ (Street|St|Road|Rd|Avenue|Ave)\b/];

export type Verdict = { ok: boolean; text: string; reason?: string };

/** Clean or reject one suggestion. Deterministic, so it can't be talked out of a decision. */
export function check(s: Suggestion, vibe: Vibe | null, allowFlirty: boolean): Verdict {
  let text = s.text
    .replace(/\s*[\u2014\u2013]\s*/g, " - ") // house style: plain hyphens, never em or en dashes
    .replace(/^["“](.*)["”]$/, "$1")
    .trim();
  if (!text) return { ok: false, text, reason: "empty" };
  if (text.length > 400) return { ok: false, text, reason: "too long for a text" };
  if (NEVER.some((r) => r.test(text))) return { ok: false, text, reason: "unkind or crude" };
  if (INVENTED.some((r) => r.test(text))) return { ok: false, text, reason: "contains contact details" };
  if (/\bas an ai\b|\blanguage model\b/i.test(text)) return { ok: false, text, reason: "breaks character" };
  if (s.tone === "flirty" && (!allowFlirty || vibe?.boundary)) return { ok: false, text, reason: "flirty is off for this chat" };
  if (vibe?.boundary && PUSHY.some((r) => r.test(text))) return { ok: false, text, reason: "too pushy for how they're feeling" };
  return { ok: true, text };
}
