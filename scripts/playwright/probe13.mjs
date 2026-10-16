// Logged out: what does a user profile's HTML carry (posts/comments, paging partials),
// and is it behind the bot check?   node probe13.mjs <outdir> [user]
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [outDir, user = "meiosis_"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
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
const res = await page.evaluate(async (user) => {
  const ACC = "text/vnd.reddit.partial+html, text/html;q=0.9";
  const out = {};
  const parse = (t) => { const d = new DOMParser().parseFromString(t, "text/html"); for (let i = 0; i < 25; i++) { const ts = d.querySelectorAll("template"); if (!ts.length) break; ts.forEach((x) => x.replaceWith(x.content)); } return d; };
  const look = async (label, u, accept) => {
    try {
      const r = await fetch(u, { credentials: "include", headers: accept ? { Accept: accept } : {} });
      const t = await r.text();
      const d = parse(t);
      const tags = {};
      d.querySelectorAll("*").forEach((e) => { const n = e.tagName.toLowerCase(); if (/^shreddit-(post|comment|profile)|profile/.test(n)) tags[n] = (tags[n] || 0) + 1; });
      out[label] = { status: r.status, ct: (r.headers.get("content-type") || "").split(";")[0], bytes: t.length, captcha: /Prove your humanity/i.test(t), tags,
        partials: Array.from(d.querySelectorAll("faceplate-partial")).map((p) => p.getAttribute("src") || "").filter((s) => /profile|more|after|user/.test(s)).map((s) => s.slice(0, 170)).slice(0, 6),
        sample: (() => { const c = d.querySelector("shreddit-profile-comment, shreddit-comment"); return c ? Array.from(c.attributes).map((a) => a.name + "=" + a.value.slice(0, 50)).slice(0, 16) : null; })() };
      return t;
    } catch (e) { out[label] = String(e); return ""; }
  };
  const pageHtml = await look("page", `/user/${user}/`, ACC);
  await look("page-plainaccept", `/user/${user}/`);
  await look("submitted", `/user/${user}/submitted/`, ACC);
  await look("comments", `/user/${user}/comments/`, ACC);
  for (const u of [
    `/svc/shreddit/profiles/profile_overview-more-posts/new/?name=${user}`,
    `/svc/shreddit/profiles/profile_posts-more-posts/new/?name=${user}`,
    `/svc/shreddit/profiles/profile_comments-more-posts/new/?name=${user}`,
  ]) await look(u, u, ACC);
  return { out, pageHtml };
}, user);
fs.writeFileSync(path.join(outDir, "user-page.html"), res.pageHtml);
console.log(JSON.stringify(res.out, null, 1));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
