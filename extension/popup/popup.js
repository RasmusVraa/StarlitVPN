const $ = (id) => document.getElementById(id);
function on(id, type, handler) {
  $(id)?.addEventListener(type, handler);
}
function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}
const views = {
  servers: { title: "servers", el: "view-servers", nav: "nav-servers" },
  import: { title: "importTitle", el: "view-import", nav: "btn-add" },
  settings: { title: "settings", el: "view-settings", nav: "btn-settings" },
};

function send(type, payload = {}) {
  return ext.runtime.sendMessage({ type, ...payload });
}

function openCabinet(e) {
  if (e) e.preventDefault();
  const url = StarlitConfig.cabinet;
  if (ext?.tabs?.create) ext.tabs.create({ url });
  else window.open(url, "_blank", "noopener");
}

function wireCabinetLinks() {
  document.querySelectorAll("a[href*='cabinet.starlit-moon.ru'], #rail-cabinet").forEach((a) => {
    a.href = StarlitConfig.cabinet;
    if (a.dataset.wired === "1") return;
    a.dataset.wired = "1";
    a.addEventListener("click", openCabinet);
  });
}

function applyI18n(lang) {
  const loc = StarlitI18n.locale(lang);
  setText("empty-text", StarlitI18n.t(loc, "noServers"));
  const search = $("search");
  if (search) search.placeholder = StarlitI18n.t(loc, "searchPlaceholder");
  const importUrl = $("import-url");
  if (importUrl) importUrl.placeholder = StarlitI18n.t(loc, "subUrl");
  const importName = $("import-name");
  if (importName) importName.placeholder = StarlitI18n.t(loc, "subName");
  const navServers = $("nav-servers");
  if (navServers) navServers.title = StarlitI18n.t(loc, "servers");
  const btnAdd = $("btn-add");
  if (btnAdd) btnAdd.title = StarlitI18n.t(loc, "add");
  const btnSettings = $("btn-settings");
  if (btnSettings) btnSettings.title = StarlitI18n.t(loc, "settings");
  const btnSubs = $("btn-subs");
  if (btnSubs) btnSubs.title = StarlitI18n.t(loc, "updateSubs");
  const btnPing = $("btn-ping");
  if (btnPing) btnPing.title = StarlitI18n.t(loc, "ping");
  setText("empty-add", StarlitI18n.t(loc, "add"));
  const cabinet = StarlitI18n.t(loc, "cabinet");
  const rail = $("rail-cabinet");
  if (rail) rail.title = cabinet;
  document.querySelectorAll(".cabinet-btn span:not(.ico)").forEach((el) => {
    el.textContent = cabinet;
  });
  setText("setup-text", StarlitI18n.t(loc, setupBusy ? "setupWait" : "setupText"));
  setText("btn-setup", StarlitI18n.t(loc, "setupTitle"));
  setText("setup-hint", StarlitI18n.t(loc, "setupHint"));
  setText("btn-check-update-label", StarlitI18n.t(loc, "updateCheck"));
  setText("auto-sites-title", StarlitI18n.t(loc, "autoSites"));
  setText("auto-sites-hint", StarlitI18n.t(loc, "autoSitesHint"));
  setText("btn-add-site", StarlitI18n.t(loc, "autoSiteAdd"));
  const autoSite = $("auto-site");
  if (autoSite) autoSite.placeholder = StarlitI18n.t(loc, "autoSitePlaceholder");
  const ver = ext.runtime.getManifest?.().version;
  if (ver) setText("app-version", StarlitI18n.t(loc, "appVersion").replace("{v}", ver));
  return loc;
}

