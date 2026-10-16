// Broad logged-out sweep: fetch many live listings + threads, run them through the
// extension's parsers (ORR_REBUILD, loaded into an offline page) and flag places
// where the parsed data misses something the raw HTML has.
//   node sweep.mjs <repo> <out-dir> [maxThreads]
// Writes <out-dir>/sweep.json (all findings) and saves flagged raw HTML for repro.
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, outDir, maxThreadsArg] = process.argv.slice(2);
const MAX_THREADS = parseInt(maxThreadsArg || "60", 10);
fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });
const SUBS = ["AskReddit", "pics", "funny", "worldnews", "news", "todayilearned", "gaming", "movies", "science", "videos",
  "aww", "mildlyinteresting", "interestingasfuck", "nextfuckinglevel", "Damnthatsinteresting", "explainlikeimfive",
  "NoStupidQuestions", "AmItheAsshole", "relationship_advice", "personalfinance", "programming", "webdev", "javascript",
  "linux", "technology", "books", "Music", "television", "sports", "nba", "soccer", "formula1", "gifs", "memes",
  "dataisbeautiful", "EarthPorn", "food", "Cooking", "DIY", "lowereastside", "nyc", "LifeProTips", "Showerthoughts",
  "OutOfTheLoop", "changemyview", "AskHistorians", "askscience", "Fitness", "buildapc", "pcmasterrace", "apple",
  "Android", "cats", "MadeMeSmile", "BeAmazed", "tifu", "UpliftingNews", "europe", "wallstreetbets", "anime",
  "Minecraft", "leagueoflegends", "AskNYC", "sanfrancisco", "IAmA"];
const FEEDS = ["/svc/shreddit/feeds/home-feed?sort=HOT", "/svc/shreddit/feeds/popular-feed?sort=HOT"];
const ACCEPT = "text/vnd.reddit.partial+html, text/html;q=0.9";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-sweep-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled", "--window-position=-3000,0"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });

// "live" page: fetches from reddit.com as a logged-out browser
const live = await ctx.newPage();
await live.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded", timeout: 45000 });
await sleep(2000);
const get = (u) => live.evaluate(async ([u, a]) => {
  const r = await fetch(u, { credentials: "include", headers: { Accept: a } });
  return { status: r.status, text: await r.text() };
}, [u, ACCEPT]);

