// Keep test browsers off the user's screen. On a Wayland desktop, xvfb-run only swaps
// DISPLAY; WAYLAND_DISPLAY is inherited, so Chromium (Ozone) and Firefox open real
// windows on the desktop instead of the invisible Xvfb display. Drop the Wayland
// variables so both use the X display xvfb-run provides. Import this first.
delete process.env.WAYLAND_DISPLAY;
process.env.MOZ_ENABLE_WAYLAND = "0";
if (process.env.XDG_SESSION_TYPE === "wayland") process.env.XDG_SESSION_TYPE = "x11";
