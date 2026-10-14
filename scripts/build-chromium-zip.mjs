// Build the Chrome / Edge / Opera / Brave package:
//   dist/classic-layout-for-reddit-chrome-<version>.zip
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

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "orr-chromium-"));
for (const f of EXT_FILES) {
  fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
  if (f === "manifest.json") fs.writeFileSync(path.join(stage, f), JSON.stringify(manifest, null, 2) + "\n");
  else fs.copyFileSync(path.join(repo, f), path.join(stage, f));
}

const dist = path.join(repo, "dist");
fs.mkdirSync(dist, { recursive: true });
for (const old of fs.readdirSync(dist)) if (/^classic-layout-for-reddit-chrome-.*\.zip$/.test(old)) fs.rmSync(path.join(dist, old));
const out = path.join(dist, `classic-layout-for-reddit-chrome-${manifest.version}.zip`);
execFileSync("zip", ["-q", "-X", out, ...EXT_FILES], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`built ${path.relative(repo, out)} (${EXT_FILES.length} files, Chromium manifest)`);
