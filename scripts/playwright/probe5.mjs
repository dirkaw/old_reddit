// Can a same-origin fetch() get the comment tree HTML (as a content script would)?
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
await page.goto("https://www.reddit.com/r/todayilearned/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
const res = await page.evaluate(async () => {
  const t0 = await (await fetch("/r/todayilearned/", { credentials: "include" })).text();
  const d0 = new DOMParser().parseFromString(t0, "text/html");
  const p = d0.querySelector("shreddit-post");
  const perma = p.getAttribute("permalink");
  const id = p.getAttribute("id"); // t3_xxx
  const sub = p.getAttribute("subreddit-name");
  const out = { perma };
  const probe = async (label, url, init) => {
    try {
      const r = await fetch(url, Object.assign({ credentials: "include" }, init || {}));
      const t = await r.text();
      const d = new DOMParser().parseFromString(t, "text/html");
      out[label] = { status: r.status, ct: (r.headers.get("content-type") || "").split(";")[0], len: t.length,
        rxComments: (t.match(/<shreddit-comment[\s>]/g) || []).length, domComments: d.querySelectorAll("shreddit-comment").length,
        templates: d.querySelectorAll("template").length, more: (t.match(/more-comments\/[^"]+/g) || []).slice(-1)[0] || null };
      if (label === "page-html") out.snippetAroundTree = (t.match(/<shreddit-comment-tree[^>]*>/) || [""])[0].slice(0, 600);
      if (label === "page-html") out.loaderMatches = (t.match(/<faceplate-partial[^>]*comment[^>]*>/g) || []).map((s) => s.slice(0, 300)).slice(0, 4);
    } catch (e) { out[label] = { error: String(e) }; }
  };
  await probe("page-html", perma);
  await probe("page-html-accept", perma, { headers: { Accept: "text/html,application/xhtml+xml" } });
  await probe("comments-partial", `/svc/shreddit/comments/${sub}/${id}?render-mode=partial`);
  await probe("comments-partial-r", `/svc/shreddit/comments/r/${sub}/${id}?render-mode=partial`);
  await probe("more-comments-top", `/svc/shreddit/more-comments/${sub}/${id}?top-level=1&comments-remaining=500&commentPositionOffset=0`);
  await probe("more-comments-sorted", `/svc/shreddit/more-comments/${sub}/${id}?sort=NEW&top-level=1&comments-remaining=500&commentPositionOffset=0`);
  return out;
});
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
console.log("done");
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
