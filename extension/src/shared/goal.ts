// Steer: drive a chat toward something the person wants to say or ask, slowly, over a few back-and-forths.
//
// The plan lives in code, not in the model. Each reply does one step; the step only moves on after you've
// replied and they've answered, so a goal can't be rushed by a long chat history or an eager model. Before
// the last step, every suggestion is told not to say or ask it yet.

export type Pace = 3 | 4 | 5;
export type Step = { id: string; name: string; guide: string };
export type Goal = {
  text: string;
  pace: Pace;
  step: number; // 0-based: the step the next reply should do
  awaiting: boolean; // you've replied on this step; the next one starts when they answer
  said: boolean; // you've sent a reply on the final step
};
/** The model's read of the chat against the goal: have they opened the door themselves? */
export type GoalRead = { ahead: boolean; note: string };

const S = {
  rapport: { id: "rapport", name: "build rapport", guide: "Keep the chat warm and flowing and show real interest in them. Do not mention or hint at the goal." },
  common: { id: "common", name: "find common ground", guide: "Drift toward a nearby subject that connects to the goal (for coffee: their week, food, places they like), without mentioning the goal itself." },
  bridge: { id: "bridge", name: "bridge to the topic", guide: "Bring the conversation naturally to the goal's topic, but don't say or ask it yet." },
  hint: { id: "hint", name: "test the water", guide: "Hint at it lightly, so they can pick it up, without saying or asking it outright." },
  ask: { id: "ask", name: "say it", guide: "Say or ask it now, clearly and kindly, as a natural next line in this chat's style." },
} satisfies Record<string, Step>;

export const PLANS: Record<Pace, Step[]> = {
  3: [S.common, S.bridge, S.ask],
  4: [S.common, S.bridge, S.hint, S.ask],
  5: [S.rapport, S.common, S.bridge, S.hint, S.ask],
};
export const PACES: { pace: Pace; label: string }[] = [
  { pace: 3, label: "Quick" },
  { pace: 4, label: "Natural" },
  { pace: 5, label: "Slow" },
];

export function newGoal(text: string, pace: Pace = 4): Goal {
  return { text: text.trim().slice(0, 160), pace, step: 0, awaiting: false, said: false };
}

/** Read a stored goal; older versions stored just the text. */
export function normaliseGoal(raw: unknown): Goal | null {
  if (typeof raw === "string") return raw.trim() ? newGoal(raw) : null;
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Partial<Goal>;
  if (!g.text?.trim()) return null;
  const pace = ([3, 4, 5] as const).includes(g.pace as Pace) ? (g.pace as Pace) : 4;
  const step = Math.max(0, Math.min(pace - 1, Math.floor(Number(g.step) || 0)));
  return { text: g.text.trim().slice(0, 160), pace, step, awaiting: !!g.awaiting, said: !!g.said };
}

export function stepOf(g: Goal) {
  const plan = PLANS[g.pace];
  const step = plan[Math.min(g.step, plan.length - 1)];
  return { index: g.step, total: plan.length, step, final: g.step >= plan.length - 1 };
}

/**
 * A new message in the chat. Your reply finishes the current step; their answer starts the next. Several
 * messages in a row count once, and when they seem to want space the plan holds where it is.
 */
export function onMessage(g: Goal, from: "me" | "them", wantsSpace = false): Goal {
  const { final } = stepOf(g);
  if (from === "me") {
    if (g.awaiting) return g;
    return { ...g, awaiting: true, said: g.said || final };
  }
  if (!g.awaiting || wantsSpace || final) return g;
  return { ...g, step: g.step + 1, awaiting: false };
}

export const skip = (g: Goal): Goal => ({ ...g, step: Math.min(g.pace - 1, g.step + 1), awaiting: false });
export const sayNow = (g: Goal): Goal => ({ ...g, step: g.pace - 1, awaiting: false });
export const again = (g: Goal): Goal => ({ ...g, awaiting: false, said: false });

const STOP = new Set(
  "ask asking tell telling them they their about that this with gently kindly back want would could should maybe some sometime going into from have bring talk mention eventually out over when what where your just really the for and you are can get".split(" "),
);
// People rarely use the goal's own word, so each topic brings its everyday neighbours.
const RELATED: [RegExp, string[]][] = [
  [/\b(money|dollars?|rupees?|cash|owe|owes|loan|lent|borrow|pay)\b/, ["money", "cash", "owe", "borrow", "lent", "loan", "pay back", "paid"]],
  [/\b(coffee|cafe|café|tea)\b/, ["coffee", "cafe", "café", "cup", "latte", "brew"]],
  [/\b(drinks?|beer|wine|bar)\b/, ["drink", "beer", "wine", "bar", "pub"]],
  [/\b(dinner|lunch|brunch|food|eat)\b/, ["dinner", "lunch", "brunch", "food", "eat", "restaurant"]],
  [/\b(move|moving|relocat\w*)\b/, ["moving", "move", "relocat", "new city", "leaving"]],
  [/\b(job|referral|hiring|role|interview)\b/, ["job", "referral", "hiring", "role", "opening", "interview"]],
  [/\b(date|ask (them|her|him) out)\b/, ["date", "free", "hang out"]],
];
/** Words that carry the goal's topic: "ask them out for coffee" → ["coffee", "cafe", …]. */
export function topicWords(goal: string): string[] {
  const g = goal.toLowerCase();
  const own = (g.match(/\p{L}{3,}/gu) ?? []).filter((w) => !STOP.has(w));
  const related = RELATED.filter(([re]) => re.test(g)).flatMap(([, words]) => words);
  return [...new Set([...own, ...related])];
}

/** A quick local read: did their last message bring up the goal's topic themselves? */
export function quickRead(chat: { speaker: string; text: string }[], g: Goal): GoalRead {
  const last = ([...chat].reverse().find((m) => m.speaker === "them")?.text ?? "").toLowerCase();
  const hit = topicWords(g.text).find((w) => new RegExp(`\\b${w.replace(/s$/, "")}`, "u").test(last));
  return hit ? { ahead: true, note: `they mentioned ${hit}` } : { ahead: false, note: "" };
}

// "want to grab…", "can we…", "shall we…", "when can you…": the shape of actually asking.
const INVITE = /\b(want to|wanna|would you( like)?( to)?|shall we|should we|let'?s|can we|could we|can you|could you|how about (we|you)|when can|when will|are you free|you free|if you'?re free|if you are free|you around|up for it)\b/i;

/** Does this reply make the ask itself? Used to hold early asks back until the last step. */
export function makesAsk(text: string, g: Goal): boolean {
  const t = text.toLowerCase();
  const topic = topicWords(g.text).some((w) => new RegExp(`\\b${w.replace(/s$/, "")}`, "u").test(t)) || /\$\s?\d|\b\d{2,}\b/.test(t) && /\b(money|dollars?|rupees?|owe|loan|pay)\b/.test(g.text.toLowerCase());
  return topic && INVITE.test(t);
}
