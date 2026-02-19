function updateUI() {
    chrome.storage.local.get(['timezone', 'city', 'country', 'ip', 'lastUpdate'], (data) => {
        document.getElementById('timezone').textContent = data.timezone || 'Unknown';
        document.getElementById('location').textContent = data.city && data.country ? `${data.city}, ${data.country}` : 'Unknown';
        document.getElementById('ip').textContent = data.ip || 'Unknown';

        if (data.lastUpdate) {
            const date = new Date(data.lastUpdate);
            document.getElementById('last-update').textContent = date.toLocaleTimeString();
        }
    });
}

document.getElementById('refresh-btn').addEventListener('click', () => {
    const btn = document.getElementById('refresh-btn');
    btn.textContent = 'Updating...';
    btn.disabled = true;

    chrome.runtime.sendMessage({ action: 'refresh' }, (response) => {
        btn.textContent = 'Refresh Now';
        btn.disabled = false;
        updateUI();
    });
});

// Initial Load
updateUI();
