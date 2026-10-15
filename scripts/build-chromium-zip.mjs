// Build the Chrome / Edge / Opera / Brave package:
//   dist/classic-layout-for-reddit-chrome-<version>.zip   (for the stores / releases)
//   dist/chromium/                                        (the same files unpacked — point
//                                                          "Load unpacked" here; gitignored)
// Same files as the Firefox build, but its manifest drops the Firefox-only keys:
// `background.scripts` (Firefox needs it to run background.js; Edge's store
// rejects it outright in MV3 and Chrome only warns) and `browser_specific_settings`
// (Gecko-only). Firefox keeps using the repo's manifest.json as-is via web-ext.
//   node scripts/build-chromium-zip.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EXT_FILES } from "./ext-files.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "manifest.json"), "utf8"));
delete manifest.browser_specific_settings;
if (manifest.background) delete manifest.background.scripts;
if (!manifest.background || !manifest.background.service_worker) throw new Error("manifest has no background.service_worker");

// Every local file the extension's pages reference must be in EXT_FILES — the popup
// logo (icons/icon.svg) once went missing from the Chrome build this way.
for (const page of EXT_FILES.filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(repo, page), "utf8");
  for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"#?]+)"/g)) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue; // external / anchor
    const f = path.posix.join(path.posix.dirname(page), ref).replace(/^\.\//, "");
    if (!EXT_FILES.includes(f)) throw new Error(`${page} references ${ref}, which isn't in scripts/ext-files.mjs`);
  }
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "orr-chromium-"));
for (const f of EXT_FILES) {
  fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
  if (f === "manifest.json") fs.writeFileSync(path.join(stage, f), JSON.stringify(manifest, null, 2) + "\n");
  else fs.copyFileSync(path.join(repo, f), path.join(stage, f));
}

// Fixed timestamps → the same files always produce a byte-identical zip (no spurious
// dist/ diffs from rebuilding).
const FIXED = new Date("2020-01-01T00:00:00Z");
for (const f of EXT_FILES) fs.utimesSync(path.join(stage, f), FIXED, FIXED);

const dist = path.join(repo, "dist");
fs.mkdirSync(dist, { recursive: true });
for (const old of fs.readdirSync(dist)) if (/^classic-layout-for-reddit-chrome-.*\.zip$/.test(old)) fs.rmSync(path.join(dist, old));
const out = path.join(dist, `classic-layout-for-reddit-chrome-${manifest.version}.zip`);
execFileSync("zip", ["-q", "-X", out, ...EXT_FILES], { cwd: stage });
// Chrome's "Load unpacked" needs a folder with manifest.json at its top — not the
// zip, and not the repo root (Firefox-only manifest keys; node_modules has "_" files
// Chrome refuses to load).
const unpacked = path.join(dist, "chromium");
fs.rmSync(unpacked, { recursive: true, force: true });
fs.cpSync(stage, unpacked, { recursive: true });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`built ${path.relative(repo, out)} + ${path.relative(repo, unpacked)}/ (${EXT_FILES.length} files, Chromium manifest)`);
