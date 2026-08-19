/**
 * Parse Happ routing profiles (happ://routing/...) and map to Xray rules.
 */
(function (root) {
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
    try {
      return JSON.parse(b64decode(m[1]));
    } catch {
      return null;
    }
  }

  function extractHappRouting(body, headers = {}) {
    const hdr = headers.routing || headers.Routing || headers["routing-enable"];
    if (typeof hdr === "string" && /^happ:\/\//i.test(hdr)) {
      const parsed = parseHappRoutingLink(hdr);
      if (parsed) return parsed;
    }
    for (const line of String(body || "").split(/\r?\n/)) {
      const item = line.trim();
      if (!/^happ:\/\/routing\//i.test(item)) continue;
      const parsed = parseHappRoutingLink(item);
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
