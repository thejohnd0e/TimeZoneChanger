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
const API_TIMEOUT = 5000;
const TAB_STATE_KEY = "tabStateV1";
const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

let updatePromise = null;
let lastCheckTime = 0;
let tabStateCache = null;
let tabStateLoad = null;
let tabStateMutations = Promise.resolve();

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
  if (!tabStateLoad) {
    tabStateLoad = chrome.storage.session.get(TAB_STATE_KEY).then((fromSession) => {
      tabStateCache = fromSession[TAB_STATE_KEY] && typeof fromSession[TAB_STATE_KEY] === "object" ? fromSession[TAB_STATE_KEY] : {};
      return tabStateCache;
    }).finally(() => { tabStateLoad = null; });
  }
  return tabStateLoad;
}

function mutateTabState(change) {
  const mutation = tabStateMutations.catch(() => {}).then(async () => {
    const state = await getTabState();
    const next = structuredClone(state);
    if (change(next) === false) return;
    await chrome.storage.session.set({ [TAB_STATE_KEY]: next });
    // Publish only committed state. Failed writes must never become active or
    // hitchhike on a later tab's successful persistence.
    tabStateCache = next;
  });
  tabStateMutations = mutation;
  return mutation;
}

async function clearTabState(tabId) {
  await mutateTabState((state) => {
    if (!state[tabId]) return false;
    delete state[tabId];
  });
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
    const fixedTz = tabStateEntry?.tabOverride ? tabStateEntry.tabOverride.timezone : behavior.timezone;
    return { mode: "fixed", timezone: fixedTz };
  }

  const lockedTimezone = TZC_SHARED.isValidTimezone(tabStateEntry?.lockedTimezone) ? tabStateEntry.lockedTimezone : runtimeTimezone || SYSTEM_TIMEZONE;
  return { mode: "auto", timezone: lockedTimezone };
}

async function getPageConfig(tabId, hostname) {
  const [settings, initialRuntime, state] = await Promise.all([getSettings(), getRuntimeState(), getTabState()]);
  let runtime = initialRuntime;
  const behavior = TZC_SHARED.resolveHostnameBehavior(hostname, settings);
  let tabEntry = state[tabId] || {};

  if (behavior.mode === "disable" && !tabEntry.tabOverride) {
    return {
      shouldSpoof: false,
      mode: "disable",
      timezone: SYSTEM_TIMEZONE,
      source: behavior.source
    };
  }

  const mode = tabEntry.tabOverride?.mode || behavior.mode;
  if (mode === "auto" && !TZC_SHARED.isValidTimezone(tabEntry.lockedTimezone) && !TZC_SHARED.isValidTimezone(runtime.timezone)) {
    await updateTimezone();
    runtime = await getRuntimeState();
    tabEntry = (await getTabState())[tabId] || {};
  }
  const runtimeTimezone = TZC_SHARED.isValidTimezone(runtime.timezone) ? runtime.timezone : "";
  let selection = pickModeTimezone(tabEntry, behavior, runtimeTimezone);
  if (selection.mode === "auto" && (TZC_SHARED.isValidTimezone(tabEntry.lockedTimezone) || runtimeTimezone)) {
    await mutateTabState((state) => {
      tabEntry = state[tabId] || {};
      selection = pickModeTimezone(tabEntry, behavior, runtimeTimezone);
      if (selection.mode !== "auto" || TZC_SHARED.isValidTimezone(tabEntry.lockedTimezone)) return false;
      state[tabId] = { ...tabEntry, lockedTimezone: selection.timezone };
    });
  }
  if (selection.mode === "fixed" && !TZC_SHARED.isValidTimezone(selection.timezone)) {
    return { shouldSpoof: false, mode: "disable", timezone: SYSTEM_TIMEZONE, source: tabEntry.tabOverride ? "tabOverride" : behavior.source, error: "invalid-timezone" };
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
  const [config, settings, state] = await Promise.all([getPageConfig(tab.id, hostname), getSettings(), getTabState()]);
  return { hostname, ...config, siteRule: settings.siteRules[hostname] || null, tabOverride: state[tab.id]?.tabOverride || null };
}

async function updateTimezone(force = false) {
  if (updatePromise) return updatePromise;
  const now = Date.now();
  if (!force && now - lastCheckTime < CHECK_COOLDOWN) return false;

  lastCheckTime = now;
  updatePromise = (async () => {
    for (const api of APIS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
      try {
        const response = await fetch(api.url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) continue;
        const data = await response.json();
        const parsed = api.parse(data);
        if (!TZC_SHARED.isValidTimezone(parsed.timezone)) continue;

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
      } finally {
        clearTimeout(timer);
      }
    }
    return false;
  })();
  try {
    return await updatePromise;
  } finally {
    updatePromise = null;
  }
}

async function initialize() {
  chrome.alarms.create("check-ip-periodic", { periodInMinutes: 1 });
  await getSettings();
  await updateTimezone(true);
}

function reportFailure(error) {
  console.warn("[TZ] Operation failed:", error?.message || error);
}

chrome.runtime.onInstalled.addListener(() => { initialize().catch(reportFailure); });
chrome.runtime.onStartup.addListener(() => { initialize().catch(reportFailure); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "check-ip-periodic") updateTimezone().catch(reportFailure);
});
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) updateTimezone().catch(reportFailure);
});
chrome.tabs.onRemoved.addListener((tabId) => { clearTabState(tabId).catch(reportFailure); });

