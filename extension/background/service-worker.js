if (typeof importScripts === "function") {
  importScripts("../lib/browser.js", "../lib/uri.js", "../lib/happ-routing.js", "../lib/xray-config.js", "../lib/config.js");
}

const NATIVE_HOST = "com.starlitvpn.host";
const DEFAULT_STATE = {
  nodes: [],
  groups: [],
  selectedId: null,
  settings: {
    socksPort: 10808,
    httpPort: 10809,
    routing: "bypass-private",
    language: "auto",
    attachMode: false,
    attachHost: "127.0.0.1",
    attachPort: 10808,
    loglevel: "warning",
    autoSites: [],
    autoSitesEnabled: true,
    autoSiteStates: {},
  },
  session: {
    connected: false,
    connecting: false,
    nodeId: null,
    connectedAt: null,
    error: "",
    native: null,
    core: null,
    autoConnected: false,
    warmNodeId: null,
  },
};

let firefoxProxyHandler = null;

async function loadState() {
  const stored = await ext.storage.local.get(["nodes", "groups", "selectedId", "settings", "session"]);
  const settings = { ...DEFAULT_STATE.settings, ...(stored.settings || {}) };
  cachedAutoSites = settings.autoSites || [];
  cachedSocksPort = Number(settings.socksPort || 10808);
  cachedAttachHost = settings.attachHost || "127.0.0.1";
  cachedAttachPort = Number(settings.attachPort || 10808);
  cachedAttachMode = !!settings.attachMode;
  cachedAutoSitesEnabled = settings.autoSitesEnabled !== false;
  cachedEnabledAutoSites = enabledAutoSitesFromSettings(settings);
  return {
    nodes: stored.nodes || [],
    groups: stored.groups || [],
    selectedId: stored.selectedId || null,
    settings,
    session: { ...DEFAULT_STATE.session, ...(stored.session || {}) },
  };
}

async function saveState(patch) {
  await ext.storage.local.set(patch);
}

let nativeBusy = false;
const nativeQueue = [];

function nativeFlush() {
  if (nativeBusy || !nativeQueue.length) return;
  nativeBusy = true;
  const job = nativeQueue[0];
  ext.runtime.sendNativeMessage(NATIVE_HOST, job.message)
    .then((reply) => {
      nativeQueue.shift();
      nativeBusy = false;
      job.resolve(reply || { ok: false, error: "empty native reply" });
      nativeFlush();
    })
    .catch((err) => {
      nativeQueue.shift();
      nativeBusy = false;
      job.resolve({ ok: false, error: err.message || String(err), missing: true });
      nativeFlush();
    });
}

function nativeSend(message) {
  return new Promise((resolve) => {
    nativeQueue.push({ message, resolve });
    nativeFlush();
  });
}

function firefoxLike() {
  return typeof browser !== "undefined" && browser.proxy && browser.proxy.onRequest;
}

async function applyBrowserProxy(port, host = "127.0.0.1", opts = {}) {
  const sites = opts.sites || [];
  if (firefoxLike()) {
    if (firefoxProxyHandler) {
      try { browser.proxy.onRequest.removeListener(firefoxProxyHandler); } catch { /* ignore */ }
    }
    firefoxProxyHandler = (details) => {
      if (sites.length && !urlMatchesSites(details.url, sites)) return { type: "direct" };
      return {
        type: "socks",
        host,
        port: Number(port),
        proxyDNS: true,
      };
    };
    browser.proxy.onRequest.addListener(firefoxProxyHandler, { urls: ["<all_urls>"] });
    return;
  }

  const pac = StarlitXray.buildPac(port, [], sites);
  await ext.proxy.settings.set({
    value: {
      mode: "pac_script",
      pacScript: { data: pac, mandatory: true },
    },
    scope: "regular",
  });
}

async function clearBrowserProxy() {
  if (firefoxLike()) {
    if (firefoxProxyHandler) {
      try { browser.proxy.onRequest.removeListener(firefoxProxyHandler); } catch { /* ignore */ }
      firefoxProxyHandler = null;
    }
    return;
  }
  try {
    await ext.proxy.settings.clear({ scope: "regular" });
  } catch {
    await ext.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" });
  }
}

async function setBadge(connected) {
  try {
    await ext.action.setBadgeBackgroundColor({ color: connected ? "#3ee0c5" : "#5b4ce6" });
    await ext.action.setBadgeText({ text: connected ? "ON" : "" });
  } catch { /* older firefox */ }
}

let autoHoldUntil = 0;
let warmJob = null;
let coreWarm = false;
let cachedAutoSites = [];
let cachedSocksPort = 10808;
let cachedAttachHost = "127.0.0.1";
let cachedAttachPort = 10808;
let cachedAttachMode = false;
let cachedAutoSitesEnabled = true;
let cachedEnabledAutoSites = [];
let autoPacInstalled = false;
let autoPacKey = "";
let fullTunnel = false;
let autoBadgeOn = false;

