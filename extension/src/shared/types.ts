import type { Goal, GoalRead } from "./goal";
export type Speaker = "me" | "them";
export type ChatMessage = { speaker: Speaker; text: string; time?: string };
export type Tone = "warm" | "playful" | "flirty" | "direct";
export const TONES: { id: Tone; label: string; emoji: string }[] = [
  { id: "warm", label: "Warm", emoji: "☀️" },
  { id: "playful", label: "Playful", emoji: "✨" },
  { id: "flirty", label: "Flirty", emoji: "💫" },
  { id: "direct", label: "Direct", emoji: "➜" },
];

export type Vibe = { mood: string; intent: string; language: string; boundary: boolean };
export type Suggestion = { n: number; tone: string; text: string; why: string };

/** Where suggestions come from. "local" runs a model on this laptop through Ollama; nothing leaves the device. */
export type Engine = "claude" | "local" | "demo";

export type Settings = {
  enabled: boolean;
  auto: boolean; // suggest automatically when a new message arrives
  tone: Tone; // the tone the first suggestion leans towards
  flirty: boolean; // opt-in: allow flirty suggestions at all
  engine: Engine;
  apiKey: string;
  fast: boolean; // Claude: use the faster, smaller model
  ollamaUrl: string;
  ollamaModel: string;
  contextSize: number;
  preset: string; // default preset for chats you haven't set one for ("" = none)
};

export const DEFAULTS: Settings = {
  enabled: true,
  auto: true,
  tone: "warm",
  flirty: false,
  engine: "demo",
  apiKey: "",
  fast: false,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "",
  contextSize: 12,
  preset: "",
};

/** Fill in defaults and migrate older settings (which had a `demo` switch instead of an engine). */
export function normalise(raw: unknown): Settings {
  const s = { ...DEFAULTS, ...((raw as Partial<Settings> & { demo?: boolean }) ?? {}) };
  const legacy = raw as { demo?: boolean; engine?: Engine } | undefined;
  if (legacy && !legacy.engine) s.engine = legacy.demo || !s.apiKey ? "demo" : "claude";
  delete (s as { demo?: boolean }).demo;
  return s;
}

/** Your own instructions: who you are, how you talk, and what replies must always or never do. */
export type Rules = {
  about: string; // free text: "I'm Balaji, I text short, Tamil words with friends"
  always: string[];
  never: string[];
  blocked: string[]; // words and phrases no suggestion may contain (enforced in code, not just asked)
};
export const DEFAULT_RULES: Rules = { about: "", always: [], never: [], blocked: [] };

/** A named set of rules you can switch between per chat: Friends, Work, Family… */
export type Preset = Rules & { id: string; name: string; emoji: string };

export const STARTER_PRESETS: Preset[] = [
  {
    id: "friends", name: "Friends", emoji: "😎",
    about: "Casual and quick with friends. Banter is welcome, a bit of teasing is fine.",
    always: ["Keep it short and casual", "Match their slang and language mix"],
    never: ["Sound formal", "Lecture or give unasked advice"],
    blocked: [],
  },
  {
    id: "work", name: "Work", emoji: "💼",
    about: "Professional but friendly with colleagues and clients.",
    always: ["Be clear and polite", "Use full sentences"],
    never: ["Use emojis", "Commit to deadlines, prices or meetings on my behalf", "Use slang"],
    blocked: ["lol", "babe"],
  },
  {
    id: "family", name: "Family", emoji: "🏡",
    about: "Warm and respectful with family.",
    always: ["Be warm and caring", "Ask how they are when it fits"],
    never: ["Be sarcastic", "Swear"],
    blocked: [],
  },
  {
    id: "dating", name: "Dating", emoji: "💫",
    about: "Light, confident and genuinely curious. Charming, never cheesy.",
    always: ["Ask a question back when it fits", "Keep it light"],
    never: ["Be pushy or needy", "Use cheesy pickup lines", "Double down if they seem uninterested"],
    blocked: [],
  },
];

const cleanList = (xs: unknown) => (Array.isArray(xs) ? xs.map((x) => String(x).trim()).filter(Boolean).slice(0, 30) : []);

export const normaliseRules = (raw: unknown): Rules => {
  const r = { ...DEFAULT_RULES, ...((raw as Partial<Rules>) ?? {}) };
  return { about: String(r.about ?? "").slice(0, 1500), always: cleanList(r.always), never: cleanList(r.never), blocked: cleanList(r.blocked) };
};

export const normalisePreset = (raw: Partial<Preset>): Preset => ({
  ...normaliseRules(raw),
  id: String(raw.id || crypto.randomUUID().slice(0, 8)),
  name: String(raw.name || "Untitled").slice(0, 40),
  emoji: String(raw.emoji || "✨").slice(0, 4),
});

/** Presets from storage; the starters on first run. */
export const normalisePresets = (raw: unknown): Preset[] =>
  Array.isArray(raw) && raw.length ? raw.map((p) => normalisePreset(p as Partial<Preset>)) : STARTER_PRESETS.map((p) => ({ ...p }));

export type StyleProfile = {
  samples: string[]; // a few of your own short replies, newest first
  messages: number;
  medianWords: number;
  emojiRate: number; // emojis per message
  topEmojis: string[];
  lowercaseStart: number; // share of messages starting lowercase
  exclaimRate: number;
  questionRate: number;
  endsWithPeriod: number;
  fillers: string[]; // haha, lol, da, la ...
};

// Messages between the content script, the background worker and the popup.
export type SuggestRequest = { type: "suggest"; id: string; chat: ChatMessage[]; tone: Tone; draft?: string; note?: string; preset?: string; goal?: Goal };
export type StreamEvent =
  | { type: "vibe"; id: string; vibe: Vibe }
  | { type: "goal"; id: string; read: GoalRead }
  | { type: "suggestion"; id: string; suggestion: Suggestion }
  | { type: "done"; id: string; dropped: number; ms: number }
  | { type: "error"; id: string; message: string };
