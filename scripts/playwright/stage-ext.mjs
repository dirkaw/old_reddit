// Copy the extension's runtime files into a clean folder a browser can load unpacked
// (the repo root also holds node_modules, dist/, etc.). Writes the Chromium manifest
// by default; --firefox keeps the repo's (Firefox) manifest for firefox*.mjs.
//   node stage-ext.mjs [<repo-dir>] [<out-dir>] [--firefox]     (defaults: ../.. and ./ext)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXT_FILES as FILES, chromiumManifest } from "../ext-files.mjs";

const args = process.argv.slice(2).filter((a) => a !== "--firefox");
const firefox = process.argv.includes("--firefox");
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(args[0] || path.join(here, "..", ".."));
const out = path.resolve(args[1] || path.join(here, "ext"));
fs.rmSync(out, { recursive: true, force: true });
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  if (f === "manifest.json" && !firefox) {
    const m = chromiumManifest(JSON.parse(fs.readFileSync(path.join(repo, f), "utf8")));
    fs.writeFileSync(path.join(out, f), JSON.stringify(m, null, 2) + "\n");
  } else fs.copyFileSync(path.join(repo, f), path.join(out, f));
}
console.log(`staged ${FILES.length} files (${firefox ? "Firefox" : "Chromium"} manifest) → ${out}`);
