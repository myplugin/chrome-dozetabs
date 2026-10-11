# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tab Sleep Tool is a Chrome extension (Manifest V3) that hibernates inactive tabs to save memory using Chrome's `chrome.tabs.discard()` API. It supports i18n (English and Chinese) and uses Lucide Icons for UI elements.

## Development

### Loading the Extension
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `src` folder
4. To reload after changes: click the refresh button on the extension card

### No Build Process
This extension uses native ES modules and runs directly in Chrome. No bundling or transpilation required.

## Architecture

### Component Communication Flow
```
Popup/Options (UI) → chrome.runtime.sendMessage → Service Worker → Chrome APIs
                                                              ↓
                                                        chrome.storage.local
```

All business logic resides in the Service Worker. UI components (popup, options) communicate via `MESSAGE_TYPES` defined in `constants.js`.

### Key Files

| File | Purpose |
|------|---------|
| `src/background/service-worker.js` | Core logic: sleep/wake tabs, context menus, badge updates |
| `src/popup/popup.js` | Tab list UI, sleep buttons, i18n |
| `src/options/options.js` | Settings management, whitelist config |
| `src/utils/tab-manager.js` | Tab operations: query, discard, check sleepable |
| `src/utils/storage.js` | Wrapper for `chrome.storage.local` with defaults |
| `src/utils/whitelist.js` | Domain matching logic (supports `*.example.com` wildcards) |
| `src/utils/constants.js` | `MESSAGE_TYPES`, `DEFAULT_SETTINGS`, `DEFAULT_WHITELIST` |

### i18n
- Locale files: `src/_locales/en/messages.json`, `src/_locales/zh_CN/messages.json`
- Use `chrome.i18n.getMessage('key')` or the `t('key')` helper function
- HTML elements with `data-i18n` attribute are auto-translated via `applyTranslations()`

### Tab Sleep Logic

A tab can be slept if it passes all checks in `canSleepTab()`:
1. Not already discarded (`tab.discarded === false`)
2. Not an empty/new tab page
3. Not a Chrome internal page (`chrome://`, `about:`, etc.)
4. Not pinned (if `excludePinnedTabs` setting enabled)
5. Not playing audio (if `excludeAudibleTabs` setting enabled)
6. Not in whitelist

### State Preservation
Before discarding, `executeScript` captures:
- Scroll position (`window.scrollX`, `window.scrollY`)
- Form data (inputs, textareas, selects - except passwords)

This state is stored in `chrome.storage.local` under `sleepingTabs[tabId]`.

## Debugging

- **Service Worker logs**: `chrome://extensions/` → Click "Service Worker" link
- **Popup logs**: Right-click popup → Inspect
- All logs use `[Tab Sleep]` prefix

## Testing (three layers)

| Layer | Command | Deps | Covers |
|-------|---------|------|--------|
| Unit (vitest) | `npm test` (`npm install` first) | vitest | `tests/*.test.js` — whitelist, constants |
| Logic (node) | `npm run test:startup` | none | `tests/startup-suspend.test.mjs` — 13 assertions on startup-suspend with mocked chrome APIs; reliable in any env incl. CI |
| i18n parity | `npm run test:i18n` | none | `tests/i18n-check.mjs` — en/zh key parity + used-but-undefined keys (informational) |
| Smoke (real browser) | `python scripts/smoke-test.py --tabs 12` | Playwright + desktop Edge/Chrome | 12-tab A/B; full 200-tab procedure in `docs/STARTUP-SUSPEND-TEST.md` |

## Packaging

- `node tool/build.js [version]` (or `tool/build.sh` / `tool/build.bat`) — zips `src/` into `dist/tab-sleep-v<version>.zip` for store submission. No external npm dependencies.

## Common Modifications

### Adding a new setting
1. Add to `DEFAULT_SETTINGS` in `constants.js`
2. Add UI in `options.html` with `data-i18n` for label
3. Update `options.js` to handle the setting
4. Use in service worker via `getSettings()`

### Adding a new message type
1. Add to `MESSAGE_TYPES` in `constants.js`
2. Add handler in `handleMessage()` switch in `service-worker.js`
3. Call from popup/options via `sendMessage({ type: MESSAGE_TYPES.XXX, payload })`

### Adding new translation
1. Add key to both `src/_locales/en/messages.json` and `src/_locales/zh_CN/messages.json`
2. Use `t('key')` in JS or `data-i18n="key"` in HTML
