// Storage Keys
export const STORAGE_KEYS = {
  WHITELIST: 'whitelist',
  SLEEPING_TABS: 'sleepingTabs',
  SETTINGS: 'settings',
  STATISTICS: 'statistics',
  LOCKED_TABS: 'lockedTabs'
};

// Session storage keys (cleared when the browser exits - perfect for
// "which browser-run am I in" and transient run state)
export const SESSION_KEYS = {
  STARTUP_WINDOW_END: 'startupWindowEnd' // timestamp (ms) until which startup suspend is active
};

// Default whitelist domains that should not be slept
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

// Default settings
export const DEFAULT_SETTINGS = {
  excludeAudibleTabs: true,      // Exclude tabs playing audio
  excludePinnedTabs: true,       // Exclude pinned tabs
  preserveFormData: true,        // Save form data before sleeping
  preserveScrollPosition: true,  // Save scroll position before sleeping
  showBadge: true,               // Show badge with sleeping tab count
  confirmSleepAll: true,         // Confirm before sleeping all other tabs
  autoSleepEnabled: false,       // Auto sleep inactive tabs
  autoSleepTimeout: 30,          // Minutes of inactivity before auto sleep
  startupSuspendEnabled: true,  // Master switch: keep session-restored tabs unloaded at browser startup
  startupIncludePinned: false   // Startup suspend also discards pinned tabs (default: no)
};

// Startup suspend timing. The session-restore race is caught by
// onCreated(status === 'unloaded'); the fallback window below catches anything
// the SW missed while booting (onUpdated status === 'loading').
export const STARTUP_SUSPEND_WINDOW_MS = 45 * 1000;   // 30~60s 兜底窗口
export const STARTUP_SWEEP_INTERVAL_MS = 750;        // periodic sweep cadence inside the window

// Default statistics
export const DEFAULT_STATISTICS = {
  totalSlept: 0,
  totalWoken: 0,
  lastReset: Date.now()
};

// Chrome internal URLs that cannot be slept
export const CHROME_INTERNAL_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'chrome-search://',
  'devtools://'
];

// Message types for communication between components
export const MESSAGE_TYPES = {
  SLEEP_TAB: 'sleepTab',
  SLEEP_ALL_OTHER: 'sleepAllOther',
  WAKE_TAB: 'wakeTab',
  GET_TAB_STATE: 'getTabState',
  SAVE_TAB_STATE: 'saveTabState',
  RESTORE_TAB_STATE: 'restoreTabState',
  UPDATE_BADGE: 'updateBadge',
  ADD_TO_WHITELIST: 'addToWhitelist',
  REMOVE_FROM_WHITELIST: 'removeFromWhitelist',
  GET_WHITELIST: 'getWhitelist',
  GET_SETTINGS: 'getSettings',
  UPDATE_SETTINGS: 'updateSettings',
  RESET_STATISTICS: 'resetStatistics',
  GET_STATISTICS: 'getStatistics',
  GET_SLEEPING_TABS: 'getSleepingTabs',
  FETCH_FAVICON: 'fetchFavicon',
  LOCK_TAB: 'lockTab',
  UNLOCK_TAB: 'unlockTab',
  IS_TAB_LOCKED: 'isTabLocked',
  GET_LOCKED_TABS: 'getLockedTabs',
  GET_BATCH_STATUS: 'getBatchStatus',
  ABORT_BATCH: 'abortBatch',
  AUTO_SLEEP_STATUS: 'autoSleepStatus',
  GET_STARTUP_STATUS: 'getStartupStatus',
  TRIGGER_STARTUP_SWEEP: 'triggerStartupSweep'
};

// Icon paths
export const ICONS = {
  NORMAL: {
    16: 'assets/icons/icon16.png',
    32: 'assets/icons/icon32.png',
    48: 'assets/icons/icon48.png',
    128: 'assets/icons/icon128.png'
  },
  SLEEPING: {
    16: 'assets/icons/icon16-sleep.png',
    32: 'assets/icons/icon32-sleep.png'
  }
};
