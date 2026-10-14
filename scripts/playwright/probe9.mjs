// more-comments partial: does render-mode=partial / the partial Accept type shrink the response?
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const perma = process.argv[2] || "/r/AskReddit/comments/1x5nhcy/what_death_had_the_biggest_impact_on_world_history/";
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
const res = await page.evaluate(async (perma) => {
  const deepAll = (root, sel, acc = []) => { root.querySelectorAll(sel).forEach((e) => acc.push(e)); root.querySelectorAll("template").forEach((t) => deepAll(t.content, sel, acc)); return acc; };
  const out = {};
  const page = async (u, accept) => { const r = await fetch(u, { credentials: "include", headers: accept ? { Accept: accept } : {} }); const t = await r.text(); return { status: r.status, ct: (r.headers.get("content-type") || "").split(";")[0], len: t.length, rx: (t.match(/<shreddit-comment[\s>]/g) || []).length, t }; };
  const p0 = await page(perma);
  out.page = { len: p0.len, rx: p0.rx };
  const p1 = await page(perma + (perma.includes("?") ? "&" : "?") + "render-mode=partial");
  out.pagePartial = { status: p1.status, ct: p1.ct, len: p1.len, rx: p1.rx };
  const d = new DOMParser().parseFromString(p0.t, "text/html");
  const parts = deepAll(d, "faceplate-partial[src*='more-comments']");
  const top = parts.find((p) => p.id === "top-level-more-comments-partial");
  const post = async (src, cursor, extra, accept) => {
    const body = new URLSearchParams(); if (cursor) body.set("cursor", cursor);
    const u = src + (extra ? (src.includes("?") ? "&" : "?") + extra : "");
    const h = { "Content-Type": "application/x-www-form-urlencoded" }; if (accept) h.Accept = accept;
    const r = await fetch(u, { method: "POST", credentials: "include", headers: h, body: body.toString() });
    const t = await r.text();
    return { status: r.status, ct: (r.headers.get("content-type") || "").split(";")[0], len: t.length, rx: (t.match(/<shreddit-comment[\s>]/g) || []).length, ids: (t.match(/thingid="(t1_[a-z0-9]+)"/gi) || []).length };
  };
  if (top) {
    const c = (top.querySelector("input[name=cursor]") || {}).value;
    out.topPlain = await post(top.getAttribute("src"), c);
    out.topRenderPartial = await post(top.getAttribute("src"), c, "render-mode=partial");
    out.topAcceptPartial = await post(top.getAttribute("src"), c, "", "text/vnd.reddit.partial+html, text/html;q=0.9");
  }
  return out;
}, perma);
console.log(JSON.stringify(res, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
