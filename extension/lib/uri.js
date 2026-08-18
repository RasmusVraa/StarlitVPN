/**
 * Parse Happ / Xray share links: vless, vmess, trojan, ss, socks, hy2.
 */
(function (root) {
  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `n_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function decodeURIComponentSafe(value) {
    if (value == null) return "";
    try {
      return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      return value;
    }
  }

  function b64decode(raw) {
    const s = String(raw).trim().replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s + pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return bin;
    }
  }

  function parseQuery(search) {
    const out = {};
    const q = String(search || "").replace(/^\?/, "");
    if (!q) return out;
    for (const part of q.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const k = decodeURIComponentSafe(eq >= 0 ? part.slice(0, eq) : part).toLowerCase();
      const v = decodeURIComponentSafe(eq >= 0 ? part.slice(eq + 1) : "");
      out[k] = v;
    }
    return out;
  }

  function splitHash(hash) {
    const h = String(hash || "").replace(/^#/, "");
    if (!h) return { name: "", extra: {} };
    const q = h.indexOf("?");
    if (q === -1) return { name: decodeURIComponentSafe(h), extra: {} };
    return { name: decodeURIComponentSafe(h.slice(0, q)), extra: parseQuery(h.slice(q)) };
  }

  function truthy(v) {
    return v === true || v === "1" || v === "true" || v === "yes";
  }

  function asPort(value, fallback = 443) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 && n < 65536 ? n : fallback;
  }

  function transportOf(q, fallback = "tcp") {
    return (q.type || q.net || fallback).toLowerCase();
  }

  function securityOf(q, fallback = "none") {
    const s = (q.security || q.tls || fallback).toLowerCase();
    if (s === "xtls") return "tls";
    if (s === "1") return "tls";
    return s || "none";
  }

  function nodeBase(protocol, raw, extra = {}) {
    return {
      id: uid(),
      protocol,
      raw,
      name: extra.name || protocol.toUpperCase(),
      server: extra.server || "",
      port: extra.port || 443,
      remark: extra.remark || "",
      createdAt: Date.now(),
    };
  }

  function parseVless(uri) {
    const u = new URL(uri);
    const q = parseQuery(u.search);
    const hash = splitHash(u.hash);
    const node = nodeBase("vless", uri, {
      name: hash.name || u.username,
      server: u.hostname,
      port: asPort(u.port, 443),
      remark: hash.extra.serverdescription ? b64decode(hash.extra.serverdescription) : "",
    });
    node.uuid = decodeURIComponentSafe(u.username);
    node.flow = q.flow || "";
    node.encryption = q.encryption || "none";
    node.network = transportOf(q, "tcp");
    node.security = securityOf(q, q.pbk ? "reality" : "none");
    node.sni = q.sni || q.servername || q.host || "";
    node.fp = q.fp || q.fingerprint || "chrome";
    node.alpn = q.alpn || "";
    node.allowInsecure = truthy(q.allowinsecure) || truthy(q.insecure);
    node.pbk = q.pbk || q.publickey || "";
    node.sid = q.sid || q.shortid || "";
    node.spx = q.spx || q.spiderx || "/";
    node.path = q.path || "/";
    node.host = q.host || q.authority || "";
    node.serviceName = q.servicename || q.serviceName || "";
    node.mode = q.mode || "";
    node.headerType = q.headertype || "none";
    node.packetEncoding = q.packetencoding || "";
    node.pqv = q.pqv || "";
    return node;
  }

  function parseVmess(uri) {
    const payload = uri.slice("vmess://".length);
    let data;
    try {
      data = JSON.parse(b64decode(payload));
    } catch {
      // Some clients use vless-style vmess URIs.
      try {
        const u = new URL(uri);
        const q = parseQuery(u.search);
        const hash = splitHash(u.hash);
        const node = nodeBase("vmess", uri, {
          name: hash.name || "VMess",
          server: u.hostname,
          port: asPort(u.port, 443),
        });
        node.uuid = decodeURIComponentSafe(u.username);
        node.alterId = Number.parseInt(q.aid || q.alterid || "0", 10) || 0;
        node.securityMethod = q.encryption || q.scy || "auto";
        node.network = transportOf(q, "tcp");
        node.security = securityOf(q, "none");
        node.path = q.path || "/";
        node.host = q.host || "";
        node.sni = q.sni || "";
        node.fp = q.fp || "chrome";
        node.alpn = q.alpn || "";
        node.allowInsecure = truthy(q.allowinsecure);
        return node;
      } catch (err) {
        throw new Error("Некорректная vmess-ссылка");
      }
    }
    const node = nodeBase("vmess", uri, {
      name: data.ps || data.remark || "VMess",
      server: data.add || data.address || "",
      port: asPort(data.port, 443),
    });
    node.uuid = data.id;
    node.alterId = Number.parseInt(data.aid ?? data.alterId ?? 0, 10) || 0;
    node.securityMethod = data.scy || data.security || "auto";
    node.network = (data.net || "tcp").toLowerCase();
    node.security = (data.tls === "tls" || data.tls === "reality" ? data.tls : (data.tls ? "tls" : "none")).toLowerCase();
    if (data.security === "reality") node.security = "reality";
    node.path = data.path || "/";
    node.host = data.host || "";
    node.sni = data.sni || data.host || "";
    node.fp = data.fp || "chrome";
    node.alpn = data.alpn || "";
    node.allowInsecure = truthy(data.allowInsecure);
    node.pbk = data.pbk || "";
    node.sid = data.sid || "";
    node.spx = data.spx || "/";
    node.type = data.type || "none";
    node.serviceName = data.serviceName || data.path || "";
    return node;
  }

  function parseTrojan(uri) {
    const u = new URL(uri);
    const q = parseQuery(u.search);
    const hash = splitHash(u.hash);
    const node = nodeBase("trojan", uri, {
      name: hash.name || "Trojan",
      server: u.hostname,
      port: asPort(u.port, 443),
      remark: hash.extra.serverdescription ? b64decode(hash.extra.serverdescription) : "",
    });
    node.password = decodeURIComponentSafe(u.username);
    node.network = transportOf(q, "tcp");
    node.security = securityOf(q, "tls");
    node.sni = q.sni || q.peer || "";
    node.fp = q.fp || "chrome";
    node.alpn = q.alpn || "";
    node.allowInsecure = truthy(q.allowinsecure) || truthy(q.insecure);
    node.path = q.path || "/";
    node.host = q.host || "";
    node.serviceName = q.servicename || "";
    node.pbk = q.pbk || "";
    node.sid = q.sid || "";
    node.spx = q.spx || "/";
    return node;
  }

  function parseShadowsocks(uri) {
    let body = uri.slice("ss://".length);
    let name = "";
    const hashIdx = body.indexOf("#");
    if (hashIdx >= 0) {
      name = decodeURIComponentSafe(body.slice(hashIdx + 1).split("?")[0]);
      body = body.slice(0, hashIdx);
    }
    let method = "";
    let password = "";
    let server = "";
    let port = 443;

    const at = body.lastIndexOf("@");
    if (at >= 0) {
      let userinfo = body.slice(0, at);
      const hostport = body.slice(at + 1);
      if (!userinfo.includes(":")) {
        userinfo = b64decode(userinfo);
      } else if (!/^[a-z0-9-]+:/i.test(userinfo) && /^[A-Za-z0-9+/=_-]+$/.test(userinfo)) {
        try { userinfo = b64decode(userinfo); } catch { /* keep */ }
      }
      const colon = userinfo.indexOf(":");
      method = decodeURIComponentSafe(colon >= 0 ? userinfo.slice(0, colon) : userinfo);
      password = decodeURIComponentSafe(colon >= 0 ? userinfo.slice(colon + 1) : "");
      const hp = new URL("https://" + hostport.replace(/\/$/, ""));
      server = hp.hostname;
      port = asPort(hp.port, 443);
    } else {
      const decoded = b64decode(body);
      const u = decoded.includes("@") ? decoded : null;
      if (!u) throw new Error("Некорректная ss-ссылка");
      const [cred, hp] = [u.slice(0, u.lastIndexOf("@")), u.slice(u.lastIndexOf("@") + 1)];
      const colon = cred.indexOf(":");
      method = cred.slice(0, colon);
      password = cred.slice(colon + 1);
      const parsed = new URL("https://" + hp);
      server = parsed.hostname;
      port = asPort(parsed.port, 443);
    }

    const node = nodeBase("shadowsocks", uri, { name: name || "Shadowsocks", server, port });
    node.method = method;
    node.password = password;
    node.network = "tcp";
    node.security = "none";
    return node;
  }

  function parseSocks(uri) {
    let raw = uri;
    const scheme = uri.startsWith("socks5://") ? "socks5" : "socks";
    let name = "";
    const hashIdx = raw.indexOf("#");
    if (hashIdx >= 0) {
      name = decodeURIComponentSafe(raw.slice(hashIdx + 1));
      raw = raw.slice(0, hashIdx);
    }
    const rest = raw.replace(/^socks5?:\/\//i, "");
    try {
      const u = new URL("http://" + rest);
      const node = nodeBase("socks", uri, {
        name: name || "SOCKS5",
        server: u.hostname,
        port: asPort(u.port, 1080),
      });
      node.username = decodeURIComponentSafe(u.username);
      node.password = decodeURIComponentSafe(u.password);
      node.network = "tcp";
      node.security = "none";
      return node;
    } catch {
      const decoded = b64decode(rest);
      const u = new URL("http://" + decoded);
      const node = nodeBase("socks", uri, {
        name: name || "SOCKS5",
        server: u.hostname,
        port: asPort(u.port, 1080),
      });
      node.username = decodeURIComponentSafe(u.username);
      node.password = decodeURIComponentSafe(u.password);
      return node;
    }
  }

  function parseHysteria2(uri) {
    const normalized = uri.replace(/^hy2:\/\//i, "hysteria2://");
    const u = new URL(normalized);
    const q = parseQuery(u.search);
    const hash = splitHash(u.hash);
    const node = nodeBase("hysteria2", uri, {
      name: hash.name || "Hysteria2",
      server: u.hostname,
      port: asPort(u.port, 443),
    });
    node.password = decodeURIComponentSafe(u.username);
    if (u.password) node.password = `${node.password}:${decodeURIComponentSafe(u.password)}`;
    node.sni = q.sni || q.peer || "";
    node.allowInsecure = truthy(q.insecure) || truthy(q.allowinsecure);
    node.obfs = q.obfs || "";
    node.obfsPassword = q["obfs-password"] || q.obfspassword || "";
    node.security = "tls";
    node.network = "udp";
    return node;
  }

  function looksLikeJson(text) {
    const t = text.trim();
    return t.startsWith("{") || t.startsWith("[");
  }

  function parseJsonConfig(text) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data.flatMap((item) => {
        if (typeof item === "string") return parseMany(item);
        if (item && typeof item === "object") return [parseJsonObject(item, JSON.stringify(item))];
        return [];
      });
    }
    return [parseJsonObject(data, text)];
  }

  function outboundEndpoint(outbound = {}) {
    const s = outbound.settings || {};
    const stream = outbound.streamSettings || {};
    const vnext = s.vnext?.[0] || {};
    const server = s.servers?.[0] || {};
    const sni = stream.realitySettings?.serverName || stream.tlsSettings?.serverName || "";
    const address = s.address || vnext.address || server.address || "";
    return {
      server: address && address !== "0.0.0.0" && address !== "::" ? address : (sni || address || ""),
      port: Number(s.port || vnext.port || server.port || 443),
    };
  }

  function parseJsonObject(data, raw) {
    if (typeof data === "string") return parseOne(data);
    if (data.outbounds || data.inbounds) {
      const outbound = (data.outbounds || []).find((o) => o.protocol && o.protocol !== "freedom" && o.protocol !== "blackhole") || data.outbounds?.[0];
      const ep = outboundEndpoint(outbound);
      const node = nodeBase(outbound?.protocol || "xray-json", raw, {
        name: data.remarks || data.ps || outbound?.tag || "Xray JSON",
        server: ep.server,
        port: ep.port,
      });
      node.fullConfig = data;
      node.protocol = outbound?.protocol || "xray-json";
      return node;
    }
    if (data.protocol && (data.settings || data.streamSettings || data.vnext)) {
      const node = nodeBase(data.protocol, raw, {
        name: data.tag || data.remarks || data.protocol,
        server: data.settings?.vnext?.[0]?.address || data.settings?.servers?.[0]?.address || "",
        port: data.settings?.vnext?.[0]?.port || data.settings?.servers?.[0]?.port || 443,
      });
      node.outbound = data;
      return node;
    }
    throw new Error("Неизвестный JSON-конфиг");
  }

  function parseOne(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("Пустая ссылка");
    if (looksLikeJson(raw)) return parseJsonConfig(raw)[0];
    const lower = raw.toLowerCase();
    if (lower.startsWith("vless://")) return parseVless(raw);
    if (lower.startsWith("vmess://")) return parseVmess(raw);
    if (lower.startsWith("trojan://")) return parseTrojan(raw);
    if (lower.startsWith("ss://")) return parseShadowsocks(raw);
    if (lower.startsWith("socks5://") || lower.startsWith("socks://")) return parseSocks(raw);
    if (lower.startsWith("hysteria2://") || lower.startsWith("hy2://")) return parseHysteria2(raw);
    throw new Error("Неподдерживаемая ссылка");
  }

  function parseMany(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    if (looksLikeJson(raw)) {
      try {
        return parseJsonConfig(raw);
      } catch {
        /* fall through to line parser */
      }
    }
    let body = raw;
    const compact = body.replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/_-]+=*$/.test(compact) && compact.length > 40 && !/^[a-z]+:\/\//i.test(body)) {
      try {
        const decoded = b64decode(compact);
        if (decoded.includes("://") || looksLikeJson(decoded)) body = decoded;
      } catch { /* ignore */ }
    }
    const nodes = [];
    const errors = [];
    for (const line of body.split(/\r?\n/)) {
      const item = line.trim();
      if (!item || item.startsWith("#")) continue;
      try {
        const parsed = parseOne(item);
        if (Array.isArray(parsed)) nodes.push(...parsed);
        else nodes.push(parsed);
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (!nodes.length && errors.length) throw new Error(errors[0]);
    return nodes;
  }

  root.StarlitUri = { parseOne, parseMany, b64decode };
})(globalThis);
