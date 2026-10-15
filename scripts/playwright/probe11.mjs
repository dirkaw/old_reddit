// Logged out: does an NSFW subreddit's listing partial + thread page carry real data
// (post, media, comments), or a gated stub?   node probe11.mjs [sub]
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sub = process.argv[2] || "nsfw";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled", "--window-position=-3000,0"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
const out = await page.evaluate(async (sub) => {
  const ACC = "text/vnd.reddit.partial+html, text/html;q=0.9";
  const parse = (t) => { const d = new DOMParser().parseFromString(t, "text/html"); for (let i = 0; i < 25; i++) { const ts = d.querySelectorAll("template"); if (!ts.length) break; ts.forEach((x) => x.replaceWith(x.content)); } return d; };
  const get = async (u) => { const r = await fetch(u, { credentials: "include", headers: { Accept: ACC } }); return { status: r.status, text: await r.text() }; };
  const l = await get("/svc/shreddit/community-more-posts/hot/?name=" + sub);
  const ld = parse(l.text);
  const posts = Array.from(ld.querySelectorAll("shreddit-post"));
  const o = { listing: { status: l.status, posts: posts.length, nsfw: posts.filter((p) => p.hasAttribute("nsfw")).length, sampleAttrs: posts[0] ? Array.from(posts[0].attributes).map((a) => a.name).filter((n) => /nsfw|blur|over|spoiler/i.test(n)) : null,
    blurMarkers: (l.text.match(/blurred|nsfw-blur|shreddit-blurred-container|over18/gi) || []).slice(0, 5) } };
  const p = posts.find((x) => parseInt(x.getAttribute("comment-count"), 10) > 0) || posts[0];
  if (p) {
    const t = await get(p.getAttribute("permalink"));
    const td = parse(t.text);
    const tp = td.querySelector("shreddit-post");
    o.thread = { status: t.status, permalink: p.getAttribute("permalink"), hasPost: !!tp, nsfw: tp ? tp.hasAttribute("nsfw") : null, type: tp && tp.getAttribute("post-type"),
      media: tp ? !!tp.querySelector("[slot='post-media-container'] img, shreddit-player, gallery-carousel, shreddit-embed") : null,
      comments: td.querySelectorAll("shreddit-comment").length, commentCount: p.getAttribute("comment-count"),
      gateText: (t.text.match(/(mature|over 18|18\+|age[- ]?gate|verify your age)[^<]{0,60}/gi) || []).slice(0, 4) };
  }
  return o;
}, sub);
console.log(JSON.stringify(out, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