function fmtUptime(ts) {
  if (!ts) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function bytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(0)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(v / 1024)} KB`;
}

function techLine(node) {
  const outbound = (node.fullConfig?.outbounds || []).find((o) => o.protocol && o.protocol !== "freedom" && o.protocol !== "blackhole");
  const stream = outbound?.streamSettings || {};
  let proto = String(node.protocol || outbound?.protocol || "").toUpperCase();
  if (proto === "SHADOWSOCKS") proto = "SS";
  if (proto === "HYSTERIA" || proto === "HYSTERIA2") proto = "HYSTERIA2";
  let net = (node.network || stream.network || "tcp").toUpperCase();
  if (net === "HYSTERIA") net = "UDP";
  let sec = (node.security || stream.security || "").toUpperCase();
  const parts = [proto, net];
  if (sec && sec !== "NONE") parts.push(sec);
  if (node.fullConfig) parts.push("JSON");
  return parts.filter(Boolean).join(" / ");
}

function subscriptionInput() {
  return ($("import-url")?.value || "").trim();
}

let state = null;
let loc = "ru";
let toastTimer = 0;
let listSignature = "";
let currentView = "servers";

function setView(name) {
  if (!views[name]) return;
  currentView = name;
  Object.entries(views).forEach(([key, view]) => {
    $(view.el)?.classList.toggle("on", key === name);
    $(view.nav)?.classList.toggle("active", key === name);
  });
  setText("view-title", StarlitI18n.t(loc, views[name].title));
  layoutChrome();
  if (name === "import") {
    const err = $("sheet-error");
    if (err) err.hidden = true;
    const save = $("btn-save");
    if (save) save.disabled = false;
    $("import-url")?.focus();
  }
  if (name === "settings") fillSettings();
}

function layoutChrome() {
  const hasAny = !!(state?.nodes?.length);
  const emptyServers = currentView === "servers" && !hasAny;
  const hero = $("hero");
  if (hero) hero.hidden = emptyServers;
  const ping = $("btn-ping");
  const subs = $("btn-subs");
  if (ping) ping.hidden = currentView !== "servers" || !hasAny;
  if (subs) subs.hidden = currentView !== "servers" || !hasAny;
}

function renderUpdate() {
  const bar = $("update-bar");
  if (!bar) return;
  const info = state?.appUpdate;
  const updating = !!state?.updating;
  if (!info?.version && !updating) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  if (updating) {
    setText("update-text", StarlitI18n.t(loc, "updateInstalling").replace("{v}", info?.version || ""));
    const btn = $("btn-update");
    if (btn) btn.hidden = true;
    return;
  }
  setText("update-text", StarlitI18n.t(loc, "updateAvailable").replace("{v}", info.version));
  setText("btn-update", StarlitI18n.t(loc, "updateNow"));
  const btn = $("btn-update");
  if (btn) btn.hidden = false;
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function renderStatus() {
  if (!state) return;
  const selected = state.nodes.find((n) => n.id === state.selectedId);
  const connected = !!state.session?.connected;
  const busy = !!state.session?.connecting;
  const status = $("status-label");
  if (status) {
    status.className = "status" + (connected ? " on" : busy ? " busy" : "");
    status.textContent = busy
      ? StarlitI18n.t(loc, "connecting")
      : connected
        ? StarlitI18n.t(loc, "connected")
        : StarlitI18n.t(loc, "disconnected");
  }
  $("btn-power")?.classList.toggle("on", connected);
  $("btn-power")?.classList.toggle("busy", busy);
  const power = $("btn-power");
  if (power) power.setAttribute("aria-label", connected ? StarlitI18n.t(loc, "disconnect") : StarlitI18n.t(loc, "connect"));
  setText("power-hint", busy
    ? StarlitI18n.t(loc, "connecting")
    : connected
      ? StarlitI18n.t(loc, "tapPowerOff")
      : StarlitI18n.t(loc, "tapPowerOn"));
  const extra = [];
  if (connected && state.session?.connectedAt) extra.push(fmtUptime(state.session.connectedAt));
  if (selected?.latency != null) extra.push(`${selected.latency}ms`);
  setText("current-name", state.session?.error
    ? state.session.error
    : selected
      ? `${StarlitFlags.stripFlagEmoji(selected.name)}${extra.length ? " · " + extra.join(" · ") : ""}`
      : StarlitI18n.t(loc, "notSelected"));
  const dockFlag = $("dock-flag");
  if (!dockFlag) return;
  if (selected && !state.session?.error) {
    dockFlag.hidden = false;
    dockFlag.classList.add("flag");
    dockFlag.innerHTML = StarlitFlags.svg(StarlitFlags.countryCode(selected));
  } else {
    dockFlag.hidden = true;
    dockFlag.innerHTML = "";
  }
}

function renderGroups() {
  const box = $("groups");
  if (!box) return;
  const groups = (state.groups || []).filter((g) => g.url);
  box.innerHTML = groups.map((g) => {
    const used = (g.upload || 0) + (g.download || 0);
    const total = g.total || 0;
    const usage = total ? `${bytes(used)} / ${bytes(total)}` : "";
    return `<article class="sub">
      <p class="sub-name">${escapeHtml(g.name)}</p>
      <p class="sub-usage">${escapeHtml(usage)}</p>
    </article>`;
  }).join("");
}

function renderList() {
  if (!state) return;
  const q = ($("search")?.value || "").trim().toLowerCase();
  const hasAny = state.nodes.length > 0;
  const nodes = state.nodes.filter((n) => !q || `${n.name} ${StarlitFlags.stripFlagEmoji(n.name)} ${techLine(n)}`.toLowerCase().includes(q));
  const signature = nodes.map((n) => `${n.id}:${n.latency ?? ""}:${n.id === state.selectedId ? 1 : 0}`).join("|") + q + (state.groups || []).length;
  if (signature === listSignature) return;
  listSignature = signature;
  renderGroups();
  const empty = $("empty");
  if (empty) empty.hidden = hasAny;
  const searchBar = $("search-bar");
  if (searchBar) searchBar.hidden = !hasAny;
  const groups = $("groups");
  if (groups) groups.hidden = !hasAny;
  const list = $("server-list");
  if (!list) return;
  list.hidden = !hasAny;
  list.innerHTML = nodes.map((n) => `
    <li class="item ${n.id === state.selectedId ? "active" : ""}" data-id="${n.id}">
      ${StarlitFlags.markup(n)}
      <div class="item-body">
        <div class="name">${escapeHtml(StarlitFlags.stripFlagEmoji(n.name))}</div>
        <div class="subline">${escapeHtml(techLine(n))}</div>
      </div>
      <span class="lat ${n.latency != null ? "pop " + latClass(n.latency) : "na"}">${n.latency != null ? n.latency + "ms" : ""}</span>
    </li>
  `).join("");
}

function renderAutoSites() {
  const list = $("auto-site-list");
  if (!list) return;
  const sites = state?.settings?.autoSites || [];
  const siteStates = state?.settings?.autoSiteStates || {};
  const enabled = state?.settings?.autoSitesEnabled !== false;
  const toggle = $("auto-sites-toggle");
  if (toggle) {
    toggle.textContent = enabled ? "AUTO ON" : "AUTO OFF";
    toggle.classList.toggle("off", !enabled);
  }
  setText("auto-sites-count", String(sites.length));
  if (!sites.length) {
    list.innerHTML = `<li class="site-empty">${escapeHtml(StarlitI18n.t(loc, "autoSiteEmpty"))}</li>`;
    return;
  }
  list.innerHTML = sites.map((site) => `
    <li class="site-item">
      <span>${escapeHtml(site)}</span>
      <div class="site-actions">
        <button type="button" class="site-state ${enabled && siteStates[site] !== false ? "on" : "off"}" data-site="${escapeHtml(site)}">${enabled && siteStates[site] !== false ? "ON" : "OFF"}</button>
        <button type="button" class="site-remove" data-site="${escapeHtml(site)}" title="${escapeHtml(StarlitI18n.t(loc, "delete"))}">✕</button>
      </div>
    </li>
  `).join("");
}

async function addAutoSiteFromInput() {
  const input = $("auto-site");
  const err = $("auto-site-error");
  if (err) err.hidden = true;
  try {
    const res = await send("addAutoSite", { site: (input?.value || "").trim() });
    if (res?.error) throw new Error(res.error);
    if (input) input.value = "";
    if (state) state.settings = {
      ...(state.settings || {}),
      autoSites: res.autoSites || [],
      autoSiteStates: res.autoSiteStates || {},
    };
    renderAutoSites();
    showToast(StarlitI18n.t(loc, "saved"));
  } catch (e) {
    if (err) {
      err.hidden = false;
      err.textContent = e.message || StarlitI18n.t(loc, "autoSiteBad");
    } else {
      showToast(e.message || StarlitI18n.t(loc, "autoSiteBad"));
    }
  }
}

on("btn-add-site", "click", () => addAutoSiteFromInput());
on("auto-site", "keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addAutoSiteFromInput();
  }
});
on("auto-site-list", "click", async (e) => {
  const stateBtn = e.target.closest(".site-state");
  if (stateBtn) {
    const site = stateBtn.dataset.site;
    const siteStates = state?.settings?.autoSiteStates || {};
    const isOn = (state?.settings?.autoSitesEnabled !== false) && siteStates[site] !== false;
    const res = await send("toggleAutoSite", { site, enabled: !isOn });
    if (res?.error) {
      showToast(res.error);
      return;
    }
    if (state) state.settings = { ...(state.settings || {}), autoSiteStates: res.autoSiteStates || {} };
    renderAutoSites();
    return;
  }
  const btn = e.target.closest(".site-remove");
  if (!btn) return;
  const res = await send("removeAutoSite", { site: btn.dataset.site });
  if (res?.error) {
    showToast(res.error);
    return;
  }
  if (state) state.settings = {
    ...(state.settings || {}),
    autoSites: res.autoSites || [],
    autoSiteStates: res.autoSiteStates || {},
  };
  renderAutoSites();
});
on("auto-sites-toggle", "click", async () => {
  const current = state?.settings?.autoSitesEnabled !== false;
  const next = !current;
  await send("saveSettings", { settings: { autoSitesEnabled: next } });
  if (state) state.settings = { ...(state.settings || {}), autoSitesEnabled: next };
  renderAutoSites();
  showToast(StarlitI18n.t(loc, "saved"));
});

function fillSettings() {
  if (!state) return;
  const s = state.settings || {};
  const attachMode = $("attachMode");
  if (attachMode) attachMode.checked = !!s.attachMode;
  const attachHost = $("attachHost");
  if (attachHost) attachHost.value = s.attachHost || "127.0.0.1";
  const attachPort = $("attachPort");
  if (attachPort) attachPort.value = s.attachPort || 10808;
  const socksPort = $("socksPort");
  if (socksPort) socksPort.value = s.socksPort || 10808;
  const routing = $("routing");
  if (routing) routing.value = s.routing || "bypass-private";
  const language = $("language");
  if (language) language.value = s.language || "auto";
  renderAutoSites();
  const probe = state.nativeProbe;
  setText("core-status", !probe || probe.missing
    ? StarlitI18n.t(loc, "nativeFail")
    : probe.core?.version || StarlitI18n.t(loc, "nativeOk"));
}

function render() {
  if (!state) return;
  loc = applyI18n(state.settings?.language);
  setText("view-title", StarlitI18n.t(loc, views[currentView].title));
  renderStatus();
  renderList();
  layoutChrome();
  renderUpdate();
  renderSetup();
  if (currentView === "settings") fillSettings();
}

function needsSetup() {
  return !!(state?.nativeProbe?.missing && !state?.settings?.attachMode);
}

function renderSetup() {
  const el = $("setup");
  if (!el) return;
  el.hidden = !needsSetup();
}

let setupBusy = false;

async function pollSetup() {
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    await refresh();
    if (!needsSetup()) return;
  }
  setText("setup-text", StarlitI18n.t(loc, "setupFail"));
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function refresh() {
  try {
    const next = await send("getState");
    if (next?.error && !next.nodes) return;
    state = next;
    render();
  } catch (err) {
    showToast(err.message || String(err));
  }
}

on("nav-servers", "click", () => setView("servers"));
on("location-card", "click", () => setView("servers"));
on("btn-add", "click", () => setView("import"));
on("empty-add", "click", () => setView("import"));
on("btn-settings", "click", () => setView("settings"));
on("btn-cancel", "click", () => setView("servers"));

on("btn-power", "click", async () => {
  try {
    const res = (state?.session?.connected || state?.session?.connecting)
      ? await send("disconnect")
      : await send("connect", { id: state.selectedId });
    if (res?.error) throw new Error(res.error);
  } catch (err) {
    showToast(err.message);
  }
  await refresh();
});

on("server-list", "click", async (e) => {
  const item = e.target.closest(".item");
  if (!item) return;
  await send("select", { id: item.dataset.id });
  await refresh();
});

on("btn-save", "click", async () => {
  const saveBtn = $("btn-save");
  if (saveBtn) saveBtn.disabled = true;
  const sheetError = $("sheet-error");
  if (sheetError) sheetError.hidden = true;
  try {
    const url = StarlitConfig.normalizeSubscriptionUrl(subscriptionInput());
    const res = await send("importSubscription", { url, name: ($("import-name")?.value || "").trim() });
    if (res?.error) throw new Error(res.error);
    const importUrl = $("import-url");
    if (importUrl) importUrl.value = "";
    const importName = $("import-name");
    if (importName) importName.value = "";
    listSignature = "";
    await refresh();
    setView("servers");
    showToast(StarlitI18n.t(loc, "imported").replace("{n}", String(res.added || 0)));
  } catch (err) {
    if (sheetError) {
      sheetError.hidden = false;
      sheetError.textContent = err.message;
    }
    if (saveBtn) saveBtn.disabled = false;
  }
});

on("btn-save-settings", "click", async () => {
  await send("saveSettings", {
    settings: {
      attachMode: !!$("attachMode")?.checked,
      attachHost: ($("attachHost")?.value || "").trim() || "127.0.0.1",
      attachPort: Number($("attachPort")?.value) || 10808,
      socksPort: Number($("socksPort")?.value) || 10808,
      httpPort: (Number($("socksPort")?.value) || 10808) + 1,
      routing: $("routing")?.value || "bypass-private",
      language: $("language")?.value || "auto",
      autoSitesEnabled: state?.settings?.autoSitesEnabled !== false,
    },
  });
  await refresh();
  showToast(StarlitI18n.t(loc, "saved"));
});

on("btn-core", "click", async () => {
  setText("core-status", "…");
  const res = await send("ensureCore");
  setText("core-status", res?.error || res?.core?.version || StarlitI18n.t(loc, "nativeOk"));
});
on("btn-check-update", "click", async () => {
  const btn = $("btn-check-update");
  if (btn) btn.disabled = true;
  setText("btn-check-update-label", StarlitI18n.t(loc, "updateChecking"));
  setText("update-status", StarlitI18n.t(loc, "updateChecking"));
  try {
    const res = await send("checkUpdate");
    if (res?.error) throw new Error(res.error);
    await refresh();
    if (res?.update?.version || res?.installing) {
      setText("update-status", StarlitI18n.t(loc, "updateInstalling").replace("{v}", res.update?.version || ""));
      showToast(StarlitI18n.t(loc, "updateInstalling").replace("{v}", res.update?.version || ""));
    } else {
      setText("update-status", StarlitI18n.t(loc, "updateLatest").replace("{v}", res?.local || ext.runtime.getManifest().version));
      showToast(StarlitI18n.t(loc, "updateLatest").replace("{v}", res?.local || ext.runtime.getManifest().version));
    }
  } catch (err) {
    const msg = err.message || StarlitI18n.t(loc, "updateCheckFail");
    setText("update-status", msg);
    showToast(msg);
  }
  setText("btn-check-update-label", StarlitI18n.t(loc, "updateCheck"));
  if (btn) btn.disabled = false;
});
function latClass(ms) {
  if (ms == null) return "na";
  if (ms < 80) return "";
  if (ms < 160) return "mid";
  return "slow";
}

function setLat(el, ms) {
  if (!el) return;
  el.className = "lat pop " + latClass(ms);
  el.innerHTML = ms != null ? `${ms}ms` : "—";
}

on("btn-ping", "click", async () => {
  const btn = $("btn-ping");
  if (!btn || btn.classList.contains("busy") || !state?.nodes.length) return;
  btn.classList.add("busy");
  btn.disabled = true;
  const items = [...document.querySelectorAll("#server-list .item")];
  for (const item of items) {
    item.classList.add("pinging");
    const lat = item.querySelector(".lat");
    if (lat) lat.innerHTML = '<span class="lat-scan"></span>';
    const res = await send("pingNode", { id: item.dataset.id });
    item.classList.remove("pinging");
    setLat(lat, res?.latency);
    if (state) {
      const node = state.nodes.find((n) => n.id === item.dataset.id);
      if (node) node.latency = res?.latency ?? null;
    }
  }
  btn.classList.remove("busy");
  btn.disabled = false;
  renderStatus();
});
on("btn-subs", "click", async () => {
  const btn = $("btn-subs");
  if (!btn || btn.classList.contains("busy")) return;
  btn.classList.add("busy");
  btn.disabled = true;
  document.querySelectorAll(".sub").forEach((el) => el.classList.add("updating"));
  await send("updateSubscriptions");
  listSignature = "";
  await refresh();
  btn.classList.remove("busy");
  btn.disabled = false;
  showToast(StarlitI18n.t(loc, "updateSubs"));
});
on("search", "input", () => { listSignature = ""; renderList(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentView !== "servers") setView("servers");
});

on("btn-update", "click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const url = state?.appUpdate?.url;
  if (!url) return;
  try {
    const res = await send("installUpdate");
    if (res?.error) throw new Error(res.error);
    showToast(StarlitI18n.t(loc, "updateInstalling").replace("{v}", state.appUpdate?.version || ""));
  } catch (err) {
    if (ext?.tabs?.create) ext.tabs.create({ url: state.appUpdate.page || url });
    else window.open(state.appUpdate.page || url, "_blank", "noopener");
  }
});

on("btn-setup", "click", async () => {
  setupBusy = true;
  setText("setup-text", StarlitI18n.t(loc, "setupWait"));
  const btn = $("btn-setup");
  if (btn) btn.disabled = true;
  try {
    const url = ext.runtime.getURL("setup/setup.html");
    if (ext.tabs?.create) await ext.tabs.create({ url });
    else window.open(url, "_blank", "noopener");
  } catch {
    send("setupNative").catch(() => {});
  }
  pollSetup().finally(() => {
    setupBusy = false;
    if (btn) btn.disabled = false;
  });
});

wireCabinetLinks();
refresh();
setInterval(() => { if (state?.session?.connected) renderStatus(); }, 1000);
