// Logged out: Reddit's own hover-card partials vs the right-rail partial — size and
// what data they carry (for logged-out user/subreddit hover cards).
//   node probe12.mjs [user] [sub]
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [user = "spez", sub = "pics"] = process.argv.slice(2);
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
const out = await page.evaluate(async ([user, sub]) => {
  const ACC = "text/vnd.reddit.partial+html, text/html;q=0.9";
  const res = {};
  for (const [k, u] of [["userCard", `/svc/shreddit/user-hover-card/${user}`], ["subCard", `/svc/shreddit/community-hover-card/${sub}`], ["rightRail", `/svc/shreddit/feeds/subreddit-right-rail?name=${sub}`]]) {
    const r = await fetch(u, { credentials: "include", headers: { Accept: ACC } });
    const t = await r.text();
    const doc = new DOMParser().parseFromString(t, "text/html");
    doc.querySelectorAll("script, style, template").forEach((n) => n.remove());
    const text = doc.body.textContent.replace(/\s+/g, " ").trim();
    const numbers = Array.from(doc.querySelectorAll("faceplate-number")).map((n) => n.getAttribute("number"));
    const times = Array.from(doc.querySelectorAll("faceplate-timeago, time")).map((n) => n.getAttribute("ts") || n.getAttribute("datetime"));
    const attrs = Array.from(t.matchAll(/\s(karma|post-karma|comment-karma|cake-day|created|subscribers|weekly-active-users|weekly-contributions|description|members)="([^"]{0,60})"/gi)).map((m) => m[1] + "=" + m[2]).slice(0, 8);
    res[k] = { status: r.status, bytes: t.length, text: text.slice(0, 260), numbers, times, attrs };
  }
  return res;
}, [user, sub]);
console.log(JSON.stringify(out, null, 1));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