function normalizeSite(input) {
  let raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  raw = raw.replace(/^\*:\/\//, "").replace(/^\/\//, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = "https://" + raw;
  let url;
  try { url = new URL(raw); } catch { return ""; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  let host = (url.hostname || "").replace(/\.$/, "").replace(/^www\./, "");
  if (!host || host === "localhost") return "";
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return "";
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!ip && !host.includes(".")) return "";
  if (!ip && !/^[a-z0-9.-]+$/.test(host)) return "";
  return host;
}

function hostFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function urlMatchesSites(url, sites) {
  const host = hostFromUrl(url);
  if (!host || !sites?.length) return false;
  return sites.some((site) => host === site || host.endsWith("." + site));
}

function enabledAutoSitesFromSettings(settings) {
  const allSites = settings?.autoSites || [];
  const states = settings?.autoSiteStates || {};
  return allSites.filter((site) => states[site] !== false);
}

async function addAutoSite(input) {
  const site = normalizeSite(input);
  if (!site) throw new Error("Введите домен, например youtube.com");
  const state = await loadState();
  const autoSites = [...new Set([...(state.settings.autoSites || []), site])].slice(0, 80);
  const autoSiteStates = { ...(state.settings.autoSiteStates || {}) };
  autoSiteStates[site] = true;
  await saveState({ settings: { ...state.settings, autoSites, autoSiteStates } });
  cachedAutoSites = autoSites;
  cachedEnabledAutoSites = autoSites.filter((s) => autoSiteStates[s] !== false);
  if (cachedAutoSitesEnabled) installAutoPac().catch(() => {});
  return { site, autoSites, autoSiteStates };
}

async function removeAutoSite(input) {
  const site = normalizeSite(input) || String(input || "").trim().toLowerCase();
  const state = await loadState();
  const autoSites = (state.settings.autoSites || []).filter((s) => s !== site);
  const autoSiteStates = { ...(state.settings.autoSiteStates || {}) };
  delete autoSiteStates[site];
  await saveState({ settings: { ...state.settings, autoSites, autoSiteStates } });
  cachedAutoSites = autoSites;
  cachedEnabledAutoSites = autoSites.filter((s) => autoSiteStates[s] !== false);
  if (!cachedEnabledAutoSites.length) {
    autoPacInstalled = false;
    autoPacKey = "";
    if (!fullTunnel) await clearBrowserProxy();
  } else if (!fullTunnel) {
    await installAutoPac();
  }
  return { autoSites, autoSiteStates };
}

async function toggleAutoSite(input, enabled) {
  const site = normalizeSite(input) || String(input || "").trim().toLowerCase();
  if (!site) throw new Error("Некорректный сайт");
  const state = await loadState();
  const autoSites = state.settings.autoSites || [];
  if (!autoSites.includes(site)) throw new Error("Сайт не найден");
  const autoSiteStates = { ...(state.settings.autoSiteStates || {}) };
  autoSiteStates[site] = !!enabled;
  await saveState({ settings: { ...state.settings, autoSiteStates } });
  cachedEnabledAutoSites = autoSites.filter((s) => autoSiteStates[s] !== false);
  if (!fullTunnel) {
    if (cachedAutoSitesEnabled && cachedEnabledAutoSites.length) await installAutoPac();
    else {
      autoPacInstalled = false;
      autoPacKey = "";
      await clearBrowserProxy();
      markAutoBadge(false);
    }
  }
  return { autoSites, autoSiteStates };
}

function autoProxyTarget() {
  const port = cachedAttachMode ? cachedAttachPort : cachedSocksPort;
  const host = cachedAttachMode ? cachedAttachHost : "127.0.0.1";
  return { port, host };
}

async function installAutoPac() {
  if (!cachedAutoSitesEnabled || !cachedEnabledAutoSites.length || fullTunnel) return;
  const { port, host } = autoProxyTarget();
  const key = `auto|${host}|${port}|${cachedEnabledAutoSites.join(",")}`;
  if (autoPacInstalled && autoPacKey === key) return;
  await applyBrowserProxy(port, host, { sites: cachedEnabledAutoSites });
  autoPacInstalled = true;
  autoPacKey = key;
}

function markAutoBadge(on) {
  if (fullTunnel) return;
  if (autoBadgeOn === on) return;
  autoBadgeOn = on;
  setBadge(on).catch(() => {});
  ext.storage.local.get(["session"], (stored) => {
    if (fullTunnel) return;
    const session = { ...DEFAULT_STATE.session, ...(stored.session || {}) };
    if (session.connected && !session.autoConnected) return;
    session.connected = !!on;
    session.autoConnected = !!on;
    session.connecting = false;
    session.error = "";
    if (on) session.connectedAt = Date.now();
    ext.storage.local.set({ session });
  });
}

function proxyTarget(state) {
  const port = state.settings.attachMode ? Number(state.settings.attachPort) : Number(state.settings.socksPort);
  const host = state.settings.attachMode ? state.settings.attachHost : "127.0.0.1";
  return { port, host };
}

async function ensureWarm() {
  if (warmJob) return warmJob;
  warmJob = (async () => {
    const state = await loadState();
    if (state.settings.attachMode) {
      coreWarm = true;
      return;
    }
    if (!state.nodes.length) return;
    const node = state.nodes.find((n) => n.id === state.selectedId) || state.nodes[0];
    if (!node) return;
    if (coreWarm && state.session.warmNodeId === node.id) return;
    if (state.session.connecting || (state.session.connected && !state.session.autoConnected)) return;
    const port = Number(state.settings.socksPort);
    const config = StarlitXray.buildConfig(node, state.settings, routingForNode(state, node));
    const started = await nativeSend({ cmd: "start", force: false, config, configText: JSON.stringify(config), port });
    if (!started.ok) return;
    coreWarm = true;
    const latest = await loadState();
    await saveState({
      session: { ...latest.session, core: started.core || null, native: true, warmNodeId: node.id },
    });
  })().finally(() => { warmJob = null; });
  return warmJob;
}

async function maybeAutoConnect(url) {
  if (Date.now() < autoHoldUntil) return;
  if (!cachedAutoSitesEnabled) return;
  if (fullTunnel) return;
  if (!urlMatchesSites(url, cachedEnabledAutoSites)) return;
  markAutoBadge(true);
  ensureWarm().catch(() => {});
}

async function maybeAutoDisconnect() {
  if (!cachedAutoSitesEnabled) return;
  if (fullTunnel) return;
  if (!cachedEnabledAutoSites.length) return;
  if (await anyAutoSiteTab(cachedEnabledAutoSites)) return;
  markAutoBadge(false);
}

function scheduleAutoDisconnect() {
  clearTimeout(scheduleAutoDisconnect.timer);
  scheduleAutoDisconnect.timer = setTimeout(() => { maybeAutoDisconnect().catch(() => {}); }, 40);
}

async function anyAutoSiteTab(sites) {
  if (!sites?.length || !ext.tabs?.query) return false;
  const tabs = await ext.tabs.query({});
  return tabs.some((tab) => urlMatchesSites(tab.url, sites));
}

async function connect(nodeId, opts = {}) {
  const state = await loadState();
  if (opts.auto && (state.session.connected || state.session.connecting)) return state.session;
  const node = state.nodes.find((n) => n.id === nodeId) || state.nodes.find((n) => n.id === state.selectedId);
  if (!node) throw new Error("Выберите сервер");

  if (!opts.auto) {
    fullTunnel = true;
    autoPacInstalled = false;
    autoPacKey = "";
    autoBadgeOn = true;
  }

  await saveState({
    selectedId: node.id,
    session: { ...state.session, connecting: true, error: "", nodeId: node.id, autoConnected: !!opts.auto },
  });

  const { port, host } = proxyTarget(state);

  try {
    if (state.settings.attachMode) {
      await applyBrowserProxy(port, host, opts.auto ? { sites: state.settings.autoSites || [] } : {});
      autoPacInstalled = !!opts.auto;
      autoPacKey = "";
      fullTunnel = !opts.auto;
      autoBadgeOn = true;
      const session = {
        connected: true,
        connecting: false,
        nodeId: node.id,
        connectedAt: Date.now(),
        error: "",
        native: false,
        core: state.session.core,
        autoConnected: !!opts.auto,
        warmNodeId: node.id,
      };
      await saveState({ session });
      await setBadge(true);
      return session;
    }

    const config = StarlitXray.buildConfig(node, state.settings, routingForNode(state, node));
    const started = await nativeSend({
      cmd: "start",
      force: true,
      config,
      configText: JSON.stringify(config),
      port,
    });
    if (!started.ok) {
      const again = await nativeSend({ cmd: "status" });
      if (!again.running && !/сразу завершился/i.test(started.error || "")) {
        throw new Error(started.missing
          ? "Нажмите «Включить StarlitVPN» в окне расширения"
          : (started.error || "Не удалось запустить Xray"));
      }
    }
    coreWarm = true;

    await applyBrowserProxy(port, host, opts.auto ? { sites: state.settings.autoSites || [] } : {});
    autoPacInstalled = !!opts.auto;
    autoPacKey = "";
    fullTunnel = !opts.auto;
    autoBadgeOn = true;
    const session = {
      connected: true,
      connecting: false,
      nodeId: node.id,
      connectedAt: Date.now(),
      error: "",
      native: !state.settings.attachMode,
      core: (await loadState()).session.core,
      autoConnected: !!opts.auto,
      warmNodeId: node.id,
    };
    await saveState({ session });
    await setBadge(true);
    return session;
  } catch (err) {
    await clearBrowserProxy();
    autoPacInstalled = false;
    autoPacKey = "";
    fullTunnel = false;
    autoBadgeOn = false;
    const session = { ...DEFAULT_STATE.session, error: err.message || String(err) };
    await saveState({ session });
    await setBadge(false);
    if (cachedAutoSites.length) installAutoPac().catch(() => {});
    throw err;
  }
}

async function disconnect(opts = {}) {
  if (!opts.auto) autoHoldUntil = Date.now() + 1500;
  const state = await loadState();
  await clearBrowserProxy();
  autoPacInstalled = false;
  autoPacKey = "";
  fullTunnel = false;
  autoBadgeOn = false;
  const stopCore = opts.stopCore === true;
  if (stopCore && !state.settings.attachMode) {
    await nativeSend({ cmd: "stop" });
    coreWarm = false;
  }
  const session = {
    ...DEFAULT_STATE.session,
    native: state.session.native,
    core: state.session.core,
    warmNodeId: stopCore ? null : state.session.warmNodeId,
  };
  await saveState({ session });
  await setBadge(false);
  if (!stopCore && cachedAutoSites.length) {
    await installAutoPac();
  }
  return session;
}

function isAnnounceText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^[🚫ℹ️⌛⚡⚠]/u.test(t)) return true;
  if (/не поддерж|not supported|unsupported|превышено максимальное|удалите или купите слот|подписка истекла|лимита трафика|аккаунт заблокирован|обратитесь в поддержку/i.test(t)) return true;
  if (/^(tg|web)\s*[-–—]/i.test(t)) return true;
  if (/@starlitvpnbot/i.test(t)) return true;
  return false;
}

