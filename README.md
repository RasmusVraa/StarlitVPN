# StarlitVPN

Клиент [Starlit](https://starlit-moon.ru) для браузера на ядре Xray. Подписки принимаются **только** с `https://sub.starlit-moon.ru/`.

Проксируется трафик браузера, не вся система.

## Установка для пользователей (Windows)

Соберите архив:

```powershell
.\scripts\pack.ps1
```

Клиентам отдайте `dist/StarlitVPN.zip`. Они распаковывают папку и загружают её в `chrome://extensions` (режим разработчика → загрузить распакованное). Python не нужен.

Автообновление: положите `StarlitVPN.zip` в GitHub Release репозитория `RasmusVraa/StarlitVPN` (тег вроде `v1.0.1`). Расширение само покажет кнопку «Обновить». Репозиторий задаётся в `extension/lib/config.js` (`githubRepo`).

## Разработка

```powershell
node tests/uri.test.js
node tests/config.test.js
node tests/xray-config.test.js
```

Сборка zip:

```powershell
.\scripts\pack.ps1
```

Политика конфиденциальности: `store/privacy.md`.
