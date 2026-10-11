# Tab Sleep

[中文](README.md) ｜ English (current)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-informational.svg)](src/manifest.json)

> **Restart your browser and every tab loads at once — memory spikes into the
> double-digit gigabytes and the machine is unusable for minutes.**
> That is the problem this extension is built around.
>
> Secondarily, it also gives you a one-click way to hibernate tabs when memory
> runs low.

Built on Chrome's native `chrome.tabs.discard()`: **nothing is closed and no
placeholder page is injected** — click a sleeping tab and it reloads.

```bash
# Up and running in 30 seconds: clone, load src/, done. No build step.
git clone <repo> && cd tab-sleep
# chrome://extensions/ → Developer mode → Load unpacked → pick src/
```

---

## The problem it solves

Every tab gets its own renderer process. Open a lot of them and background
processes start eating memory. The real pain, though, is a **restart**: session
restore loads last session's hundred-plus tabs _simultaneously_, memory shoots
to 15–20 GB within seconds, the disk thrashes, and the machine is effectively
frozen for the next few minutes.

**Suspend restored tabs at startup** (on by default) targets exactly that
moment: restored tabs stay unloaded — titles, favicons and positions intact —
and **load only when you click them**. Restarting with 200 tabs then costs about
as much as loading one page.

For day-to-day use it also gives you:

- **One-click relief**: sleep the current tab, or everything except it, and
  cancel a batch midway if you change your mind.
- **No babysitting**: optional auto-sleep by idle time; pinned tabs, tabs playing
  audio and whitelisted domains are left alone by default.
- **Come back to where you were**: scroll position and form contents (passwords
  excluded, always) can be restored on wake.

## Goals

| Goal                                     | How                                                           |
| ---------------------------------------- | ------------------------------------------------------------- |
| Free memory without closing tabs         | Native discard; the tab itself stays put                      |
| **Do not load restored tabs at startup** | The core capability of this project                           |
| Never catch an important page            | Whitelist + per-tab lock + pinned/audible/internal exclusions |
| Come back to where you were              | Scroll position and form contents restored                    |
| Need no attention                        | Auto-sleep with sensible exclusions by default                |

### Non-goals

These are design boundaries, not a backlog:

- Not a tab manager: no session save/restore, no tab groups, no vertical tab strip.
- **No placeholder pages**: a sleeping tab is never replaced with custom DOM.
  That breaks the real site (and is where comparable extensions have historically
  gone wrong) — see [ADR-0001](docs/adr/0001-native-discard-over-placeholder.md).
- No in-page JS state: `discard()` destroys the renderer, so game progress and
  complex SPA state are gone by definition.
- Chromium only (no Firefox/Safari).
- No build step: `src/` _is_ the artifact.

## Typical scenarios

1. **Research or work with dozens of tabs open.**
   Done with a batch? "Sleep all others" keeps the page you're on and drops
   memory immediately.
2. **Daily browser restarts with hundreds of session tabs.**
   Leave startup suspend on: a restart costs about one page load, and each tab
   loads when you click it.
3. **Laptops and older machines.**
   Combine with auto-sleep and background tabs stop quietly eating RAM and CPU.

## How it compares

|                                            | This extension                                                     | Typical tab-sleep extensions                 | Chrome's built-in Memory Saver              |
| ------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------- |
| Mechanism                                  | Native `discard()`                                                 | Some replace the DOM with a placeholder page | Native `discard()`                          |
| **Restored tabs stay unloaded at startup** | ✅ Three-layer mechanism, effective as soon as the extension loads | ⚠️ Up to the browser's own policy            | ⚠️ Browser decides, timing not controllable |
| Domain whitelist / per-tab lock            | ✅ Both, honoured by batch sleep too                               | Usually whitelist only                       | Coarse whitelist                            |
| Restores scroll position and forms         | ✅ Passwords never captured                                        | Usually not restored                         | ❌                                          |
| Network access / data collection           | ❌ None                                                            | Varies                                       | ❌ None                                     |

The built-in feature is **necessary but not sufficient**: it discards tabs in the
background, but at the moment the browser starts it is not yet running, so the
restored tabs all load. Startup suspend fills exactly that gap.