function isAnnounceNode(n) {
  return isAnnounceText(n?.name) || isAnnounceText(n?.remark);
}

function looksLikeServerLabel(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^(vless|vmess|trojan|ss|shadowsocks|hysteria2?|hy2|socks5?|lte)\b/i.test(t)) return true;
  if (/\b(vless|vmess|trojan|hysteria2?|hy2|shadowsocks|ss)\b.*⚡/i.test(t)) return true;
  if (/^(финляндия|германия|литва|турция)\s*\d+\s*[a-zа-я]{0,4}$/i.test(t)) return true;
  if (/^(финляндия|германия|литва|турция)\b.*(vless|hysteria|lte|hy2)/i.test(t)) return true;
  if (/\b(abto|hysteria2?(fi|de|lt|tr)?)\b/i.test(t) && /⚡/.test(t)) return true;
  if (/\|\s*(германия|литва|турция)\b/i.test(t)) return true;
  if (/⚡\s*(gp|fi|de|lt|tr)\b/i.test(t) && !/быстрые\s+сервера/i.test(t)) return true;
  if (/^(финляндия|германия|литва|турция)/i.test(t) && /⚡/.test(t)) return true;
  if (/hysteria2?(fi|de|lt|tr)\b/i.test(t)) return true;
  if (/^[A-Za-z0-9_-]{24,}$/.test(t)) return true;
  return false;
}

