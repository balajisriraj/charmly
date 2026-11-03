import type { StyleProfile } from "./types";

const EMOJI = /\p{Extended_Pictographic}/gu;
const FILLERS = ["haha", "hahaha", "lol", "lmao", "hehe", "omg", "btw", "tbh", "ya", "yeah", "yep", "nah", "da", "la", "lah", "bro", "dude", "ok", "okay", "kk", "hmm"];

/** A summary of how you text, computed in the browser from your own sent messages. Nothing here leaves the device except as prompt guidance. */
export function profile(mine: string[], previous?: StyleProfile): StyleProfile {
  const texts = [...mine.map((t) => t.trim()).filter(Boolean), ...(previous?.samples ?? [])];
  const unique = [...new Set(texts)].slice(0, 200);
  const n = unique.length || 1;
  const words = unique.map((t) => t.split(/\s+/).length).sort((a, b) => a - b);
  const emojis = unique.flatMap((t) => t.match(EMOJI) ?? []);
  const counts = new Map<string, number>();
  emojis.forEach((e) => counts.set(e, (counts.get(e) ?? 0) + 1));
  const lowerWords = unique.flatMap((t) => t.toLowerCase().match(/[a-z]+/g) ?? []);
  const fillers = FILLERS.filter((f) => lowerWords.filter((w) => w === f).length >= Math.max(2, n * 0.08));

  return {
    samples: unique.filter((t) => t.length <= 120).slice(0, 12),
    messages: Math.max(unique.length, previous?.messages ?? 0),
    medianWords: words.length ? words[Math.floor(words.length / 2)] : 0,
    emojiRate: round(emojis.length / n),
    topEmojis: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e]) => e),
    lowercaseStart: round(unique.filter((t) => /^[a-z]/.test(t)).length / n),
    exclaimRate: round(unique.filter((t) => t.includes("!")).length / n),
    questionRate: round(unique.filter((t) => t.includes("?")).length / n),
    endsWithPeriod: round(unique.filter((t) => /\.$/.test(t)).length / n),
    fillers,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** The profile as instructions the writer can follow. */
export function describe(p: StyleProfile | null): string {
  if (!p || p.messages < 3) return "No style data yet: write naturally, short and casual, like a real text.";
  const lines = [
    `Usually about ${p.medianWords} words per message.`,
    p.lowercaseStart > 0.6 ? "Often starts messages in lowercase." : "Starts messages with a capital letter.",
    p.emojiRate >= 0.5 ? `Uses emojis often (${p.topEmojis.join(" ")}).` : p.emojiRate > 0.1 ? `Uses the odd emoji (${p.topEmojis.join(" ")}).` : "Rarely uses emojis.",
    p.endsWithPeriod < 0.2 ? "Rarely ends with a full stop." : "Often ends with a full stop.",
    p.exclaimRate > 0.3 ? "Uses exclamation marks a lot." : "",
    p.fillers.length ? `Says things like: ${p.fillers.join(", ")}.` : "",
  ];
  const examples = p.samples.slice(0, 6).map((s) => `  "${s}"`).join("\n");
  return `${lines.filter(Boolean).join(" ")}\nExamples of how they text:\n${examples}`;
}
