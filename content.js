(function () {
  const hostname = window.location.hostname;
  if (!hostname) return;

  let activeRequests = 0;
  const onNetworkEvent = (event) => {
    const type = event?.detail?.type;
    if (type === "start") activeRequests += 1;
    if (type === "end") activeRequests = Math.max(0, activeRequests - 1);
    chrome.runtime.sendMessage({
      action: "tzc:net-active",
      active: activeRequests > 0
    });
  };

  chrome.runtime.sendMessage({ action: "tzc:get-page-config", hostname }, (config) => {
    if (chrome.runtime.lastError || !config || !config.shouldSpoof || !config.timezone) {
      return;
    }

    document.documentElement.dataset.tzChanger = config.timezone;
    document.addEventListener("__tzc_network__", onNetworkEvent, true);

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("spoof.js");
    script.dataset.tz = config.timezone;
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  });
})();
