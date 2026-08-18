if (typeof importScripts === "function") {
  importScripts("../lib/browser.js", "../lib/uri.js", "../lib/xray-config.js", "../lib/config.js");
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
  },
  session: {
    connected: false,
    connecting: false,
    nodeId: null,
    connectedAt: null,
    error: "",
    native: null,
    core: null,
  },
};

let firefoxProxyHandler = null;

async function loadState() {
  const stored = await ext.storage.local.get(["nodes", "groups", "selectedId", "settings", "session"]);
  return {
    nodes: stored.nodes || [],
    groups: stored.groups || [],
    selectedId: stored.selectedId || null,
    settings: { ...DEFAULT_STATE.settings, ...(stored.settings || {}) },
    session: { ...DEFAULT_STATE.session, ...(stored.session || {}) },
  };
}

async function saveState(patch) {
  await ext.storage.local.set(patch);
}

async function nativeSend(message) {
  try {
    const reply = await ext.runtime.sendNativeMessage(NATIVE_HOST, message);
    return reply || { ok: false, error: "empty native reply" };
  } catch (err) {
    return { ok: false, error: err.message || String(err), missing: true };
  }
}

function firefoxLike() {
  return typeof browser !== "undefined" && browser.proxy && browser.proxy.onRequest;
}

async function applyBrowserProxy(port, host = "127.0.0.1") {
  if (firefoxLike()) {
    if (firefoxProxyHandler) {
      try { browser.proxy.onRequest.removeListener(firefoxProxyHandler); } catch { /* ignore */ }
    }
    firefoxProxyHandler = () => ({
      type: "socks",
      host,
      port: Number(port),
      proxyDNS: true,
    });
    browser.proxy.onRequest.addListener(firefoxProxyHandler, { urls: ["<all_urls>"] });
    return;
  }

  const pac = StarlitXray.buildPac(port);
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

async function connect(nodeId) {
  const state = await loadState();
  const node = state.nodes.find((n) => n.id === nodeId) || state.nodes.find((n) => n.id === state.selectedId);
  if (!node) throw new Error("Выберите сервер");

  await saveState({
    selectedId: node.id,
    session: { ...state.session, connecting: true, error: "", nodeId: node.id },
  });

  const port = state.settings.attachMode ? Number(state.settings.attachPort) : Number(state.settings.socksPort);
  const host = state.settings.attachMode ? state.settings.attachHost : "127.0.0.1";

  try {
    if (!state.settings.attachMode) {
      const config = StarlitXray.buildConfig(node, state.settings);
      const started = await nativeSend({ cmd: "start", config, configText: JSON.stringify(config), port });
      if (!started.ok) {
        throw new Error(started.missing
          ? "Нажмите «Включить StarlitVPN» в окне расширения"
          : (started.error || "Не удалось запустить Xray"));
      }
      await saveState({ session: { ...(await loadState()).session, core: started.core || null, native: true } });
    }

    await applyBrowserProxy(port, host);
    const session = {
      connected: true,
      connecting: false,
      nodeId: node.id,
      connectedAt: Date.now(),
      error: "",
      native: !state.settings.attachMode,
      core: (await loadState()).session.core,
    };
    await saveState({ session });
    await setBadge(true);
    return session;
  } catch (err) {
    await clearBrowserProxy();
    const session = { ...DEFAULT_STATE.session, error: err.message || String(err) };
    await saveState({ session });
    await setBadge(false);
    throw err;
  }
}

async function disconnect() {
  const state = await loadState();
  await clearBrowserProxy();
  if (!state.settings.attachMode) {
    await nativeSend({ cmd: "stop" });
  }
  const session = { ...DEFAULT_STATE.session, native: state.session.native, core: state.session.core };
  await saveState({ session });
  await setBadge(false);
  return session;
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
  const incoming = nodes.map((n) => ({ ...n, groupId: gid || n.groupId || null }));
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

const SUB_UA = "Happ/3.4.0/windows";

async function fetchSubscription(url) {
  const native = await nativeSend({ cmd: "fetch", url, userAgent: SUB_UA });
  if (native.ok && native.body) {
    return { body: native.body, headers: native.headers || {} };
  }
  if (native.status && !native.missing) {
    throw new Error(`Подписка HTTP ${native.status}`);
  }

  let res;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": SUB_UA, Accept: "*/*" },
    });
  } catch (err) {
    throw new Error(native.missing
      ? `Не удалось скачать подписку (${err.message}). Панель отвечает 502 на запросы браузера — установите native-host.`
      : (native.error || err.message));
  }
  if (!res.ok) {
    throw new Error(res.status === 502
      ? "Панель подписки отвечает 502 браузеру. Перезапустите браузер после native-host/install.ps1 — запрос пойдёт как у Happ."
      : `Подписка HTTP ${res.status}`);
  }
  return {
    body: await res.text(),
    headers: {
      "subscription-userinfo": res.headers.get("subscription-userinfo") || "",
      "profile-title": res.headers.get("profile-title") || "",
      "profile-update-interval": res.headers.get("profile-update-interval") || "",
    },
  };
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
  const state = await loadState();
  let group = state.groups.find((g) => g.url === normalized);
  const extra = {
    name: name || title || group?.name || "Starlit",
    url: normalized,
    updatedAt: Date.now(),
    expire: info.expire ? Number(info.expire) * 1000 : null,
    upload: info.upload ? Number(info.upload) : 0,
    download: info.download ? Number(info.download) : 0,
    total: info.total ? Number(info.total) : 0,
    updateInterval: headers["profile-update-interval"] || "",
  };
  if (!group) group = { id: crypto.randomUUID(), ...extra };
  else group = { ...group, ...extra };
  const groups = state.groups.filter((g) => g.id !== group.id).concat([group]);
  const oldIds = new Set(state.nodes.filter((n) => n.groupId === group.id).map((n) => n.id));
  const kept = state.nodes.filter((n) => n.groupId !== group.id);
  const parsed = StarlitUri.parseMany(body).map((n) => ({ ...n, groupId: group.id }));
  const selectedId = state.selectedId && oldIds.has(state.selectedId) ? (parsed[0]?.id || null) : state.selectedId;
  await saveState({ nodes: kept.concat(parsed), groups, selectedId: selectedId || parsed[0]?.id || null });
  return { added: parsed.length, group };
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
  const reply = await nativeSend({ cmd: "status" });
  const state = await loadState();
  const session = { ...state.session, native: !reply.missing, core: reply.core || state.session.core };
  await saveState({ session });
  return reply;
}

const SETUP_FILE = "StarlitVPN-setup.exe";

function waitDownload(id) {
  return new Promise((resolve, reject) => {
    if (!ext.downloads?.onChanged) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      ext.downloads.onChanged.removeListener(onChange);
      resolve();
    }, 20000);
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
        reject(new Error("Не удалось сохранить установщик"));
      }
    }
    ext.downloads.onChanged.addListener(onChange);
  });
}

async function prepareSetupDownload() {
  if (!ext.downloads?.download) throw new Error("Браузер не умеет скачивать установщик");
  const id = await ext.downloads.download({
    url: ext.runtime.getURL("native/host.exe"),
    filename: SETUP_FILE,
    conflictAction: "overwrite",
    saveAs: false,
  });
  await ext.storage.local.set({ setupDownloadId: id });
  try {
    const found = await ext.downloads.search({ id });
    if (found?.[0]?.state === "complete") return id;
  } catch { /* ignore */ }
  await waitDownload(id);
  return id;
}

async function setupNative() {
  const already = await nativeSend({ cmd: "status" });
  if (already?.ok && !already.missing) return already;
  const id = await prepareSetupDownload();
  if (ext.downloads?.open) {
    try { await ext.downloads.open(id); }
    catch {
      try { await ext.downloads.show(id); } catch { /* ignore */ }
    }
  }
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const probe = await nativeSend({ cmd: "status" });
    if (probe?.ok && !probe.missing) return { ok: true, ...probe };
  }
  return { ok: false, error: "Запустите StarlitVPN-setup.exe из загрузок, если Windows его скачал.", missing: true };
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
  await ext.storage.local.set({ updateCheckedAt: now, appUpdate: info });
  return info;
}

