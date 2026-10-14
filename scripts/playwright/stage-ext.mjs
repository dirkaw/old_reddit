// Copy the extension's runtime files into a clean folder Chromium/Firefox can load
// unpacked (the repo root also holds node_modules, dist/, etc.).
//   node stage-ext.mjs [<repo-dir>] [<out-dir>]     (defaults: ../.. and ./ext)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] || path.join(here, "..", ".."));
const out = path.resolve(process.argv[3] || path.join(here, "ext"));
const FILES = [
  "manifest.json", "common.js", "rebuild.js", "redirect.js", "settings.js", "settings.css",
  "popup.html", "options.html", "background.js", "permission-prompt.html", "permission-prompt.js",
  "vendor/oldreddit.bundled.css", "vendor/dash.mediaplayer.min.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
];
fs.rmSync(out, { recursive: true, force: true });
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(path.join(repo, f), path.join(out, f));
}
console.log(`staged ${FILES.length} files → ${out}`);
