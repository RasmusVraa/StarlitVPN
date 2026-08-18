const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const btn = document.getElementById("btn-run");
let phase = "run";

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", !!ok);
}

async function nativeReady() {
  try {
    const reply = await ext.runtime.sendNativeMessage("com.starlitvpn.host", { cmd: "status" });
    return !!(reply && reply.ok && reply.missing !== true);
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitItem(id, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const items = await ext.downloads.search({ id });
    const item = items?.[0];
    if (!item) return null;
    if (item.state === "complete") return item;
    if (item.state === "interrupted") throw new Error("Скачивание прервано. В панели загрузок нажмите «Оставить».");
    await sleep(300);
  }
  const items = await ext.downloads.search({ id });
  return items?.[0] || null;
}

async function pollReady() {
  for (let i = 0; i < 120; i += 1) {
    if (await nativeReady()) {
      try { await ext.runtime.sendMessage({ type: "ensureCore" }); } catch { /* later */ }
      setStatus("Готово. Можно закрыть эту вкладку и открыть иконку StarlitVPN.", true);
      hintEl.textContent = "";
      btn.disabled = false;
      btn.textContent = "Готово";
      return true;
    }
    await sleep(1000);
  }
  return false;
}

btn.addEventListener("click", async () => {
  if (phase === "reload") {
    ext.runtime.reload();
    return;
  }
  btn.disabled = true;
  hintEl.textContent = "";
  try {
    if (await nativeReady()) {
      setStatus("Ядро уже включено. Закройте вкладку.", true);
      return;
    }
    setStatus("Скачиваем установщик…");
    const url = ext.runtime.getURL("native/host.exe");
    const id = await ext.downloads.download({
      url,
      filename: "StarlitVPN-setup.exe",
      conflictAction: "uniquify",
      saveAs: false,
    });
    await sleep(250);
    if (ext.downloads.acceptDanger) {
      try { await ext.downloads.acceptDanger(id); } catch { /* not dangerous or needs Keep */ }
    }
    const item = await waitItem(id);
    if (item?.danger && item.danger !== "safe" && item.danger !== "accepted" && ext.downloads.acceptDanger) {
      setStatus("Chrome считает файл опасным. Подтвердите «Оставить», затем нажмите кнопку ещё раз.");
      try { await ext.downloads.acceptDanger(id); } catch { /* user must click Keep */ }
    }
    setStatus("Запускаем установщик. Если Windows спросит — «Подробнее» → «Выполнить в любом случае».");
    let opened = false;
    if (ext.downloads.open) {
      try {
        await ext.downloads.open(id);
        opened = true;
      } catch { /* blocked */ }
    }
    if (!opened && ext.downloads.show) {
      try { await ext.downloads.show(id); } catch { /* ignore */ }
      hintEl.textContent = "Откройте папку загрузок и дважды нажмите StarlitVPN-setup.exe";
    }
    const ok = await pollReady();
    if (!ok) {
      setStatus("Установщик ещё не ответил. Запустите StarlitVPN-setup.exe из загрузок, затем нажмите «Обновить расширение».");
      phase = "reload";
      btn.disabled = false;
      btn.textContent = "Обновить расширение";
    }
  } catch (err) {
    setStatus(err.message || String(err));
    btn.disabled = false;
    btn.textContent = "Повторить";
  }
});

nativeReady().then((ok) => {
  if (ok) setStatus("Ядро уже включено. Можно закрыть вкладку.", true);
});
