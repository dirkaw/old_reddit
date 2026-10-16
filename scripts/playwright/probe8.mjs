// Pagination + sort coverage for the logged-out listing partials.
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
await page.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
const res = await page.evaluate(async () => {
  const out = {};
  const ids = async (u) => {
    const r = await fetch(u, { credentials: "include" });
    const d = new DOMParser().parseFromString(await r.text(), "text/html");
    const ps = Array.from(d.querySelectorAll("shreddit-post"));
    const nx = d.querySelector("faceplate-partial[src*='more-posts'], faceplate-partial[src*='/feeds/']");
    return { status: r.status, n: ps.length, ids: ps.map((p) => p.id), next: nx ? nx.getAttribute("src") : null };
  };
  const p1 = await ids("/svc/shreddit/community-more-posts/hot/?name=pics");
  const last = p1.ids[p1.ids.length - 1];
  const p2 = await ids("/svc/shreddit/community-more-posts/hot/?name=pics&after=" + encodeURIComponent(btoa(last)));
  out.subPaging = { p1n: p1.n, p2n: p2.n, overlap: p2.ids.filter((i) => p1.ids.includes(i)).length, nextAfterDecoded: p1.next && atob(decodeURIComponent((p1.next.match(/after=([^&]+)/) || [])[1] || "")), last };
  for (const s of ["rising", "controversial", "best"]) { const r = await ids(`/svc/shreddit/community-more-posts/${s}/?name=pics&t=WEEK`); out["sort_" + s] = r.status + "/" + r.n; }
  // feeds
  for (const f of ["home-feed", "popular-feed"]) {
    for (const s of ["BEST", "HOT", "NEW", "TOP", "RISING"]) {
      const a = await ids(`/svc/shreddit/feeds/${f}?sort=${s}`);
      let b = null;
      if (a.ids.length) { const l = a.ids[a.ids.length - 1]; const c = encodeURIComponent(btoa(l)); b = await ids(`/svc/shreddit/feeds/${f}?sort=${s}&after=${c}&cursor=${c}`); }
      out[f + "_" + s] = a.status + "/" + a.n + " -> " + (b ? b.status + "/" + b.n + " overlap " + b.ids.filter((i) => a.ids.includes(i)).length : "-");
    }
  }
  const t = await ids("/svc/shreddit/feeds/popular-feed?sort=TOP&t=WEEK");
  out.popularTopWeek = t.n;
  // attribute names for nsfw/spoiler/sticky across a few subs
  const names = new Set();
  for (const u of ["/svc/shreddit/community-more-posts/hot/?name=todayilearned", "/svc/shreddit/community-more-posts/hot/?name=movies", "/svc/shreddit/community-more-posts/hot/?name=AskReddit", "/svc/shreddit/community-more-posts/hot/?name=gaming"]) {
    const d = new DOMParser().parseFromString(await (await fetch(u, { credentials: "include" })).text(), "text/html");
    d.querySelectorAll("shreddit-post").forEach((p) => { for (const a of p.attributes) names.add(a.name); });
    const th = d.querySelector("shreddit-post [slot=thumbnail]");
    if (th && !out.thumbSample) out.thumbSample = th.outerHTML.replace(/\sclass="[^"]*"/g, "").replace(/\s+/g, " ").slice(0, 700);
  }
  out.attrNames = Array.from(names).sort();
  return out;
});
console.log(JSON.stringify(res, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
