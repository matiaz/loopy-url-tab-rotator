# Loopy URL Tab Rotator - Architecture

## Overview

A browser extension (Chrome, Firefox, Edge, Opera, Safari) that automatically rotates through web pages on a timer. Two modes: **Single Tab Rotation** (cycles through a user-defined URL list in one tab) and **Open Tabs Rotation** (cycles through existing open tabs in the current window).

## Architecture

- Single codebase using WebExtensions API (Manifest V3)
- Build step produces separate outputs per browser in `dist/`
- **Popup** -- the UI when clicking the extension icon, built with vanilla HTML/CSS/JS
- **Background service worker** -- handles rotation timer logic, tab switching, and URL loading
- **Browser storage API** -- persists all user settings automatically
- Popup communicates with background service worker via `chrome.runtime.sendMessage`
- **Offscreen document** (Chromium only) -- runs the rotation timer and sends a `tick` to the service worker on every interval, since service worker timers stop when the worker is suspended
- **Watchdog alarm** -- a `rotation-watchdog` alarm every 30 seconds wakes the background script, restores a running rotation from storage and catches up a missed step
- **Firefox and Safari** have no offscreen document, so they run the timer with `setInterval` in the background script and rely on the watchdog alarm to resume it after the browser unloads an idle background script

## Project Structure

```
loopy-url-tab-rotator/
├── src/
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   ├── background/
│   │   ├── service-worker.js
│   │   ├── offscreen.html        (Chromium only)
│   │   └── offscreen.js          (Chromium only)
│   ├── icons/
│   │   └── icon-{16,32,48,64,96,128}.png
│   ├── manifest.chrome.json      (Chrome, Edge, Opera, Safari)
│   └── manifest.firefox.json
├── scripts/
│   ├── build.js                  (src → dist/<browser>/)
│   ├── package.js                (dist/<browser>/ → packages/*.zip)
│   └── version.js                (package.json version → manifests)
├── docs/                         (GitHub Pages landing page)
├── dist/                         (build output, not tracked)
├── packages/                     (store zips, not tracked)
├── ARCHITECTURE.md
├── LICENSE
├── package.json
└── README.md
```

## Modes

### Single Tab Rotation

**URL Management:**
- Text input field + "Add" button to add URLs one at a time
- URLs appear in a list below with drag-and-drop reordering
- Each URL has a delete button
- URL validation on add: the input is parsed with `new URL()`, `https://` is prepended only when no scheme is given, and only `http:` and `https:` are accepted; anything else shows an inline error

**Timer Settings:**
- Dropdown with presets: 5s, 10s, 15s, 30s, 1min, 2min, 5min, 10min
- "Custom..." option opens a number input (in seconds, 1 to 86400); invalid values show an inline error and block Start

**Loop Settings:**
- Toggle switch: "Loop" (default off)
- When loop is ON:
  - Radio options: "Indefinitely" or "Specific number"
  - If "Specific number", a number input appears (minimum 1)
- When loop is OFF, rotation stops after reaching the last URL

**Behavior:**
- Rotation happens in the tab that was active when Start was pressed -- each URL loads in that same tab, even if you switch to another tab. If that tab is closed, rotation moves to the active tab
- When user hits "Start", the first URL loads immediately, then the timer begins for subsequent URLs
- Popup shows current status: which URL is active, progress through the list, current loop count

### Open Tabs Rotation

**Tab Scope:**
- Rotates through all open tabs in the current browser window
- Tab list is captured when the user hits "Start" (new tabs opened after starting are not included)
- Tabs closed during rotation are dropped from the list; rotation stops when none are left

**Timer Settings:**
- Same dropdown as Single Tab Rotation: 5s, 10s, 15s, 30s, 1min, 2min, 5min, 10min
- "Custom..." option for a specific number of seconds

**Loop Settings:**
- Toggle switch: "Loop" (default off)
- When loop is ON:
  - Radio options: "Indefinitely" or "Specific number"
  - If "Specific number", a number input appears (minimum 1)
- When loop is OFF, rotation stops after reaching the last tab

**Reload Option:**
- Toggle switch: "Reload page on switch" (default off)
- When ON, each tab is refreshed/reloaded when it becomes the active tab
- Applies every time a tab is switched to, including on loops

**Behavior:**
- Rotation starts from the currently active tab and moves left-to-right through tab order
- Popup shows current status: which tab is active (by title), progress, current loop count

## Popup UI

**Header:**
- Extension name/logo
- Light/dark mode toggle (sun/moon icon) in top-right corner

**Mode Tabs:**
- Two tabs below header: "Single Tab" and "Open Tabs"
- Active tab visually highlighted

**Configuration State (rotation not running):**
- Selected mode's settings displayed (URL list, timer, loop options)
- "Start" button at the bottom

