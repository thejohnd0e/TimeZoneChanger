let currentHost = "";
let currentTabId = null;
let pageStatus = null;
let currentScope = "site";
let editorBusy = false;
let drafts = { site: { mode: "inherit", timezone: "" }, tab: { mode: "inherit", timezone: "" } };

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

function canEditRules() {
  return pageStatus?.supported === true && Number.isInteger(currentTabId) && !!currentHost;
}

function updateEditorAvailability() {
  for (const id of ["rule-scope", "rule-mode", "rule-timezone", "apply-rule-btn"]) {
    document.getElementById(id).disabled = editorBusy || !canEditRules();
  }
}

function readRuleForm() {
  return { mode: document.getElementById("rule-mode").value, timezone: document.getElementById("rule-timezone").value };
}

function toggleTimezoneInput() {
  const hidden = document.getElementById("rule-mode").value !== "fixed";
  document.getElementById("rule-timezone").hidden = hidden;
  document.getElementById("timezone-label").hidden = hidden;
}

function renderRuleEditor() {
  const rule = drafts[currentScope];
  document.getElementById("rule-scope").value = currentScope;
  document.getElementById("rule-mode").value = rule.mode;
  document.getElementById("rule-timezone").value = rule.timezone;
  let hint = currentScope === "tab"
    ? "Temporary: applies only to this tab. Inherited policy removes its override."
    : "Saved for this exact hostname. Other open tabs need their own reload.";
  if (currentScope === "site") {
    if (pageStatus?.tabOverride) hint += " A tab override currently takes priority over site rules.";
    else if (pageStatus?.source === "excluded") hint += " An exclusion takes priority; manage it in All rules and exclusions.";
    else if (pageStatus?.source === "whitelist") hint += " This site is outside the whitelist; manage it in All rules and exclusions.";
  }
  document.getElementById("scope-hint").textContent = canEditRules() ? hint : "Open an HTTP or HTTPS web page to edit its rule.";
  toggleTimezoneInput();
  updateEditorAvailability();
}

async function updateUI({ preserveDrafts = false, savedScope = null } = {}) {
  const [settingsPayload, status] = await Promise.all([
    sendMessage({ action: "tzc:get-settings" }),
    sendMessage({ action: "tzc:get-tab-status" })
  ]);
  const samePage = currentTabId === status.tabId && currentHost === status.hostname;
  const savedRules = {
    site: { mode: status.siteRule?.mode || "inherit", timezone: status.siteRule?.timezone || "" },
    tab: { mode: status.tabOverride?.mode || "inherit", timezone: status.tabOverride?.timezone || "" }
  };
  if (samePage && (preserveDrafts || savedScope)) {
    drafts[currentScope] = readRuleForm();
    if (savedScope) drafts[savedScope] = savedRules[savedScope];
  } else {
    drafts = savedRules;
  }
  if (!samePage) currentScope = status.tabOverride ? "tab" : "site";
  currentTabId = status.tabId ?? null;
  currentHost = status.hostname || "";
  pageStatus = status;

  const runtime = settingsPayload.runtime || {};
  document.getElementById("timezone").textContent = runtime.timezone || "Unknown";
  document.getElementById("location").textContent = runtime.city && runtime.country ? `${runtime.city}, ${runtime.country}` : "Unknown";
  document.getElementById("ip").textContent = runtime.ip || "Unknown";
  document.getElementById("last-update").textContent = runtime.lastUpdate ? new Date(runtime.lastUpdate).toLocaleTimeString() : "--";

  const supported = canEditRules();
  const modeLabels = { auto: "Auto by IP", fixed: "Fixed timezone", disable: "Do not spoof" };
  const sourceLabels = { tabOverride: "Tab override", siteRule: "Site rule", excluded: "Excluded site", whitelist: "Outside whitelist", default: "Default policy" };
  document.getElementById("current-host").textContent = supported ? currentHost : "Not a supported web page";
  document.getElementById("current-mode").textContent = supported ? modeLabels[status.mode] || status.mode : "Not available";
  document.getElementById("effective-timezone").textContent = supported ? status.timezone || "Unknown" : "Not available";
  document.getElementById("rule-source").textContent = supported ? sourceLabels[status.source] || status.source : "Not applicable";
  document.getElementById("page-message").hidden = supported;
  document.getElementById("page-message").textContent = supported ? "" : "Timezone spoofing is not available on this page.";
  renderRuleEditor();
  if (status.error) throw new Error(status.error);
}

function showError(error) {
  const errors = {
    "invalid-timezone": "Enter a valid timezone, for example America/New_York.",
    "unsupported-tab": "Timezone spoofing is not available on this page.",
    "invalid-tab": "This tab is no longer available. Reopen the popup."
  };
  document.getElementById("status-message").textContent = errors[error?.message] || error?.message || "Operation failed.";
  if (!pageStatus) {
    document.getElementById("page-message").textContent = "Unable to read the current page. Try Refresh or reopen the popup.";
    document.getElementById("effective-timezone").textContent = "Not available";
  }
}

function onAction(id, action) {
  const button = document.getElementById(id);
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    document.getElementById("status-message").textContent = "";
    try { await action(); }
    catch (error) { showError(error); }
    finally {
      button.disabled = false;
      updateEditorAvailability();
    }
  });
}

document.getElementById("rule-mode").addEventListener("change", toggleTimezoneInput);
document.getElementById("rule-scope").addEventListener("change", () => {
  drafts[currentScope] = readRuleForm();
  currentScope = document.getElementById("rule-scope").value === "tab" ? "tab" : "site";
  renderRuleEditor();
});

onAction("apply-rule-btn", async () => {
  if (!canEditRules() || editorBusy) return;
  const tabId = currentTabId;
  const hostname = currentHost;
  const scope = currentScope;
  const rule = readRuleForm();
  const timezone = rule.timezone.trim();
  editorBusy = true;
  updateEditorAvailability();
  try {
    await sendMessage(scope === "tab"
      ? { action: "tzc:set-tab-rule", tabId, mode: rule.mode, timezone }
      : { action: "tzc:set-site-rule", pattern: hostname, rule: { mode: rule.mode, timezone } });
    await chrome.tabs.reload(tabId);
    await updateUI({ savedScope: scope });
    document.getElementById("status-message").textContent = scope === "tab"
      ? "Saved for this tab. Page reloaded."
      : "Saved for this site. Page reloaded; other open tabs need a reload.";
  } finally {
    editorBusy = false;
  }
});

onAction("refresh-btn", async () => {
  const result = await sendMessage({ action: "refresh" });
  if (!result.success) throw new Error("IP lookup failed. Last known data has been kept.");
  await updateUI({ preserveDrafts: true });
});
onAction("open-options-btn", () => chrome.runtime.openOptionsPage());

renderRuleEditor();
updateUI().catch(showError);
