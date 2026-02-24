# 🕒 TimeZone Changer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-2.01-blue.svg)](#)
[![Browser](https://img.shields.io/badge/Chrome-Extension-green.svg)](#)

**TimeZone Changer** is a powerful Google Chrome extension that automatically synchronizes your browser's timezone with your current IP address location. This is crucial for maintaining privacy and passing "Timezone Mismatch" checks on various privacy-focused websites.

---

## 🚀 Key Features

- **Automatic Detection:** Instantly detects IP changes when you switch networks or toggle your VPN.
- **Deep Spoofing:** Overrides `Intl.DateTimeFormat`, `Date.getTimezoneOffset`, and other browser APIs at the page level.
- **Smart Updates:** Checks for IP changes on every navigation and periodically in the background.
- **Reliable Data:** Utilizes multiple redundant APIs (ipwho.is, freeipapi.com) for high accuracy.
- **iFrame Support:** The spoofing logic works seamlessly across all frames on a page.

## 🛠 Technical Stack

- **Manifest V3** (Current Chrome standard)
- **Vanilla JavaScript** (Maximum performance, zero dependencies)
- **Chrome Storage API** (Persistent state management)
- **Scripting API** (High-authority script injection)

## 📦 Installation

1. Download or clone this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right corner.
4. Click **"Load unpacked"**.
5. Select the project folder.

## 🖥 How to Use

Once installed, the extension works automatically:
1. It identifies your current IP and the corresponding timezone.
2. Click the extension icon to see your current status: city, country, IP, and timezone.
3. If you switch your VPN, the extension will automatically reload active tabs to apply the new timezone settings.

## 🔍 How It Works

The extension operates on three layers:
1. **Background Service Worker:** Monitors network activity and fetches timezone data.
2. **Content Script:** Prepares the environment for every page you visit.
3. **Injected Script:** Injected into the page's execution context before any other scripts run, patching system Date and Time functions.

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

*Designed for maximum online privacy and seamless browsing.*
