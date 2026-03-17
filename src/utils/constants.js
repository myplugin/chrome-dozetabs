// Storage Keys
export const STORAGE_KEYS = {
  WHITELIST: 'whitelist',
  SLEEPING_TABS: 'sleepingTabs',
  SETTINGS: 'settings',
  STATISTICS: 'statistics'
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
  confirmSleepAll: true          // Confirm before sleeping all other tabs
};

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
  GET_STATISTICS: 'getStatistics',
  GET_SLEEPING_TABS: 'getSleepingTabs',
  FETCH_FAVICON: 'fetchFavicon'
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
