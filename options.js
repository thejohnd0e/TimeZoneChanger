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

function showError(error) {
  document.getElementById("status-message").textContent = error?.message === "invalid-timezone"
    ? "Enter a valid timezone, for example America/New_York." : error?.message || "Operation failed.";
}

async function runAction(button, action) {
  button.disabled = true;
  document.getElementById("status-message").textContent = "";
  try {
    await action();
    document.getElementById("status-message").textContent = "Saved. Reload affected pages to apply.";
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

function onAction(id, action) {
  const button = document.getElementById(id);
  button.addEventListener("click", () => runAction(button, action));
}

function removeItem(list, value) {
  return list.filter((entry) => entry !== value);
}

function createListItem(text, onDelete) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = text;
  const button = document.createElement("button");
  button.textContent = "Delete";
  button.className = "del-btn";
  button.addEventListener("click", () => runAction(button, onDelete));
  li.appendChild(label);
  li.appendChild(button);
  return li;
}

async function loadSettings() {
  const payload = await sendMessage({ action: "tzc:get-settings" });
  return payload?.settings || null;
}

async function saveSettings(settings) {
  await sendMessage({ action: "tzc:update-settings", settings });
}

async function render() {
  const settings = await loadSettings();
  if (!settings) return;

  const excludeList = document.getElementById("exclude-list");
  const whitelistList = document.getElementById("whitelist-list");
  const rulesList = document.getElementById("rules-list");
  excludeList.innerHTML = "";
  whitelistList.innerHTML = "";
  rulesList.innerHTML = "";

  settings.excludedDomains.forEach((pattern) => {
    excludeList.appendChild(
      createListItem(pattern, async () => {
        settings.excludedDomains = removeItem(settings.excludedDomains, pattern);
        await saveSettings(settings);
        await render();
      })
    );
  });

  settings.whitelistDomains.forEach((pattern) => {
    whitelistList.appendChild(
      createListItem(pattern, async () => {
        settings.whitelistDomains = removeItem(settings.whitelistDomains, pattern);
        await saveSettings(settings);
        await render();
      })
    );
  });

  Object.entries(settings.siteRules).forEach(([pattern, rule]) => {
    const text = `${pattern} -> ${rule.mode}${rule.timezone ? ` (${rule.timezone})` : ""}`;
    rulesList.appendChild(
      createListItem(text, async () => {
        delete settings.siteRules[pattern];
        await saveSettings(settings);
        await render();
      })
    );
  });
}

onAction("add-exclude-btn", async () => {
  const input = document.getElementById("exclude-input");
  const value = input.value.trim().toLowerCase();
  if (!value) return;
  const settings = await loadSettings();
  if (!settings.excludedDomains.includes(value)) settings.excludedDomains.push(value);
  await saveSettings(settings);
  input.value = "";
  await render();
});

onAction("add-whitelist-btn", async () => {
  const input = document.getElementById("whitelist-input");
  const value = input.value.trim().toLowerCase();
  if (!value) return;
  const settings = await loadSettings();
  if (!settings.whitelistDomains.includes(value)) settings.whitelistDomains.push(value);
  await saveSettings(settings);
  input.value = "";
  await render();
});

onAction("add-rule-btn", async () => {
  const pattern = document.getElementById("rule-pattern").value.trim().toLowerCase();
  const mode = document.getElementById("rule-mode").value;
  const timezone = document.getElementById("rule-timezone").value.trim();
  if (!pattern) return;

  const settings = await loadSettings();
  settings.siteRules[pattern] = {
    mode,
    timezone: mode === "fixed" ? timezone : ""
  };

  await saveSettings(settings);
  document.getElementById("rule-pattern").value = "";
  document.getElementById("rule-timezone").value = "";
  await render();
});

render().catch(showError);
