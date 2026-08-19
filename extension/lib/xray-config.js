/**
 * Build an Xray-core JSON config from a parsed Starlit node.
 */
(function (root) {
  function streamSettings(node) {
    const network = node.network || "tcp";
    const security = node.security || "none";
    const stream = { network };

    if (network === "ws" || network === "websocket") {
      stream.network = "ws";
      stream.wsSettings = {
        path: node.path || "/",
        host: node.host || undefined,
        headers: node.host ? { Host: node.host } : undefined,
      };
    } else if (network === "grpc") {
      stream.grpcSettings = {
        serviceName: node.serviceName || node.path || "",
        multiMode: node.mode === "multi",
      };
    } else if (network === "httpupgrade") {
      stream.httpupgradeSettings = {
        path: node.path || "/",
        host: node.host || "",
      };
    } else if (network === "xhttp" || network === "splithttp") {
      stream.network = "xhttp";
      stream.xhttpSettings = {
        path: node.path || "/",
        host: node.host || "",
        mode: node.mode || "auto",
      };
    } else if (network === "h2" || network === "http") {
      stream.network = "h2";
      stream.httpSettings = {
        path: node.path || "/",
        host: node.host ? [node.host] : undefined,
      };
    } else if (network === "tcp" && node.headerType && node.headerType !== "none") {
      stream.tcpSettings = {
        header: { type: node.headerType },
      };
    }

    if (security === "reality") {
      stream.security = "reality";
      stream.realitySettings = {
        show: false,
        fingerprint: node.fp || "chrome",
        serverName: node.sni || "",
        publicKey: node.pbk || "",
        shortId: node.sid || "",
        spiderX: node.spx || "/",
      };
      if (node.pqv) stream.realitySettings.mldsa65Verify = node.pqv;
    } else if (security === "tls") {
      stream.security = "tls";
      const tls = {
        allowInsecure: !!node.allowInsecure,
        fingerprint: node.fp || "chrome",
      };
      if (node.sni) tls.serverName = node.sni;
      if (node.alpn) tls.alpn = String(node.alpn).split(",").map((s) => s.trim()).filter(Boolean);
      stream.tlsSettings = tls;
    }

    return stream;
  }

  function outboundFromNode(node) {
    if (node.fullConfig?.outbounds) {
      return node.fullConfig.outbounds.find((o) => o.protocol && o.protocol !== "freedom" && o.protocol !== "blackhole") || node.fullConfig.outbounds[0];
    }
    if (node.outbound) return { ...node.outbound, tag: "proxy" };

    const protocol = node.protocol;
    if (protocol === "vless") {
      return {
        tag: "proxy",
        protocol: "vless",
        settings: {
          vnext: [{
            address: node.server,
            port: Number(node.port),
            users: [{
              id: node.uuid,
              encryption: node.encryption || "none",
              flow: node.flow || "",
            }],
          }],
        },
        streamSettings: streamSettings(node),
      };
    }
    if (protocol === "vmess") {
      return {
        tag: "proxy",
        protocol: "vmess",
        settings: {
          vnext: [{
            address: node.server,
            port: Number(node.port),
            users: [{
              id: node.uuid,
              alterId: Number(node.alterId || 0),
              security: node.securityMethod || "auto",
            }],
          }],
        },
        streamSettings: streamSettings(node),
      };
    }
    if (protocol === "trojan") {
      return {
        tag: "proxy",
        protocol: "trojan",
        settings: {
          servers: [{
            address: node.server,
            port: Number(node.port),
            password: node.password,
          }],
        },
        streamSettings: streamSettings({ ...node, security: node.security || "tls" }),
      };
    }
    if (protocol === "shadowsocks") {
      return {
        tag: "proxy",
        protocol: "shadowsocks",
        settings: {
          servers: [{
            address: node.server,
            port: Number(node.port),
            method: node.method,
            password: node.password,
          }],
        },
      };
    }
    if (protocol === "socks") {
      return {
        tag: "proxy",
        protocol: "socks",
        settings: {
          servers: [{
            address: node.server,
            port: Number(node.port),
            users: node.username ? [{ user: node.username, pass: node.password || "" }] : undefined,
          }],
        },
      };
    }
    if (protocol === "hysteria2" || protocol === "hysteria") {
      const stream = {
        network: "hysteria",
        security: "tls",
        tlsSettings: {
          serverName: node.sni || node.server,
          allowInsecure: !!node.allowInsecure,
          alpn: ["h3"],
        },
        hysteriaSettings: {
          version: 2,
          auth: node.password || "",
        },
      };
      if (node.obfs && /salamander/i.test(node.obfs) && node.obfsPassword) {
        stream.finalmask = {
          udp: [{ type: "salamander", settings: { password: node.obfsPassword } }],
        };
      }
      return {
        tag: "proxy",
        protocol: "hysteria",
        settings: {
          version: 2,
          address: node.server,
          port: Number(node.port),
        },
        streamSettings: stream,
      };
    }
    throw new Error("Нельзя собрать outbound для " + protocol);
  }

  function routingRules(mode) {
    const rules = [
      { type: "field", inboundTag: ["socks-in", "http-in"], domain: ["geosite:private"], outboundTag: "direct" },
      { type: "field", inboundTag: ["socks-in", "http-in"], ip: ["geoip:private"], outboundTag: "direct" },
    ];
    if (mode === "bypass-lan-cn") {
      rules.push(
        { type: "field", domain: ["geosite:cn"], outboundTag: "direct" },
        { type: "field", ip: ["geoip:cn"], outboundTag: "direct" },
      );
    }
    if (mode === "direct") {
      return [{ type: "field", network: "tcp,udp", outboundTag: "direct" }];
    }
    return rules;
  }

  function buildConfig(node, settings = {}, happRouting = null) {
    if (node.fullConfig?.inbounds && node.fullConfig?.outbounds) {
      return node.fullConfig;
    }
    const socksPort = Number(settings.socksPort || 10808);
    const httpPort = Number(settings.httpPort || socksPort + 1);
    const outbound = outboundFromNode(node);
    outbound.tag = "proxy";
    const happ = typeof StarlitHapp !== "undefined" ? StarlitHapp.toXrayRules(happRouting) : null;
    const routing = happ
      ? { domainStrategy: happ.domainStrategy, rules: happ.rules }
      : {
        domainStrategy: "AsIs",
        rules: routingRules(settings.routing || "bypass-private"),
      };
    return {
      log: { loglevel: settings.loglevel || "warning" },
      inbounds: [
        {
          tag: "socks-in",
          listen: "127.0.0.1",
          port: socksPort,
          protocol: "socks",
          settings: { udp: true, auth: "noauth" },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: true },
        },
        {
          tag: "http-in",
          listen: "127.0.0.1",
          port: httpPort,
          protocol: "http",
          sniffing: { enabled: true, destOverride: ["http", "tls"] },
        },
      ],
      outbounds: [
        outbound,
        { tag: "direct", protocol: "freedom" },
        { tag: "block", protocol: "blackhole" },
      ],
      routing,
    };
  }

  function buildPac(socksPort, extraBypass = [], onlyHosts = []) {
    const port = Number(socksPort);
    if (onlyHosts.length) {
      const sites = onlyHosts.map((h) => JSON.stringify(h)).join(", ");
      return `function FindProxyForURL(url, host) {
  var h = String(host || "").toLowerCase();
  if (h.indexOf("www.") === 0) h = h.substring(4);
  var sites = [${sites}];
  for (var i = 0; i < sites.length; i++) {
    var s = sites[i];
    if (h === s || (h.length > s.length && h.substring(h.length - s.length - 1) === "." + s))
      return "SOCKS5 127.0.0.1:${port}";
  }
  return "DIRECT";
}`;
    }
    const bypass = ["127.0.0.1", "localhost", "[::1]", ...extraBypass]
      .map((h) => JSON.stringify(h))
      .join(", ");
    return `function FindProxyForURL(url, host) {
  var bypass = [${bypass}];
  if (bypass.indexOf(host) !== -1) return "DIRECT";
  if (isPlainHostName(host)) return "DIRECT";
  if (shExpMatch(host, "*.local")) return "DIRECT";
  var ip = host;
  if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(ip)) {
    if (isInNet(ip, "10.0.0.0", "255.0.0.0")) return "DIRECT";
    if (isInNet(ip, "172.16.0.0", "255.240.0.0")) return "DIRECT";
    if (isInNet(ip, "192.168.0.0", "255.255.0.0")) return "DIRECT";
    if (isInNet(ip, "127.0.0.0", "255.0.0.0")) return "DIRECT";
  }
  return "SOCKS5 127.0.0.1:${port}";
}`;
  }

  root.StarlitXray = { buildConfig, outboundFromNode, buildPac };
})(globalThis);
