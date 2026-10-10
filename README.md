# Tab Sleep Tool

A Chrome extension that allows you to hibernate inactive tabs to save memory and CPU resources. Similar to Firefox's Tab Unload feature or The Great Suspender.

## Features

- **Sleep Current Tab**: Quickly put the active tab to sleep with one click
- **Sleep All Other Tabs**: Hibernate all tabs except the current one
- **Startup Suspend** (启动抢先休眠): Tabs restored at browser startup stay unloaded instead of all loading at once - they load only when you click them. Prevents the multi-GB memory spike when the browser reopens one or two hundred tabs (uses only the native `chrome.tabs.discard()`; no tab closing, no fake pages)
- **Auto Sleep**: Automatically sleep tabs after configurable inactivity period
- **Auto Wake**: Click on a sleeping tab to automatically reload it
- **State Preservation**: Optionally save scroll position and form data
- **Whitelist**: Protect important domains from being put to sleep
- **Tab Lock**: Lock individual tabs to prevent them from being slept (even during batch operations)
- **Smart Filtering**: Automatically excludes pinned tabs, tabs playing audio, and Chrome internal pages
- **Context Menu**: Right-click to quickly sleep tabs or add domains to whitelist
- **Keyboard Shortcuts**: Use Alt+S to sleep current tab, Alt+Shift+S to sleep all other tabs
- **Statistics**: Track how many tabs you've put to sleep
- **Badge Counter**: See the number of sleeping tabs at a glance
- **Batch Operation Control**: Abort sleep-all operations mid-progress

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `chrome-extension-tab-sleep` folder
6. The extension icon should appear in your toolbar

### Generate Icons

Before using the extension, you need to generate the PNG icon files:

1. Open `icon-generator.html` in Chrome
2. Click "Download All Icons"
3. Save each icon to the `assets/icons/` directory with the correct filename:
   - icon16.png
   - icon32.png
   - icon48.png
   - icon128.png
   - icon16-sleep.png
   - icon32-sleep.png

## Usage

### Popup Interface

Click the extension icon to open the popup:

- **Sleep Current Tab**: Button to sleep the active tab
- **Sleep All Other Tabs**: Button to sleep all tabs except the current one
  - Shows progress during batch operations
  - Can abort mid-operation with the "Abort" button
- **Tab List**: View all tabs in the current window with sleep/wake/lock buttons
  - Toggle between Active and Sleeping views
  - Lock individual tabs to prevent sleeping
- **Settings**: Link to open the full settings page

### Right-Click Menu

Right-click on any page to access:

- **Sleep this tab**: Put the current tab to sleep
- **Sleep all other tabs**: Hibernate all other tabs
- **Add domain to whitelist**: Protect the current domain
- **Remove domain from whitelist**: Unprotect the current domain

### Waking Tabs

Simply click on a sleeping tab to wake it up. The page will reload and:
- Scroll position will be restored (if enabled)
- Form data will be restored (if enabled)

### Keyboard Shortcuts

The extension supports keyboard shortcuts for quick actions:

| Shortcut | Action |
|----------|--------|
| `Alt+S` | Sleep current tab |
| `Alt+Shift+S` | Sleep all other tabs |

You can customize these shortcuts in Chrome:
1. Go to `chrome://extensions/shortcuts`
2. Find "Tab Sleep Tool"
3. Click the pencil icon to change the shortcut

## Settings

Access settings by:
1. Right-click the extension icon → Options
2. Or click the "Settings" link in the popup

### General Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Exclude pinned tabs | Pinned tabs will never be put to sleep | On |
| Exclude tabs playing audio | Tabs with active audio won't be slept | On |
| Show badge counter | Display sleeping tab count on icon | On |

### Auto Sleep

| Setting | Description | Default |
|---------|-------------|---------|
| Enable auto sleep | Automatically sleep tabs after inactivity | Off |
| Sleep after (minutes) | Minutes of inactivity before auto sleep | 30 |

Note: Auto sleep respects all exclusion rules (pinned, audio, whitelist, locked tabs).

### Startup Suspend

| Setting | Description | Default |
|---------|-------------|---------|
| Suspend restored tabs at startup | Tabs restored at browser startup stay unloaded; click to load | On |
| Include pinned tabs | Also keep pinned tabs unloaded at startup | Off |

