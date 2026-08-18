/* Shared browser API (Chrome + Firefox). */
const ext = globalThis.browser ?? globalThis.chrome;

function isFirefox() {
  return typeof globalThis.browser !== "undefined" &&
    typeof globalThis.browser.runtime?.getBrowserInfo === "function";
}