// "lab" page: a fake same-origin page with the extension's parsers loaded (no network)
const lab = await ctx.newPage();
await lab.route("https://www.reddit.com/orr-lab", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><head></head><body></body></html>" }));
await lab.goto("https://www.reddit.com/orr-lab");
await lab.addScriptTag({ content: "globalThis.chrome={runtime:{getURL:(p)=>p,sendMessage:()=>Promise.resolve()},storage:{local:{get:(k,c)=>c&&c({}),set:()=>{}},sync:{get:(k,c)=>c&&c({}),set:()=>{}},onChanged:{addListener:()=>{}}}};" });
for (const f of ["common.js", "rebuild.js"]) await lab.addScriptTag({ content: fs.readFileSync(path.join(repo, f), "utf8") });

const analyzeListing = (html) => lab.evaluate((html) => {
  const R = globalThis.ORR_REBUILD;
  const doc = R.parseHtmlDoc(html);
  const out = [];
  doc.querySelectorAll("shreddit-post").forEach((el) => {
    if (el.parentElement && el.parentElement.closest("shreddit-post")) return;
    const type = el.getAttribute("post-type") || "";
    let d = null, err = null, item = "";
    try { d = R.postFromShreddit(el); item = R.buildItem(d, { expandoButton: true }); } catch (e) { err = String(e); }
    const media = el.querySelector("[slot='post-media-container']") || el;
    const raw = {
      textBody: !!(el.querySelector(`[id="${el.id}-post-rtjson-content"]`) || el.querySelector("shreddit-post-text-body [property='schema:articleBody']")),
      player: !!media.querySelector("shreddit-player, shreddit-player-2"),
      gallery: !!media.querySelector("gallery-carousel"),
      image: !!media.querySelector("img[data-post-media-primary]"),
      embed: !!media.querySelector("shreddit-embed"),
      nsfwAttr: Array.from(el.attributes).map((a) => a.name).filter((n) => /nsfw|spoiler|sticky|stickied|pinned|locked|archived|quarantin|deleted|removed|poll/i.test(n)),
      tags: Array.from(new Set(Array.from(media.querySelectorAll("*")).map((x) => x.tagName.toLowerCase()).filter((t) => t.includes("-")))).slice(0, 12),
    };
    const exp = d ? R.postExpando(d) : null;
    out.push({ id: el.id, type, permalink: el.getAttribute("permalink"), title: (el.getAttribute("post-title") || "").slice(0, 60), comments: parseInt(el.getAttribute("comment-count"), 10) || 0,
      err, raw, parsed: d && { is_self: d.is_self, hasSelftext: !!d.selftext_html, xpText: !!(d.crosspost_parent_list && d.crosspost_parent_list[0] && d.crosspost_parent_list[0].selftext_html), app: !!d.orr_app, hint: d.post_hint || "", gallery: !!d.is_gallery, video: !!d.is_video, thumb: !!d.thumbnail, url: (d.url || "").slice(0, 80), created: d.created_utc > 0, author: !!d.author, expando: exp ? exp.type : null } });
  });
  return out;
}, html);

const analyzeThread = (html) => lab.evaluate((html) => {
  const R = globalThis.ORR_REBUILD;
  const doc = R.parseHtmlDoc(html);
  const postEl = doc.querySelector("shreddit-post");
  let post = null, err = null, tree = [], bodyHtml = "";
  try {
    post = postEl && R.postFromShreddit(postEl);
    tree = R.commentsFromHtml(doc, post ? post.name : "");
    bodyHtml = R.buildCommentsBody([{ data: { children: post ? [{ kind: "t3", data: post }] : [] } }, { data: { children: tree } }], { permalink: "/x" }).inner;
  } catch (e) { err = String(e); }
  const rawComments = Array.from(doc.querySelectorAll("shreddit-comment"));
  const parsed = []; const walk = (k) => k.forEach((c) => { if (c.kind === "t1") { parsed.push(c.data); walk(c.data.replies.data.children); } }); walk(tree);
  const byId = new Map(parsed.map((c) => [c.name, c]));
  const emptyBodies = [], contentTypes = {}, mediaInComments = [];
  rawComments.forEach((el) => {
    const ct = el.getAttribute("content-type") || "?"; contentTypes[ct] = (contentTypes[ct] || 0) + 1;
    const c = byId.get(el.getAttribute("thingid"));
    const rawBody = Array.from(el.querySelectorAll("[slot='comment']")).find((b) => b.closest("shreddit-comment") === el);
    const rawText = rawBody ? rawBody.textContent.replace(/\s+/g, " ").trim() : "";
    const rawImgs = rawBody ? rawBody.querySelectorAll("img").length : 0;
    const rawCustom = rawBody ? Array.from(new Set(Array.from(rawBody.querySelectorAll("*")).map((x) => x.tagName.toLowerCase()).filter((t) => t.includes("-")))) : [];
    if (c && (rawText || rawImgs) && !c.body_html) emptyBodies.push({ id: c.name, ct, rawText: rawText.slice(0, 60) });
    const players = rawBody ? rawBody.querySelectorAll("shreddit-player, shreddit-player-2").length : 0;
    if (c && rawImgs - (rawBody ? rawBody.querySelectorAll("shreddit-player img, shreddit-player-2 img").length : 0) > 0 && !/<img/.test(c.body_html)) mediaInComments.push({ id: c.name, ct, rawImgs, custom: rawCustom });
    if (c && players && !/orr-inline-gif|v\.redd\.it/.test(c.body_html)) mediaInComments.push({ id: c.name, ct, players, custom: rawCustom });
  });
  const missing = rawComments.map((el) => el.getAttribute("thingid")).filter((id) => id && !byId.has(id));
  const rawBody = postEl && (postEl.querySelector(`[id="${postEl.id}-post-rtjson-content"]`) || postEl.querySelector("shreddit-post-text-body"));
  return {
    type: postEl ? postEl.getAttribute("post-type") : null, err,
    post: post && { is_self: post.is_self, selftextLen: (post.selftext_html || "").length, rawBodyText: rawBody ? rawBody.textContent.replace(/\s+/g, " ").trim().length : 0, hint: post.post_hint || "", gallery: !!post.is_gallery, video: !!post.is_video },
    rawComments: rawComments.length, parsedComments: parsed.length, missing: missing.slice(0, 5), moreStubs: (bodyHtml.match(/data-partial=/g) || []).length,
    rawMoreStubs: doc.querySelectorAll("faceplate-partial[src*='/more-comments/']").length,
    contentTypes, emptyBodies: emptyBodies.slice(0, 5), mediaInComments: mediaInComments.slice(0, 6), builtLen: bodyHtml.length,
  };
}, html);

const findings = { listings: {}, threads: {}, types: {}, issues: [] };
const flag = (kind, where, info, rawText) => {
  findings.issues.push({ kind, where, info });
  if (rawText) fs.writeFileSync(path.join(outDir, "raw", kind.replace(/\W+/g, "_") + "-" + String(where).replace(/[^a-z0-9]+/gi, "_").slice(-60) + ".html"), rawText);
};
const threadPicks = [];
for (const src of SUBS.map((s) => "/svc/shreddit/community-more-posts/hot/?name=" + s).concat(FEEDS)) {
  const r = await get(src).catch((e) => ({ status: 0, text: String(e) }));
  await sleep(700);
  if (r.status !== 200) { flag("listing-http", src, r.status); continue; }
  const posts = await analyzeListing(r.text);
  findings.listings[src] = posts.length;
  if (!posts.length) flag("listing-empty", src, "0 posts", r.text);
  for (const p of posts) {
    findings.types[p.type] = (findings.types[p.type] || 0) + 1;
    const P = p.parsed || {};
    if (p.err) flag("parse-error", p.permalink, p.err, r.text);
    if (!["text", "image", "gallery", "video", "link", "crosspost", "multi_media", "gif", "customPost"].includes(p.type)) flag("unknown-post-type:" + p.type, p.permalink, p.raw, r.text);
    if (p.raw.textBody && P.is_self && !P.hasSelftext) flag("self-body-missing", p.permalink, p.type);
    if (p.raw.textBody && !P.hasSelftext && !P.xpText) flag("body-not-shown", p.permalink, p.type + " " + P.url);
    if (p.raw.player && !P.video) flag("video-not-parsed", p.permalink, p.type, r.text);
    if (p.raw.gallery && !P.gallery) flag("gallery-not-parsed", p.permalink, p.type, r.text);
    if (p.type === "image" && P.hint !== "image") flag("image-not-parsed", p.permalink, p.raw, r.text);
    if (p.raw.embed && !P.expando) flag("embed-no-expando", p.permalink, P.url);
    if (!P.created) flag("no-date", p.permalink, p.type);
    if (!P.author) flag("no-author", p.permalink, p.type);
    const unhandled = p.raw.nsfwAttr.filter((a) => !["locked", "spoiler", "stickied", "is-author-deleted", "nsfw"].includes(a));
    if (unhandled.length) flag("unhandled-attrs", p.permalink, unhandled);
    if (p.comments > 0) threadPicks.push(p);
  }
}
// threads: prefer one per post type first, then one per subreddit
const chosen = [], seenTypes = new Set(), seenSubs = new Set();
for (const p of threadPicks) if (!seenTypes.has(p.type)) { seenTypes.add(p.type); chosen.push(p); }
for (const p of threadPicks) { const s = p.permalink.split("/")[2]; if (chosen.length >= MAX_THREADS) break; if (!seenSubs.has(s) && !chosen.includes(p)) { seenSubs.add(s); chosen.push(p); } }
for (const p of chosen) {
  const r = await get(p.permalink).catch((e) => ({ status: 0, text: String(e) }));
  await sleep(900);
  if (r.status !== 200) { flag("thread-http", p.permalink, r.status); continue; }
  const t = await analyzeThread(r.text);
  findings.threads[p.permalink] = t;
  if (t.err) flag("thread-error", p.permalink, t.err, r.text);
  if (t.missing.length) flag("comments-missing", p.permalink, t.missing, r.text);
  if (t.emptyBodies.length) flag("comment-body-empty", p.permalink, t.emptyBodies, r.text);
  if (t.mediaInComments.length) flag("comment-media", p.permalink, t.mediaInComments, r.text);
  if (t.post && t.post.rawBodyText > 0 && !t.post.selftextLen) flag("thread-body-missing", p.permalink, t.type + " rawText=" + t.post.rawBodyText, r.text);
  if (t.rawMoreStubs !== t.moreStubs) flag("more-stub-mismatch", p.permalink, t.rawMoreStubs + " raw vs " + t.moreStubs + " built");
  if (t.rawComments === 0 && p.comments > 0) flag("thread-no-comments", p.permalink, "comment-count=" + p.comments, r.text);
}
fs.writeFileSync(path.join(outDir, "sweep.json"), JSON.stringify(findings, null, 2));
const byKind = {};
findings.issues.forEach((i) => { (byKind[i.kind] = byKind[i.kind] || []).push(i.where); });
console.log("listings:", Object.keys(findings.listings).length, "threads:", Object.keys(findings.threads).length, "types:", JSON.stringify(findings.types));
for (const k of Object.keys(byKind).sort()) console.log(k.padEnd(34), byKind[k].length, "e.g.", byKind[k].slice(0, 2).join("  "));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
