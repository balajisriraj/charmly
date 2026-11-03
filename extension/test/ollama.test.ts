import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, OllamaError, streamChat, ThinkFilter } from "../src/shared/ollama";

const ndjson = (chunks: string[]) =>
  new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))); c.close(); } }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("ThinkFilter", () => {
  it("drops reasoning blocks even when tags are split across chunks", () => {
    const f = new ThinkFilter();
    const out = ["<thi", "nk>let me plan", " this</th", "ink>1|warm|hey", " there"].map((c) => f.push(c)).join("") + f.end();
    expect(out).toBe("1|warm|hey there");
  });
});

describe("Ollama client", () => {
  it("streams NDJSON content, across chunk boundaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson(['{"message":{"content":"1|warm|"}}\n{"message":{"con', 'tent":"hi!"}}\n{"done":true}\n'])));
    let text = "";
    await streamChat({ url: "http://localhost:11434", model: "m", system: "s", prompt: "p", signal: new AbortController().signal }, (t) => (text += t));
    expect(text).toBe("1|warm|hi!");
    const body = JSON.parse((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string);
    expect(body).toMatchObject({ model: "m", stream: true, keep_alive: "15m" });
  });

  it("lists chat models smallest first and skips embedding models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [
      { name: "llama3.2:latest", size: 2e9, digest: "a80c", details: { parameter_size: "3.2B" } },
      { name: "llama3.2:3b", size: 2e9, digest: "a80c", details: { parameter_size: "3.2B" } },
      { name: "nomic-embed-text", size: 3e8 },
      { name: "gemma3:1b", size: 8e8, details: { parameter_size: "1B" } },
    ] })));
    expect((await listModels("http://localhost:11434")).map((m) => m.name)).toEqual(["gemma3:1b", "llama3.2:3b"]);
  });

  it("explains the common failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(listModels("http://localhost:11434")).rejects.toThrow(/Is it running\?/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(listModels("http://localhost:11434")).rejects.toThrow(/OLLAMA_ORIGINS/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"model \\"x\\" not found"}', { status: 404 })));
    await expect(listModels("http://localhost:11434")).rejects.toBeInstanceOf(OllamaError);
  });
});
