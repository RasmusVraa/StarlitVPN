/* Shared browser API (Chrome + Firefox). Prefer an object that actually has runtime. */
const ext = (() => {
  const chromeApi = globalThis.chrome;
  const browserApi = globalThis.browser;
  if (chromeApi?.runtime?.getURL) return chromeApi;
  if (browserApi?.runtime?.getURL) return browserApi;
  return chromeApi || browserApi || {};
})();

function isFirefox() {
  return typeof globalThis.browser !== "undefined" &&
    typeof globalThis.browser.runtime?.getBrowserInfo === "function";
}
