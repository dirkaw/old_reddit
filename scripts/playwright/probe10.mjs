// PR #28 follow-ups, logged out: the subreddit right-rail partial (sidebar), where
// stickies ("community highlights") come from, and whether a video's
// packaged-media MP4s are fetchable.   node probe10.mjs [sub]
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sub = process.argv[2] || "AskReddit";
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
const out = await page.evaluate(async (sub) => {
  const ACC = "text/vnd.reddit.partial+html, text/html;q=0.9";
  const get = async (u) => { const r = await fetch(u, { credentials: "include", headers: { Accept: ACC } }); return { status: r.status, text: await r.text() }; };
  const parse = (t) => { const d = new DOMParser().parseFromString(t, "text/html"); for (let i = 0; i < 25; i++) { const ts = d.querySelectorAll("template"); if (!ts.length) break; ts.forEach((x) => x.replaceWith(x.content)); } return d; };
  const o = {};
  // 1. right rail
  const rr = await get("/svc/shreddit/feeds/subreddit-right-rail?name=" + sub);
  const rd = parse(rr.text);
  const hdr = rd.querySelector("shreddit-subreddit-header");
  o.rail = { status: rr.status, len: rr.text.length, header: hdr ? Array.from(hdr.attributes).map((a) => a.name + "=" + a.value.slice(0, 60)) : null,
    h2s: Array.from(rd.querySelectorAll("h2")).map((h) => h.textContent.replace(/\s+/g, " ").trim().slice(0, 40)).slice(0, 20),
    siblings: hdr && hdr.parentElement ? Array.from(hdr.parentElement.children).map((c) => c.tagName.toLowerCase() + (c.querySelector("h2") ? ":" + c.querySelector("h2").textContent.trim().slice(0, 30) : "")).slice(0, 20) : null };
  // 2. highlights: in the sub page HTML? any partial for them?
  const pg = await get("/r/" + sub + "/");
  const pd = parse(pg.text);
  const cards = Array.from(pd.querySelectorAll("community-highlight-card"));
  o.highlights = { pageLen: pg.text.length, cards: cards.length, ids: cards.map((c) => c.id).slice(0, 4),
    cardAttrs: cards[0] ? Array.from(cards[0].attributes).map((a) => a.name + "=" + a.value.slice(0, 50)) : null,
    partials: Array.from(pd.querySelectorAll("faceplate-partial")).map((p) => p.getAttribute("src") || "").filter((s) => /highlight|sticky|pinned/i.test(s)).map((s) => s.slice(0, 160)),
    stickiedPosts: Array.from(pd.querySelectorAll("shreddit-post")).filter((p) => p.hasAttribute("stickied") || p.hasAttribute("pinned")).length };
  // 3. packaged media mp4
  const vids = await get("/svc/shreddit/community-more-posts/hot/?name=nextfuckinglevel");
  const vd = parse(vids.text);
  const pl = vd.querySelector("shreddit-player, shreddit-player-2");
  o.player = null;
  if (pl) {
    let pm = null; try { pm = JSON.parse(pl.getAttribute("packaged-media-json") || "null"); } catch (e) { pm = "bad json"; }
    const perms = pm && pm.playbackMp4s ? pm.playbackMp4s.permutations : [];
    o.player = { attrs: Array.from(pl.attributes).map((a) => a.name), keys: pm && typeof pm === "object" ? Object.keys(pm) : pm,
      perms: perms.map((p) => p.source.dimensions.height + "p " + p.source.bitrateBps + " " + p.source.url.slice(0, 70)), sample: perms.length ? perms[perms.length - 1].source.url : null,
      permKeys: perms[0] ? Object.keys(perms[0].source) : null };
  }
  return o;
}, sub);
// try the packaged mp4 from node-side page context with a <video> element (codec support aside, does it load metadata?)
if (out.player && out.player.sample) {
  const vp = await ctx.newPage();
  await vp.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded" });
  out.videoLoad = await vp.evaluate(async (src) => {
    const r = await fetch(src, { method: "GET", headers: { Range: "bytes=0-2047" } }).then((r) => ({ status: r.status, ct: r.headers.get("content-type"), acao: r.headers.get("access-control-allow-origin") })).catch((e) => ({ err: String(e) }));
    const v = document.createElement("video"); v.muted = true; v.preload = "metadata"; v.src = src; document.documentElement.appendChild(v);
    const meta = await new Promise((res) => { const t = setTimeout(() => res({ timeout: true, rs: v.readyState, err: v.error && v.error.code }), 12000); v.onloadedmetadata = () => { clearTimeout(t); res({ ok: true, w: v.videoWidth, h: v.videoHeight, dur: v.duration, audioTracks: v.audioTracks ? v.audioTracks.length : "n/a", mozHasAudio: v.mozHasAudio, webkitAudio: v.webkitAudioDecodedByteCount }); }; v.onerror = () => { clearTimeout(t); res({ error: v.error && v.error.code }); }; });
    return { fetch: r, meta };
  }, out.player.sample);
  fs.writeFileSync(path.join(os.tmpdir(), "orr-pm-url.txt"), out.player.sample);
}
console.log(JSON.stringify(out, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
