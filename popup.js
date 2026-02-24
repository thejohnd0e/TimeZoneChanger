let currentHost = "";
let currentTabId = null;

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response));
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function toggleTimezoneInput(selectId, inputId) {
  const mode = document.getElementById(selectId).value;
  document.getElementById(inputId).style.display = mode === "fixed" ? "block" : "none";
}

async function updateUI() {
  const [settingsPayload, tab, tabStatus] = await Promise.all([
    sendMessage({ action: "tzc:get-settings" }),
    getActiveTab(),
    sendMessage({ action: "tzc:get-tab-status" })
  ]);
  const runtime = settingsPayload?.runtime || {};

  currentTabId = tab?.id || null;
  currentHost = tabStatus?.hostname || "";

  document.getElementById("timezone").textContent = runtime?.timezone || "Unknown";
  document.getElementById("location").textContent = runtime?.city && runtime?.country ? `${runtime.city}, ${runtime.country}` : "Unknown";
  document.getElementById("ip").textContent = runtime?.ip || "Unknown";
  document.getElementById("last-update").textContent = runtime?.lastUpdate ? new Date(runtime.lastUpdate).toLocaleTimeString() : "--";
  document.getElementById("current-host").textContent = currentHost || "Unsupported tab";
  document.getElementById("current-mode").textContent = tabStatus?.mode || "disable";
  document.getElementById("site-mode").value = tabStatus?.mode || "auto";
  document.getElementById("tab-mode").value = "auto";
  toggleTimezoneInput("site-mode", "site-timezone");
  toggleTimezoneInput("tab-mode", "tab-timezone");
}

document.getElementById("site-mode").addEventListener("change", () => toggleTimezoneInput("site-mode", "site-timezone"));
document.getElementById("tab-mode").addEventListener("change", () => toggleTimezoneInput("tab-mode", "tab-timezone"));

document.getElementById("refresh-btn").addEventListener("click", async () => {
  const btn = document.getElementById("refresh-btn");
  btn.textContent = "Updating...";
  btn.disabled = true;
  await sendMessage({ action: "refresh" });
  btn.textContent = "Refresh IP/Timezone";
  btn.disabled = false;
  await updateUI();
});

document.getElementById("add-exclusion-btn").addEventListener("click", async () => {
  if (!currentHost) return;
  await sendMessage({ action: "tzc:add-excluded-site", hostname: currentHost });
  await updateUI();
});

document.getElementById("save-site-rule-btn").addEventListener("click", async () => {
  if (!currentHost) return;
  const mode = document.getElementById("site-mode").value;
  const timezone = document.getElementById("site-timezone").value.trim();
  await sendMessage({
    action: "tzc:set-site-rule",
    pattern: currentHost,
    rule: { mode, timezone }
  });
  await updateUI();
});

document.getElementById("save-tab-rule-btn").addEventListener("click", async () => {
  if (!currentTabId) return;
  const mode = document.getElementById("tab-mode").value;
  const timezone = document.getElementById("tab-timezone").value.trim();
  await sendMessage({
    action: "tzc:set-tab-rule",
    tabId: currentTabId,
    mode,
    timezone
  });
  if (currentTabId) chrome.tabs.reload(currentTabId);
});

document.getElementById("open-options-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

toggleTimezoneInput("site-mode", "site-timezone");
toggleTimezoneInput("tab-mode", "tab-timezone");
updateUI();
