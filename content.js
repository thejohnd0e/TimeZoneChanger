(async function () {
    const data = await chrome.storage.local.get('timezone');
    if (!data.timezone) return;

    // Передаем зону через атрибут html, чтобы spoof.js её увидел сразу
    document.documentElement.dataset.tzChanger = data.timezone;

    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('spoof.js');
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
})();