async function installUpdate() {
  const { appUpdate } = await ext.storage.local.get("appUpdate");
  if (!appUpdate?.url) throw new Error("Нет ссылки на обновление");
  if (!ext.downloads?.download) throw new Error("Скачивание недоступно");
  const id = await ext.downloads.download({
    url: appUpdate.url,
    filename: StarlitConfig.updateAsset || "StarlitVPN.zip",
    conflictAction: "uniquify",
    saveAs: false,
  });
  return { ok: true, id, url: appUpdate.url };
}

ext.runtime.onInstalled.addListener(() => {
  probeNative().then((p) => {
    if (p?.missing) prepareSetupDownload().catch(() => {});
  }).catch(() => {});
  checkUpdate(true).catch(() => {});
});

ext.runtime.onStartup.addListener(async () => {
  const state = await loadState();
  if (state.session.connected && state.session.nodeId) {
    try { await connect(state.session.nodeId); }
    catch { await saveState({ session: { ...DEFAULT_STATE.session, error: "Не удалось восстановить соединение" } }); }
  }
});

try {
  ext.alarms.create("starlit-watch", { periodInMinutes: 1 });
  ext.alarms.create("starlit-update", { periodInMinutes: 360 });
} catch { /* alarms optional */ }
if (ext.alarms?.onAlarm) {
  ext.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "starlit-update") {
      await checkUpdate(true).catch(() => {});
      return;
    }
    if (alarm.name !== "starlit-watch") return;
    const state = await loadState();
    if (!state.session.connected || state.settings.attachMode) return;
    const st = await nativeSend({ cmd: "status" });
    if (st.missing || st.running === false) {
      await saveState({ session: { ...state.session, connected: false, error: "Xray остановился" } });
      await clearBrowserProxy();
      await setBadge(false);
    }
  });
}

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await loadState();
    switch (msg?.type) {
      case "getState": {
        const { appUpdate } = await ext.storage.local.get("appUpdate");
        checkUpdate(false).catch(() => {});
        return { ...state, nativeProbe: await probeNative(), appUpdate: appUpdate || null };
      }
      case "installUpdate":
        return installUpdate();
      case "select":
        await saveState({ selectedId: msg.id });
        return { ok: true };
      case "connect":
        return { ok: true, session: await connect(msg.id) };
      case "disconnect":
        return { ok: true, session: await disconnect() };
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
        return { ok: true, id: await prepareSetupDownload() };
      case "openOptions":
        if (ext.runtime.openOptionsPage) await ext.runtime.openOptionsPage();
        return { ok: true };
      default:
        throw new Error("Unknown message");
    }
  })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});
