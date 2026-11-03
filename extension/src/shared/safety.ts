import type { Suggestion, Vibe } from "./types";

// Lines no suggestion should ever contain, whatever the tone.
const NEVER = [
  /\b(send|show) (me )?(nudes?|pics? of you)\b/i,
  /\b(stupid|idiot|dumb|ugly|loser)\b/i,
  // About a person, not a plan: "something crazy" is fine, "you're crazy" is not.
  /\byou('re| are)( so| such an?)? (crazy|fat|psycho)\b/i,
  // Pressure, not ordinary phrasing: "you must be so relieved" is fine, "you must reply" is not.
  /\b(you owe me|or else|why are(n't| you not) you replying|(you have to|you must|you need to) (reply|answer|respond|text me|call me|see me))\b/i,
  /\b(f+u+c+k+|s+h+i+t+|b+i+t+c+h+)\b/i,
];
// Pressure that is fine in banter but not when the other person is pulling back.
const PUSHY = [/\b(come on|just one|please please|don'?t be like that|why not|give me a chance)\b/i, /!{2,}/];
const INVENTED = [/\+?\d[\d\s-]{7,}\d/, /[\w.+-]+@[\w-]+\.[\w.]+/, /\b\d{1,5} [A-Z][a-z]+ (Street|St|Road|Rd|Avenue|Ave)\b/];

export type Verdict = { ok: boolean; text: string; reason?: string };

/** Clean or reject one suggestion. Deterministic, so it can't be talked out of a decision. */
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does the text contain a blocked word or phrase? Whole words only, so "hell" doesn't block "hello". */
export function blockedIn(text: string, blocked: string[]): string | null {
  for (const b of blocked) {
    const word = b.trim();
    if (word && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) return word;
  }
  return null;
}

export function check(s: Suggestion, vibe: Vibe | null, allowFlirty: boolean, blocked: string[] = []): Verdict {
  let text = s.text
    .replace(/\s*[\u2014\u2013]\s*/g, " - ") // house style: plain hyphens, never em or en dashes
    .replace(/^["“](.*)["”]$/, "$1")
    .trim();
  if (!text) return { ok: false, text, reason: "empty" };
  if (text.length > 400) return { ok: false, text, reason: "too long for a text" };
  if (NEVER.some((r) => r.test(text))) return { ok: false, text, reason: "unkind or crude" };
  const hit = blockedIn(text, blocked);
  if (hit) return { ok: false, text, reason: `uses "${hit}", which you blocked` };
  if (INVENTED.some((r) => r.test(text))) return { ok: false, text, reason: "contains contact details" };
  if (/\bas an ai\b|\blanguage model\b/i.test(text)) return { ok: false, text, reason: "breaks character" };
  if (s.tone === "flirty" && (!allowFlirty || vibe?.boundary)) return { ok: false, text, reason: "flirty is off for this chat" };
  if (vibe?.boundary && PUSHY.some((r) => r.test(text))) return { ok: false, text, reason: "too pushy for how they're feeling" };
  return { ok: true, text };
}
