# Playwright checks & Reddit probes

Tools used to diagnose and verify the **logged-out** rebuild (v3.16): Reddit
answers every logged-out `.json` request with a `403` "blocked by network security"
page, so `rebuild.js` falls back to parsing the HTML Reddit still serves. Every
script runs a **fresh, logged-out profile**. Nothing here is packaged into the
extension (`web-ext-config.cjs` ignores `scripts/`).

## Setup

```bash
cd scripts/playwright
npm install
npx playwright install chromium firefox
node stage-ext.mjs            # copies the extension's runtime files into ./ext
```

Re-run `stage-ext.mjs` after every source change. Reddit bot-challenges headless
browsers, so run headed under a virtual display. Also, IPv6 to reddit timed out on
the dev machine; Chromium falls back to IPv4 on its own.

```bash
xvfb-run -a -s "-screen 0 1600x1000x24" node <script> …
```

## Verification scripts (load the extension)

| Script | What it checks |
|---|---|
| `run.mjs <ext> <out> <url>…` | Per URL, whether it was rebuilt or left native, plus post/comment/stub counts, the `.json`/partial responses, console errors and a screenshot. Writes `<out>/results.json`. `HEADED=1` runs it headed. |
| `interact.mjs <ext> <out> [sub]` | Infinite scroll; in-page navigation from a listing to a thread; a nested "load more comments" stub; auto-loading top-level comments at the bottom; no duplicate IDs; no new-Reddit CSS left on the page. |
| `live-extras.mjs <ext> <out> <sub> <videoSub>` | Stickies listed first in old-reddit green, the right-rail sidebar, and a video playing inline with audio from Reddit's packaged MP4 (checks `currentTime` and decoded audio bytes). |
| `expand.mjs <ext> <out> <url> [n]` | Clicks the first *n* expandos (image, gallery, video) and screenshots them. |
| `firefox.mjs <ext> <out> <listing> <thread>` | Installs the extension as a temporary add-on in Playwright's Firefox (over the Remote Debugging Protocol) and runs the listing, thread and load-more checks. |
| `inspect-css.mjs <ext> <url> <selector>` | Lists every stylesheet in the rebuilt page and the rules that style one element. |
| `css-timeline.mjs <ext> <out> <url>…` | Samples the page's `<style>`/`<link>` elements over time. This found new Reddit's CSS leaking in after the body swap. |
| `offline.mjs <repo> <saved.html>…` | Runs the parsers exposed on `ORR_REBUILD` against saved HTML with no network: post types, dates, comment-tree integrity, sanitiser (spoilers, screen-reader text), packaged-MP4 video, and, by fixture file name, right-rail sidebars (`*right_rail*`) and stickies (`_r_<sub>_.html`). Exits non-zero on failure. |

## Probes (no extension, raw Reddit behaviour)

| Script | Finding |
|---|---|
| `probe.mjs [sub]` | `.json` → 403 HTML; `.rss` → 200; the HTML page and `/svc/shreddit/community-more-posts/…` → 200. |
| `probe2.mjs`, `probe3.mjs` | `shreddit-post` attributes; the 403 body text; old.reddit redirects logged-out visitors to `/login`. |
| `probe4.mjs <out.json>`, `probe5.mjs <out.json>` | Thread pages hold their comments inside `<template>`s; more-comments partials are POST requests. |
| `probe6.mjs <outdir>` | Feed endpoints per route (front page → `home-feed`, r/popular → `popular-feed`; r/all and `a+b` have none) and markup samples for each post type. |
| `probe7.mjs <out.json>` | Logged-out POST to more-comments works with just the `cursor` field (no CSRF token). |
| `probe8.mjs` | Paging: `after=base64(fullname)`, 25 per page; the feeds return 3 posts on their first call. |
| `probe9.mjs` | `Accept: text/vnd.reddit.partial+html` shrinks responses by 40–60%. |
| `probe10.mjs [sub]` | The right-rail sidebar partial (`/svc/shreddit/feeds/subreddit-right-rail?name=`); stickies exist only as `community-highlight-card`s on the sub page; `shreddit-player`'s `packaged-media-json` lists signed progressive MP4s (H.264 + AAC). |
| `save.mjs <outdir> <path>…` | Saves raw HTML of Reddit paths (input for `offline.mjs`). |

Saved HTML and screenshots are Reddit content and test output, so they're gitignored.
Capture fresh samples with `save.mjs` when needed.
