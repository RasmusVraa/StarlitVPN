const StarlitConfig = {
  subHost: "sub.starlit-moon.ru",
  cabinet: "https://cabinet.starlit-moon.ru",
  githubRepo: "RasmusVraa/StarlitVPN",
  updateAsset: "StarlitVPN.zip",
  happUserAgent: "Happ/3.3.6/windows",
};

StarlitConfig.normalizeSubscriptionUrl = function normalizeSubscriptionUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Вставьте ссылку подписки");
  if (!/^https?:\/\//i.test(raw)) throw new Error("Вставьте полную ссылку подписки");
  let url;
  try {
    url = new URL(raw);
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
