// Sample the sidebar labels and every <style>/<link> in the page at 3s and 6s after load
// (found new-Reddit CSS leaking into the rebuilt page).  node css-timeline.mjs <ext-dir> <out-dir> <url>...
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [extDir, out, ...urls] = process.argv.slice(2);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0"] });
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
let i = 0;
for (const url of urls) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  for (const t of [3000, 6000]) {
    await page.waitForTimeout(t);
    const r = await page.evaluate(() => {
      const ls = Array.from(document.querySelectorAll(".side label, .side .orr-restrict"));
      return { labels: ls.map((l) => l.outerHTML.slice(0, 160) + " | " + getComputedStyle(l).textTransform + " " + getComputedStyle(l).fontSize),
        styles: Array.from(document.querySelectorAll("style, link[rel=stylesheet]")).map((s) => (s.id || s.href || "anon") + ":" + (s.textContent || "").slice(0, 80).replace(/\s+/g, " ")),
        sideHtml: (document.querySelector(".side") || {}).innerHTML ? document.querySelector(".side").innerHTML.slice(0, 600) : null };
    });
    console.log(url, "@", t, JSON.stringify(r, null, 1));
  }
  await page.screenshot({ path: path.join(out, "i" + i++ + ".png") });
  await page.close();
}
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