function invalidFixedRule(rule) {
  return rule?.mode === "fixed" && !TZC_SHARED.isValidTimezone(String(rule.timezone || "").trim());
}

let settingsWrites = Promise.resolve();
function mutateSettings(change) {
  const write = settingsWrites.catch(() => {}).then(async () => setSettings(await change(await getSettings())));
  settingsWrites = write;
  return write;
}

async function handleMessage(msg, sender) {
  if (msg.action === "refresh") return { success: await updateTimezone(true) };
  if (msg.action === "tzc:get-page-config") {
    const tabId = sender?.tab?.id;
    const hostname = String(msg.hostname || "").trim().toLowerCase();
    if (!Number.isInteger(tabId) || tabId < 0 || !hostname) {
      return { shouldSpoof: false, mode: "disable", timezone: SYSTEM_TIMEZONE, source: "invalid" };
    }
    return getPageConfig(tabId, hostname);
  }
  if (msg.action === "tzc:get-settings") {
    const [settings, runtime] = await Promise.all([getSettings(), getRuntimeState()]);
    return { settings, runtime, systemTimezone: SYSTEM_TIMEZONE };
  }
  if (msg.action === "tzc:update-settings") {
    if (Object.values(msg.settings?.siteRules || {}).some(invalidFixedRule)) return { ok: false, error: "invalid-timezone" };
    const settings = await mutateSettings(() => msg.settings || {});
    return { ok: true, settings };
  }
  if (msg.action === "tzc:add-excluded-site") {
    const hostname = String(msg.hostname || "").trim().toLowerCase();
    if (!hostname) return { ok: false, error: "empty-pattern" };
    const settings = await mutateSettings((settings) => {
      if (!settings.excludedDomains.includes(hostname)) settings.excludedDomains.push(hostname);
      return settings;
    });
    return { ok: true, settings };
  }
  if (msg.action === "tzc:set-site-rule") {
    const pattern = String(msg.pattern || "").trim().toLowerCase();
    if (!pattern) return { ok: false, error: "empty-pattern" };
    const rule = msg.rule || {};
    if (invalidFixedRule(rule)) return { ok: false, error: "invalid-timezone" };
    const settings = await mutateSettings((settings) => {
      if (rule.mode === "inherit") delete settings.siteRules[pattern];
      else settings.siteRules[pattern] = {
        mode: rule.mode === "disable" || rule.mode === "fixed" ? rule.mode : "auto",
        timezone: rule.mode === "fixed" ? String(rule.timezone || "").trim() : ""
      };
      return settings;
    });
    return { ok: true, settings };
  }
  if (msg.action === "tzc:set-tab-rule") {
    const tabId = Number(msg.tabId ?? sender?.tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) return { ok: false, error: "invalid-tab" };
    if (invalidFixedRule(msg)) return { ok: false, error: "invalid-timezone" };
    await mutateTabState((state) => {
      const entry = { ...state[tabId] };
      if (msg.mode === "inherit") delete entry.tabOverride;
      else entry.tabOverride = {
        mode: msg.mode === "disable" || msg.mode === "fixed" ? msg.mode : "auto",
        timezone: msg.mode === "fixed" ? String(msg.timezone || "").trim() : ""
      };
      state[tabId] = entry;
    });
    return { ok: true };
  }
  if (msg.action === "tzc:get-tab-status") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? getTabStatus(tab) : { hostname: "", mode: "disable", shouldSpoof: false, timezone: SYSTEM_TIMEZONE };
  }
}

const MESSAGE_ACTIONS = new Set(["refresh", "tzc:get-page-config", "tzc:get-settings", "tzc:update-settings", "tzc:add-excluded-site", "tzc:set-site-rule", "tzc:set-tab-rule", "tzc:get-tab-status"]);
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!MESSAGE_ACTIONS.has(msg?.action)) return false;
  handleMessage(msg, sender).then(sendResponse, (error) => {
    reportFailure(error);
    sendResponse({ ok: false, error: "storage-error" });
  });
  return true;
});
