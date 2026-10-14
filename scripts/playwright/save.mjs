// Save raw HTML of given reddit paths (fetched same-origin from a logged-out page). node save.mjs <outdir> <path>...
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [OUT, ...paths] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
let i = 0;
for (const p of paths) {
  const r = await page.evaluate(async (u) => { const r = await fetch(u, { credentials: "include" }); return { status: r.status, ct: r.headers.get("content-type"), text: await r.text() }; }, p);
  const f = path.join(OUT, String(i++).padStart(2, "0") + "-" + p.replace(/[^a-z0-9]+/gi, "_").slice(0, 80) + ".html");
  fs.writeFileSync(f, r.text);
  console.log(r.status, (r.ct || "").split(";")[0], r.text.length, f);
}
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
