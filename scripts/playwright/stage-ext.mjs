// Copy the extension's runtime files into a clean folder Chromium/Firefox can load
// unpacked (the repo root also holds node_modules, dist/, etc.).
//   node stage-ext.mjs [<repo-dir>] [<out-dir>]     (defaults: ../.. and ./ext)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXT_FILES as FILES } from "../ext-files.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] || path.join(here, "..", ".."));
const out = path.resolve(process.argv[3] || path.join(here, "ext"));
fs.rmSync(out, { recursive: true, force: true });
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(path.join(repo, f), path.join(out, f));
}
console.log(`staged ${FILES.length} files → ${out}`);
