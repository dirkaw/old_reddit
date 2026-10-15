// The extension's runtime files — what ships in a package / gets loaded unpacked.
// Shared by build-chromium-zip.mjs and playwright/stage-ext.mjs.
export const EXT_FILES = [
  "manifest.json", "common.js", "rebuild.js", "redirect.js", "settings.js", "settings.css",
  "popup.html", "options.html", "background.js", "permission-prompt.html", "permission-prompt.js",
  "vendor/oldreddit.bundled.css", "vendor/dash.mediaplayer.min.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png", "icons/icon.svg",
];
