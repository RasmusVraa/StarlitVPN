const fs = require("fs");
const path = require("path");
const vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "../extension/lib/flags.js"), "utf8");
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { countryCode, stripFlagEmoji } = sandbox.StarlitFlags;

function eq(name, actual, expected) {
  if (actual !== expected) {
    console.error("FAIL", name, JSON.stringify(actual), JSON.stringify(expected));
    process.exitCode = 1;
  } else console.log("ok  ", name);
}

eq("fi name", countryCode({ name: "ФИНЛЯНДИЯ 1🇫🇮" }), "fi");
eq("de name", countryCode({ name: "ГЕРМАНИЯ HYSTERIA2" }), "de");
eq("lt host", countryCode({ name: "Server", server: "litva.starlit-moon.ru" }), "lt");
eq("tr emoji", countryCode({ name: "Node 🇹🇷" }), "tr");
eq("auto", countryCode({ name: "VLESS АВТО" }), "gp");
eq("info", countryCode({ name: "Осталось дней: 26527" }), "info");
eq("strip", stripFlagEmoji("ФИНЛЯНДИЯ 1🇫🇮"), "ФИНЛЯНДИЯ 1");
if (!process.exitCode) console.log("\nall tests passed");