function looksLikeNoiseToken(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^[A-Za-z0-9+/_=-]{20,}$/.test(t)) return true;
  if (!/\s/.test(t) && t.length > 18) return true;
  return false;
}

function isHumanDescriptionLine(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.startsWith("#")) return false;
  if (/^happ:\/\/routing\//i.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;
  if (looksLikeServerLabel(t) || looksLikeNoiseToken(t)) return false;
  if (/[а-яё]/i.test(t)) return true;
  if (/[⚡❗🔄🚫ℹ️⌛⚠]/u.test(t)) return true;
  if (/support|error|days|traffic|limit/i.test(t)) return true;
  return false;
}

function cleanDescription(lines) {
  const out = [];
  for (const raw of (lines || [])) {
    const line = String(raw || "").trim();
    if (!isHumanDescriptionLine(line)) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

function isDescriptionLine(text) {
  return isHumanDescriptionLine(text);
}

function isInfoCarrierNode(n) {
  if (isAnnounceNode(n)) return true;
  const name = String(n?.name || n?.remark || "").trim();
  if (!isDescriptionLine(name)) return false;
  if (/осталось\s*дней|дней\s*осталось/i.test(name)) return true;
  const srv = String(n?.server || "").trim();
  return !srv || srv === "0.0.0.0" || srv === "127.0.0.1" || srv === "localhost";
}

function extractSubscriptionInfo(body, nodes) {
  const lines = [];
  for (const n of nodes || []) {
    const text = String(n.name || n.remark || "").trim();
    if (!isDescriptionLine(text)) continue;
    if (text && !lines.includes(text)) lines.push(text);
  }
  for (const line of String(body || "").split(/\r?\n/)) {
    const item = line.trim();
    if (!isDescriptionLine(item)) continue;
    if (!lines.includes(item)) lines.push(item);
  }
  return cleanDescription(lines);
}

async function sanitizeStoredGroups(groups) {
  let changed = false;
  const next = (groups || []).map((g) => {
    const description = cleanDescription(g.description);
    if (JSON.stringify(description) !== JSON.stringify(g.description || [])) {
      changed = true;
      return { ...g, description };
    }
    return g;
  });
  if (changed) await saveState({ groups: next });
  return next;
}

function groupHappRouting(group) {
  if (!group?.happRouting || group.happRouting.off) return null;
  return group.happRouting;
}

function routingForNode(state, node) {
  const group = state.groups?.find((g) => g.id === node?.groupId);
  return groupHappRouting(group);
}

function subscriptionLooksLikeAnnounce(body) {
  const raw = String(body || "");
  let nodes = [];
  try { nodes = StarlitUri.parseMany(raw); } catch { nodes = []; }
  if (!nodes.length) return /не поддерж|превышено максимальное|подписка истекла|лимита трафика|заблокирован|@starlitvpnbot/i.test(raw);
  return nodes.every(isAnnounceNode);
}

function announceError(body) {
  const t = String(body || "");
  if (/превышено максимальное|max.*device|купите слот/i.test(t)) {
    return "Достигнут лимит устройств. Удалите лишнее устройство в личном кабинете.";
  }
  if (/не поддерж|not supported/i.test(t)) {
    return "Панель не приняла устройство. Нажмите обновление подписки или откройте кабинет.";
  }
  if (/истекла|expired/i.test(t)) return "Подписка истекла. Откройте личный кабинет.";
  if (/лимита трафика/i.test(t)) return "Закончился трафик. Откройте личный кабинет.";
  if (/заблокирован/i.test(t)) return "Аккаунт заблокирован. Напишите в поддержку.";
  if (/@starlitvpnbot|обратитесь в поддержку/i.test(t)) {
    return "Панель вернула служебное сообщение вместо серверов. Откройте личный кабинет.";
  }
  return "Панель вернула служебное сообщение вместо серверов. Откройте личный кабинет.";
}

async function dropAnnounceNodes() {
  const state = await loadState();
  const nodes = (state.nodes || []).filter((n) => !isInfoCarrierNode(n));
  if (nodes.length === state.nodes.length) return false;
  const selectedId = nodes.some((n) => n.id === state.selectedId) ? state.selectedId : (nodes[0]?.id || null);
  await saveState({ nodes, selectedId });
  return true;
}

async function importText(text, groupId = null, groupName = "") {
  const trimmed = String(text || "").trim();
  const first = trimmed.split(/\s+/)[0];
  if (/^https?:\/\//i.test(first)) return importSubscription(first, groupName);
  const nodes = StarlitUri.parseMany(trimmed);
  if (!nodes.length) throw new Error("Не найдено ни одной ссылки");
  const state = await loadState();
  let groups = state.groups;
  let gid = groupId;
  if (!gid && groupName) {
    gid = crypto.randomUUID();
    groups = groups.concat([{ id: gid, name: groupName, url: "", updatedAt: Date.now() }]);
  }
  const incoming = nodes.map((n) => ({ ...n, groupId: gid || n.groupId || null })).filter((n) => !isAnnounceNode(n));
  const existingKeys = new Set(state.nodes.map((n) => n.raw || `${n.protocol}:${n.server}:${n.port}:${n.name}`));
  const merged = state.nodes.slice();
  for (const node of incoming) {
    const key = node.raw || `${node.protocol}:${node.server}:${node.port}:${node.name}`;
    const idx = merged.findIndex((n) => (n.raw && node.raw && n.raw === node.raw) || `${n.protocol}:${n.server}:${n.port}:${n.name}` === key);
    if (idx >= 0) merged[idx] = { ...merged[idx], ...node, id: merged[idx].id, latency: merged[idx].latency };
    else merged.push(node);
    existingKeys.add(key);
  }
  const selectedId = state.selectedId || merged[0]?.id || null;
  await saveState({ nodes: merged, groups, selectedId });
  return { added: incoming.length, total: merged.length };
}

const SUB_UA = (typeof StarlitConfig !== "undefined" && StarlitConfig.happUserAgent) || "Happ/3.3.6/windows StarlitVPN/1.0.10";

async function getDeviceHwid() {
  const stored = await ext.storage.local.get("starlitHwid");
  if (stored.starlitHwid && /^[a-zA-Z0-9=-]{10,64}$/.test(stored.starlitHwid)) return stored.starlitHwid;
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let hwid = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "x").replace(/=+$/g, "");
  if (hwid.length < 16) hwid = (hwid + "StarlitVPN12").slice(0, 16);
  if (hwid.length > 64) hwid = hwid.slice(0, 64);
  await ext.storage.local.set({ starlitHwid: hwid });
  return hwid;
}

async function ensureSubHeaderRules() {
  const dnr = ext.declarativeNetRequest;
  if (!dnr?.updateDynamicRules) return;
  const hwid = await getDeviceHwid();
  try {
    await dnr.updateDynamicRules({
      removeRuleIds: [91001],
      addRules: [{
        id: 91001,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "User-Agent", operation: "set", value: SUB_UA },
            { header: "x-hwid", operation: "set", value: hwid },
            { header: "x-device-os", operation: "set", value: "Windows" },
            { header: "x-ver-os", operation: "set", value: "10.0" },
            { header: "x-device-model", operation: "set", value: "StarlitVPN" },
          ],
        },
        condition: {
          urlFilter: "||sub.starlit-moon.ru/",
          resourceTypes: ["xmlhttprequest", "other", "main_frame", "sub_frame"],
        },
      }],
    });
  } catch { /* Firefox/Chrome without DNR */ }
}

