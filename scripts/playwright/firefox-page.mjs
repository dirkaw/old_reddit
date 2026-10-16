// Firefox: install the extension as a temporary add-on (Remote Debugging Protocol)
// and report what a page's post media actually rendered — images/videos/iframes in
// the post (incl. its expando), and whether each loaded.
//   node firefox-page.mjs <ext-dir> <out-dir> <url>
import "./hidden-display.mjs"; // keep browser windows off the desktop (Wayland)
import { firefox } from "playwright";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [extDir, outDir, url] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PORT = 6000 + Math.floor(Math.random() * 1000);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orr-ff-"));
const ctx = await firefox.launchPersistentContext(profile, {
  headless: false, viewport: { width: 1400, height: 900 },
  args: ["-start-debugger-server", String(PORT)],
  firefoxUserPrefs: { "devtools.debugger.remote-enabled": true, "devtools.debugger.prompt-connection": false, "devtools.chrome.enabled": true, "xpinstall.signatures.required": false },
});
function rdpInstall(dir) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, "127.0.0.1");
    let buf = "", step = 0;
    const send = (o) => { const s = JSON.stringify(o); sock.write(Buffer.byteLength(s) + ":" + s); };
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      for (;;) {
        const c = buf.indexOf(":"); if (c < 0) return;
        const len = parseInt(buf.slice(0, c), 10); if (buf.length < c + 1 + len) return;
        const msg = JSON.parse(buf.slice(c + 1, c + 1 + len)); buf = buf.slice(c + 1 + len);
        if (step === 0) { step = 1; send({ to: "root", type: "getRoot" }); }
        else if (step === 1 && msg.addonsActor) { step = 2; send({ to: msg.addonsActor, type: "installTemporaryAddon", addonPath: dir }); }
        else if (step === 2 && (msg.addon || msg.error)) { sock.end(); msg.error ? reject(new Error(msg.error + ": " + msg.message)) : resolve(msg.addon); }
      }
    });
    sock.on("error", reject);
  });
}
for (let i = 0; i < 20; i++) { try { await rdpInstall(path.resolve(extDir)); break; } catch (e) { if (i === 19) throw e; await new Promise((r) => setTimeout(r, 500)); } }
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (!/\.announce is not a function/.test(e.message)) errors.push(String(e.message).slice(0, 160)); });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector("#siteTable .thing.link", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(6000);
const r = await page.evaluate(() => {
  const post = document.querySelector("#siteTable .thing.link");
  const media = post ? Array.from(post.querySelectorAll("img, video, iframe")).filter((m) => !m.closest(".thumbnail")) : [];
  return {
    rebuilt: !!document.getElementById("siteTable"), ptype: post && post.dataset.ptype, hasExpando: !!(post && post.querySelector(".expando")),
    expandoOpen: !!(post && post.querySelector(".expando") && post.querySelector(".expando").style.display !== "none"),
    media: media.map((m) => ({ tag: m.tagName.toLowerCase(), src: (m.currentSrc || m.src || "").slice(0, 100), loaded: m.tagName === "IMG" ? m.complete && m.naturalWidth > 0 : m.tagName === "VIDEO" ? m.readyState > 0 || !!m.poster : true, w: m.naturalWidth || m.videoWidth || m.clientWidth, visible: m.offsetParent !== null })),
    comments: document.querySelectorAll(".commentarea .thing.comment").length,
  };
});
console.log(JSON.stringify(r, null, 1));
console.log("errors", JSON.stringify(errors));
await page.screenshot({ path: path.join(outDir, "firefox.png") });
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
