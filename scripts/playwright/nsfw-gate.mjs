// Logged-out over-18 gate: an adult sub shows old reddit's interstitial, "continue"
// renders the listing in place (no new-Reddit reroute) and is remembered; a direct
// NSFW thread in a fresh profile gets the post gate; media is the real (unblurred) one.
//   node nsfw-gate.mjs <ext-dir> <out-dir> [sub]
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, outDir, sub = "nsfw"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const launch = async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    ignoreDefaultArgs: ["--enable-automation"],
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0"],
  });
  await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
  return { ctx, profile };
};
const state = (page) => page.evaluate(() => ({
  url: location.pathname, gate: !!document.querySelector(".interstitial .orr-over18-yes"), gateTitle: (document.querySelector(".interstitial h3") || {}).textContent || null,
  rebuilt: !!document.getElementById("siteTable") || !!document.querySelector(".interstitial"), things: document.querySelectorAll("#siteTable .thing.link").length,
  comments: document.querySelectorAll(".commentarea .thing.comment").length,
}));
let fail = 0;
const check = (name, ok, info) => { console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  " + info : "")); if (!ok) fail++; };

// 1) adult sub → gate → continue → listing, then a thread opens without a second gate
let { ctx, profile } = await launch();
let page = await ctx.newPage();
const errors = [];
// (new Reddit's own scripts keep running after the body swap; its screen-reader announcer throws "t.announce is not a function" — not ours)
page.on("pageerror", (e) => { if (!/\.announce is not a function/.test(e.message)) errors.push(String(e.message).slice(0, 160)); });
await page.goto(`https://www.reddit.com/r/${sub}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector(".interstitial, #siteTable", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
let s = await state(page);
check("adult sub shows the over-18 gate", s.gate && /community/.test(s.gateTitle || ""), JSON.stringify(s));
await page.screenshot({ path: path.join(outDir, "1-gate.png") });
await page.click(".orr-over18-yes");
await page.waitForSelector("#siteTable .thing.link", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
s = await state(page);
check("continue renders the listing in place", !s.gate && s.things > 5 && s.url === `/r/${sub}/`, JSON.stringify(s));
// expand the first image/video post: the real media, not Reddit's blur=40 preview
const btn = page.locator("#siteTable .thing.link .expando-button").first();
await btn.click().catch(() => {});
await page.waitForTimeout(2000);
const media = await page.evaluate(() => Array.from(document.querySelectorAll("#siteTable .expando img, #siteTable .expando video source, #siteTable .expando video, #siteTable .expando iframe, #siteTable .orr-embed-gate"))
  .map((m) => m.getAttribute("src") || m.getAttribute("data-embed-href") || "").filter(Boolean).slice(0, 3));
check("expanded media is the unblurred source", media.length > 0 && media.every((u) => !/[?&]blur=/.test(u)), JSON.stringify(media.map((u) => u.slice(0, 70))));
await page.screenshot({ path: path.join(outDir, "2-listing.png") });
const link = page.locator("#siteTable .thing.link a.bylink.comments").first();
const href = await link.getAttribute("href");
await link.click();
await page.waitForSelector(".commentarea, .interstitial", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
s = await state(page);
check("NSFW thread opens without a second gate (remembered)", !s.gate && s.url === href.split("?")[0], JSON.stringify(s));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".commentarea, .interstitial", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
s = await state(page);
check("still remembered after a reload", !s.gate && s.comments >= 0 && s.rebuilt, JSON.stringify(s));
check("no page errors", errors.length === 0, JSON.stringify(errors));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });

// 2) fresh profile, straight to an NSFW thread → post gate → continue → thread
({ ctx, profile } = await launch());
page = await ctx.newPage();
await page.goto("https://www.reddit.com" + href, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector(".interstitial, .commentarea", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
s = await state(page);
check("direct NSFW thread shows the post gate", s.gate && /post/.test(s.gateTitle || ""), JSON.stringify(s));
await page.click(".orr-over18-yes").catch(() => {});
await page.waitForSelector(".commentarea", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
s = await state(page);
check("continue renders the thread in place", !s.gate && s.things === 1, JSON.stringify(s));
await page.screenshot({ path: path.join(outDir, "3-thread.png") });
// "no thank you" goes to the front page, still in the old layout
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
({ ctx, profile } = await launch());
page = await ctx.newPage();
await page.goto(`https://www.reddit.com/r/${sub}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector(".interstitial", { timeout: 30000 }).catch(() => {});
await page.click(".interstitial a.c-btn").catch(() => {});
await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
s = await state(page);
check("'no thank you' goes to the front page (old layout)", s.url === "/" && s.things > 0, JSON.stringify(s));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
