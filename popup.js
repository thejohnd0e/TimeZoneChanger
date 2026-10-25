let currentHost = "";
let currentTabId = null;

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response) return reject(new Error("No response from extension."));
      if (response.ok === false) return reject(new Error(response.error || "Operation failed."));
      resolve(response);
    });
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

  currentTabId = tab?.id ?? null;
  currentHost = tabStatus?.hostname || "";

  document.getElementById("timezone").textContent = runtime?.timezone || "Unknown";
  document.getElementById("location").textContent = runtime?.city && runtime?.country ? `${runtime.city}, ${runtime.country}` : "Unknown";
  document.getElementById("ip").textContent = runtime?.ip || "Unknown";
  document.getElementById("last-update").textContent = runtime?.lastUpdate ? new Date(runtime.lastUpdate).toLocaleTimeString() : "--";
  document.getElementById("current-host").textContent = currentHost || "Unsupported tab";
  document.getElementById("current-mode").textContent = tabStatus?.mode || "disable";
  document.getElementById("effective-timezone").textContent = tabStatus?.timezone || "Unknown";
  document.getElementById("rule-source").textContent = tabStatus?.source || "Unknown";
  document.getElementById("site-mode").value = tabStatus?.siteRule?.mode || "inherit";
  document.getElementById("site-timezone").value = tabStatus?.siteRule?.timezone || "";
  document.getElementById("tab-mode").value = tabStatus?.tabOverride?.mode || "inherit";
  document.getElementById("tab-timezone").value = tabStatus?.tabOverride?.timezone || "";
  if (tabStatus?.error) throw new Error(tabStatus.error);
  toggleTimezoneInput("site-mode", "site-timezone");
  toggleTimezoneInput("tab-mode", "tab-timezone");
}

document.getElementById("site-mode").addEventListener("change", () => toggleTimezoneInput("site-mode", "site-timezone"));
document.getElementById("tab-mode").addEventListener("change", () => toggleTimezoneInput("tab-mode", "tab-timezone"));

function showError(error) {
  document.getElementById("status-message").textContent = error?.message === "invalid-timezone"
    ? "Enter a valid timezone, for example America/New_York." : error?.message || "Operation failed.";
}

function onAction(id, action) {
  const button = document.getElementById(id);
  button.addEventListener("click", async () => {
    button.disabled = true;
    document.getElementById("status-message").textContent = "";
    try { await action(); }
    catch (error) { showError(error); }
    finally { button.disabled = false; }
  });
}

onAction("refresh-btn", async () => {
  const result = await sendMessage({ action: "refresh" });
  if (!result.success) throw new Error("IP lookup failed. Last known data has been kept.");
  await updateUI();
});

onAction("add-exclusion-btn", async () => {
  if (!currentHost) return;
  await sendMessage({ action: "tzc:add-excluded-site", hostname: currentHost });
  await updateUI();
  document.getElementById("status-message").textContent = "Saved. Reload the page to apply.";
});

onAction("save-site-rule-btn", async () => {
  if (!currentHost) return;
  const mode = document.getElementById("site-mode").value;
  const timezone = document.getElementById("site-timezone").value.trim();
  await sendMessage({
    action: "tzc:set-site-rule",
    pattern: currentHost,
    rule: { mode, timezone }
  });
  await updateUI();
  document.getElementById("status-message").textContent = "Saved. Reload the page to apply.";
});

onAction("save-tab-rule-btn", async () => {
  if (currentTabId === null) return;
  const mode = document.getElementById("tab-mode").value;
  const timezone = document.getElementById("tab-timezone").value.trim();
  await sendMessage({
    action: "tzc:set-tab-rule",
    tabId: currentTabId,
    mode,
    timezone
  });
  await chrome.tabs.reload(currentTabId);
});

document.getElementById("open-options-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

toggleTimezoneInput("site-mode", "site-timezone");
toggleTimezoneInput("tab-mode", "tab-timezone");
updateUI().catch(showError);
