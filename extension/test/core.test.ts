import { describe, expect, it } from "vitest";
import { demo } from "../src/shared/demo";
import { LineParser } from "../src/shared/parse";
import { buildPrompt } from "../src/shared/prompt";
import { check } from "../src/shared/safety";
import { describe as describeStyle, profile } from "../src/shared/style";
import type { Suggestion, Vibe } from "../src/shared/types";

const s = (text: string, tone = "warm"): Suggestion => ({ n: 1, tone, text, why: "" });
const calm: Vibe = { mood: "happy", intent: "sharing", language: "English", boundary: false };
const space: Vibe = { ...calm, mood: "tired", boundary: true };

describe("stream parser", () => {
  it("emits records as each line completes, across chunk boundaries", () => {
    const vibes: Vibe[] = [];
    const out: Suggestion[] = [];
    const p = new LineParser((v) => vibes.push(v), (x) => out.push(x));
    p.push("VIBE|excited|sharing good news|English + Tamil|no\n1|warm|that's amazing");
    expect(out).toHaveLength(0);
    p.push("!! so proud|celebrates them\n2|playful|okay treat|on me | obviously|fun\n");
    p.push("garbage line\n3|direct|congrats!");
    p.end();
    expect(vibes[0]).toEqual({ mood: "excited", intent: "sharing good news", language: "English + Tamil", boundary: false });
    expect(out.map((x) => x.text)).toEqual(["that's amazing!! so proud", "okay treat | on me | obviously", "congrats!"]);
    expect(out[1].why).toBe("fun");
  });
});

describe("safety filter", () => {
  it("keeps kind replies and normalises dashes", () => {
    expect(check(s("sounds fun \u2014 count me in"), calm, false)).toEqual({ ok: true, text: "sounds fun - count me in" });
  });
  it("drops crude, unkind, invented-contact and out-of-character text", () => {
    expect(check(s("don't be stupid"), calm, true).ok).toBe(false);
    expect(check(s("call me on +65 9123 4567"), calm, true).ok).toBe(false);
    expect(check(s("As an AI, I think"), calm, true).ok).toBe(false);
    expect(check(s("you must reply to me now"), calm, true).ok).toBe(false);
    expect(check(s("Woah, congrats! You must be so relieved!"), calm, true).ok).toBe(true);
  });
  it("turns flirty off unless opted in, and always when they want space", () => {
    expect(check(s("you're cute", "flirty"), calm, false).ok).toBe(false);
    expect(check(s("you're cute", "flirty"), calm, true).ok).toBe(true);
    expect(check(s("you're cute", "flirty"), space, true).ok).toBe(false);
    expect(check(s("come on, just one drink"), space, true).ok).toBe(false);
    expect(check(s("come on, just one drink", "playful"), calm, true).ok).toBe(true);
  });
});

describe("voice profile", () => {
  it("summarises how someone texts", () => {
    const p = profile(["haha yes da 😂", "omw", "haha ok see you", "sounds good 😂", "lol true", "haha"]);
    expect(p.lowercaseStart).toBe(1);
    expect(p.topEmojis[0]).toBe("😂");
    expect(p.fillers).toContain("haha");
    expect(describeStyle(p)).toMatch(/lowercase/);
    expect(describeStyle(null)).toMatch(/No style data/);
  });
});

describe("prompt and demo", () => {
  const chat = [
    { speaker: "them" as const, text: "are you free tonight for dinner?" },
    { speaker: "me" as const, text: "maybe!" },
  ];
  it("labels speakers without names and respects the flirty switch", () => {
    const p = buildPrompt(chat, "warm", false, null);
    expect(p).toContain("Them: are you free tonight");
    expect(p).toContain("flirty is switched off");
  });
  it("demo suggestions lead with the chosen tone and back off when asked", () => {
    expect(demo(chat, "playful", false).suggestions[0].tone).toBe("playful");
    const tired = demo([{ speaker: "them", text: "I'm so tired, talk later" }], "warm", true);
    expect(tired.vibe.boundary).toBe(true);
    expect(tired.suggestions.every((x) => x.tone !== "flirty")).toBe(true);
  });
});

describe("small-model output", () => {
  const run = (text: string) => {
    const vibes: Vibe[] = [];
    const out: Suggestion[] = [];
    const p = new LineParser((v) => vibes.push(v), (x) => out.push(x));
    p.push(text);
    p.end();
    return { vibes, out };
  };
  it("ignores an echoed template and reads un-numbered tone lines", () => {
    const { out } = run("1|tone|reply|why\nWarm|Get some rest, talk soon\n2|tone|reply|why\nPlayful: recharge mode on 🔋\nDirect|catch you tomorrow|clear");
    expect(out.map((s) => `${s.tone}:${s.text}`)).toEqual(["warm:Get some rest, talk soon", "playful:recharge mode on 🔋", "direct:catch you tomorrow"]);
  });
  it("treats a numbered vibe line as the vibe, maps odd tones and stops at three", () => {
    const { vibes, out } = run("1|tone|no worries\n2|vibe|concerned|what's going on\n3|warm|take care\n4|direct|later!\n5|playful|one too many");
    expect(vibes[0].mood).toBe("concerned");
    expect(out.map((s) => s.tone)).toEqual(["warm", "warm", "direct"]);
  });
});

describe("quick vibe", () => {
  it("flags someone pulling back even when a model doesn't", async () => {
    const { quickVibe } = await import("../src/shared/demo");
    expect(quickVibe([{ speaker: "them", text: "honestly I'm exhausted, can we talk later" }]).boundary).toBe(true);
    expect(quickVibe([{ speaker: "them", text: "dinner tonight?" }])).toMatchObject({ boundary: false, intent: "making plans" });
  });
});

describe("voice presets", () => {
  it("turns a preset and chat note into a rules block the prompt leads with", async () => {
    const { rulesBlock } = await import("../src/shared/prompt");
    const work = { about: "Professional but friendly.", always: ["Use full sentences"], never: ["Use emojis"], blocked: ["lol"] };
    const block = rulesBlock(work, "my manager, keep it brief", "Work");
    expect(block).toContain("Voice preset: Work");
    expect(block).toContain("Always:\n- Use full sentences");
    expect(block).toContain("Never:\n- Use emojis");
    expect(block).toContain('"lol"');
    expect(block).toContain("my manager, keep it brief");
    expect(buildPrompt([{ speaker: "them", text: "hi" }], "warm", false, null, undefined, work, undefined, "Work").startsWith("<your_rules>")).toBe(true);
    expect(rulesBlock(null)).toBe("");
  });

  it("enforces blocked words as whole words, in any case", async () => {
    const { blockedIn } = await import("../src/shared/safety");
    expect(blockedIn("haha LOL that's great", ["lol"])).toBe("lol");
    expect(blockedIn("hello there", ["hell"])).toBeNull();
    expect(blockedIn("see you, babe 😘", ["babe"])).toBe("babe");
    expect(check(s("lol fair enough"), calm, false, ["lol"])).toMatchObject({ ok: false, reason: 'uses "lol", which you blocked' });
  });

  it("ships editable starter presets and cleans stored ones", async () => {
    const { normalisePresets } = await import("../src/shared/types");
    expect(normalisePresets(null).map((p) => p.name)).toEqual(["Friends", "Work", "Family", "Dating"]);
    const [p] = normalisePresets([{ id: "x", name: "", always: ["  a  ", ""], never: "nope" }]);
    expect(p).toMatchObject({ id: "x", name: "Untitled", always: ["a"], never: [], blocked: [] });
  });
});
