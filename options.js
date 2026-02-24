function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response));
  });
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
  button.addEventListener("click", onDelete);
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

document.getElementById("add-exclude-btn").addEventListener("click", async () => {
  const input = document.getElementById("exclude-input");
  const value = input.value.trim().toLowerCase();
  if (!value) return;
  const settings = await loadSettings();
  if (!settings.excludedDomains.includes(value)) settings.excludedDomains.push(value);
  await saveSettings(settings);
  input.value = "";
  await render();
});

document.getElementById("add-whitelist-btn").addEventListener("click", async () => {
  const input = document.getElementById("whitelist-input");
  const value = input.value.trim().toLowerCase();
  if (!value) return;
  const settings = await loadSettings();
  if (!settings.whitelistDomains.includes(value)) settings.whitelistDomains.push(value);
  await saveSettings(settings);
  input.value = "";
  await render();
});

document.getElementById("add-rule-btn").addEventListener("click", async () => {
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

render();
