// Comments page (logged-out): where do comments come from and what do they carry?
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
const svc = [];
page.on("response", (r) => { const u = r.url(); if (/\/svc\/shreddit\//.test(u)) svc.push(r.status() + " " + u.replace("https://www.reddit.com", "").slice(0, 260)); });
await page.goto("https://www.reddit.com/r/todayilearned/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
const listing = await page.evaluate(async () => {
  const t = await (await fetch("/r/todayilearned/", { credentials: "include" })).text();
  const d = new DOMParser().parseFromString(t, "text/html");
  const posts = Array.from(d.querySelectorAll("shreddit-post"));
  const part = d.querySelector("faceplate-partial[src*='more-posts']");
  return { perma: posts.map((p) => p.getAttribute("permalink")), more: part && part.getAttribute("src"), html: t.length };
});
// svc partial: count real posts
const more = await page.evaluate(async (src) => {
  const t = await (await fetch(src, { credentials: "include" })).text();
  const d = new DOMParser().parseFromString(t, "text/html");
  const posts = Array.from(d.querySelectorAll("shreddit-post"));
  const nxt = d.querySelector("faceplate-partial[src*='more-posts']");
  const thumb = posts[0] && posts[0].querySelector("[slot=thumbnail]");
  const flair = posts.map((p) => p.querySelector("shreddit-post-flair")).find(Boolean);
  return { count: posts.length, next: nxt && nxt.getAttribute("src").slice(0, 200), thumbHtml: thumb ? thumb.outerHTML.slice(0, 600) : null, flairHtml: flair ? flair.outerHTML.slice(0, 600) : null };
}, listing.more);
svc.length = 0;
const perma = listing.perma[0];
await page.goto("https://www.reddit.com" + perma, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(7000);
const live = await page.evaluate(() => {
  const all = (root, sel, acc = []) => { root.querySelectorAll(sel).forEach((e) => acc.push(e)); root.querySelectorAll("*").forEach((e) => { if (e.shadowRoot) all(e.shadowRoot, sel, acc); }); return acc; };
  const cs = all(document, "shreddit-comment");
  const a = {}; if (cs[0]) for (const at of cs[0].attributes) a[at.name] = at.value.slice(0, 100);
  const body = cs[0] && cs[0].querySelector("[slot=comment]");
  return { liveComments: cs.length, firstAttrs: a, firstBody: body ? body.outerHTML.slice(0, 500) : null,
    partials: all(document, "faceplate-partial").map((p) => (p.getAttribute("src") || "").slice(0, 220)), posts: all(document, "shreddit-post").length, title: document.title };
});
fs.writeFileSync(OUT, JSON.stringify({ listing, more, commentsSvc: svc, live }, null, 2));
console.log("ok", perma);
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
