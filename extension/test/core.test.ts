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
