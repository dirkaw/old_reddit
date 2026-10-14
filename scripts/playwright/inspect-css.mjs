// Which stylesheets survive into the rebuilt page, and which rules style a given element?
//   node inspect-css.mjs <ext-dir> <url> <css-selector>
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, url, sel] = process.argv.slice(2);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-pw-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: { width: 1400, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ignoreDefaultArgs: ["--enable-automation"],
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled", "--window-position=-3000,0"],
});
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(9000);
const out = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const sheets = Array.from(document.styleSheets).map((s) => ({ href: s.href, owner: s.ownerNode ? s.ownerNode.tagName + "#" + (s.ownerNode.id || "") : null, rules: (() => { try { return s.cssRules.length; } catch (e) { return "x"; } })() }));
  const adopted = (document.adoptedStyleSheets || []).length;
  if (!el) return { sheets, adopted, el: null };
  const cs = getComputedStyle(el);
  const hits = [];
  for (const s of document.styleSheets) {
    let rules; try { rules = s.cssRules; } catch (e) { continue; }
    const walk = (rs) => { for (const r of rs) { if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; } if (!r.selectorText) continue; try { if (el.matches(r.selectorText) && /text-transform|font-size|font-family/.test(r.style.cssText)) hits.push((s.href || s.ownerNode.id || s.ownerNode.tagName) + " :: " + r.selectorText.slice(0, 80) + " { " + r.style.cssText.slice(0, 120) + " }"); } catch (e) {} } };
    walk(rules);
  }
  return { sheets, adopted, computed: { tt: cs.textTransform, fs: cs.fontSize, ff: cs.fontFamily.slice(0, 60) }, hits: hits.slice(0, 30), htmlClass: document.documentElement.className.slice(0, 200) };
}, sel);
console.log(JSON.stringify(out, null, 2));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
