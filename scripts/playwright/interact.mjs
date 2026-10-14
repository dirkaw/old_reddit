// Logged-out interaction checks against the unpacked extension:
//  1. listing → infinite scroll loads page 2
//  2. listing → click a post's comments link (in-page nav) → thread renders
//  3. thread → click a nested "load more comments" stub → replies appear
//  4. thread → scroll to bottom → next page of top-level comments auto-loads
//  5. CSS: no new-Reddit stylesheets left in the rebuilt page
//   node interact.mjs <ext-dir> <out-dir> [sub]
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, outDir, sub = "AskReddit"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"],
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 200)));
const log = (k, v) => console.log(k.padEnd(28), typeof v === "string" ? v : JSON.stringify(v));
const nativeCss = () => page.evaluate(() => Array.from(document.querySelectorAll("style, link[rel~=stylesheet]"))
  .filter((n) => !/^orr-/.test(n.id || "") && !n.hasAttribute("class")).map((n) => n.id || n.href || "anon").length);

await page.goto(`https://www.reddit.com/r/${sub}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
log("listing things", await page.locator("#siteTable .thing.link").count());
log("listing native css left", await nativeCss());

// 1. infinite scroll
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 6000); await page.waitForTimeout(1200); }
await page.waitForTimeout(3000);
log("after scroll things", await page.locator("#siteTable .thing.link").count());
log("duplicate post ids", await page.evaluate(() => { const ids = Array.from(document.querySelectorAll("#siteTable .thing.link")).map((t) => t.id); const seen = new Set(), dup = []; ids.forEach((id, i) => { if (seen.has(id)) dup.push(id + "@" + i + (document.querySelectorAll("#" + id + ".stickied").length ? "(sticky)" : "")); seen.add(id); }); return dup.length ? dup : 0; }));
await page.screenshot({ path: path.join(outDir, "1-listing.png") });

// 2. in-page nav to a thread (pick a post with comments)
await page.evaluate(() => window.scrollTo(0, 0));
const link = page.locator("#siteTable .thing.link:not(.stickied) a.bylink.comments").first(); // stickies may have 0 comments
const href = await link.getAttribute("href");
await link.click();
await page.waitForSelector(".commentarea", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
log("nav href", href);
log("nav url", page.url());
log("thread comments", await page.locator(".commentarea .thing.comment").count());
log("thread more stubs", await page.locator("a.orr-more").count());
log("thread native css left", await nativeCss());
await page.screenshot({ path: path.join(outDir, "2-thread.png") });

// 3. click a nested "load more" (reply) stub
const before = await page.locator(".commentarea .thing.comment").count();
const nested = page.locator(".child a.orr-more[data-partial]").first();
if (await nested.count()) {
  const parentId = await nested.evaluate((a) => (a.closest(".thing.comment") || {}).id);
  await nested.scrollIntoViewIfNeeded();
  await nested.click();
  await page.waitForTimeout(5000);
  const after = await page.locator(".commentarea .thing.comment").count();
  const kids = await page.evaluate((id) => document.querySelectorAll("#" + id + " > .child > .thing.comment").length, parentId);
  log("reply stub: comments", before + " -> " + after + " (direct replies under " + parentId + ": " + kids + ")");
  await page.screenshot({ path: path.join(outDir, "3-replies.png") });
} else log("reply stub", "none on this thread");

// 4. scroll to the bottom → top-level partial auto-loads
const top0 = await page.locator(".nestedlisting > .thing.comment").count();
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 8000); await page.waitForTimeout(900); }
await page.waitForTimeout(5000);
log("top-level comments", top0 + " -> " + (await page.locator(".nestedlisting > .thing.comment").count()));
log("duplicate comment ids", await page.evaluate(() => { const ids = Array.from(document.querySelectorAll(".thing.comment")).map((t) => t.id); return ids.length - new Set(ids).size; }));await page.screenshot({ path: path.join(outDir, "4-bottom.png"), fullPage: false });

log("page errors", errors);
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
