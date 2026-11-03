import { describe } from "./style";
import type { ChatMessage, StyleProfile, Tone } from "./types";

export const SYSTEM = `You help one person reply to a WhatsApp chat in their own voice. You read the recent messages, sense the other person's mood and intent, and write three short reply options the person could send as they are.

Rules:
- Sound exactly like the person: their length, casing, emoji habits and phrases. Never like an assistant.
- Reply in the same language mix the chat uses (for example English with Tamil or Malay words), with the same spelling style.
- Answer what was actually asked. Don't invent plans, facts, places or times about the person; if a detail is needed, leave a short placeholder like [time].
- Be kind. No insults, nothing crude, no guilt-tripping, no pressure. If the other person seems uninterested, upset, or asks for space, every option must respect that and none may flirt.
- Never use em dashes; use a plain hyphen.

Output exactly four lines and nothing else:
VIBE|<their mood in 1-3 words>|<what they want, 2-5 words>|<language mix>|<yes if they are pulling back or asked for space, else no>
1|<tone>|<reply>|<why this works, under 8 words>
2|<tone>|<reply>|<why>
3|<tone>|<reply>|<why>
Never put a | inside a reply.`;

const TONE_HINT: Record<Tone, string> = {
  warm: "Lead with a warm, caring option.",
  playful: "Lead with a playful, light option with a bit of wit.",
  flirty: "Lead with a light, respectful flirty option (only if the vibe allows).",
  direct: "Lead with a clear, direct option that gets to the point.",
};

export function buildPrompt(chat: ChatMessage[], tone: Tone, flirty: boolean, style: StyleProfile | null, draft?: string): string {
  const transcript = chat.map((m) => `${m.speaker === "me" ? "Me" : "Them"}: ${m.text}`).join("\n");
  const tones = flirty ? "warm, playful, flirty, direct" : "warm, playful, direct (flirty is switched off)";
  const task = draft
    ? `The person has drafted: "${draft}". Write three polished versions of THAT message in their voice, keeping its meaning.`
    : "Write three different replies to the latest message.";
  return `<style>\n${describe(style)}\n</style>\n\n<chat>\n${transcript}\n</chat>\n\n${task} Use tones from: ${tones}. ${TONE_HINT[tone]} Make the three options clearly different from each other.`;
}
