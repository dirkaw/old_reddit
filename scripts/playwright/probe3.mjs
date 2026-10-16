// Why is .json 403 logged-out, and where do comments come from on the HTML comments page?
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
const svc = [];
page.on("request", (r) => { const u = r.url(); if (/\/svc\/shreddit\//.test(u)) svc.push(u.replace("https://www.reddit.com", "").slice(0, 200)); });
await page.goto("https://www.reddit.com/r/todayilearned/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4000);
const body403 = await page.evaluate(async () => {
  const r = await fetch("/r/todayilearned/.json?raw_json=1", { credentials: "include" });
  const t = await r.text();
  return { status: r.status, text: t.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) };
});
const cookies = (await ctx.cookies()).map((c) => c.domain + ":" + c.name);
// Go to a comments page and watch which svc partials load the comments
const perma = await page.evaluate(() => { const p = document.querySelector("shreddit-post"); return p && p.getAttribute("permalink"); });
const listingSvc = svc.splice(0);
let commentInfo = null;
if (perma) {
  await page.goto("https://www.reddit.com" + perma, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);
  commentInfo = await page.evaluate(() => {
    const cs = document.querySelectorAll("shreddit-comment");
    const a = {}; if (cs[0]) for (const at of cs[0].attributes) a[at.name] = at.value.slice(0, 90);
    const partials = Array.from(document.querySelectorAll("faceplate-partial")).map((p) => (p.getAttribute("src") || "").slice(0, 200));
    const body = cs[0] && cs[0].querySelector("[slot=comment]");
    return { liveComments: cs.length, firstAttrs: a, firstBody: body ? body.innerHTML.slice(0, 300) : null, partials };
  });
}
const old = await ctx.newPage();
const r2 = await old.goto("https://old.reddit.com/r/todayilearned/.json?raw_json=1", { waitUntil: "domcontentloaded" }).catch(() => null);
const oldInfo = r2 ? { status: r2.status(), url: old.url().slice(0, 120), start: (await old.content()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160) } : null;
console.log(JSON.stringify({ body403, cookies, listingSvc, commentSvc: svc, commentInfo, oldInfo }, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