## Getting started

### Install (about a minute)

1. Open `chrome://extensions/` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select the **`src`** folder of this repo — not the
   repository root.
3. The toolbar icon appears when it's ready. Works on Chrome, Edge, and other
   Chromium-based browsers.

### Everyday use

- Click the toolbar icon: **Sleep all other tabs** (click the same button again
  to cancel mid-run), plus per-tab sleep / wake / lock.
- Right-click anywhere: sleep this tab, sleep the rest, or add/remove the current
  domain on the whitelist.
- To wake a tab, **just click it**.
- Shortcuts: `Alt+S` sleeps the current tab, `Alt+Shift+S` sleeps the rest
  (remappable at `chrome://extensions/shortcuts`).

## Settings at a glance

Open the options page from the popup ("Settings") or via right-click on the
toolbar icon → Options:

| Setting                                                      | Default                                    |
| ------------------------------------------------------------ | ------------------------------------------ |
| Spare pinned tabs / audible tabs / badge counter             | On                                         |
| Confirm before sleeping all other tabs                       | On                                         |
| Suspend restored tabs at startup                             | On; pinned tabs excluded unless you opt in |
| Auto-sleep                                                   | Off; 30 minutes idle when enabled          |
| Restore scroll position / form contents (passwords excluded) | On                                         |

The whitelist ships with common collaboration tools (Gmail, Slack, Notion, Figma,
Zoom, …) and supports wildcards like `*.example.com`.

## How it works, and its limits

**In one line**: pages are unloaded with Chrome's native `chrome.tabs.discard()`
while the tab itself — title, favicon, position — stays put. Compare before/after
in Chrome's Task Manager (`Shift+Esc`).

**Startup suspend** uses three layers — intercepting the tab at creation,
a listener fallback on load events, and a periodic sweep for 45 seconds after
startup. The window is opened only by the browser's real "just started" signal,
so **updating the extension can never trigger it**. Full mechanism:
[architecture doc](docs/ARCHITECTURE.md#64-启动抢先休眠核心能力) (Chinese, with
English summary at the end of this file).

**Limits**:

- In-page JS state (game progress, complex SPA state) is not preserved;
- Rich-text editors driven by heavy JS may not restore fully;
- Browser-internal pages (`chrome://…`) cannot be slept;
- Background tabs opened within the ~45s startup window are suspended too
  (clicking loads them normally).

The full acceptance procedure — including a 200-tab real-browser A/B comparison —
is in [docs/STARTUP-SUSPEND-TEST.md](docs/STARTUP-SUSPEND-TEST.md) (Chinese).

## Development

```bash
npm ci        # installs eslint + prettier only; the test suite needs nothing
npm run check # what CI runs: format + lint + consistency checks + 120 tests
npm run build # produces dist/tab-sleep-v<version>.zip
```

- **No build step**: `src/` is the final artifact; edit a file and hit reload in
  `chrome://extensions/`.
- **Docs**: [architecture](docs/ARCHITECTURE.md) ·
  [development](docs/DEVELOPMENT.md) · [testing](docs/TESTING.md) ·
  [releasing](docs/RELEASING.md) · [roadmap](docs/ROADMAP.md) ·
  [decision records](docs/adr/README.md) · [audit report](docs/AUDIT.md)

## Privacy

- **No data is collected, nothing is sent to any server, and there is no
  analytics or telemetry of any kind.**
- Settings and state live only in local `chrome.storage.local` / `.session`.
  Scroll position and form contents are read once when a tab wakes up and
  **deleted immediately**; password fields are never captured.
- The only outbound request loads a site's own favicon (the same thing the
  browser itself does) and only while the popup is open. We plan to remove even
  that using Chrome's built-in `favicon` permission ([roadmap N1](docs/ROADMAP.md)).
- Why "read all websites": sleep/wake captures scroll position and form contents
  locally. Nothing leaves your machine. Full policy: [PRIVACY.md](PRIVACY.md).

## Contributing

Issues and PRs are welcome. Please read first:

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, conventions, required checks
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md) — threat model and how to report vulnerabilities

MIT License — see [LICENSE](LICENSE).
