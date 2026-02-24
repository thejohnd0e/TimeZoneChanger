importScripts("shared.js");

const APIS = [
  {
    url: "https://ipwho.is/",
    parse: (data) => ({
      timezone: data.timezone?.id,
      ip: data.ip,
      country: data.country,
      city: data.city
    })
  },
  {
    url: "https://freeipapi.com/api/json",
    parse: (data) => ({
      timezone: Array.isArray(data.timeZones) ? data.timeZones[0] : data.timeZone || data.timezones?.[0],
      ip: data.ipAddress || data.ip,
      country: data.countryName || data.country,
      city: data.cityName || data.city
    })
  }
];

const CHECK_COOLDOWN = 10000;
const TAB_STATE_KEY = "tabStateV1";
const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

let isUpdating = false;
let lastCheckTime = 0;
let tabStateCache = null;
const busyTabs = new Set();

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  const safe = TZC_SHARED.sanitizeSettings(settings);
  if (!settings) await chrome.storage.sync.set({ settings: safe });
  return safe;
}

async function setSettings(settings) {
  const safe = TZC_SHARED.sanitizeSettings(settings);
  await chrome.storage.sync.set({ settings: safe });
  return safe;
}

async function getRuntimeState() {
  return chrome.storage.local.get(["timezone", "ip", "country", "city", "lastUpdate"]);
}

async function getTabState() {
  if (tabStateCache) return tabStateCache;
  const fromSession = await chrome.storage.session.get(TAB_STATE_KEY);
  tabStateCache = fromSession[TAB_STATE_KEY] && typeof fromSession[TAB_STATE_KEY] === "object" ? fromSession[TAB_STATE_KEY] : {};
  return tabStateCache;
}

async function persistTabState() {
  if (!tabStateCache) return;
  await chrome.storage.session.set({ [TAB_STATE_KEY]: tabStateCache });
}

async function clearTabState(tabId) {
  const state = await getTabState();
  if (state[tabId]) {
    delete state[tabId];
    await persistTabState();
  }
  busyTabs.delete(Number(tabId));
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return "";
  }
}

function pickModeTimezone(tabStateEntry, behavior, runtimeTimezone) {
  const mode = tabStateEntry?.tabOverride?.mode || behavior.mode;
  if (mode === "disable") return { mode: "disable", timezone: "" };
  if (mode === "fixed") {
    const fixedTz = tabStateEntry?.tabOverride?.timezone || behavior.timezone || runtimeTimezone || SYSTEM_TIMEZONE;
    return { mode: "fixed", timezone: fixedTz };
  }

  const lockedTimezone = tabStateEntry?.lockedTimezone || runtimeTimezone || SYSTEM_TIMEZONE;
  return { mode: "auto", timezone: lockedTimezone };
}

async function getPageConfig(tabId, hostname) {
  const [settings, runtime, state] = await Promise.all([getSettings(), getRuntimeState(), getTabState()]);
  const behavior = TZC_SHARED.resolveHostnameBehavior(hostname, settings);
  const tabEntry = state[tabId] || {};

  if (behavior.mode === "disable" && !tabEntry.tabOverride) {
    return {
      shouldSpoof: false,
      mode: "disable",
      timezone: SYSTEM_TIMEZONE,
      source: behavior.source
    };
  }

  const selection = pickModeTimezone(tabEntry, behavior, runtime.timezone);
  if (selection.mode === "auto") {
    state[tabId] = {
      ...tabEntry,
      lockedTimezone: selection.timezone
    };
    await persistTabState();
  } else if (tabEntry.lockedTimezone) {
    state[tabId] = {
      ...tabEntry,
      lockedTimezone: tabEntry.lockedTimezone
    };
  }

  return {
    shouldSpoof: selection.mode !== "disable",
    mode: selection.mode,
    timezone: selection.timezone || SYSTEM_TIMEZONE,
    source: tabEntry?.tabOverride ? "tabOverride" : behavior.source,
    matchedPattern: behavior.pattern || ""
  };
}

async function getTabStatus(tab) {
  const hostname = getHostname(tab?.url || "");
  if (!hostname) {
    return { hostname: "", mode: "disable", timezone: SYSTEM_TIMEZONE, shouldSpoof: false, source: "unsupported" };
  }
  return { hostname, ...(await getPageConfig(tab.id, hostname)) };
}

