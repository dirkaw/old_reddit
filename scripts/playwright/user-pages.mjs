// Logged-out user profiles in the old layout: overview / submitted / comments (+ sort),
// sidebar from the hover-card partial, infinite scroll, and in-page nav from a listing
// author.   node user-pages.mjs <ext-dir> <out-dir> [user]
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, outDir, user = "meiosis_"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"],
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (!/\.announce is not a function/.test(e.message)) errors.push(String(e.message).slice(0, 160)); });
let fail = 0;
const check = (name, ok, info) => { console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  " + info : "")); if (!ok) fail++; };
const state = () => page.evaluate(() => ({
  rebuilt: document.body && document.body.classList.contains("profile-page"),
  posts: document.querySelectorAll("#siteTable .thing.link").length,
  comments: document.querySelectorAll("#siteTable .thing.comment").length,
  firstComment: (() => { const c = document.querySelector("#siteTable .thing.comment"); return c ? { tagline: c.querySelector(".tagline").innerText.replace(/\s+/g, " ").slice(0, 120), body: (c.querySelector(".usertext-body") || {}).innerText.trim().slice(0, 60) } : null; })(),
  side: (document.querySelector(".side .titlebox") || {}).innerText ? document.querySelector(".side .titlebox").innerText.replace(/\s+/g, " ") : null,
  tab: (document.querySelector(".tabmenu .selected") || {}).innerText || null,
}));
const go = async (p) => {
  await page.goto("https://www.reddit.com" + p, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#siteTable, .interstitial", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3500);
  return state();
};

let s = await go(`/user/${user}/`);
check("overview rebuilt with posts/comments", s.rebuilt && s.posts + s.comments >= 10, JSON.stringify({ posts: s.posts, comments: s.comments, tab: s.tab }));
check("comment shows 'on <post> in r/sub' + body", !!s.firstComment && / on .+ in r\//.test(s.firstComment.tagline) && s.firstComment.body.length > 0, JSON.stringify(s.firstComment));
check("sidebar: karma + cake day", !!s.side && /post karma/.test(s.side) && /cake day/.test(s.side), s.side);
await page.screenshot({ path: path.join(outDir, "overview.png") });
const before = s.posts + s.comments;
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 6000); await page.waitForTimeout(1200); }
await page.waitForTimeout(2500);
s = await state();
const dup = await page.evaluate(() => { const ids = Array.from(document.querySelectorAll("#siteTable > .thing")).map((t) => t.id); return ids.length - new Set(ids).size; });
check("infinite scroll loads more, no duplicates", s.posts + s.comments > before && dup === 0, `${before} → ${s.posts + s.comments}, dup ${dup}`);

s = await go(`/user/${user}/submitted/`);
check("submitted: posts only", s.rebuilt && s.posts > 0 && s.comments === 0, JSON.stringify({ posts: s.posts, tab: s.tab }));
s = await go(`/user/${user}/comments/?sort=top&t=all`);
check("comments sorted top: comments only", s.rebuilt && s.comments > 0 && s.posts === 0, JSON.stringify({ comments: s.comments, first: s.firstComment && s.firstComment.tagline }));
await page.screenshot({ path: path.join(outDir, "comments-top.png") });

// in-page nav: a listing author → their profile, rebuilt
await go("/r/AskReddit/");
const a = page.locator("#siteTable a.author").first();
const who = await a.textContent();
await a.click();
await page.waitForSelector("body.profile-page", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
s = await state();
check("click an author in a listing → old-layout profile", s.rebuilt && page.url().includes("/user/" + who), page.url());

// a profile that hides its posts: still the old layout, with stats + an explanation
s = await go("/user/Justmetalking/");
const empty = await page.evaluate(() => (document.querySelector("#siteTable .thing") || {}).innerText || "");
check("hidden-posts profile: old layout + stats + message", s.rebuilt && /post karma/.test(s.side || "") && /may keep their posts hidden/.test(empty), empty);
check("no page errors", errors.length === 0, JSON.stringify(errors));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
