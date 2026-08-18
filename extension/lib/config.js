const StarlitConfig = {
  subHost: "sub.starlit-moon.ru",
  cabinet: "https://cabinet.starlit-moon.ru",
  githubRepo: "RasmusVraa/StarlitVPN",
  updateAsset: "StarlitVPN.zip",
};

StarlitConfig.normalizeSubscriptionUrl = function normalizeSubscriptionUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Вставьте ссылку подписки");
  let url;
  try {
    if (/^https?:\/\//i.test(raw)) url = new URL(raw);
    else if (raw.startsWith("/")) url = new URL(`https://${StarlitConfig.subHost}${raw}`);
    else url = new URL(`https://${StarlitConfig.subHost}/${raw.replace(/^\/+/, "")}`);
  } catch {
    throw new Error("Некорректная ссылка подписки");
  }
  if (url.hostname.toLowerCase() !== StarlitConfig.subHost) {
    throw new Error("Подписки можно добавить только с sub.starlit-moon.ru");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Подписки можно добавить только с sub.starlit-moon.ru");
  }
  url.protocol = "https:";
  url.hash = "";
  return url.toString();
};

if (typeof globalThis !== "undefined") globalThis.StarlitConfig = StarlitConfig;
