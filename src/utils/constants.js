/**
 * Single source of truth for persisted keys, defaults and the internal message
 * protocol. Everything that is written to `chrome.storage` or sent over
 * `chrome.runtime.sendMessage` is declared here, so a rename can never drift
 * between the service worker, the popup and the options page.
 */

// ---------------------------------------------------------------------------
// chrome.storage.local keys (persist across browser restarts)
// ---------------------------------------------------------------------------
export const STORAGE_KEYS = {
  WHITELIST: 'whitelist',
  SLEEPING_TABS: 'sleepingTabs',
  SETTINGS: 'settings',
  STATISTICS: 'statistics',
  LOCKED_TABS: 'lockedTabs'
};

// ---------------------------------------------------------------------------
// chrome.storage.session keys (cleared when the browser exits) — perfect for
// "which browser-run am I in" and for transient run state.
// ---------------------------------------------------------------------------
export const SESSION_KEYS = {
  /** Timestamp (ms) until which the startup-suspend window stays open. */
  STARTUP_WINDOW_END: 'startupWindowEnd',
  /** Map of tabId -> last-active timestamp, used by auto-sleep. */
  AUTO_SLEEP_ACTIVITY: 'autoSleepLastActive'
};

/** Domains that should never be slept out of the box. */
export const DEFAULT_WHITELIST = [
  'gmail.com',
  'mail.google.com',
  'teams.microsoft.com',
  'slack.com',
  'discord.com',
  'zoom.us',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'notion.so',
  'figma.com',
  'meet.google.com',
  'web.whatsapp.com',
  'messenger.com',
  'twitter.com',
  'x.com'
];

export const DEFAULT_SETTINGS = {
  excludeAudibleTabs: true, // Exclude tabs playing audio
  excludePinnedTabs: true, // Exclude pinned tabs
  preserveFormData: true, // Save form data before sleeping
  preserveScrollPosition: true, // Save scroll position before sleeping
  showBadge: true, // Show badge with active tab count
  confirmSleepAll: true, // Ask before "sleep all other tabs"
  autoSleepEnabled: false, // Auto sleep inactive tabs
  autoSleepTimeout: 30, // Minutes of inactivity before auto sleep
  startupSuspendEnabled: true, // Keep session-restored tabs unloaded at startup
  startupIncludePinned: false // Startup suspend also discards pinned tabs
};

// ---------------------------------------------------------------------------
// Auto-sleep tuning
// ---------------------------------------------------------------------------
export const AUTO_SLEEP = {
  ALARM_NAME: 'autoSleepCheck',
  CHECK_INTERVAL_MINUTES: 1,
  DEFAULT_TIMEOUT_MINUTES: 30,
  MIN_TIMEOUT_MINUTES: 1,
  MAX_TIMEOUT_MINUTES: 120
};

// ---------------------------------------------------------------------------
// Startup suspend timing. The session-restore race is caught by
// onCreated(status === 'unloaded'); the fallback window below catches anything
// the service worker missed while it was booting (onUpdated + periodic sweep).
// ---------------------------------------------------------------------------
export const STARTUP_SUSPEND_WINDOW_MS = 45 * 1000;
export const STARTUP_SWEEP_INTERVAL_MS = 750;

export const DEFAULT_STATISTICS = {
  totalSlept: 0,
  totalWoken: 0,
  lastReset: Date.now()
};

/** URL schemes that can never be discarded by the extension. */
export const CHROME_INTERNAL_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'chrome-search://',
  'devtools://'
];

/**
 * Internal message protocol between UI surfaces (popup/options), the content
 * script and the service worker. Values are the literal `type` strings on the
 * wire — never change a value without checking `docs/ARCHITECTURE.md`.
 */
export const MESSAGE_TYPES = {
  // Tab lifecycle
  SLEEP_TAB: 'sleepTab',
  SLEEP_ALL_OTHER: 'sleepAllOther',
  WAKE_TAB: 'wakeTab',

  // Whitelist
  GET_WHITELIST: 'getWhitelist',
  ADD_TO_WHITELIST: 'addToWhitelist',
  REMOVE_FROM_WHITELIST: 'removeFromWhitelist',

  // Settings & statistics
  GET_SETTINGS: 'getSettings',
  UPDATE_SETTINGS: 'updateSettings',
  GET_STATISTICS: 'getStatistics',
  RESET_STATISTICS: 'resetStatistics',

  // Per-tab lock (survives batch operations)
  LOCK_TAB: 'lockTab',
  UNLOCK_TAB: 'unlockTab',
  GET_LOCKED_TABS: 'getLockedTabs',

  // Batch sleep ("sleep all other tabs")
  GET_BATCH_STATUS: 'getBatchStatus',
  ABORT_BATCH: 'abortBatch',

  // Test hook used by scripts/smoke-test.py to force a startup sweep.
  TRIGGER_STARTUP_SWEEP: 'triggerStartupSweep'
};
