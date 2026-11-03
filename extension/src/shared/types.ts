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
};

/** Fill in defaults and migrate older settings (which had a `demo` switch instead of an engine). */
export function normalise(raw: unknown): Settings {
  const s = { ...DEFAULTS, ...((raw as Partial<Settings> & { demo?: boolean }) ?? {}) };
  const legacy = raw as { demo?: boolean; engine?: Engine } | undefined;
  if (legacy && !legacy.engine) s.engine = legacy.demo || !s.apiKey ? "demo" : "claude";
  delete (s as { demo?: boolean }).demo;
  return s;
}

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
export type SuggestRequest = { type: "suggest"; id: string; chat: ChatMessage[]; tone: Tone; draft?: string };
export type StreamEvent =
  | { type: "vibe"; id: string; vibe: Vibe }
  | { type: "suggestion"; id: string; suggestion: Suggestion }
  | { type: "done"; id: string; dropped: number; ms: number }
  | { type: "error"; id: string; message: string };
