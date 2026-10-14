// Live logged-out check: stickies (green, on top) + right-rail sidebar on a sub, and inline
// v.redd.it playback with audio from the packaged MP4.
//   node live-extras.mjs <ext> <out> <sub> <videoSub>
import { chromium } from "playwright"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [extDir, out, sub, vsub] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0", "--autoplay-policy=no-user-gesture-required"] });
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
await page.goto(`https://www.reddit.com/r/${sub}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
console.log("listing", JSON.stringify(await page.evaluate(() => ({
  things: document.querySelectorAll("#siteTable .thing.link").length,
  stickies: Array.from(document.querySelectorAll("#siteTable .thing.stickied")).map((t) => t.querySelector("a.title").textContent.slice(0, 40) + " | " + getComputedStyle(t.querySelector("a.title")).color),
  firstIsSticky: !!document.querySelector("#siteTable .thing.link:first-child.stickied, #siteTable > .thing.link.stickied"),
  side: Array.from(document.querySelectorAll(".side .titlebox .redditname, .side .subscribers, .side .sidecontentbox .title h1")).map((e) => e.textContent.trim().slice(0, 40)),
}))));
await page.screenshot({ path: path.join(out, "sub.png") });
await page.goto(`https://www.reddit.com/r/${vsub}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
const btn = page.locator("#siteTable .thing.link[data-ptype=video] .expando-button").first();
await btn.click();
await page.waitForTimeout(1500);
const v = page.locator("#siteTable .expando video").first();
await v.evaluate((el) => { el.muted = false; el.volume = 0.5; return el.play().catch((e) => String(e)); });
await page.waitForTimeout(6000);
console.log("video", JSON.stringify(await v.evaluate((el) => ({ src: (el.currentSrc || "").slice(0, 60), t: el.currentTime, paused: el.paused, rs: el.readyState, err: el.error && el.error.code, audioBytes: el.webkitAudioDecodedByteCount, videoBytes: el.webkitVideoDecodedByteCount, muted: el.muted, fallback: !!document.querySelector(".orr-video-fallback") }))));
await page.screenshot({ path: path.join(out, "video.png") });
console.log("errors", JSON.stringify(errors));
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
