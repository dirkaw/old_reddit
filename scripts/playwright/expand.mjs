// Expand the first few expandos on a listing and screenshot (logged-out).  node expand.mjs <ext> <out> <url> [n]
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [extDir, out, url, n = "2"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0"] });
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
const btns = page.locator("#siteTable .expando-button");
const cnt = Math.min(await btns.count(), parseInt(n, 10));
for (let i = 0; i < cnt; i++) { await btns.nth(i).click(); await page.waitForTimeout(1500); }
await page.waitForTimeout(4000);
const info = await page.evaluate(() => Array.from(document.querySelectorAll("#siteTable .thing.link")).slice(0, 4).map((t) => {
  const ex = t.querySelector(".expando");
  return { ptype: t.dataset.ptype, open: !!ex && ex.style.display !== "none", imgs: ex ? ex.querySelectorAll("img").length : 0, video: ex ? !!ex.querySelector("video") : false, fallback: ex ? !!ex.querySelector(".orr-video-fallback") : false, gallery: ex ? (ex.querySelector(".orr-gcount") || {}).textContent || "" : "" };
}));
console.log(JSON.stringify(info), "errors:", JSON.stringify(errors));
await page.screenshot({ path: path.join(out, url.replace(/[^a-z0-9]+/gi, "_").slice(-40) + ".png") });
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
