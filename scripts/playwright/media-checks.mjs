// Live logged-out checks: a GIF post loops (muted), the reCAPTCHA badge is hidden, and a
// single-comment permalink shows just that thread with the infobar.   node media-checks.mjs <ext-dir>
import { chromium } from "playwright"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [extDir] = process.argv.slice(2);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0", "--autoplay-policy=no-user-gesture-required"] });
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto("https://www.reddit.com/r/gifs/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.locator("#siteTable .thing.link[data-ptype=video] .expando-button").first().click();
await page.waitForTimeout(1500);
const v = page.locator("#siteTable .expando video").first();
await v.evaluate((el) => el.play().catch(() => {}));
await page.waitForTimeout(5000);
console.log("gif", JSON.stringify(await v.evaluate((el) => ({ loop: el.loop, muted: el.muted, t: el.currentTime, dur: el.duration, paused: el.paused, gifAttr: el.hasAttribute("data-orr-gif") }))));
console.log("recaptcha badge", JSON.stringify(await page.evaluate(() => { const b = document.querySelector(".grecaptcha-badge"); return b ? getComputedStyle(b).visibility : "absent"; })));
await page.goto("https://www.reddit.com/r/AskReddit/comments/1x5nhcy/comment/pgnuiie/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".commentarea", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
console.log("single", JSON.stringify(await page.evaluate(() => ({ infobar: (document.querySelector(".commentarea .infobar") || {}).textContent, top: Array.from(document.querySelectorAll(".nestedlisting > .thing.comment")).map((t) => t.id), total: document.querySelectorAll(".thing.comment").length }))));
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
