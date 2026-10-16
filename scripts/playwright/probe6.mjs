// Feed endpoints + per-post-type markup samples, logged-out. node probe6.mjs <outdir>
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
const res = await page.evaluate(async () => {
  const out = { pages: {}, svc: {}, samples: {} };
  const get = async (u) => { const r = await fetch(u, { credentials: "include" }); return { status: r.status, ct: (r.headers.get("content-type") || "").split(";")[0], text: await r.text() }; };
  const parse = (t) => new DOMParser().parseFromString(t, "text/html");
  for (const u of ["/", "/r/popular/", "/r/all/", "/r/pics/new/", "/r/pics/top/?t=week", "/r/pics+aww/", "/user/spez/m/test/"]) {
    try {
      const r = await get(u); const d = parse(r.text);
      out.pages[u] = { status: r.status, ct: r.ct, len: r.text.length, posts: d.querySelectorAll("shreddit-post").length,
        partials: Array.from(d.querySelectorAll("faceplate-partial")).map((p) => p.getAttribute("src") || "").filter((s) => /posts|feed/.test(s)).map((s) => s.slice(0, 230)),
        captcha: /Prove your humanity/.test(r.text) };
    } catch (e) { out.pages[u] = String(e); }
  }
  const svcUrls = [
    "/svc/shreddit/community-more-posts/hot/?name=pics",
    "/svc/shreddit/community-more-posts/new/?name=pics",
    "/svc/shreddit/community-more-posts/top/?name=pics&t=WEEK",
    "/svc/shreddit/community-more-posts/hot/?name=pics&after=" + encodeURIComponent(btoa("t3_1x5of7q")),
    "/svc/shreddit/community-more-posts/hot/?name=pics%2Baww",
    "/svc/shreddit/community-more-posts/hot/?name=popular",
    "/svc/shreddit/community-more-posts/hot/?name=all",
    "/svc/shreddit/feeds/popular-feed?sort=HOT",
    "/svc/shreddit/feeds/all-feed?sort=HOT",
    "/svc/shreddit/feeds/home-feed?sort=BEST",
  ];
  const types = {};
  for (const u of svcUrls) {
    try {
      const r = await get(u); const d = parse(r.text);
      const posts = Array.from(d.querySelectorAll("shreddit-post"));
      const nxt = d.querySelector("faceplate-partial[src*='posts'], faceplate-partial[src*='feed']");
      out.svc[u] = { status: r.status, ct: r.ct, posts: posts.length, first: posts.slice(0, 3).map((p) => p.getAttribute("post-title").slice(0, 40) + " | " + p.getAttribute("score")), next: nxt && nxt.getAttribute("src").slice(0, 200) };
      posts.forEach((p) => { const t = p.getAttribute("post-type"); (types[t] = types[t] || []).push(p.outerHTML); });
    } catch (e) { out.svc[u] = String(e); }
  }
  // extra subs for type coverage
  for (const sub of ["videos", "AskReddit", "mildlyinteresting", "nextfuckinglevel", "EarthPorn", "funny", "interestingasfuck"]) {
    try { const r = await get("/svc/shreddit/community-more-posts/hot/?name=" + sub); const d = parse(r.text);
      d.querySelectorAll("shreddit-post").forEach((p) => { const t = p.getAttribute("post-type"); (types[t] = types[t] || []).push(p.outerHTML); });
    } catch (e) {}
  }
  for (const t in types) out.samples[t] = { n: types[t].length, html: types[t].slice(0, 2) };
  return out;
});
for (const t in res.samples) { fs.writeFileSync(path.join(OUT, "type-" + t + ".html"), res.samples[t].html.join("\n\n<!-- ======== -->\n\n")); res.samples[t] = res.samples[t].n; }
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(res, null, 2));
console.log("done");
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
