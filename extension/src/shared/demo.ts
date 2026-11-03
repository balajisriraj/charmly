import type { ChatMessage, Suggestion, Tone, Vibe } from "./types";

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

export function demo(chat: ChatMessage[], tone: Tone, flirty: boolean, draft?: string): { vibe: Vibe; suggestions: Suggestion[] } {
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
  let options: [string, string, string][];
  if (draft) {
    const d = draft.trim().replace(/\s+/g, " ");
    options = [
      ["warm", d.charAt(0).toLowerCase() + d.slice(1).replace(/[.!]?$/, " 😊"), "same message, softer finish"],
      ["playful", `${d.replace(/[.!]?$/, "")} haha`, "keeps it light"],
      ["direct", d.charAt(0).toUpperCase() + d.slice(1).replace(/[.!]?$/, "."), "clear and tidy"],
    ];
  } else if (pulling) {
    options = [
      ["warm", "no worries at all, get some rest 😊 talk tomorrow?", "gives them space kindly"],
      ["playful", "fair enough, recharge mode activated 🔋 catch you later", "light, no pressure"],
      ["direct", "all good, message me whenever you're free", "clear and respectful"],
    ];
  } else if (plans) {
    options = [
      ["warm", "that sounds lovely, I'm in 😊 what time works for you?", "says yes, hands them the timing"],
      ["playful", "only if you're ready to lose at choosing the place 😄 [time]?", "playful yes with a callback"],
      [flirty ? "flirty" : "direct", flirty ? "honestly the best offer I've had all week 😉 when?" : "yes! does [time] work?", "keeps momentum"],
    ];
  } else if (excited) {
    options = [
      ["warm", "wait that's amazing!! tell me everything 😄", "matches their excitement"],
      ["playful", "okay I need the full story, don't skip the good bits 👀", "invites them to share more"],
      ["direct", "congrats, that's huge! how did it happen?", "celebrates and asks"],
    ];
  } else {
    options = [
      ["warm", asked ? "good question - honestly I think [your answer], what about you?" : "haha I love that, how's your day going?", "answers and turns it back"],
      ["playful", "okay this deserves a proper reply, give me a sec 😄", "buys time with charm"],
      ["direct", asked ? "short answer: [your answer]. want the long version?" : "nice! what are you up to later?", "keeps it moving"],
    ];
  }
  const lead = options.findIndex(([toneId]) => toneId === tone);
  if (lead > 0) options.unshift(...options.splice(lead, 1));
  return { vibe, suggestions: options.map(([toneId, text, why], i) => ({ n: i + 1, tone: toneId, text, why })) };
}
