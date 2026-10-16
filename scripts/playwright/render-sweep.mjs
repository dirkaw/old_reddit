// Rendering sweep with the extension loaded (logged out): for each URL, wait for the
// rebuild, open every expando, and check what actually rendered — broken images,
// videos that never load, media shown twice, empty bodies, page errors.
//   node render-sweep.mjs <ext-dir> <out-dir> <url>...
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, outDir, ...urls] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-rs-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"],
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0", "--autoplay-policy=no-user-gesture-required"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const results = [];
for (const url of urls) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) { errors.push("nav: " + e.message.slice(0, 100)); }
  await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const isThread = await page.evaluate(() => !!document.querySelector(".commentarea"));
  if (!isThread) {
    const n = await page.locator("#siteTable .expando-button").count();
    for (let i = 0; i < Math.min(n, 25); i++) await page.locator("#siteTable .expando-button").nth(i).click().catch(() => {});
  }
  await page.waitForTimeout(6000);
  const r = await page.evaluate((isThread) => {
    const vis = (el) => !!el && el.offsetParent !== null;
    const imgs = Array.from(document.querySelectorAll("#siteTable img, .commentarea .md img")).filter(vis);
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => (i.currentSrc || i.src).slice(0, 90));
    const vids = Array.from(document.querySelectorAll("#siteTable video, .commentarea video")).filter(vis);
    const deadVids = vids.filter((v) => v.error || (v.networkState === 3)).map((v) => (v.currentSrc || v.src || (v.querySelector("source") || {}).src || "").slice(0, 90));
    const gifs = Array.from(document.querySelectorAll(".commentarea video.orr-inline-gif"));
    // the same media shown twice inside one post/comment body
    const dupes = [];
    document.querySelectorAll("#siteTable .thing.link, .commentarea .thing.comment > .entry").forEach((t) => {
      const srcs = Array.from(t.querySelectorAll(":scope img, :scope video")).filter((m) => vis(m) && !m.closest(".thumbnail")).map((m) => (m.currentSrc || m.src || "").replace(/[?#].*$/, "").replace(/^https:\/\/(preview|external-preview|i)\.redd\.it\//, "").replace(/-v0-/, "/"));
      const key = (s) => s.split("/").pop();
      const seen = new Set();
      srcs.filter(Boolean).forEach((s) => { const k = key(s); if (seen.has(k)) dupes.push(k.slice(0, 50)); seen.add(k); });
    });
    const things = Array.from(document.querySelectorAll("#siteTable .thing.link"));
    const exps = things.map((t) => {
      const ex = t.querySelector(".expando");
      return { type: t.dataset.ptype, hasExpando: !!ex, open: !!ex && ex.style.display !== "none", empty: !!ex && !ex.textContent.trim() && !ex.querySelector("img, video, iframe, audio, .orr-embed-gate, .orr-video-fallback") };
    });
    const post = document.querySelector("#siteTable .thing.link");
    return {
      rebuilt: !!document.getElementById("siteTable"), things: things.length, comments: document.querySelectorAll(".commentarea .thing.comment").length,
      broken, deadVids, dupes: Array.from(new Set(dupes)), inlineGifs: gifs.length, gifsPlaying: gifs.filter((g) => !g.paused && g.readyState >= 2).length,
      emptyExpandos: exps.filter((e) => e.empty).map((e) => e.type),
      threadPost: isThread && post ? { type: post.dataset.ptype, hasExpando: !!post.querySelector(".expando"), bodyText: ((post.querySelector(".expando .md") || {}).textContent || "").trim().length, media: post.querySelectorAll(".expando img, .expando video, .expando iframe").length } : null,
      fallbacks: document.querySelectorAll(".orr-video-fallback").length,
    };
  }, isThread).catch((e) => ({ evalError: String(e) }));
  const name = url.replace(/^https?:\/\/(www\.)?reddit\.com\/?/, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 70) || "front";
  await page.screenshot({ path: path.join(outDir, name + ".png") }).catch(() => {});
  results.push({ url, ...r, errors });
  const bad = (r.broken || []).length || (r.deadVids || []).length || (r.dupes || []).length || (r.emptyExpandos || []).length || errors.length || !r.rebuilt;
  console.log(`${bad ? "CHECK" : "ok   "} ${r.rebuilt ? "" : "NATIVE "}things=${r.things} comments=${r.comments} broken=${(r.broken || []).length} deadVid=${(r.deadVids || []).length} dupes=${(r.dupes || []).length} emptyExp=${(r.emptyExpandos || []).length} gifs=${r.gifsPlaying}/${r.inlineGifs} fb=${r.fallbacks} errs=${errors.length} ${r.threadPost ? "post=" + JSON.stringify(r.threadPost) : ""}  ${url.replace("https://www.reddit.com", "")}`);
  await page.close();
}
fs.writeFileSync(path.join(outDir, "render.json"), JSON.stringify(results, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
