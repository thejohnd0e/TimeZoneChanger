(function () {
  const hostname = window.location.hostname;
  if (!hostname) return;

  chrome.runtime.sendMessage({ action: "tzc:get-page-config", hostname }, (config) => {
    if (chrome.runtime.lastError || !config || !config.shouldSpoof || !config.timezone) {
      return;
    }

    document.documentElement.dataset.tzChanger = config.timezone;

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("spoof.js");
    script.dataset.tz = config.timezone;
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  });
})();
