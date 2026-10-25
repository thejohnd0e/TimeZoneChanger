# TimeZone Changer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-2.01-blue.svg)](#)
[![Browser](https://img.shields.io/badge/Chrome-Extension-green.svg)](#)

`TimeZone Changer` is a Chrome extension (Manifest V3) that aligns browser timezone behavior with your network/IP location, while giving full per-site and per-tab control over spoofing.

## Highlights (v2.01)

- Automatic timezone detection by IP (`ipwho.is`, `freeipapi.com`)
- Domain exclusions with wildcard support (`*.domain.com`)
- Whitelist mode support
- Per-site rules:
  - `Do not spoof`
  - `Fixed timezone`
  - `Auto by IP`
- Per-tab overrides (session-scoped)
- Tab-lifetime timezone lock in auto mode (stable behavior while tab is open)
- Safe patching strategy (Proxy-based where possible)
- Popup and Options UI for rule management

## Default Protected Domains

Spoofing is disabled by default on critical Google/Gemini domains to avoid breaking uploads and auth flows:

- `*.google.com`
- `gemini.google.com`
- `*.googleapis.com`
- `upload.googleapis.com`
- `*.gstatic.com`
- `accounts.google.com`

On these hosts the extension falls back to real system timezone behavior.

## Rule Priority

Rules are resolved in this order:

1. Per-tab override
2. Exclusion / whitelist decision
3. Per-site rule (most specific matching pattern)
4. Global default mode (`auto`)

A per-tab override can explicitly bypass an exclusion. A site rule cannot.
`*.example.com` matches subdomains, not the apex `example.com`; add that domain
separately if needed. Existing protected-domain defaults are unchanged.

**Auto locks:** a successfully detected timezone stays locked for the lifetime of
the tab, including reloads and navigation. Refreshing IP data does not change an
existing lock; open a new tab to use the new timezone. On first detection failure,
the system timezone is a temporary fallback and is not locked. Reload that page
after IP detection recovers to apply the newly available timezone.

**Rule editing:** `Auto by IP` is an explicit rule. `Use inherited policy` removes
the exact site rule; `Use site/default policy` removes the tab override. A broader
wildcard site rule can still apply after removing an exact rule. Reload affected
pages after changing settings; applying a tab rule reloads the tab automatically.

## Storage Model

- `chrome.storage.sync`: settings, domain lists, site rules
- `chrome.storage.local`: runtime IP/timezone metadata
- `chrome.storage.session`: per-tab temporary state (lock/override)

## UI

- **Popup**
  - Current timezone/IP/location status
  - Current host + active mode
  - Quick action: add current site to exclusions
  - Quick per-site and per-tab mode controls
- **Options page**
  - Manage excluded domains
  - Manage whitelist domains
  - Manage per-site rules

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the project folder.

## Technical Notes

- Uses content-script + page-context injection model
- Checks `location.hostname` before applying spoof logic
- Supports all frames (`all_frames: true`)
- Maintains MV3 compatibility

## License

MIT. See [LICENSE](LICENSE).
