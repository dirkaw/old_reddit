// Firefox logged-out check: install the unpacked extension as a temporary add-on
// (via the Remote Debugging Protocol) into Playwright's Firefox, then load a
// listing + a thread and click a "load more comments" stub.
//   node firefox.mjs <ext-dir> <out-dir> <listing-url> <thread-url>
import { firefox } from "playwright";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, outDir, listingUrl, threadUrl] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PORT = 6000 + Math.floor(Math.random() * 1000);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-ff-"));
const ctx = await firefox.launchPersistentContext(profile, {
  headless: false, viewport: { width: 1400, height: 900 },
  args: ["-start-debugger-server", String(PORT)],
  firefoxUserPrefs: {
    "devtools.debugger.remote-enabled": true, "devtools.debugger.prompt-connection": false,
    "devtools.chrome.enabled": true, "xpinstall.signatures.required": false,
  },
});

// Minimal RDP client: messages are "<length>:<json>".
function rdpInstall(dir) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, "127.0.0.1");
    let buf = "", step = 0;
    const send = (o) => { const s = JSON.stringify(o); sock.write(Buffer.byteLength(s) + ":" + s); };
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      for (;;) {
        const c = buf.indexOf(":");
        if (c < 0) return;
        const len = parseInt(buf.slice(0, c), 10);
        if (buf.length < c + 1 + len) return;
        const msg = JSON.parse(buf.slice(c + 1, c + 1 + len));
        buf = buf.slice(c + 1 + len);
        if (step === 0) { step = 1; send({ to: "root", type: "getRoot" }); }
        else if (step === 1 && msg.addonsActor) { step = 2; send({ to: msg.addonsActor, type: "installTemporaryAddon", addonPath: dir }); }
        else if (step === 2 && (msg.addon || msg.error)) { sock.end(); msg.error ? reject(new Error(msg.error + ": " + msg.message)) : resolve(msg.addon); }
      }
    });
    sock.on("error", reject);
  });
}
let addon = null;
for (let i = 0; i < 20 && !addon; i++) {
  try { addon = await rdpInstall(path.resolve(extDir)); } catch (e) { if (i === 19) throw e; await new Promise((r) => setTimeout(r, 500)); }
}
console.log("installed", addon && addon.id);

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
const state = () => page.evaluate(() => ({
  rebuilt: !!document.getElementById("siteTable"), things: document.querySelectorAll("#siteTable .thing.link").length,
  comments: document.querySelectorAll(".commentarea .thing.comment").length, more: document.querySelectorAll("a.orr-more").length,
  nativeCss: Array.from(document.querySelectorAll("style, link[rel~=stylesheet]")).filter((n) => !/^orr-/.test(n.id || "") && !n.hasAttribute("class")).map((n) => n.parentNode.nodeName + ">" + n.nodeName + "#" + (n.id || "") + " " + (n.href || n.textContent || "").slice(0, 70).replace(/\s+/g, " ")),
  body: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 100),
}));
await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(9000);
console.log("listing", JSON.stringify(await state()));
await page.screenshot({ path: path.join(outDir, "ff-listing.png") });
await page.goto(threadUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(9000);
console.log("thread ", JSON.stringify(await state()));
const stub = page.locator(".child a.orr-more[data-partial]").first();
if (await stub.count()) {
  await stub.scrollIntoViewIfNeeded();
  await stub.click();
  await page.waitForTimeout(6000);
  console.log("after more-click", JSON.stringify(await state()), "stubText:", await page.locator("a.orr-more").first().textContent().catch(() => ""));
}
await page.screenshot({ path: path.join(outDir, "ff-thread.png") });
console.log("errors", JSON.stringify(errors));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
