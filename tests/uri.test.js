/**
 * Node test runner for share-link parsers. Usage: node tests/uri.test.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "../extension/lib/uri.js"), "utf8");
const sandbox = { globalThis: {}, crypto: require("crypto"), console };
sandbox.globalThis = sandbox;
sandbox.atob = (s) => Buffer.from(s, "base64").toString("binary");
sandbox.btoa = (s) => Buffer.from(s, "binary").toString("base64");
sandbox.URL = URL;
sandbox.Uint8Array = Uint8Array;
sandbox.TextDecoder = TextDecoder;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { parseOne, parseMany } = sandbox.globalThis.StarlitUri;

let failed = 0;
function eq(name, actual, expected) {
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL ${name}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const vless = parseOne("vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=reality&pbk=PUBKEY&fp=chrome&sni=www.cloudflare.com&sid=abcd&flow=xtls-rprx-vision#NL-1");
eq("vless proto", vless.protocol, "vless");
eq("vless host", vless.server, "example.com");
eq("vless port", vless.port, 443);
eq("vless sni", vless.sni, "www.cloudflare.com");
eq("vless name", vless.name, "NL-1");
eq("vless flow", vless.flow, "xtls-rprx-vision");

const vmessJson = Buffer.from(JSON.stringify({
  v: "2", ps: "US-VM", add: "1.2.3.4", port: "8443", id: "22222222-2222-4222-8222-222222222222",
  aid: "0", net: "ws", path: "/ray", host: "cdn.example.com", tls: "tls", sni: "cdn.example.com", fp: "chrome"
})).toString("base64");
const vmess = parseOne("vmess://" + vmessJson);
eq("vmess proto", vmess.protocol, "vmess");
eq("vmess name", vmess.name, "US-VM");
eq("vmess port", vmess.port, 8443);
eq("vmess path", vmess.path, "/ray");

const trojan = parseOne("trojan://secret@proxy.example.org:443?security=tls&sni=proxy.example.org&type=tcp#Trojan%20EU");
eq("trojan proto", trojan.protocol, "trojan");
eq("trojan name", trojan.name, "Trojan EU");
eq("trojan pass", trojan.password, "secret");

const ssUser = parseOne("ss://aes-256-gcm:p%40ss@10.0.0.8:8388#SS-1");
eq("ss method", ssUser.method, "aes-256-gcm");
eq("ss host", ssUser.server, "10.0.0.8");
eq("ss pass", ssUser.password, "p@ss");

const hy2 = parseOne("hy2://hop@hy.example.net:443?sni=hy.example.net&insecure=0#HY2");
eq("hy2 proto", hy2.protocol, "hysteria2");
eq("hy2 name", hy2.name, "HY2");

const many = parseMany("vless://11111111-1111-4111-8111-111111111111@a.com:443?security=tls#A\nss://aes-256-gcm:x@b.com:1#B\n");
eq("many count", many.length, 2);

const b64list = Buffer.from("vless://11111111-1111-4111-8111-111111111111@a.com:443?security=tls#A\n", "utf8").toString("base64");
eq("sub b64", parseMany(b64list).length, 1);

const happJson = JSON.stringify([{
  remarks: "ФИНЛЯНДИЯ 1",
  inbounds: [{ tag: "socks", protocol: "socks", port: 10808 }],
  outbounds: [
    { protocol: "vless", settings: { vnext: [{ address: "0.0.0.0", port: 443 }] }, streamSettings: { security: "reality", realitySettings: { serverName: "www.max.ru" } } },
    { protocol: "freedom", tag: "direct" },
  ],
}, {
  remarks: "HYSTERIA2 АВТО",
  outbounds: [
    { protocol: "hysteria", settings: { address: "germany.starlit-moon.ru", port: 443, version: 2 } },
    { protocol: "freedom", tag: "direct" },
  ],
}]);
const happNodes = parseMany(happJson);
eq("happ count", happNodes.length, 2);
eq("happ name", happNodes[0].name, "ФИНЛЯНДИЯ 1");
eq("happ sni host", happNodes[0].server, "www.max.ru");
eq("happ hy2 host", happNodes[1].server, "germany.starlit-moon.ru");
eq("happ unique raw", happNodes[0].raw !== happNodes[1].raw, true);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall tests passed");
