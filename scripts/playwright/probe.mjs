// Which Reddit data endpoints does a LOGGED-OUT browser get usable data from?
// No extension loaded. node probe.mjs <sub>
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sub = process.argv[2] || "pics";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto(`https://www.reddit.com/r/${sub}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4000);

const out = await page.evaluate(async (sub) => {
  const probe = async (label, url, kind) => {
    try {
      const r = await fetch(url, { credentials: "include" });
      const ct = (r.headers.get("content-type") || "").split(";")[0];
      const t = await r.text();
      const info = { label, status: r.status, ct, len: t.length };
      if (kind === "json") { try { const j = JSON.parse(t); info.posts = ((j.data || (j[0] && j[0].data) || {}).children || []).length; } catch (e) { info.parse = "not json: " + t.slice(0, 60).replace(/\s+/g, " "); } }
      if (kind === "html") { info.shredditPosts = (t.match(/<shreddit-post\b/g) || []).length; info.challenge = /Prove your humanity|recaptcha/i.test(t); }
      if (kind === "rss") { info.entries = (t.match(/<entry>/g) || []).length; }
      return info;
    } catch (e) { return { label, error: String(e) }; }
  };
  return [
    await probe(".json (current)", `/r/${sub}/.json?raw_json=1&limit=25`, "json"),
    await probe("hot.json", `/r/${sub}/hot.json?raw_json=1`, "json"),
    await probe(".rss", `/r/${sub}/.rss`, "rss"),
    await probe("HTML page", `/r/${sub}/`, "html"),
    await probe("svc partial (hot)", `/svc/shreddit/community-more-posts/hot/?name=${sub}`, "html"),
  ];
}, sub);

// Also: does a top-level NAVIGATION to the .json work (vs fetch)?
const p2 = await ctx.newPage();
const resp = await p2.goto(`https://www.reddit.com/r/${sub}/.json?raw_json=1`, { waitUntil: "domcontentloaded" }).catch((e) => null);
const navInfo = resp ? { status: resp.status(), ct: (resp.headers()["content-type"] || "").split(";")[0], start: (await p2.content()).slice(0, 80).replace(/\s+/g, " ") } : { error: "nav failed" };

// What does the native HTML page give us to parse? (attributes on the first shreddit-post)
const attrs = await page.evaluate(() => {
  const p = document.querySelector("shreddit-post");
  if (!p) return null;
  const a = {}; for (const at of p.attributes) a[at.name] = at.value.slice(0, 60);
  return { count: document.querySelectorAll("shreddit-post").length, attrs: a };
});
console.log(JSON.stringify({ sub, fetches: out, navigateToJson: navInfo, nativePostAttrs: attrs }, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