function headerVal(headers, key) {
  if (!headers) return "";
  return String(headers[key] || headers[key.toLowerCase()] || "");
}

function throwIfHwidBlocked(headers, status) {
  const flag = (key) => String(headerVal(headers, key)).toLowerCase() === "true";
  if (flag("x-hwid-max-devices-reached") || flag("x-hwid-limit")) {
    throw new Error("Достигнут лимит устройств. Удалите лишнее устройство в личном кабинете.");
  }
  if (status === 404) {
    throw new Error("Панель отклонила запрос (лимит устройств / HWID). Откройте кабинет или обновите подписку.");
  }
}

async function fetchSubscription(url) {
  const hwid = await getDeviceHwid();
  await ensureSubHeaderRules();
  const extraHeaders = {
    "x-hwid": hwid,
    "x-device-os": "Windows",
    "x-ver-os": "10.0",
    "x-device-model": "StarlitVPN",
  };
  const native = await nativeSend({ cmd: "fetch", url, userAgent: SUB_UA, headers: extraHeaders, ...extraHeaders });
  if (native.ok && native.body) {
    throwIfHwidBlocked(native.headers, native.status);
    if (!subscriptionLooksLikeAnnounce(native.body)) {
      return { body: native.body, headers: native.headers || {} };
    }
  }
  if (native.status && !native.missing && native.status !== 200) {
    throwIfHwidBlocked(native.headers, native.status);
    if (!subscriptionLooksLikeAnnounce(native.body || "")) throw new Error(`Подписка HTTP ${native.status}`);
  }

  await ensureSubHeaderRules();
  let res;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": SUB_UA, Accept: "*/*", ...extraHeaders },
    });
  } catch (err) {
    if (native.ok && native.body) throw new Error(announceError(native.body));
    throw new Error(native.missing
      ? `Не удалось скачать подписку (${err.message}). Панель отвечает 502 на запросы браузера — установите native-host.`
      : (native.error || err.message));
  }
  const headers = {
    "subscription-userinfo": res.headers.get("subscription-userinfo") || "",
    "profile-title": res.headers.get("profile-title") || "",
    "profile-update-interval": res.headers.get("profile-update-interval") || "",
    routing: res.headers.get("routing") || res.headers.get("Routing") || "",
    "x-hwid-active": res.headers.get("x-hwid-active") || "",
    "x-hwid-not-supported": res.headers.get("x-hwid-not-supported") || "",
    "x-hwid-max-devices-reached": res.headers.get("x-hwid-max-devices-reached") || "",
    "x-hwid-limit": res.headers.get("x-hwid-limit") || "",
  };
  throwIfHwidBlocked(headers, res.status);
  if (!res.ok) {
    if (native.ok && native.body) throw new Error(announceError(native.body));
    throw new Error(res.status === 502
      ? "Панель подписки отвечает 502 браузеру. Перезапустите браузер после native-host/install.ps1 — запрос пойдёт как у Happ."
      : `Подписка HTTP ${res.status}`);
  }
  const body = await res.text();
  if (subscriptionLooksLikeAnnounce(body)) throw new Error(announceError(body));
  return { body, headers };
}

function parseUserInfo(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function decodeProfileTitle(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^base64:/i.test(raw)) {
    try { return StarlitUri.b64decode(raw.replace(/^base64:/i, "")); } catch { return raw; }
  }
  try { return decodeURIComponent(raw); } catch { return raw; }
}

async function importSubscription(url, name) {
  const normalized = StarlitConfig.normalizeSubscriptionUrl(url);
  const { body, headers } = await fetchSubscription(normalized);
  const info = parseUserInfo(headers["subscription-userinfo"]);
  const title = decodeProfileTitle(headers["profile-title"]);
  const happRouting = StarlitHapp.extractHappRouting(body, headers);
  const state = await loadState();
  let group = state.groups.find((g) => g.url === normalized);
  const allParsed = StarlitUri.parseMany(body).map((n) => ({ ...n, groupId: group?.id || null }));
  const description = extractSubscriptionInfo(body, allParsed);
  const parsed = allParsed.filter((n) => !isInfoCarrierNode(n));
  const extra = {
    name: name || title || group?.name || "Starlit",
    url: normalized,
    updatedAt: Date.now(),
    expire: info.expire ? Number(info.expire) * 1000 : null,
    upload: info.upload ? Number(info.upload) : 0,
    download: info.download ? Number(info.download) : 0,
    total: info.total ? Number(info.total) : 0,
    updateInterval: headers["profile-update-interval"] || "",
    description,
    happRouting: happRouting || null,
    happRoutingName: happRouting?.Name || (happRouting?.off ? "" : ""),
  };
  if (!group) group = { id: crypto.randomUUID(), ...extra };
  else group = { ...group, ...extra };
  const groups = state.groups.filter((g) => g.id !== group.id).concat([group]);
  const oldIds = new Set(state.nodes.filter((n) => n.groupId === group.id).map((n) => n.id));
  const kept = state.nodes.filter((n) => n.groupId !== group.id);
  const withGroup = parsed.map((n) => ({ ...n, groupId: group.id }));
  if (!withGroup.length) throw new Error(announceError(body));
  const selectedId = state.selectedId && oldIds.has(state.selectedId) ? (withGroup[0]?.id || null) : state.selectedId;
  await saveState({ nodes: kept.concat(withGroup), groups, selectedId: selectedId || withGroup[0]?.id || null });
  return { added: withGroup.length, group };
}

async function updateSubscriptions() {
  const state = await loadState();
  const subs = state.groups.filter((g) => {
    try {
      StarlitConfig.normalizeSubscriptionUrl(g.url);
      return true;
    } catch {
      return false;
    }
  });
  const results = [];
  for (const sub of subs) {
    try {
      const r = await importSubscription(sub.url, sub.name);
      results.push({ name: sub.name, ok: true, added: r.added });
    } catch (err) {
      results.push({ name: sub.name, ok: false, error: err.message });
    }
  }
  return results;
}

async function pingNode(id) {
  const state = await loadState();
  const node = state.nodes.find((n) => n.id === id);
  if (!node) throw new Error("Сервер не найден");
  const reply = await nativeSend({ cmd: "ping", host: node.server, port: Number(node.port) });
  const latency = reply.ok ? reply.ms : null;
  const nodes = state.nodes.map((n) => n.id === id ? { ...n, latency } : n);
  await saveState({ nodes });
  return { id, latency, error: reply.ok ? null : reply.error };
}

async function pingAll() {
  const state = await loadState();
  const nodes = state.nodes.slice();
  for (let i = 0; i < nodes.length; i += 1) {
    const reply = await nativeSend({ cmd: "ping", host: nodes[i].server, port: Number(nodes[i].port) });
    nodes[i] = { ...nodes[i], latency: reply.ok ? reply.ms : null };
  }
  await saveState({ nodes });
  return nodes.map((n) => ({ id: n.id, latency: n.latency }));
}

async function probeNative() {
  if (probeNative.cache && Date.now() - probeNative.at < 2500) return probeNative.cache;
  const reply = await nativeSend({ cmd: "status" });
  probeNative.cache = reply;
  probeNative.at = Date.now();
  const state = await loadState();
  const session = { ...state.session, native: !reply.missing, core: reply.core || state.session.core };
  await saveState({ session });
  return reply;
}

const SETUP_FILE = "StarlitVPN-setup.exe";
const SETUP_PAGE = "setup/setup.html";

async function hostExeUrl() {
  const url = ext.runtime.getURL("native/host.exe");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("missing");
  } catch {
    throw new Error("В папке расширения нет native/host.exe. Скачайте StarlitVPN.zip заново.");
  }
  return url;
}

function waitDownload(id) {
  return new Promise((resolve, reject) => {
    if (!ext.downloads?.onChanged) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      ext.downloads.onChanged.removeListener(onChange);
      resolve();
    }, 60000);
    function onChange(delta) {
      if (delta.id !== id) return;
      if (delta.state?.current === "complete") {
        clearTimeout(timer);
        ext.downloads.onChanged.removeListener(onChange);
        resolve();
      }
      if (delta.state?.current === "interrupted") {
        clearTimeout(timer);
        ext.downloads.onChanged.removeListener(onChange);
        reject(new Error("Chrome заблокировал установщик. В загрузках нажмите «Оставить», затем запустите StarlitVPN-setup.exe"));
      }
    }
    ext.downloads.onChanged.addListener(onChange);
  });
}

async function prepareSetupDownload() {
  if (!ext.downloads?.download) throw new Error("Браузер не умеет скачивать установщик");
  const url = await hostExeUrl();
  const id = await ext.downloads.download({
    url,
    filename: SETUP_FILE,
    conflictAction: "uniquify",
    saveAs: false,
  });
  await ext.storage.local.set({ setupDownloadId: id });
  try {
    const found = await ext.downloads.search({ id });
    if (found?.[0]?.state === "complete") return { id, danger: found[0].danger, filename: found[0].filename };
  } catch { /* ignore */ }
  await waitDownload(id);
  const items = await ext.downloads.search({ id });
  const item = items?.[0] || {};
  return { id, danger: item.danger, filename: item.filename };
}

