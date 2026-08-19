function send(type, payload = {}) {
  return ext.runtime.sendMessage({ type, ...payload });
}

const fields = ["attachMode", "attachHost", "attachPort", "socksPort", "routing", "language"];

let autoSites = [];
let autoSitesEnabled = true;

function paintSites() {
  const list = $("auto-site-list");
  if (!list) return;
  const toggle = $("auto-sites-toggle");
  if (toggle) {
    toggle.textContent = autoSitesEnabled ? "AUTO ON" : "AUTO OFF";
    toggle.classList.toggle("off", !autoSitesEnabled);
  }
  const count = $("auto-site-count");
  if (count) count.textContent = String(autoSites.length);
  if (!autoSites.length) {
    list.innerHTML = "<li class=\"hint\">Сайтов пока нет</li>";
    return;
  }
  list.innerHTML = autoSites.map((site) => `
    <li>
      <span>${site}</span>
      <div class="site-actions">
        <span class="site-state ${autoSitesEnabled ? "on" : "off"}">${autoSitesEnabled ? "ON" : "OFF"}</span>
        <button type="button" class="ghost site-del" data-site="${site}" title="Удалить">✕</button>
      </div>
    </li>
  `).join("");
}

async function load() {
  const state = await send("getState");
  const s = state.settings || {};
  $("attachMode").checked = !!s.attachMode;
  $("attachHost").value = s.attachHost || "127.0.0.1";
  $("attachPort").value = s.attachPort || 10808;
  $("socksPort").value = s.socksPort || 10808;
  $("routing").value = s.routing || "bypass-private";
  $("language").value = s.language || "auto";
  autoSites = s.autoSites || [];
  autoSitesEnabled = s.autoSitesEnabled !== false;
  paintSites();
  paintCore(state.nativeProbe);
}

function paintCore(probe) {
  const el = $("core-status");
  if (!probe || probe.missing) {
    el.textContent = "Native host не найден. Установите native-host/install.ps1 и перезапустите браузер.";
    return;
  }
  if (probe.ok === false && probe.error) {
    el.textContent = "Host ответил с ошибкой: " + probe.error;
    return;
  }
  const ver = probe.core?.version || "неизвестно";
  const run = probe.running ? "Xray запущен" : "Xray остановлен";
  el.textContent = `Native host работает. Ядро: ${ver}. ${run}.`;
}

function $ (id) { return document.getElementById(id); }

$("btn-save").addEventListener("click", async () => {
  await send("saveSettings", {
    settings: {
      attachMode: $("attachMode").checked,
      attachHost: $("attachHost").value.trim() || "127.0.0.1",
      attachPort: Number($("attachPort").value) || 10808,
      socksPort: Number($("socksPort").value) || 10808,
      httpPort: (Number($("socksPort").value) || 10808) + 1,
      routing: $("routing").value,
      language: $("language").value,
      autoSitesEnabled,
    },
  });
  $("saved").hidden = false;
  setTimeout(() => { $("saved").hidden = true; }, 1500);
});

$("btn-core").addEventListener("click", async () => {
  $("core-status").textContent = "Скачиваю Xray-core…";
  const res = await send("ensureCore");
  paintCore(res);
  if (res?.error) $("core-status").textContent = res.error;
});

$("btn-status").addEventListener("click", async () => {
  const state = await send("getState");
  paintCore(state.nativeProbe);
});

$("btn-add-site")?.addEventListener("click", async () => {
  const input = $("auto-site");
  const res = await send("addAutoSite", { site: (input?.value || "").trim() });
  if (res?.error) {
    $("saved").hidden = false;
    $("saved").textContent = res.error;
    return;
  }
  if (input) input.value = "";
  autoSites = res.autoSites || [];
  paintSites();
});

$("auto-site-list")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".site-del");
  if (!btn) return;
  const res = await send("removeAutoSite", { site: btn.dataset.site });
  autoSites = res.autoSites || [];
  paintSites();
});

$("auto-sites-toggle")?.addEventListener("click", async () => {
  autoSitesEnabled = !autoSitesEnabled;
  await send("saveSettings", { settings: { autoSitesEnabled } });
  paintSites();
});

load();

const cabinet = $("btn-cabinet");
if (cabinet) {
  cabinet.href = StarlitConfig.cabinet;
  cabinet.addEventListener("click", (e) => {
    e.preventDefault();
    const url = StarlitConfig.cabinet;
    if (ext?.tabs?.create) ext.tabs.create({ url });
    else window.open(url, "_blank", "noopener");
  });
}
