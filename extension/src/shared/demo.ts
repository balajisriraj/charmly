import { lineup } from "./prompt";
import type { ChatMessage, GoalProgress, Suggestion, Tone, Vibe } from "./types";

/**
 * Demo mode: believable suggestions without an API key, built from the last message.
 * It exists so the extension can be tried and tested offline; it is labelled as a demo in the UI.
 */
/** An instant, local read of the last message. Used as a safety floor when a model doesn't report a vibe. */
export function quickVibe(chat: ChatMessage[]): Vibe {
  const last = [...chat].reverse().find((m) => m.speaker === "them")?.text ?? "";
  const t = last.toLowerCase();
  const pulling = /\b(busy|tired|exhausted|not now|later|leave me|space|stop|not interested|go away|sleep)\b/.test(t);
  const excited = /!|haha|😂|🤣|🥳|yay|omg|amazing|guess what/.test(t);
  const plans = /\b(free|tonight|tomorrow|weekend|dinner|coffee|movie|meet|plans?)\b/.test(t);
  return {
    mood: pulling ? "tired" : excited ? "excited" : last.includes("?") ? "curious" : "relaxed",
    intent: plans ? "making plans" : last.includes("?") ? "asking you something" : "sharing",
    language: /\b(da|la|lah|machan|yaar|bro)\b/.test(t) ? "English + local slang" : "English",
    boundary: pulling,
  };
}

/** A quick local read of how close the chat is to the person's goal, for engines that don't report it. */
export function goalFloor(chat: ChatMessage[], goal?: string): GoalProgress | undefined {
  const t = ([...chat].reverse().find((m) => m.speaker === "them")?.text ?? "").toLowerCase();
  if (!goal?.trim() || /\b(busy|tired|not now|later|leave me|space|stop)\b/.test(t)) return undefined;
  const warm = /!|haha|😂|🤣|😊|☕|omg|amazing|free|tonight|tomorrow|weekend|plans?/.test(t);
  const stage = (chat.length >= 8 || (warm && chat.length >= 4) ? 3 : chat.length >= 4 || warm ? 2 : 1) as 1 | 2 | 3;
  return { stage, step: ["find some common ground", "open the topic lightly", "say it, kindly and clearly"][stage - 1] };
}

export function demo(chat: ChatMessage[], tone: Tone, flirty: boolean, draft?: string, goal?: string): { vibe: Vibe; suggestions: Suggestion[]; goal?: GoalProgress } {
  const last = [...chat].reverse().find((m) => m.speaker === "them")?.text ?? "";
  const t = last.toLowerCase();
  const asked = last.includes("?");
  const pulling = /\b(busy|tired|not now|later|leave me|space|stop)\b/.test(t);
  const excited = /!|haha|😂|🤣|yay|omg|amazing|guess what/.test(t);
  const plans = /\b(free|tonight|tomorrow|weekend|dinner|coffee|movie|meet|plans?)\b/.test(t);
  const vibe: Vibe = {
    mood: pulling ? "tired" : excited ? "excited" : asked ? "curious" : "relaxed",
    intent: plans ? "making plans" : asked ? "asking you something" : "sharing news",
    language: /\b(da|la|lah|machan|yaar)\b/.test(t) ? "English + local slang" : "English",
    boundary: pulling,
  };
  // Every scenario has a line for each tone; the lineup picks three, lead first, as the real engines are asked to.
  type Line = [string, string];
  let lines: Record<Tone, Line>;
  if (draft) {
    const d = draft.trim().replace(/\s+/g, " ");
    lines = {
      warm: [d.charAt(0).toLowerCase() + d.slice(1).replace(/[.!]?$/, " 😊"), "same message, softer finish"],
      playful: [`${d.replace(/[.!]?$/, "")} haha`, "keeps it light"],
      flirty: [`${d.replace(/[.!]?$/, "")} 😉`, "same message, a little wink"],
      direct: [d.charAt(0).toUpperCase() + d.slice(1).replace(/[.!]?$/, "."), "clear and tidy"],
    };
  } else if (pulling) {
    const warm: Line = ["no worries at all, get some rest 😊 talk tomorrow?", "gives them space kindly"];
    lines = {
      warm,
      playful: ["fair enough, recharge mode activated 🔋 catch you later", "light, no pressure"],
      flirty: warm, // never used: the lineup leaves flirty out when they want space
      direct: ["all good, message me whenever you're free", "clear and respectful"],
    };
  } else if (plans) {
    lines = {
      warm: ["that sounds lovely, I'm in 😊 what time works for you?", "says yes, hands them the timing"],
      playful: ["only if you're ready to lose at choosing the place 😄 [time]?", "playful yes with a callback"],
      flirty: ["honestly the best offer I've had all week 😉 when?", "keeps momentum, with a wink"],
      direct: ["yes! does [time] work?", "a clear yes"],
    };
  } else if (excited) {
    lines = {
      warm: ["wait that's amazing!! tell me everything 😄", "matches their excitement"],
      playful: ["okay I need the full story, don't skip the good bits 👀", "invites them to share more"],
      flirty: ["look at you, making my day with news like this 😏", "celebrates with a little charm"],
      direct: ["congrats, that's huge! how did it happen?", "celebrates and asks"],
    };
  } else {
    lines = {
      warm: [asked ? "good question - honestly I think [your answer], what about you?" : "haha I love that, how's your day going?", "answers and turns it back"],
      playful: ["okay this deserves a proper reply, give me a sec 😄", "buys time with charm"],
      flirty: ["you always know how to get my attention 😉", "light and playful interest"],
      direct: [asked ? "short answer: [your answer]. want the long version?" : "nice! what are you up to later?", "keeps it moving"],
    };
  }
  const options = lineup(tone, flirty && !pulling).map((t) => [t, ...lines[t]] as [Tone, string, string]);
  // A goal: judge readiness from how warm and long the chat is, and make the last option the next step there.
  const progress = draft ? undefined : goalFloor(chat, goal);
  if (progress && goal) {
    const { stage, step } = progress;
    const bridge = [
      "haha that reminds me, we should catch up properly sometime 😊",
      "random thought, can I ask you something? [ease into: " + goal.trim() + "]",
      "okay I'll just say it: [" + goal.trim() + "]",
    ][stage - 1];
    options[2] = [options[2][0], bridge, `moves toward your goal: ${step}`];
  }
  return { goal: progress, vibe, suggestions: options.map(([toneId, text, why], i) => ({ n: i + 1, tone: toneId, text, why })) };
}
