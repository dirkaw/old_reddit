// Playwright harness: load the unpacked extension into a fresh, LOGGED-OUT
// Chromium profile and report how each Reddit URL renders.
//   [HEADED=1] node run.mjs <ext-dir> <out-dir> <url> [<url> ...]
// Results: <out-dir>/results.json (+ one screenshot per URL).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [extDir, outDir, ...urls] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const headed = process.env.HEADED === "1";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: !headed,
  viewport: { width: 1400, height: 900 },
  userAgent: UA,
  ignoreDefaultArgs: ["--enable-automation"],
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--disable-blink-features=AutomationControlled",
    ...(headed ? ["--window-position=-3000,0"] : []),
  ],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null);

const results = [];
for (const url of urls) {
  const page = await ctx.newPage();
  const json = [];
  const errors = [];
  page.on("response", (r) => {
    const u = r.url();
    if (/reddit\.com\/.*\.json/.test(u) || /\/svc\/shreddit\/(community-more-posts|feeds\/(home|popular)-feed|more-comments)/.test(u) || (r.request().resourceType() === "fetch" && /\/comments\//.test(u))) {
      json.push({ status: r.status(), ct: (r.headers()["content-type"] || "").split(";")[0], url: u.replace(/^https:\/\/www\.reddit\.com/, "").split("?")[0] });
    }
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

  let navErr = null;
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) { navErr = String(e.message).slice(0, 160); }
  await page.waitForTimeout(9000);

  const state = await page.evaluate(() => {
    const st = document.getElementById("siteTable");
    return {
      title: document.title,
      href: location.href,
      rebuilt: !!st,
      things: document.querySelectorAll("#siteTable .thing.link").length,
      comments: document.querySelectorAll(".commentarea .thing.comment").length,
      moreStubs: document.querySelectorAll("a.orr-more").length,
      titles: Array.from(document.querySelectorAll("#siteTable .thing.link a.title")).slice(0, 3).map((a) => a.textContent.slice(0, 50)),
      firstComment: (document.querySelector(".commentarea .thing.comment .usertext-body") || {}).textContent ? document.querySelector(".commentarea .thing.comment .usertext-body").textContent.trim().slice(0, 80) : null,
      htmlHidden: getComputedStyle(document.documentElement).display === "none",
      bodyStart: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim().slice(0, 220),
    };
  }).catch((e) => ({ evalError: String(e.message).slice(0, 160) }));

  const name = url.replace(/^https?:\/\/(www\.)?reddit\.com\/?/, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "front";
  const shot = path.join(outDir, name + ".png");
  await page.screenshot({ path: shot }).catch(() => {});
  results.push({ url, navErr, ...state, json, errors: errors.slice(0, 6), shot });
  await page.close();
  await new Promise((r) => setTimeout(r, 2500));
}

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ headed, swLoaded: !!sw, results }, null, 2));
for (const r of results) {
  console.log(`${r.rebuilt ? "REBUILT" : "native "} things=${String(r.things).padStart(2)} comments=${r.comments} more=${r.moreStubs} errs=${(r.errors || []).length} json=${(r.json || []).map((j) => j.status + "/" + (j.ct || "?").replace("application/", "")).join(",") || "-"}  ${r.url}  ::  ${(r.bodyStart || r.navErr || r.evalError || "").slice(0, 70)}`);
}
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
