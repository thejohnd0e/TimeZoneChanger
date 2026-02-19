// ─── Конфигурация API ──────────────────────────────────────────────────────
const APIS = [
  {
    url: 'https://ipwho.is/',
    parse: (data) => ({
      timezone: data.timezone?.id,
      ip: data.ip,
      country: data.country,
      city: data.city
    })
  },
  {
    url: 'https://freeipapi.com/api/json',
    parse: (data) => ({
      timezone: Array.isArray(data.timeZones) ? data.timeZones[0] : (data.timeZone || data.timezones?.[0]),
      ip: data.ipAddress || data.ip,
      country: data.countryName || data.country,
      city: data.cityName || data.city
    })
  }
];

let isUpdating = false;
let lastCheckTime = 0;
const CHECK_COOLDOWN = 10000; // Проверять не чаще чем раз в 10 секунд при навигации

async function updateTimezone() {
  if (isUpdating) return;

  // Проверяем кулдаун, чтобы не спамить API при каждом клике
  const now = Date.now();
  if (now - lastCheckTime < CHECK_COOLDOWN) return;

  isUpdating = true;
  lastCheckTime = now;

  console.log("[TZ] Checking for IP changes...");

  for (const api of APIS) {
    try {
      // cache: 'no-store' критически важен, чтобы не получать старый IP из кеша браузера
      const response = await fetch(api.url, { cache: 'no-store' });
      if (!response.ok) continue;

      const data = await response.json();
      const parsed = api.parse(data);

      if (parsed.timezone) {
        const stored = await chrome.storage.local.get(['ip', 'timezone']);

        // Если IP или зона изменились — обновляем и перезагружаем страницы
        if (stored.ip !== parsed.ip || stored.timezone !== parsed.timezone) {
          console.log(`[TZ] IP Changed: ${stored.ip || 'none'} -> ${parsed.ip}`);

          await chrome.storage.local.set({
            timezone: parsed.timezone,
            ip: parsed.ip,
            country: parsed.country,
            city: parsed.city,
            lastUpdate: Date.now()
          });

          // Сообщаем всем вкладкам об изменениях
          const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
          for (const tab of tabs) {
            if (tab.id) {
              // Перезагружаем только если это не служебная страница
              chrome.tabs.reload(tab.id);
            }
          }
        }
        isUpdating = false;
        return true;
      }
    } catch (e) {
      console.warn(`[TZ] API ${api.url} failed:`, e.message);
    }
  }
  isUpdating = false;
  return false;
}

// ─── Слушатели событий ──────────────────────────────────────────────────────

// Проверка при установке и создании аларма
chrome.runtime.onInstalled.addListener(() => {
  updateTimezone();
  chrome.alarms.create('check-ip-periodic', { periodInMinutes: 1 });
});

// Проверка при запуске браузера
chrome.runtime.onStartup.addListener(() => {
  updateTimezone();
  chrome.alarms.create('check-ip-periodic', { periodInMinutes: 1 });
});

// Реакция на аларм
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-ip-periodic') {
    updateTimezone();
  }
});

// ГЛАВНОЕ: Проверка при начале навигации. 
// Если вы сменили VPN и перешли на новый сайт — мы поймаем это мгновенно.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) { // Только для главных вкладок, не для рекламы в iframe
    updateTimezone();
  }
});

// Ручное обновление из попапа
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'refresh') {
    lastCheckTime = 0; // Сбрасываем кулдаун для ручного обновления
    updateTimezone().then(success => sendResponse({ success }));
    return true;
  }
});
