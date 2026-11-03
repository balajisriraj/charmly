// A small client for Ollama's local HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md).

export class OllamaError extends Error {}

export type LocalModel = { name: string; size: number; params: string };

const trimUrl = (url: string) => url.replace(/\/+$/, "");

function explain(url: string, status: number, body: string): string {
  if (status === 403)
    return `Ollama refused the request from the extension. Quit Ollama, run: OLLAMA_ORIGINS="chrome-extension://*" ollama serve, and try again.`;
  if (status === 404 && /model/i.test(body)) return `That model isn't on this laptop yet. Run: ollama pull <model>`;
  return `Ollama at ${url} answered ${status}${body ? `: ${body.slice(0, 120)}` : ""}`;
}

async function call(url: string, path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${trimUrl(url)}${path}`, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new OllamaError(`Can't reach Ollama at ${url}. Is it running? Start it with: ollama serve`);
  }
  if (!res.ok) throw new OllamaError(explain(url, res.status, await res.text().catch(() => "")));
  return res;
}

export async function listModels(url: string): Promise<LocalModel[]> {
  const res = await call(url, "/api/tags");
  const data = (await res.json()) as { models?: { name: string; size: number; digest?: string; details?: { parameter_size?: string } }[] };
  // The same weights can appear under several tags (llama3.2:latest and llama3.2:3b); keep the most specific name.
  const byDigest = new Map<string, (typeof data.models & object)[number]>();
  for (const m of data.models ?? []) {
    const key = m.digest ?? m.name;
    const seen = byDigest.get(key);
    if (!seen || (seen.name.endsWith(":latest") && !m.name.endsWith(":latest"))) byDigest.set(key, m);
  }
  return [...byDigest.values()]
    .filter((m) => !/embed/i.test(m.name)) // embedding models can't chat
    .map((m) => ({ name: m.name, size: m.size, params: m.details?.parameter_size ?? "" }))
    .sort((a, b) => a.size - b.size);
}

/**
 * Drops <think>…</think> sections that reasoning models (Qwen 3, DeepSeek R1…) emit before their answer.
 * Works on a stream, so a tag split across chunks is still recognised.
 */
export class ThinkFilter {
  private buffer = "";
  private thinking = false;

  push(chunk: string): string {
    this.buffer += chunk;
    let out = "";
    for (;;) {
      if (this.thinking) {
        const end = this.buffer.indexOf("</think>");
        if (end < 0) {
          this.buffer = this.buffer.slice(-8); // keep enough to spot a split closing tag
          return out;
        }
        this.buffer = this.buffer.slice(end + 8);
        this.thinking = false;
      } else {
        const start = this.buffer.indexOf("<think>");
        if (start < 0) {
          // Hold back a possible partial "<think" at the end.
          const safe = this.buffer.length - partialTagLength(this.buffer);
          out += this.buffer.slice(0, safe);
          this.buffer = this.buffer.slice(safe);
          return out;
        }
        out += this.buffer.slice(0, start);
        this.buffer = this.buffer.slice(start + 7);
        this.thinking = true;
      }
    }
  }

  end(): string {
    const rest = this.thinking ? "" : this.buffer;
    this.buffer = "";
    return rest;
  }
}

function partialTagLength(text: string): number {
  const tag = "<think>";
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) if (tag.startsWith(text.slice(-n))) return n;
  return 0;
}

/** Stream a chat completion; calls onText with each piece of visible text. */
export async function streamChat(
  opts: { url: string; model: string; system: string; prompt: string; signal: AbortSignal },
  onText: (text: string) => void,
): Promise<void> {
  const res = await call(opts.url, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      keep_alive: "15m", // keep the model warm between messages so replies stay fast
      options: { temperature: 0.8, num_predict: 400, num_ctx: 4096 },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
    }),
  });
  if (!res.body) throw new OllamaError("Ollama sent an empty response.");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const think = new ThinkFilter();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean };
      if (event.error) throw new OllamaError(event.error);
      const text = think.push(event.message?.content ?? "");
      if (text) onText(text);
    }
  }
  const tail = think.end();
  if (tail) onText(tail);
}