When the browser reopens many tabs, they stay unloaded instead of all loading at once — this is what prevents the multi-GB memory spike. Only the tab you're viewing loads; every other tab loads when you click it.

### State Preservation

| Setting | Description | Default |
|---------|-------------|---------|
| Save scroll position | Remember scroll position when waking | On |
| Save form data | Remember form inputs (except passwords) | On |

### Whitelist

Manage domains that should never be put to sleep. Default whitelist includes:

- Gmail (gmail.com, mail.google.com)
- Microsoft Teams (teams.microsoft.com)
- Slack (slack.com)
- Discord (discord.com)
- Zoom (zoom.us)
- Google Docs/Sheets/Slides
- Notion (notion.so)
- Figma (figma.com)
- And more...

### Tab Lock

Lock individual tabs to prevent them from being put to sleep:

- **Lock a tab**: Click the lock icon in the popup tab list
- **Unlock a tab**: Click the lock icon again to unlock
- **Behavior**: Locked tabs are protected from both manual and batch sleep operations
- **Indicator**: Locked tabs show a lock icon in the popup

Tab lock is useful when you have specific tabs you want to keep active at all times, regardless of whitelist settings.

## How It Works

### Tab Discarding

The extension uses Chrome's built-in `chrome.tabs.discard()` API to unload tabs. When a tab is discarded:

1. The tab remains visible in the tab bar
2. The page content is unloaded from memory
3. The favicon and title remain visible
4. Clicking the tab reloads the page

### Memory Savings

Each discarded tab typically saves 50-200MB of RAM depending on the page complexity. Use Chrome's Task Manager (Shift+Esc) to verify memory savings.

### Limitations

- **Page State Lost**: JavaScript state is not preserved (e.g., game progress, SPA state)
- **Form Data**: Only basic form inputs are saved; complex editors may not be preserved
- **Chrome Pages**: Internal pages (chrome://, settings, etc.) cannot be discarded

## Development

### Project Structure

```
chrome-extension-tab-sleep/
├── manifest.json              # Extension manifest (Manifest V3)
├── src/
│   ├── background/
│   │   └── service-worker.js  # Core business logic
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   ├── options/
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.js
│   ├── content/
│   │   └── content-script.js  # State capture/restore
│   └── utils/
│       ├── constants.js       # Constants and defaults
│       ├── storage.js         # Storage utilities
│       ├── tab-manager.js     # Tab operations
│       └── whitelist.js       # Whitelist management
├── assets/icons/              # Extension icons
└── README.md
```

### Key APIs Used

- `chrome.tabs.discard()` - Unload tabs
- `chrome.tabs.query()` - Query tab information
- `chrome.storage.local` - Persist settings and state
- `chrome.contextMenus` - Right-click menu
- `chrome.scripting` - Inject content scripts

### Building

No build process required! This extension uses native ES modules and runs directly in Chrome.

## Browser Compatibility

- **Chrome**: 88+ (Manifest V3 support)
- **Microsoft Edge**: 88+ (Chromium-based)

Not compatible with Firefox or Safari.

## Privacy

This extension:
- Does NOT collect any user data
- Does NOT make any network requests
- Stores all data locally using chrome.storage.local
- Does NOT require any external services

## Troubleshooting

### Tab won't sleep

The tab may be:
- A Chrome internal page (chrome://)
- Playing audio (if audio exclusion is enabled)
- Pinned (if pinned exclusion is enabled)
- In the whitelist

### Form data not restored

Some forms use complex JavaScript that can't be captured. Basic forms should work correctly.

### Extension icon not showing

Make sure you've generated the PNG icons using the icon-generator.html file.

## Testing

- **Unit tests** (no browser needed): `node tests/startup-suspend.test.mjs` — validates the startup-suspend logic with mocked chrome APIs.
- **E2E smoke test** (real Edge, 12-tab A/B): `python scripts/smoke-test.py --tabs 12` — see `docs/STARTUP-SUSPEND-TEST.md` for the full 200-tab acceptance procedure and the before/after comparison table.

## License

MIT License - feel free to use and modify.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

Inspired by:
- [The Great Suspender](https://github.com/deanoemcke/thegreatsuspender)
- [Tab Discard](https://github.com/ragingwind/tab-discard)
- Firefox's built-in Tab Unload feature
