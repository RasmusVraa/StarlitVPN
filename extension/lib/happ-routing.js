/**
 * Parse Happ routing profiles (happ://routing/...) and map to Xray rules.
 */
(function (root) {
  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return undefined;
    for (const key of Object.keys(obj)) {
      const lk = key.toLowerCase();
      if (keys.includes(lk)) return obj[key];
    }
    return undefined;
  }

  function toList(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
    const one = String(value || "").trim();
    if (!one) return [];
    return one.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
  }

  function normalizeProfile(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.off) return { off: true };
    const profile = {
      Name: pick(raw, ["name"]) || "",
      DomainStrategy: pick(raw, ["domainstrategy"]) || "AsIs",
      GlobalProxy: pick(raw, ["globalproxy"]),
      BlockSites: toList(pick(raw, ["blocksites", "block_sites", "blockdomains", "block_domains"])),
      BlockIp: toList(pick(raw, ["blockip", "block_ip"])),
      DirectSites: toList(pick(raw, ["directsites", "direct_sites", "directdomains", "direct_domains"])),
      DirectIp: toList(pick(raw, ["directip", "direct_ip"])),
      ProxySites: toList(pick(raw, ["proxysites", "proxy_sites", "proxydomains", "proxy_domains"])),
      ProxyIp: toList(pick(raw, ["proxyip", "proxy_ip"])),
    };
    return profile;
  }

  function b64decode(raw) {
    const s = String(raw || "").trim().replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s + pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return bin;
    }
  }

  function parseHappRoutingLink(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^happ:\/\/routing\/off/i.test(s)) return { off: true };
    const m = s.match(/^happ:\/\/routing\/(?:add|onadd)\/(.+)$/i);
    if (!m) return null;
    try { return normalizeProfile(JSON.parse(b64decode(m[1]))); } catch { return null; }
  }

  function parseHappRoutingValue(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^happ:\/\/routing\//i.test(s)) return parseHappRoutingLink(s);
    try {
      if (s.startsWith("{")) return normalizeProfile(JSON.parse(s));
    } catch { /* ignore */ }
    try {
      const decoded = b64decode(s);
      if (decoded && decoded.trim().startsWith("{")) return normalizeProfile(JSON.parse(decoded));
    } catch { /* ignore */ }
    return null;
  }

  function extractHappRouting(body, headers = {}) {
    const hdr = headers.routing || headers.Routing || headers["routing-enable"] || headers["x-routing"];
    if (typeof hdr === "string") {
      const parsed = parseHappRoutingValue(hdr);
      if (parsed) return parsed;
    }
    for (const line of String(body || "").split(/\r?\n/)) {
      const item = line.trim();
      const parsed = parseHappRoutingValue(item);
      if (parsed) return parsed;
    }
    return null;
  }

  function fieldRules(list, tag, key) {
    const rules = [];
    for (const item of list || []) {
      const v = String(item || "").trim();
      if (!v) continue;
      rules.push({ type: "field", [key]: [v], outboundTag: tag });
    }
    return rules;
  }

  function toXrayRules(profile) {
    if (!profile || profile.off) return null;
    const rules = [
      { type: "field", inboundTag: ["socks-in", "http-in"], domain: ["geosite:private"], outboundTag: "direct" },
      { type: "field", inboundTag: ["socks-in", "http-in"], ip: ["geoip:private"], outboundTag: "direct" },
    ];
    rules.push(...fieldRules(profile.BlockSites, "block", "domain"));
    rules.push(...fieldRules(profile.BlockIp, "block", "ip"));
    rules.push(...fieldRules(profile.DirectSites, "direct", "domain"));
    rules.push(...fieldRules(profile.DirectIp, "direct", "ip"));
    rules.push(...fieldRules(profile.ProxySites, "proxy", "domain"));
    rules.push(...fieldRules(profile.ProxyIp, "proxy", "ip"));
    const globalOff = profile.GlobalProxy === false || String(profile.GlobalProxy).toLowerCase() === "false";
    if (globalOff) {
      rules.push({ type: "field", network: "tcp,udp", outboundTag: "direct" });
    }
    return {
      domainStrategy: profile.DomainStrategy || "AsIs",
      rules,
      name: profile.Name || "",
    };
  }

  root.StarlitHapp = {
    parseHappRoutingLink,
    extractHappRouting,
    toXrayRules,
  };
})(globalThis);
