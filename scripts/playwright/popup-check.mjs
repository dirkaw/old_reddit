// Open the extension's own popup + options pages (chrome-extension://…) and check
// every <img> on them actually loaded.   node popup-check.mjs <ext-dir> <out-dir>
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 420, height: 600 },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--window-position=-3000,0"],
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 10000 }));
const id = new URL(sw.url()).host;
let fail = 0;
for (const pg of ["popup.html", "options.html"]) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/${pg}`);
  await page.waitForTimeout(1000);
  const imgs = await page.evaluate(() => Array.from(document.images).map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth })));
  const bad = imgs.filter((i) => !i.ok);
  console.log(`${bad.length ? "FAIL" : "PASS"} ${pg}: ${imgs.length} image(s) ${JSON.stringify(imgs)}`);
  if (bad.length) fail++;
  await page.screenshot({ path: path.join(outDir, pg.replace(".html", ".png")) });
  await page.close();
}
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