async function updateTimezone(force = false) {
  if (isUpdating) return false;
  const now = Date.now();
  if (!force && now - lastCheckTime < CHECK_COOLDOWN) return false;

  isUpdating = true;
  lastCheckTime = now;
  try {
    for (const api of APIS) {
      try {
        const response = await fetch(api.url, { cache: "no-store" });
        if (!response.ok) continue;
        const data = await response.json();
        const parsed = api.parse(data);
        if (!parsed.timezone) continue;

        const stored = await getRuntimeState();
        const changed = stored.ip !== parsed.ip || stored.timezone !== parsed.timezone;

        await chrome.storage.local.set({
          timezone: parsed.timezone,
          ip: parsed.ip,
          country: parsed.country,
          city: parsed.city,
          lastUpdate: Date.now()
        });

        if (changed) {
          console.log(`[TZ] Updated timezone: ${stored.timezone || "none"} -> ${parsed.timezone}`);
        }
        return true;
      } catch (err) {
        console.warn(`[TZ] API ${api.url} failed:`, err?.message || err);
      }
    }
  } finally {
    isUpdating = false;
  }
  return false;
}

async function initialize() {
  await getSettings();
  await updateTimezone(true);
  chrome.alarms.create("check-ip-periodic", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "check-ip-periodic") updateTimezone();
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) updateTimezone();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === "refresh") {
    lastCheckTime = 0;
    updateTimezone(true).then((success) => sendResponse({ success }));
    return true;
  }

  if (msg?.action === "tzc:get-page-config") {
    const tabId = sender?.tab?.id;
    const hostname = String(msg.hostname || "").trim().toLowerCase();
    if (!tabId || !hostname) {
      sendResponse({ shouldSpoof: false, mode: "disable", timezone: SYSTEM_TIMEZONE, source: "invalid" });
      return false;
    }
    getPageConfig(tabId, hostname).then(sendResponse);
    return true;
  }

  if (msg?.action === "tzc:net-active") {
    const tabId = sender?.tab?.id;
    if (!tabId) return false;
    if (msg.active) busyTabs.add(tabId);
    else busyTabs.delete(tabId);
    return false;
  }

  if (msg?.action === "tzc:get-settings") {
    Promise.all([getSettings(), getRuntimeState()]).then(([settings, runtime]) => {
      sendResponse({ settings, runtime, systemTimezone: SYSTEM_TIMEZONE });
    });
    return true;
  }

  if (msg?.action === "tzc:update-settings") {
    setSettings(msg.settings || {}).then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (msg?.action === "tzc:add-excluded-site") {
    const hostname = String(msg.hostname || "").trim().toLowerCase();
    if (!hostname) {
      sendResponse({ ok: false });
      return false;
    }
    getSettings()
      .then((settings) => {
        if (!settings.excludedDomains.includes(hostname)) settings.excludedDomains.push(hostname);
        return setSettings(settings);
      })
      .then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (msg?.action === "tzc:set-site-rule") {
    const pattern = String(msg.pattern || "").trim().toLowerCase();
    if (!pattern) {
      sendResponse({ ok: false, error: "empty-pattern" });
      return false;
    }
    getSettings()
      .then((settings) => {
        const rule = msg.rule || {};
        if (rule.mode === "auto" && !rule.timezone) {
          delete settings.siteRules[pattern];
        } else {
          settings.siteRules[pattern] = {
            mode: rule.mode === "disable" || rule.mode === "fixed" ? rule.mode : "auto",
            timezone: rule.mode === "fixed" ? String(rule.timezone || "").trim() : ""
          };
        }
        return setSettings(settings);
      })
      .then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (msg?.action === "tzc:set-tab-rule") {
    const tabId = Number(msg.tabId || sender?.tab?.id);
    if (!tabId) {
      sendResponse({ ok: false });
      return false;
    }
    getTabState()
      .then(async (state) => {
        const entry = state[tabId] || {};
        const mode = msg.mode === "disable" || msg.mode === "fixed" ? msg.mode : "auto";
        if (mode === "auto" && !msg.timezone) {
          delete entry.tabOverride;
        } else {
          entry.tabOverride = {
            mode,
            timezone: mode === "fixed" ? String(msg.timezone || "").trim() : ""
          };
        }
        state[tabId] = entry;
        await persistTabState();
        return true;
      })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.action === "tzc:get-tab-status") {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => tabs[0] || null)
      .then((tab) => (tab ? getTabStatus(tab) : { hostname: "", mode: "disable", shouldSpoof: false, timezone: SYSTEM_TIMEZONE }))
      .then(sendResponse);
    return true;
  }
});
