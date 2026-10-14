// Can a logged-out page POST Reddit's more-comments partials (replies + next top-level page)?
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2];
const perma = process.argv[3] || "/r/AskReddit/comments/1x5nhcy/what_death_had_the_biggest_impact_on_world_history/";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto("https://www.reddit.com/r/pics/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
const res = await page.evaluate(async (perma) => {
  const out = { cookieNames: document.cookie.split(";").map((c) => c.split("=")[0].trim()) };
  const deepAll = (root, sel, acc = []) => {
    root.querySelectorAll(sel).forEach((e) => acc.push(e));
    root.querySelectorAll("template").forEach((t) => deepAll(t.content, sel, acc));
    return acc;
  };
  const t = await (await fetch(perma, { credentials: "include" })).text();
  const d = new DOMParser().parseFromString(t, "text/html");
  const parts = deepAll(d, "faceplate-partial[src*='more-comments']");
  out.partialCount = parts.length;
  const csrf = (document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/) || [])[1] || "";
  out.hasCsrf = !!csrf;
  const tryPost = async (p, label, withCsrf) => {
    const body = new URLSearchParams();
    p.querySelectorAll("input[type=hidden]").forEach((i) => body.set(i.name, i.value));
    if (withCsrf && csrf) body.set("csrf_token", csrf);
    const r = await fetch(p.getAttribute("src"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const txt = await r.text();
    const dd = new DOMParser().parseFromString(txt, "text/html");
    const cs = deepAll(dd, "shreddit-comment");
    out[label] = { status: r.status, ct: (r.headers.get("content-type") || "").split(";")[0], len: txt.length, inputs: Array.from(p.querySelectorAll("input")).map((i) => i.name), comments: cs.length,
      depths: cs.slice(0, 12).map((c) => c.getAttribute("depth") + ":" + (c.getAttribute("parentid") || "")),
      attrsSample: cs[0] ? Array.from(cs[0].attributes).map((a) => a.name) : null,
      nextParts: deepAll(dd, "faceplate-partial[src*='more-comments']").map((x) => x.getAttribute("src").slice(0, 160)).slice(0, 3),
      start: txt.slice(0, 120).replace(/\s+/g, " ") };
  };
  const child = parts.find((p) => p.getAttribute("slot") === "children");
  const top = parts.find((p) => p.id === "top-level-more-comments-partial");
  if (child) { await tryPost(child, "childNoCsrf", false); await tryPost(child, "childCsrf", true); out.childSrc = child.getAttribute("src"); }
  if (top) { await tryPost(top, "topCsrf", true); out.topSrc = top.getAttribute("src"); }
  return out;
}, perma);
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2).slice(0, 4000));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
