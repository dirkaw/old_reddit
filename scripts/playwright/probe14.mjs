// Logged out: profile feed sorts (new/hot/top/controversial + t) and paging (after=base64(fullname)).
//   node probe14.mjs [user]
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const user = process.argv[2] || "meiosis_";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"] });
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
const out = await page.evaluate(async (user) => {
  const ids = async (u) => {
    const r = await fetch(u, { credentials: "include", headers: { Accept: "text/vnd.reddit.partial+html, text/html;q=0.9" } });
    const d = new DOMParser().parseFromString(await r.text(), "text/html");
    const items = Array.from(d.querySelectorAll("shreddit-post, shreddit-profile-comment")).filter((e) => !(e.parentElement && e.parentElement.closest("shreddit-post")))
      .map((e) => e.getAttribute("id") || e.getAttribute("comment-id"));
    const nx = d.querySelector("faceplate-partial[src*='more-posts'][src*='after=']");
    return { status: r.status, n: items.length, first: items[0], last: items[items.length - 1], ids: items, next: nx ? decodeURIComponent((nx.getAttribute("src").match(/after=([^&]+)/) || [])[1] || "") : null };
  };
  const o = {};
  const F = "/svc/shreddit/profiles/profile_comments-more-posts";
  for (const u of [
    `${F}/new/?name=${user}`,
    `${F}/new/?name=${user}&sort=top&t=all`,
    `${F}/new/?name=${user}&sort=TOP&t=ALL`,
    `${F}/top/?name=${user}&sort=top&t=all`,
    `${F}/TOP/?name=${user}&t=ALL`,
    `/user/${user}/comments/?sort=top&t=all`,
    `/svc/shreddit/profiles/profile_comments-more-posts/top/?name=${user}&t=ALL&sort=top`,
  ]) { const r = await ids(u); o[u.replace(user, "U")] = `${r.status} n=${r.n} first=${r.first}`; }
  return o;
}, user);
console.log(JSON.stringify(out, null, 1));
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
