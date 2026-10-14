// Dump the data a logged-out browser can parse out of Reddit's HTML:
// shreddit-post attributes (listing + comments page) and shreddit-comment attributes.
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
await page.goto("https://www.reddit.com/r/todayilearned/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);

const res = await page.evaluate(async () => {
  const parse = (t) => new DOMParser().parseFromString(t, "text/html");
  const attrsOf = (el, max) => { const a = {}; for (const at of el.attributes) a[at.name] = at.value.slice(0, max || 90); return a; };
  const out = {};
  // 1) listing HTML
  let t = await (await fetch("/r/todayilearned/", { credentials: "include" })).text();
  let d = parse(t);
  const posts = d.querySelectorAll("shreddit-post");
  out.listingPostCount = posts.length;
  out.firstPost = posts[0] ? attrsOf(posts[0]) : null;
  out.firstPostChildSlots = posts[0] ? Array.from(posts[0].querySelectorAll("[slot]")).map((e) => e.getAttribute("slot") + ":" + e.tagName.toLowerCase()).slice(0, 25) : null;
  // pagination: how does the page link to the next batch?
  const loader = d.querySelector("faceplate-partial[src*='more-posts'], [src*='community-more-posts']");
  out.moreSrc = loader ? loader.getAttribute("src").slice(0, 200) : null;
  // 2) a comments page
  const perma = posts[0] && posts[0].getAttribute("permalink");
  if (perma) {
    t = await (await fetch(perma, { credentials: "include" })).text();
    d = parse(t);
    const cp = d.querySelector("shreddit-post");
    out.commentsPagePost = cp ? attrsOf(cp) : null;
    out.commentsPagePostText = cp ? ((cp.querySelector("[slot=text-body]") || {}).innerHTML || "").slice(0, 200) : null;
    const cs = d.querySelectorAll("shreddit-comment");
    out.commentCount = cs.length;
    out.firstComment = cs[0] ? attrsOf(cs[0]) : null;
    out.firstCommentBody = cs[0] ? ((cs[0].querySelector("[slot=comment]") || {}).innerHTML || "").slice(0, 220) : null;
    const tree = d.querySelector("shreddit-comment-tree");
    out.commentTree = tree ? attrsOf(tree, 120) : null;
    const moreC = d.querySelectorAll("faceplate-partial[src*='comment'], [src*='more-comments']");
    out.moreCommentsSrc = moreC[0] ? moreC[0].getAttribute("src").slice(0, 220) : null;
  }
  return out;
});
console.log(JSON.stringify(res, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
