// Pass 2 of the promo: render the film frame by frame, and score it.
//
//   node promo/render.mjs [--music track.mp3] [--fps 30] [--preview 12.5]
//
// The film (promo/blink.ts) plays on the set with the real tray. Reads promo/script.json (from capture.mjs and
// capture-extras.mjs). Writes promo/out/charmly-promo.mp4 (1080p) and ../docs/charmly-promo.mp4 (web size, for the
// README). --preview t saves one frame.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as esbuild from "esbuild";
import puppeteer from "puppeteer-core";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "promo/out");
const DOCS = resolve(ROOT, "../docs");
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const FPS = Number(arg("fps") ?? 30);
const PREVIEW = arg("preview");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

// The film page: Charmly's real tray, bundled with the film's timeline, plus the captured script.
await esbuild.build({ entryPoints: [resolve(ROOT, "promo/blink.ts")], outfile: resolve(OUT, "film.js"), bundle: true, format: "iife", target: "chrome120", loader: { ".css": "text" }, logLevel: "error" });
const script = readFileSync(resolve(ROOT, "promo/script.json"), "utf8");
writeFileSync(resolve(OUT, "film.html"), readFileSync(resolve(ROOT, "promo/film.html"), "utf8").replace("/*SCRIPT*/", script));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("film error:", e.message));
await page.goto(`file://${resolve(OUT, "film.html")}`);
await page.evaluate(() => document.fonts.ready);
const { duration, marks, scenes } = await page.evaluate(() => ({ duration: window.DURATION, marks: window.MARKS, scenes: window.SCENES }));

if (PREVIEW) {
  // Frames are rendered in order (camera and cursor targets resolve as they're reached), so step up to t.
  for (let t = 0; t < Number(PREVIEW); t += 1 / FPS) await page.evaluate((t) => window.renderAt(t), t);
  await page.evaluate((t) => window.renderAt(t), Number(PREVIEW));
  await page.screenshot({ path: resolve(OUT, "preview.png") });
  await browser.close();
  console.log(`preview at ${PREVIEW}s of ${duration.toFixed(1)}s`);
  process.exit(0);
}

const silent = resolve(OUT, "silent.mp4");
const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent], { stdio: ["pipe", "inherit", "inherit"] });
const frames = Math.ceil(duration * FPS);
const started = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => window.renderAt(t), f / FPS);
  const jpg = await page.screenshot({ type: "jpeg", quality: 94, optimizeForSpeed: true });
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % (FPS * 5) === 0) process.stdout.write(`\r  rendering ${Math.round((f / frames) * 100)}% (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`\n  ${frames} frames, ${duration.toFixed(1)}s`);
writeFileSync(resolve(OUT, "timeline.json"), JSON.stringify({ duration, marks, scenes }, null, 2));

// The score: an original track composed to the cut (music_upbeat.py), unless you bring your own.
const track = arg("music") ?? resolve(OUT, "music.wav");
if (!arg("music")) execFileSync("python3", [resolve(ROOT, "promo/music_upbeat.py"), track, String(duration), JSON.stringify(marks)], { stdio: "inherit" });
const film = resolve(OUT, "charmly-promo.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", silent, "-i", track, "-filter_complex", `[1:a]atrim=0:${duration.toFixed(2)},loudnorm=I=-14:TP=-1.2:LRA=11,afade=t=in:d=0.6,afade=t=out:st=${(duration - 2.4).toFixed(2)}:d=2.4[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", film]);

// For the README and the portfolio: a web-sized film.
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", film, "-vf", "scale=1280:-2:flags=lanczos", "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", resolve(DOCS, "charmly-promo.mp4")]);
console.log(JSON.stringify({ duration: +duration.toFixed(1), marks, scenes }));
