(function () {
  const DEFAULT_EXCLUDED_DOMAINS = [
    "*.google.com",
    "gemini.google.com",
    "*.googleapis.com",
    "upload.googleapis.com",
    "*.gstatic.com",
    "accounts.google.com"
  ];

  const DEFAULT_SETTINGS = {
    defaultMode: "auto",
    excludedDomains: DEFAULT_EXCLUDED_DOMAINS,
    whitelistDomains: [],
    siteRules: {}
  };

  function escapeRegex(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  function patternToRegex(pattern) {
    const trimmed = String(pattern || "").trim().toLowerCase();
    if (!trimmed) return null;
    const parts = trimmed.split("*").map(escapeRegex);
    return new RegExp("^" + parts.join(".*") + "$", "i");
  }

  function matchesPattern(hostname, pattern) {
    const host = String(hostname || "").trim().toLowerCase();
    const normalizedPattern = String(pattern || "").trim().toLowerCase();
    if (!host || !normalizedPattern) return false;
    if (normalizedPattern === host) return true;
    const regex = patternToRegex(normalizedPattern);
    return !!regex && regex.test(host);
  }

  function findBestRule(hostname, siteRules) {
    let bestRule = null;
    let bestPattern = null;
    let bestScore = -1;
    for (const [pattern, rule] of Object.entries(siteRules || {})) {
      if (!matchesPattern(hostname, pattern)) continue;
      const score = pattern.replace(/\*/g, "").length;
      if (score > bestScore) {
        bestScore = score;
        bestPattern = pattern;
        bestRule = rule;
      }
    }
    return { pattern: bestPattern, rule: bestRule };
  }

  function resolveHostnameBehavior(hostname, settings) {
    const safeSettings = {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
      excludedDomains: Array.isArray(settings?.excludedDomains) ? settings.excludedDomains : DEFAULT_SETTINGS.excludedDomains,
      whitelistDomains: Array.isArray(settings?.whitelistDomains) ? settings.whitelistDomains : [],
      siteRules: settings?.siteRules && typeof settings.siteRules === "object" ? settings.siteRules : {}
    };

    if (safeSettings.excludedDomains.some((pattern) => matchesPattern(hostname, pattern))) {
      return { mode: "disable", source: "excluded" };
    }

    if (safeSettings.whitelistDomains.length > 0 && !safeSettings.whitelistDomains.some((pattern) => matchesPattern(hostname, pattern))) {
      return { mode: "disable", source: "whitelist" };
    }

    const { pattern, rule } = findBestRule(hostname, safeSettings.siteRules);
    if (rule && typeof rule === "object") {
      return {
        mode: rule.mode || "auto",
        timezone: rule.timezone || "",
        source: "siteRule",
        pattern
      };
    }

    return { mode: safeSettings.defaultMode || "auto", source: "default" };
  }

  function sanitizeSettings(raw) {
    const safe = {
      ...DEFAULT_SETTINGS,
      ...(raw || {}),
      excludedDomains: Array.isArray(raw?.excludedDomains) ? raw.excludedDomains.map((v) => String(v).trim()).filter(Boolean) : [...DEFAULT_SETTINGS.excludedDomains],
      whitelistDomains: Array.isArray(raw?.whitelistDomains) ? raw.whitelistDomains.map((v) => String(v).trim()).filter(Boolean) : [],
      siteRules: {}
    };

    if (raw?.siteRules && typeof raw.siteRules === "object") {
      for (const [pattern, rule] of Object.entries(raw.siteRules)) {
        const normalizedPattern = String(pattern || "").trim();
        if (!normalizedPattern || !rule || typeof rule !== "object") continue;
        const mode = rule.mode === "disable" || rule.mode === "fixed" ? rule.mode : "auto";
        safe.siteRules[normalizedPattern] = {
          mode,
          timezone: mode === "fixed" ? String(rule.timezone || "").trim() : ""
        };
      }
    }

    return safe;
  }

  globalThis.TZC_SHARED = {
    DEFAULT_EXCLUDED_DOMAINS,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    matchesPattern,
    resolveHostnameBehavior
  };
})();