async function waitNative(ms = 120000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const probe = await nativeSend({ cmd: "status" });
    if (probe?.ok && !probe.missing) return probe;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function setupNative() {
  const already = await nativeSend({ cmd: "status" });
  if (already?.ok && !already.missing) {
    nativeSend({ cmd: "ensure_core" }).catch(() => {});
    return already;
  }
  let id = null;
  try {
    const prep = await prepareSetupDownload();
    id = prep.id;
  } catch (err) {
    return { ok: false, error: err.message, missing: true };
  }
  if (ext.downloads?.open && id != null) {
    try { await ext.downloads.open(id); }
    catch {
      try { await ext.downloads.show(id); } catch { /* ignore */ }
    }
  } else if (ext.downloads?.show && id != null) {
    try { await ext.downloads.show(id); } catch { /* ignore */ }
  }
  const probe = await waitNative(120000);
  if (probe) {
    nativeSend({ cmd: "ensure_core" }).catch(() => {});
    return { ok: true, ...probe };
  }
  return {
    ok: false,
    missing: true,
    id,
    error: "Запустите StarlitVPN-setup.exe из загрузок. Если Windows спросит — «Подробнее» → «Выполнить в любом случае». Затем на chrome://extensions нажмите «Обновить».",
  };
}

function versionParts(v) {
  return String(v || "").replace(/^v/i, "").split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
}

function versionNewer(remote, local) {
  const a = versionParts(remote);
  const b = versionParts(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

async function checkUpdate(force) {
  const repo = StarlitConfig.githubRepo;
  if (!repo) return null;
  const now = Date.now();
  const stored = await ext.storage.local.get(["updateCheckedAt", "appUpdate"]);
  if (!force && stored.updateCheckedAt && now - stored.updateCheckedAt < 3 * 3600 * 1000) {
    return stored.appUpdate || null;
  }
  const local = ext.runtime.getManifest().version;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    await ext.storage.local.set({ updateCheckedAt: now });
    if (force) throw new Error("Не удалось проверить обновления");
    return stored.appUpdate || null;
  }
  const data = await res.json();
  const version = String(data.tag_name || data.name || "").replace(/^v/i, "");
  const assets = data.assets || [];
  const want = (StarlitConfig.updateAsset || "StarlitVPN.zip").toLowerCase();
  const asset = assets.find((a) => String(a.name || "").toLowerCase() === want)
    || assets.find((a) => /\.zip$/i.test(a.name || ""));
  const info = versionNewer(version, local) ? {
    version,
    url: asset?.browser_download_url || data.html_url,
    page: data.html_url,
  } : null;
  await ext.storage.local.set({ updateCheckedAt: now, appUpdate: info, remoteVersion: version });
  return info;
}

async function installUpdate() {
  const { appUpdate } = await ext.storage.local.get("appUpdate");
  if (!appUpdate?.url) throw new Error("Нет ссылки на обновление");
  const reply = await nativeSend({ cmd: "self_update", url: appUpdate.url });
  if (reply.missing) throw new Error("Сначала включите StarlitVPN — после этого обновления ставятся сами");
  if (!reply.ok) throw new Error(reply.error || "Не удалось установить обновление");
  await ext.storage.local.set({ appUpdate: null, updateCheckedAt: 0, remoteVersion: ext.runtime.getManifest().version });
  return { ok: true, applied: true, count: reply.count || 0 };
}

let updateJob = null;
function applyUpdateQuietly(info) {
  if (!info?.url || updateJob) return;
  updateJob = (async () => {
    try {
      const res = await installUpdate();
      if (res?.applied) {
        try { ext.runtime.reload(); } catch { /* popup closes */ }
      }
    } catch {
      updateJob = null;
    }
  })();
}

ext.runtime.onInstalled.addListener(() => {
  checkUpdate(true).then((info) => applyUpdateQuietly(info)).catch(() => {});
  if (cachedAutoSites.length && !fullTunnel) installAutoPac().catch(() => {});
});

ext.runtime.onStartup.addListener(async () => {
  const state = await loadState();
  if (state.session.connected && state.session.nodeId && !state.session.autoConnected) {
    try { await connect(state.session.nodeId); }
    catch { await saveState({ session: { ...DEFAULT_STATE.session, error: "Не удалось восстановить соединение" } }); }
    return;
  }
  if (state.settings.autoSitesEnabled !== false && enabledAutoSitesFromSettings(state.settings).length) installAutoPac().catch(() => {});
  try {
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (tab.url) await maybeAutoConnect(tab.url);
    }
  } catch { /* tabs permission */ }
});

try {
  ext.alarms.create("starlit-watch", { periodInMinutes: 1 });
  ext.alarms.create("starlit-update", { periodInMinutes: 360 });
} catch { /* alarms optional */ }
if (ext.alarms?.onAlarm) {
  ext.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "starlit-update") {
      const info = await checkUpdate(true).catch(() => null);
      applyUpdateQuietly(info);
      return;
    }
    if (alarm.name !== "starlit-watch") return;
    const state = await loadState();
    if (state.settings.attachMode) return;
    if (!state.session.connected) return;
    const st = await nativeSend({ cmd: "status" });
    if (st.running) coreWarm = true;
    else {
      coreWarm = false;
      if (state.session.autoConnected) {
        await ensureWarm().catch(() => {});
        return;
      }
      await saveState({ session: { ...state.session, connected: false, error: "Xray остановился" } });
      await clearBrowserProxy();
      autoPacInstalled = false;
      autoPacKey = "";
      fullTunnel = false;
      autoBadgeOn = false;
      await setBadge(false);
      if (cachedAutoSites.length) await installAutoPac();
    }
  });
}

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await loadState();
    switch (msg?.type) {
      case "getState": {
        await ensureSubHeaderRules();
        const storedUa = await ext.storage.local.get(["subUa", "hwidFetch2"]);
        if (storedUa.subUa !== SUB_UA || !storedUa.hwidFetch2) {
          await ext.storage.local.set({ subUa: SUB_UA, hwidFetch2: true });
          try { await updateSubscriptions(); } catch { /* keep current list */ }
        }
        await dropAnnounceNodes();
        const fresh = await loadState();
        fresh.groups = await sanitizeStoredGroups(fresh.groups || []);
        let appUpdate = null;
        try {
          appUpdate = await checkUpdate(true);
        } catch {
          const stored = await ext.storage.local.get("appUpdate");
          appUpdate = stored.appUpdate || null;
        }
        if (appUpdate?.url) applyUpdateQuietly(appUpdate);
        return { ...fresh, nativeProbe: await probeNative(), appUpdate: appUpdate || null, updating: !!updateJob };
      }
      case "checkUpdate": {
        const local = ext.runtime.getManifest().version;
        const update = await checkUpdate(true);
        const stored = await ext.storage.local.get("remoteVersion");
        if (update?.url) applyUpdateQuietly(update);
        return { ok: true, local, remote: stored.remoteVersion || update?.version || null, update, installing: !!update };
      }
      case "installUpdate": {
        const res = await installUpdate();
        if (res?.applied) {
          setTimeout(() => { try { ext.runtime.reload(); } catch { /* ignore */ } }, 400);
        }
        return res;
      }
      case "select":
        await saveState({ selectedId: msg.id });
        return { ok: true };
      case "connect":
        return { ok: true, session: await connect(msg.id) };
      case "disconnect":
        return { ok: true, session: await disconnect() };
      case "addAutoSite":
        return { ok: true, ...(await addAutoSite(msg.site)) };
      case "removeAutoSite":
        return { ok: true, ...(await removeAutoSite(msg.site)) };
      case "toggleAutoSite":
        return { ok: true, ...(await toggleAutoSite(msg.site, msg.enabled)) };
      case "importText":
        return { ok: true, ...(await importText(msg.text, msg.groupId, msg.groupName)) };
      case "importSubscription":
        return { ok: true, ...(await importSubscription(msg.url, msg.name)) };
      case "updateSubscriptions":
        return { ok: true, results: await updateSubscriptions() };
      case "deleteNode": {
        const nodes = state.nodes.filter((n) => n.id !== msg.id);
        const selectedId = state.selectedId === msg.id ? (nodes[0]?.id || null) : state.selectedId;
        await saveState({ nodes, selectedId });
        return { ok: true };
      }
      case "deleteGroup": {
        const groups = state.groups.filter((g) => g.id !== msg.id);
        const nodes = state.nodes.filter((n) => n.groupId !== msg.id);
        await saveState({ groups, nodes });
        return { ok: true };
      }
      case "saveSettings":
        await saveState({ settings: { ...state.settings, ...msg.settings } });
        await loadState();
        if (!fullTunnel) {
          if (cachedAutoSitesEnabled && cachedEnabledAutoSites.length) {
            installAutoPac().catch(() => {});
          } else {
            autoPacInstalled = false;
            autoPacKey = "";
            clearBrowserProxy().catch(() => {});
            markAutoBadge(false);
          }
        }
        return { ok: true };
      case "pingNode":
        return { ok: true, ...(await pingNode(msg.id)) };
      case "pingAll":
        return { ok: true, results: await pingAll() };
      case "ensureCore":
        return nativeSend({ cmd: "ensure_core" });
      case "setupNative":
        return setupNative();
      case "prepareSetup":
        return { ok: true, ...(await prepareSetupDownload()) };
      case "waitNative":
        return { ok: true, native: await waitNative(Number(msg.ms) || 120000) };
      case "openSetupPage": {
        const url = ext.runtime.getURL(SETUP_PAGE);
        if (ext.tabs?.create) await ext.tabs.create({ url });
        return { ok: true, url };
      }
      case "openOptions":
        if (ext.runtime.openOptionsPage) await ext.runtime.openOptionsPage();
        return { ok: true };
      default:
        throw new Error("Unknown message");
    }
  })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

