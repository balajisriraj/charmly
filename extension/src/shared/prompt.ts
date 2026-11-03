import { describe } from "./style";
import { type Goal, PLANS, stepOf } from "./goal";
import type { ChatMessage, Rules, StyleProfile, Tone } from "./types";

export const SYSTEM = `You help one person reply to a WhatsApp chat in their own voice. You read the recent messages, sense the other person's mood and intent, and write three short reply options the person could send as they are.

Rules:
- Sound exactly like the person: their length, casing, emoji habits and phrases. Never like an assistant.
- Reply in the same language mix the chat uses (for example English with Tamil or Malay words), with the same spelling style.
- Answer what was actually asked. Don't invent plans, facts, places or times about the person; if a detail is needed, leave a short placeholder like [time].
- Match the chat's register. Between friends, teasing, roasting and swearing are fine when the chat already talks that way; don't add them where it doesn't.
- No guilt-tripping or pressure. If the other person seems uninterested, upset, or asks for space, every option must respect that and none may flirt.
- Never use em dashes; use a plain hyphen.

Output exactly four lines and nothing else (five when the person set a goal):
VIBE|<their mood in 1-3 words>|<what they want, 2-5 words>|<language mix>|<yes if they are pulling back or asked for space, else no>
GOAL|<yes or no>|<what this step does>   (only when there is a <goal>)
1|<tone>|<reply>|<why this works, under 8 words>
2|<tone>|<reply>|<why>
3|<tone>|<reply>|<why>
Never put a | inside a reply.`;

/**
 * Small local models follow formats better from an example than from rules, and do worse with long
 * instructions, so on-device generation gets a shorter prompt with one worked example.
 */
export const LOCAL_SYSTEM = `You write WhatsApp replies for one person, in their own voice. Read the chat and write three short replies they could send.
Be natural. Match their style, the chat's language and how casual or rough it is. No pressure, no em dashes.
If the other person wants space, keep every reply gentle and never flirt.

Answer with exactly four lines in this format and nothing else:
VIBE|mood|what they want|language|yes or no (yes if they want space)
1|tone|reply|why
2|tone|reply|why
3|tone|reply|why
If there is a <goal>, follow its step: replies move toward it slowly and only say it when told to.

Example:
VIBE|excited|sharing good news|English|no
1|warm|wait that's amazing!! tell me everything|matches their energy
2|playful|okay this calls for a celebration 😄|keeps it fun
3|direct|congrats! when do you start?|asks the obvious next thing`;

const TONE_HINT: Record<Tone, string> = {
  warm: "warm and caring",
  playful: "playful and light, with a bit of wit",
  flirty: "lightly, respectfully flirty",
  direct: "clear and direct, gets to the point",
};

/**
 * The three tones to write, in order, with the chosen one first. Naming them exactly matters: with four tones
 * and three slots, models (small ones especially) otherwise drift to warm/playful/flirty and drop the lead.
 * In flirt mode flirty stays in the mix whichever tone leads.
 */
export function lineup(lead: Tone, flirty: boolean): Tone[] {
  const pool: Tone[] = flirty ? ["flirty", "warm", "playful", "direct"] : ["warm", "playful", "direct"];
  const first = pool.includes(lead) ? lead : "warm";
  return [first, ...pool.filter((t) => t !== first)].slice(0, 3);
}

/** The person's own rules, as a block the writer must follow. Empty when they haven't set any. */
export function rulesBlock(rules: Rules | null, note?: string, presetName?: string): string {
  const parts: string[] = [];
  if (presetName) parts.push(`Voice preset: ${presetName}`);
  if (rules?.about.trim()) parts.push(`About the person and how they talk:\n${rules.about.trim()}`);
  if (rules?.always.length) parts.push(`Always:\n${rules.always.map((r) => `- ${r}`).join("\n")}`);
  if (rules?.never.length) parts.push(`Never:\n${rules.never.map((r) => `- ${r}`).join("\n")}`);
  if (rules?.blocked.length) parts.push(`Never use these words or phrases: ${rules.blocked.map((b) => `"${b}"`).join(", ")}`);
  if (note?.trim()) parts.push(`About this chat (the person's own note):\n${note.trim()}`);
  return parts.length ? `<your_rules>\nThese come from the person and override style habits. Follow them exactly.\n${parts.join("\n\n")}\n</your_rules>\n\n` : "";
}

/**
 * Steer: the person's goal for this chat and the one step this reply should take toward it. The step comes
 * from code (see goal.ts), so the model can't rush it: before the last step, no option may say it yet.
 */
export function goalBlock(goal?: Goal | null, compact = false): string {
  if (!goal?.text.trim()) return "";
  const { index, total, step, final } = stepOf(goal);
  const plan = PLANS[goal.pace].map((x, i) => `${i + 1}. ${x.name}${i === index ? "  <- this reply" : ""}`).join("\n");
  const hold = final
    ? `This is the moment: all three options say or ask "${goal.text.trim()}", clearly and kindly, each in a different way.`
    : `All three options take this step only. None of them may say or ask "${goal.text.trim()}" yet; that comes at step ${total}.`;
  // Small models lose the format under long instructions, so on-device gets the gist.
  if (compact)
    return `<goal>Goal for later, not now: "${goal.text.trim()}". This reply is step ${index + 1} of ${total}: ${step.name}. ${step.guide} ${final ? `Now is the moment: all three replies must say or ask it, clearly and kindly, each in a different way.` : "Do not say or ask the goal yet."}</goal>\n\n`;
  return `<goal>
The person wants this chat to get to: "${goal.text.trim()}", slowly, over a few back-and-forths. Plan:
${plan}
This reply is step ${index + 1} of ${total}: ${step.name}. ${step.guide}
${hold}
- Every option must still answer what they just said first. Nudge, don't steer hard.
- Be honest: no tricks, no false pretexts, no guilt or pressure. If they seem to want space, don't push the goal at all.
After the VIBE line, add: GOAL|<yes if they have already brought up the goal's topic or invited it themselves, else no>|<what this step does, 4-8 words>
In each reply's "why", say how it moves toward the goal.
</goal>

`;
}

export function buildPrompt(
  chat: ChatMessage[],
  tone: Tone,
  flirty: boolean,
  style: StyleProfile | null,
  draft?: string,
  rules?: Rules | null,
  note?: string,
  presetName?: string,
  goal?: Goal | null,
  compact = false,
): string {
  const transcript = chat.map((m) => `${m.speaker === "me" ? "Me" : "Them"}: ${m.text}`).join("\n");
  const tones = lineup(tone, flirty);
  const plan = tones.map((t, i) => `option ${i + 1} ${t} (${TONE_HINT[t]})`).join("; ");
  const task = draft
    ? `The person has drafted: "${draft}". Write three polished versions of THAT message in their voice, keeping its meaning.`
    : "Write three different replies to the latest message.";
  return `${rulesBlock(rules ?? null, note, presetName)}${draft ? "" : goalBlock(goal, compact)}<style>\n${describe(style)}\n</style>\n\n<chat>\n${transcript}\n</chat>\n\n${task} Use exactly these tones in this order: ${plan}.${flirty ? "" : " Flirty is switched off."} Make the three options clearly different from each other.`;
}
