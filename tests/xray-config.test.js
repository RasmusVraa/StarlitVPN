const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, "../extension/lib", file), "utf8");
  const sandbox = {
    globalThis: {},
    crypto: require("crypto"),
    URL,
    Uint8Array,
    TextDecoder,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.globalThis;
}

const { parseOne } = load("uri.js").StarlitUri;
const { buildConfig } = load("xray-config.js").StarlitXray;

const node = parseOne("vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=reality&pbk=PUB&fp=chrome&sni=www.cloudflare.com&sid=ab&flow=xtls-rprx-vision#NL");
const cfg = buildConfig(node, { socksPort: 10808, routing: "bypass-private" });
const proxy = cfg.outbounds.find((o) => o.tag === "proxy");
if (proxy.protocol !== "vless") throw new Error("protocol");
if (proxy.streamSettings.security !== "reality") throw new Error("reality");
if (proxy.streamSettings.realitySettings.publicKey !== "PUB") throw new Error("pbk");
if (cfg.inbounds[0].port !== 10808) throw new Error("port");
console.log("ok   xray reality outbound");
console.log("all config tests passed");