if (ext.webNavigation?.onBeforeNavigate) {
  ext.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    maybeAutoConnect(details.url);
    if (!urlMatchesSites(details.url, cachedEnabledAutoSites)) scheduleAutoDisconnect();
  });
}
if (ext.tabs?.onUpdated) {
  ext.tabs.onUpdated.addListener((_id, info) => {
    if (!info.url) return;
    maybeAutoConnect(info.url);
    if (!urlMatchesSites(info.url, cachedEnabledAutoSites)) scheduleAutoDisconnect();
  });
}
if (ext.tabs?.onRemoved) {
  ext.tabs.onRemoved.addListener(() => { maybeAutoDisconnect().catch(() => {}); });
}

ext.storage.local.get(["settings", "session"], (stored) => {
  const settings = stored?.settings || {};
  cachedAutoSites = settings.autoSites || [];
  cachedSocksPort = Number(settings.socksPort || 10808);
  cachedAttachHost = settings.attachHost || "127.0.0.1";
  cachedAttachPort = Number(settings.attachPort || 10808);
  cachedAttachMode = !!settings.attachMode;
  cachedAutoSitesEnabled = settings.autoSitesEnabled !== false;
  cachedEnabledAutoSites = enabledAutoSitesFromSettings(settings);
  if (stored?.session?.connected && !stored.session.autoConnected) fullTunnel = true;
  autoBadgeOn = !!(stored?.session?.connected);
  if (cachedAutoSitesEnabled && cachedEnabledAutoSites.length && !fullTunnel) installAutoPac().catch(() => {});
});
