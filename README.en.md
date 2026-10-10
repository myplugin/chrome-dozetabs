# Tab Sleep

[中文](README.md) ｜ English (current)

> Too many tabs? Browser crawling, memory usage in the gigabytes, and every restart reloads hundreds of pages at once?
>
> **Tab Sleep hibernates the tabs you're not using. They stay right where they are — click one and it comes back — while the memory they were hogging is freed.**

It uses Chrome's native `chrome.tabs.discard()` API. Nothing is closed, no placeholder pages — a sleeping tab simply reloads when you click it.

## What it does for you

- **Instant relief when memory runs low**: sleep the current tab, or everything except it, with one click. Each page typically gives back tens to hundreds of MB.
- **Restarts that don't freeze**: with "Suspend restored tabs at startup", the hundred tabs from your last session stay unloaded — each one loads only when you click it.
- **Zero babysitting**: optional auto-sleep by idle time; pinned tabs, tabs playing audio, and whitelisted domains are left alone by default, so important pages never get caught out.

## Key features

| Feature | In short |
|---------|----------|
| Sleep current / sleep others | Two buttons in the popup, or `Alt+S` / `Alt+Shift+S` |
| Suspend at startup (on by default) | Session-restored tabs stay unloaded until you visit them |
| Auto-sleep (off by default) | Sleeps tabs idle longer than your threshold (e.g. 30 min) |
| Click to wake | Click a sleeping tab to reload it; scroll position and form contents optionally restored |
| Whitelist + per-tab lock | Keep whole domains exempt; lock individual tabs so even batch sleep skips them |
| Smart exclusions | Pinned tabs, audible tabs, and browser-internal pages are skipped automatically |

## Typical scenarios

1. **Research or work with dozens of tabs open**: done with a batch? "Sleep all others" keeps just the page you're on and drops memory usage immediately.
2. **Daily browser restarts**: leave startup suspend on — restoring 200 tabs costs about as much as loading one.
3. **Laptops and older machines**: combine with auto-sleep and background tabs stop quietly eating CPU and RAM.

## Getting started

### Install (about a minute)

1. Open `chrome://extensions/` and turn on "Developer mode" (top right).
2. Click "Load unpacked" and select the `src` folder of this repo.
3. The toolbar icon appears when it's ready. Works on Chrome, Edge, and other Chromium-based browsers.

### Everyday use

- Click the toolbar icon: **Sleep current tab** / **Sleep all other tabs** (batch runs can be cancelled midway).
- The popup's tab list sleeps, wakes, locks, or unlocks individual tabs.
- Right-click anywhere: sleep this tab, sleep the rest, or add/remove the current domain on the whitelist.
- To wake a tab, **just click it**.
- Shortcuts: `Alt+S` sleeps the current tab, `Alt+Shift+S` sleeps the rest (remappable at `chrome://extensions/shortcuts`).

## Settings at a glance

Open the options page from the popup ("Settings") or via right-click on the toolbar icon → Options:

| Setting | Default |
|---------|---------|
| Spare pinned tabs / audible tabs / badge counter | On |
| Suspend restored tabs at startup | On; pinned tabs excluded unless you opt in |
| Auto-sleep | Off; 30 minutes idle when enabled |
| Restore scroll position / form contents (passwords excluded) | On |
| Confirm before sleeping all other tabs | On |

The whitelist ships with common collaboration tools (Gmail, Slack, Notion, Figma, Zoom, …) and supports wildcards like `*.example.com`.

## How it works & going further

- **The one-liner**: pages are unloaded with Chrome's native `chrome.tabs.discard()` while the tab itself — title, favicon, position — stays put. Compare before/after in Chrome's Task Manager (`Shift+Esc`).
- **Limits**: in-page JS state (game progress, complex SPA state) isn't kept; fancy rich-text editors may not restore fully; internal pages like `chrome://` can't be slept.
- **Startup suspend mechanics and acceptance procedure**: see [docs/STARTUP-SUSPEND-TEST.md](docs/STARTUP-SUSPEND-TEST.md).
- **For developers** (layout, messaging, adding settings/translations): see [CLAUDE.md](CLAUDE.md). No build step — native ES modules run as-is. Tests: `node tests/startup-suspend.test.mjs` (unit), `python scripts/smoke-test.py --tabs 12` (smoke test on a real browser, see the doc above).

## Troubleshooting

- **A tab won't sleep?** Check whether it's an internal page, whitelisted, locked, or covered by the pinned/audible exclusions.
- **Form contents didn't come back?** Plain forms are fine; editors driven by heavy JS may not restore.
- **No toolbar icon?** Make sure you loaded the `src` directory and the PNGs under `src/assets/icons/` exist.

## Privacy

- No data collection — nothing is ever sent to any server.
- The only outbound requests load each site's own favicon (the same thing the browser itself does), and only while the popup list is open.
- Everything lives in local `chrome.storage.local`. No external services.
- Why the "read all websites" permission: sleep/wake captures scroll position and form contents (passwords excluded) locally on your machine — nothing leaves it.

## Contributing & license

MIT License — see [LICENSE](LICENSE). PRs welcome. Inspired by The Great Suspender, Tab Discard, and Firefox's Tab Unload.
