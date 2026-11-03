// Builds the MV3 extension into dist/. `--dev` also lets the content script run on localhost (for the e2e test page).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const dev = process.argv.includes("--dev");
const watch = process.argv.includes("--watch");
const { version } = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync("package.json", "utf8")));

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const pages = ["https://web.whatsapp.com/*", ...(dev ? ["http://localhost/*", "http://127.0.0.1/*"] : [])];
const manifest = {
  manifest_version: 3,
  name: dev ? "Charmly (dev)" : "Charmly",
  version,
  description: "Reply suggestions for WhatsApp Web, in your own voice. Tap to insert; you always send.",
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  options_ui: { page: "options.html", open_in_tab: true },
  action: { default_popup: "popup.html", default_title: "Charmly", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [{ matches: pages, js: ["content.js"], run_at: "document_idle" }],
  permissions: ["storage", "declarativeNetRequest"],
  // Ollama listens on localhost; any port, since people change it.
  host_permissions: [...pages, "https://api.anthropic.com/*", "http://localhost/*", "http://127.0.0.1/*"],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
cpSync("public", "dist", { recursive: true });
cpSync("src/popup/popup.html", "dist/popup.html");
cpSync("src/popup/popup.css", "dist/popup.css");
cpSync("src/options/options.html", "dist/options.html");
cpSync("src/options/options.css", "dist/options.css");

const common = { bundle: true, target: "chrome120", minify: !dev, sourcemap: dev ? "inline" : false, logLevel: "info", loader: { ".css": "text" }, define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' } };
const builds = [
  { ...common, entryPoints: ["src/background/index.ts"], outfile: "dist/background.js", format: "esm" },
  { ...common, entryPoints: ["src/content/index.ts"], outfile: "dist/content.js", format: "iife" },
  { ...common, entryPoints: ["src/popup/Popup.tsx"], outfile: "dist/popup.js", format: "iife", jsx: "automatic" },
  { ...common, entryPoints: ["src/options/Options.tsx"], outfile: "dist/options.js", format: "iife", jsx: "automatic" },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