**Active State (rotation running):**
- Settings replaced with status view:
  - Current mode label
  - Active URL or tab title
  - Progress indicator (e.g., "URL 3 of 7" or "Tab 2 of 5")
  - Loop counter if looping (e.g., "Loop 2 of 5" or "Loop 3 (indefinite)")
  - Elapsed time in current rotation
- "Stop" button to end rotation
- Stopping returns to configuration state with previous settings intact

**Dimensions:**
- Standard extension popup: ~350px wide, height adjusts to content (max ~500px with scroll)

## Storage Schema

Everything lives in `chrome.storage.local`. Popup settings:

```json
{
  "theme": "light",
  "singleTab": {
    "urls": ["https://example.com/", "https://github.com/"],
    "interval": 30,
    "intervalSelect": "30",
    "customSeconds": "",
    "loop": false,
    "loopType": "indefinite",
    "loopCount": 2
  },
  "openTabs": {
    "interval": 30,
    "intervalSelect": "30",
    "customSeconds": "",
    "loop": false,
    "loopType": "indefinite",
    "loopCount": 2,
    "reloadOnSwitch": false
  }
}
```

- `interval` is in seconds (`null` when the custom value is invalid)
- `intervalSelect` is the dropdown value (`"custom"` when a custom interval is used)

Rotation progress, written by the background script so it can resume after being suspended:

```json
{
  "rotation": {
    "running": true,
    "mode": "singleTab",
    "config": { "urls": [], "interval": 30, "loop": true, "indefinite": true, "loopCount": null },
    "currentIndex": 0,
    "currentLoop": 0,
    "tabIds": [],
    "targetTabId": 123,
    "startTime": 1760000000000,
    "lastAdvanceAt": 1760000000000
  }
}
```

- `config.loopCount` is `null` when loop is off or indefinite
- `tabIds` is used in Open Tabs mode, `targetTabId` in Single Tab mode
- The key is removed when rotation stops

## Messaging Protocol

Messages sent via `chrome.runtime.sendMessage`:

| Message | Direction | Response |
|---------|-----------|----------|
| `{ action: "start", mode: "singleTab", config: {...} }` | Popup → Background | `{ success }` |
| `{ action: "start", mode: "openTabs", config: {...} }` | Popup → Background | `{ success }` |
| `{ action: "stop" }` | Popup → Background | `{ success: true }` |
| `{ action: "getStatus" }` | Popup → Background | `{ running, mode, currentItem, currentIndex, totalItems, currentLoop, loop, indefinite, loopCount, startTime }` |
| `{ action: "start-offscreen-timer", interval }` | Background → Offscreen | none (interval in ms) |
| `{ action: "stop-offscreen-timer" }` | Background → Offscreen | none |
| `{ action: "tick" }` | Offscreen → Background | none |

The background script ignores any message whose `sender.id` is not its own extension id, and re-validates every `start` config: only `http:`/`https:` URLs are kept and `interval` is clamped to 1-86400 seconds. The popup polls `getStatus` once a second while the status view is open.

## Browser Compatibility

**Chrome:**
- Manifest V3
- `chrome.` namespace
- `service_worker` in manifest background key

**Firefox:**
- Manifest V3
- Uses the same `chrome.` namespace code, which Firefox supports
- `scripts` in manifest background key (event page, no offscreen document)

**Edge:**
- Chromium-based, uses the Chrome manifest
- Load via `edge://extensions`

**Opera:**
- Chromium-based, uses the Chrome manifest
- Load via `opera://extensions`

**Safari:**
- Uses the Chrome manifest without the `offscreen` permission and without the offscreen files; Safari has no offscreen API, so it uses the `setInterval` plus watchdog alarm path
- Uses `xcrun safari-web-extension-converter` to wrap the web extension in an Xcode project
- Build output: `dist/safari-xcode/` contains the full Xcode project
- Bundle identifier: `com.bhz.url-tab-rotator`
- macOS only (can be extended to iOS via converter flags)
- Requires Xcode to build and Apple Developer account to distribute

Build script copies `src/` to each `dist/` folder with the correct manifest renamed to `manifest.json`. For Safari, it additionally runs the Xcode converter to produce the native wrapper project. `npm run build` builds Safari only on macOS with Xcode available and skips it elsewhere.

The Firefox add-on id `url-tab-rotator@bhz` and the Safari bundle id `com.bhz.url-tab-rotator` are kept as-is because the published store listings depend on them.

## Tech Stack

- Vanilla HTML/CSS/JS (no frameworks, no bundlers)
- Node.js build scripts (Node 20+) for cross-browser builds and `zip` packaging
- Browser Storage API for persistence
- Native drag-and-drop API for URL reordering
