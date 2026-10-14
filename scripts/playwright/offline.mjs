// Offline check of the logged-out HTML parsers against saved Reddit HTML (no network).
// Loads common.js + rebuild.js into a blank page and runs ORR_REBUILD's parsers.
//   node offline.mjs <repo-dir> <saved.html>...
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [repo, ...files] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();
await page.route("https://www.reddit.com/orr-offline", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><head></head><body></body></html>" }));
await page.goto("https://www.reddit.com/orr-offline");
await page.addScriptTag({ content: "globalThis.chrome = { runtime: { getURL: (p) => p, sendMessage: () => Promise.resolve() }, storage: { local: { get: (k, cb) => cb && cb({}), set: () => {} }, sync: { get: (k, cb) => cb && cb({}), set: () => {} }, onChanged: { addListener: () => {} } } };" });
for (const f of ["common.js", "rebuild.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(repo, f), "utf8") });
let fail = 0;
const check = (name, ok, info) => { console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  " + info : "")); if (!ok) fail++; };
for (const f of files) {
  const html = fs.readFileSync(f, "utf8");
  const r = await page.evaluate((html) => {
    const R = globalThis.ORR_REBUILD;
    const doc = R.parseHtmlDoc(html);
    const posts = Array.from(doc.querySelectorAll("shreddit-post")).map(R.postFromShreddit).filter(Boolean);
    const linkId = posts[0] ? posts[0].name : "";
    const tree = R.commentsFromHtml(doc, linkId);
    let t1 = 0, more = 0, orphans = 0, maxDepth = 0;
    const walk = (kids, depth) => kids.forEach((c) => {
      if (c.kind === "more") { more++; return; }
      t1++; maxDepth = Math.max(maxDepth, depth);
      if (depth === 0 && c.data.parent_id !== linkId) orphans++;
      walk(c.data.replies.data.children, depth + 1);
    });
    walk(tree, 0);
    const html0 = tree[0] && tree[0].data ? tree[0].data.body_html || "" : "";
    return {
      posts: posts.length,
      first: posts[0] && { title: posts[0].title.slice(0, 50), score: posts[0].score, n: posts[0].num_comments, created: posts[0].created_utc, self: posts[0].is_self, hint: posts[0].post_hint || "", gallery: !!posts[0].is_gallery, video: !!posts[0].is_video, flair: posts[0].link_flair_text || "", thumb: (posts[0].thumbnail || "").slice(0, 60), selftext: (posts[0].selftext_html || "").slice(0, 80) },
      types: posts.reduce((a, p) => { const k = p.is_gallery ? "gallery" : p.is_video ? "video" : p.post_hint === "image" ? "image" : p.is_self ? "text" : "link"; a[k] = (a[k] || 0) + 1; return a; }, {}),
      badDates: posts.filter((p) => !(p.created_utc > 1.6e9)).length,
      awardImages: posts.filter((p) => p.preview && /snoovatar|snoo_assets/.test(JSON.stringify(p.preview))).length,
      t1, more, orphans, maxDepth,
      bodySample: html0.slice(0, 120),
      bodyUnsafe: /<script|on\w+=|javascript:/i.test(tree.map((c) => (c.data && c.data.body_html) || "").join("")),
      builtOk: (() => { try { return R.buildCommentTree(tree, linkId, Date.now()).length > 0 || !tree.length; } catch (e) { return String(e); } })(),
      itemOk: (() => { try { return posts.every((p) => R.buildItem(p, { expandoButton: true }).length > 0); } catch (e) { return String(e); } })(),
    };
  }, html);
  console.log("\n== " + path.basename(f));
  console.log(JSON.stringify(r));
  check("parses posts", r.posts > 0);
  check("dates parse", r.badDates === 0, "bad=" + r.badDates);
  check("no award icon as post image", r.awardImages === 0);
  check("builders accept parsed data", r.itemOk === true && r.builtOk === true, r.itemOk + "/" + r.builtOk);
  check("comment bodies sanitized", !r.bodyUnsafe);
}
const sanit = await page.evaluate(() => {
  const R = globalThis.ORR_REBUILD;
  const d = new DOMParser().parseFromString('<div id=x><p onclick="alert(1)">hi <a href="javascript:alert(1)">j</a> <a href="https://e.com/" style="x">ok</a><img src="http://x/a.png" onerror="alert(1)"><img src="https://i.redd.it/a.png" onerror="z"><script>alert(1)</script><span class="md-spoiler-text evil">s</span><faceplate-x><b>kept</b></faceplate-x></p></div>', "text/html");
  return R.cleanMd(d.getElementById("x"));
});
console.log("\ncleanMd:", sanit);
check("cleanMd strips handlers/js/script/http img", !/onclick|onerror|javascript:|<script|http:\/\/x|style=|evil/.test(sanit) && /<b>kept<\/b>/.test(sanit) && /https:\/\/i\.redd\.it\/a\.png/.test(sanit));
const dates = await page.evaluate(() => [globalThis.ORR_REBUILD.isoToUtc("2026-10-14T19:20:16.991000+0000"), globalThis.ORR_REBUILD.isoToUtc("2026-10-14T10:28:29.199Z")]);
check("isoToUtc", dates[0] === Date.UTC(2026, 9, 14, 19, 20, 16, 991) / 1000 && dates[1] === Date.UTC(2026, 9, 14, 10, 28, 29, 199) / 1000, JSON.stringify(dates));
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
await browser.close();
process.exit(fail ? 1 : 0);
