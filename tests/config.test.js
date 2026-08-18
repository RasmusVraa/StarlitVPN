const fs = require("fs");
const path = require("path");
const vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "../extension/lib/config.js"), "utf8");
const sandbox = { globalThis: {}, URL, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { normalizeSubscriptionUrl, subHost } = sandbox.StarlitConfig;

function eq(name, actual, expected) {
  if (actual !== expected) {
    console.error("FAIL", name, actual, expected);
    process.exitCode = 1;
  } else console.log("ok  ", name);
}

eq("host", subHost, "sub.starlit-moon.ru");
eq("full", normalizeSubscriptionUrl("https://sub.starlit-moon.ru/abc"), "https://sub.starlit-moon.ru/abc");
eq("token", normalizeSubscriptionUrl("1MJQjt7897fuyKQ7"), "https://sub.starlit-moon.ru/1MJQjt7897fuyKQ7");
eq("path", normalizeSubscriptionUrl("/key"), "https://sub.starlit-moon.ru/key");

let threw = false;
try { normalizeSubscriptionUrl("https://example.com/x"); } catch { threw = true; }
eq("foreign host rejected", threw, true);
threw = false;
try { normalizeSubscriptionUrl("https://evil.sub.starlit-moon.ru.attacker.com/x"); } catch { threw = true; }
eq("suffix rejected", threw, true);
if (!process.exitCode) console.log("\nall tests passed");
