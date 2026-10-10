import {
  MESSAGE_TYPES,
  STORAGE_KEYS,
  SESSION_KEYS,
  ICONS,
  STARTUP_SUSPEND_WINDOW_MS,
  STARTUP_SWEEP_INTERVAL_MS
} from '../utils/constants.js';
import {
  getSettings,
  saveSettings,
  getWhitelist,
  saveWhitelist,
  getSleepingTabs,
  saveSleepingTab,
  removeSleepingTab,
  getStatistics,
  incrementSleepCount,
  incrementWakeCount,
  resetStatistics,
  initializeStorage,
  lockTab,
  unlockTab,
  isTabLocked,
  getLockedTabs
} from '../utils/storage.js';
import {
  canSleepTab,
  sleepTab,
  reloadTab,
  queryTabs,
  getTab,
  executeScript,
  getActiveTabCount
} from '../utils/tab-manager.js';
import {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  isChromeInternalPage,
  isEmptyTabPage,
  extractDomain,
  matchesPattern
} from '../utils/whitelist.js';

// Batch operation state
let batchOperation = {
  isRunning: false,
  currentTabId: null,
  total: 0,
  processed: 0,
  slept: 0,
  skipped: 0,
  aborted: false
};

// Auto-sleep state
let autoSleepState = {
  lastActiveTime: {}, // tabId -> timestamp
  isEnabled: false,
  timeoutMinutes: 30
};

// Constants for auto-sleep
const AUTO_SLEEP_CHECK_INTERVAL = 1; // Check every 1 minute
const AUTO_SLEEP_ALARM_NAME = 'autoSleepCheck';

// ============ Startup Suspend (启动抢先丢弃) state ============
// See the dedicated section near the bottom of this file for the full logic.
const startupSuspend = {
  windowEnd: 0,        // ms timestamp; 0 or in the past => window closed
  settings: null,      // cached while the window is open (speed matters in the race)
  whitelist: null,
  lockedTabs: null,
  userActivated: new Set(), // tabIds the user actually activated this session
  pendingStats: 0,     // startup discards not yet written to statistics
  sweepTimer: null
};

let browserJustStarted = false;       // set by chrome.runtime.onStartup
let startupSuspendInitDone = false;

const hasSessionStorage = typeof chrome.storage !== 'undefined' && typeof chrome.storage.session !== 'undefined';
const sessionMemory = new Map();     // fallback when chrome.storage.session is unavailable

// Kick off startup-window detection as soon as the SW boots. Handlers below
// await this promise before acting, so they never see a stale/unset window.
const startupSuspendReady = initStartupSuspend();

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  await createContextMenus();
  await setupAutoSleep();
  console.log('Tab Sleep Tool installed');
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  // This event only fires when the browser (profile) itself starts - the
  // canonical signal for opening the startup suspend window.
  browserJustStarted = true;
  try {
    await openStartupWindowIfNeeded();
  } catch (e) {
    console.warn('[Tab Sleep] Failed to open startup suspend window:', e);
  }

  await initializeStorage();
  await createContextMenus();
  await updateBadge();
  await setupAutoSleep();
});

// Create context menus
async function createContextMenus() {
  // Remove existing menus
  await chrome.contextMenus.removeAll();

  // Create new menus - use 'page' for right-click on page, 'action' for extension icon
  chrome.contextMenus.create({
    id: 'sleep-current-tab',
    title: chrome.i18n.getMessage('contextMenuSleep'),
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'sleep-other-tabs',
    title: chrome.i18n.getMessage('contextMenuSleepOthers'),
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'separator-1',
    type: 'separator',
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'add-to-whitelist',
    title: chrome.i18n.getMessage('contextMenuAddToWhitelist'),
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'remove-from-whitelist',
    title: chrome.i18n.getMessage('contextMenuRemoveFromWhitelist'),
    contexts: ['page', 'action']
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'sleep-current-tab':
      await handleSleepTab(tab.id);
      break;
    case 'sleep-other-tabs':
      await handleSleepAllOther(tab.id);
      break;
    case 'add-to-whitelist':
      await handleAddToWhitelist(tab.url);
      break;
    case 'remove-from-whitelist':
      await handleRemoveFromWhitelist(tab.url);
      break;
  }
});

// Handle keyboard shortcuts (commands)
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    switch (command) {
      case 'sleep-current-tab':
        await handleSleepTab(tab.id);
        break;
      case 'sleep-other-tabs':
        await handleSleepAllOther(tab.id);
        break;
    }
  } catch (error) {
    console.error('[Tab Sleep] Command handler error:', error);
  }
});

// Handle tab activation (waking up sleeping tabs and tracking activity)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Tabs the user actually visited are never touched by startup suspend.
  startupSuspend.userActivated.add(activeInfo.tabId);

  // Update last active time for auto-sleep
  autoSleepState.lastActiveTime[activeInfo.tabId] = Date.now();

  let tab;
  try {
    tab = await getTab(activeInfo.tabId);
  } catch (e) {
    return; // Tab vanished between the event and our lookup - nothing to do.
  }

  if (tab.discarded) {
    // Tab is being woken up
    await handleWakeTab(tab);
  }
});

// ============ Startup suspend: the preemptive race ============
// Session-restored tabs are first created with status === 'unloaded' and are
// only navigated afterwards. Discarding them in this instant keeps them
// unloaded until clicked. Ordinary new tabs are unaffected because they are
// active when created (or protected by the checks inside startupDiscardTab).
chrome.tabs.onCreated.addListener(async (tab) => {
  await startupSuspendReady;
  if (!isStartupWindowOpen()) return;
  const ctx = await getStartupSuspendContext();
  if (!ctx.settings.startupSuspendEnabled) return;
  await startupDiscardTab(ctx, tab, 'created');
});

// Update badge and clear lock status when tabs are removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await unlockTab(tabId); // Clear lock status when tab is closed
  updateBadgeSoon();
});

// Update badge when tabs are updated
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.discarded !== undefined) {
    updateBadgeSoon();
  }

  // Startup suspend fallback: inside the post-startup window, any background
  // tab that slipped into 'loading' (the SW was still booting, or a restored
  // tab raced past onCreated) is discarded immediately.
  if (changeInfo.status === 'loading' && tab && !tab.active) {
    await startupSuspendReady;
    if (isStartupWindowOpen()) {
      const ctx = await getStartupSuspendContext();
      if (ctx.settings.startupSuspendEnabled) {
        await startupDiscardTab(ctx, tab, 'updated');
      }
    }
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Tab Sleep] Received message:', message.type, message);
  handleMessage(message, sender).then(result => {
    console.log('[Tab Sleep] Sending response for', message.type, ':', result);
    sendResponse(result);
  }).catch(error => {
    console.error('[Tab Sleep] Error handling message:', message.type, error);
    sendResponse({ error: error.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  const { type, payload } = message;
  console.log('[Tab Sleep] Processing message type:', type, 'payload:', payload);

  switch (type) {
    case 'getTabId':
      // Used by the content script to find its own tab id for state restore.
      return { tabId: sender?.tab?.id ?? null };

    case MESSAGE_TYPES.SLEEP_TAB:
      return await handleSleepTab(payload.tabId);

    case MESSAGE_TYPES.SLEEP_ALL_OTHER:
      console.log('[Tab Sleep] Calling handleSleepAllOther with tabId:', payload.currentTabId);
      return await handleSleepAllOther(payload.currentTabId);

    case MESSAGE_TYPES.WAKE_TAB:
      return await handleWakeTab(payload.tab);

    case MESSAGE_TYPES.GET_WHITELIST:
      return { whitelist: await getWhitelist() };

    case MESSAGE_TYPES.ADD_TO_WHITELIST:
      return await handleAddToWhitelist(payload.url);

    case MESSAGE_TYPES.REMOVE_FROM_WHITELIST:
      return await handleRemoveFromWhitelist(payload.domain);

    case MESSAGE_TYPES.GET_SETTINGS:
      return { settings: await getSettings() };

    case MESSAGE_TYPES.UPDATE_SETTINGS:
      await saveSettings(payload.settings);
      return { success: true };

    case MESSAGE_TYPES.RESET_STATISTICS:
      await resetStatistics();
      return { success: true, statistics: await getStatistics() };

    case MESSAGE_TYPES.GET_STATISTICS:
      return { statistics: await getStatistics() };

    case MESSAGE_TYPES.GET_SLEEPING_TABS:
      return { sleepingTabs: await getSleepingTabs() };

    case MESSAGE_TYPES.FETCH_FAVICON:
      return await handleFetchFavicon(payload.url);

    case MESSAGE_TYPES.LOCK_TAB:
      await lockTab(payload.tabId);
      return { success: true };

    case MESSAGE_TYPES.UNLOCK_TAB:
      await unlockTab(payload.tabId);
      return { success: true };

    case MESSAGE_TYPES.IS_TAB_LOCKED: {
      const locked = await isTabLocked(payload.tabId);
      return { isLocked: locked };
    }

    case MESSAGE_TYPES.GET_LOCKED_TABS: {
      const tabs = await getLockedTabs();
      return { lockedTabs: Array.from(tabs) };
    }

    case MESSAGE_TYPES.GET_BATCH_STATUS:
      return {
        isRunning: batchOperation.isRunning,
        currentTabId: batchOperation.currentTabId,
        total: batchOperation.total,
        processed: batchOperation.processed,
        slept: batchOperation.slept,
        skipped: batchOperation.skipped
      };

    case MESSAGE_TYPES.ABORT_BATCH:
      if (batchOperation.isRunning) {
        batchOperation.aborted = true;
        return { success: true, message: 'Batch operation aborted' };
      }
      return { success: false, message: 'No batch operation running' };

    case MESSAGE_TYPES.AUTO_SLEEP_STATUS:
      return {
        enabled: autoSleepState.isEnabled,
        timeoutMinutes: autoSleepState.timeoutMinutes
      };

    case MESSAGE_TYPES.GET_STARTUP_STATUS: {
      const ctx = await getStartupSuspendContext();
      return {
        windowOpen: isStartupWindowOpen(),
        windowEnd: startupSuspend.windowEnd,
        enabled: !!ctx.settings.startupSuspendEnabled,
        includePinned: !!ctx.settings.startupIncludePinned,
        discardedThisWindow: startupSuspend.pendingStats
      };
    }

    case MESSAGE_TYPES.TRIGGER_STARTUP_SWEEP:
      // Test hook: force a startup sweep now (used by scripts/smoke-test.py
      // to control sweep timing explicitly after session restore completes).
      return { discarded: await sweepStartupTabs('manual') };

    default:
      return { error: 'Unknown message type' };
  }
}

// Fetch favicon and return as base64 data URL
async function handleFetchFavicon(url) {
  const DEFAULT_FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5f6368"><circle cx="12" cy="12" r="10"/></svg>');

  if (!url) {
    return { success: false, dataUrl: DEFAULT_FAVICON };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.debug(`[Tab Sleep] Favicon fetch returned ${response.status}: ${url}`);
      return { success: false, dataUrl: DEFAULT_FAVICON };
    }

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({ success: true, dataUrl: reader.result });
      };
      reader.onerror = () => {
        resolve({ success: false, dataUrl: DEFAULT_FAVICON });
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.debug(`[Tab Sleep] Favicon fetch failed: ${url}`);
    return { success: false, dataUrl: DEFAULT_FAVICON };
  }
}

// Sleep a single tab
// options.skipBadgeUpdate: true when called from batch operations
// options.skipStateCapture: true to skip scroll/form state capture (faster for batch)
async function handleSleepTab(tabId, options = {}) {
  const { skipBadgeUpdate = false, skipStateCapture = false } = options;

  try {
    const tab = await getTab(tabId);
    const { canSleep, reason } = await canSleepTab(tab);

    if (!canSleep) {
      return { success: false, reason };
    }

    // Check if active tab
    const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const isActiveTab = activeTab && activeTab.id === tabId;

    // Switch away if active
    if (isActiveTab) {
      await switchAwayFromTab(tab);
    }

    // Prepare tab state
    const tabState = {
      tabId,
      originalUrl: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      sleptAt: Date.now()
    };

    // Capture scroll/form state (skip for batch operations to speed up)
    if (!skipStateCapture) {
      const settings = await getSettings();
      if (settings.preserveScrollPosition || settings.preserveFormData) {
        try {
          const results = await executeScript(tabId, {
            func: captureTabState,
            args: [settings.preserveScrollPosition, settings.preserveFormData]
          });

          if (results && results[0] && results[0].result) {
            const capturedState = results[0].result;
            if (settings.preserveScrollPosition) {
              tabState.scrollPosition = capturedState.scrollPosition;
            }
            if (settings.preserveFormData) {
              tabState.formData = capturedState.formData;
            }
          }
        } catch (e) {
          // Skip state capture on error
        }
      }
    }

    // Save state to storage
    await saveSleepingTab(tabId, tabState);

    // Sleep the tab (discard)
    await sleepTab(tabId);

    // Update statistics
    await incrementSleepCount();

    // Update badge (skip if batch operation)
    if (!skipBadgeUpdate) {
      await updateBadge();
    }

    // Clear lock status
    await unlockTab(tabId);

    return { success: true };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

// Switch away from a tab before sleeping it
async function switchAwayFromTab(tab) {
  const windowId = tab.windowId;

  // Get all tabs in the same window
  const tabs = await chrome.tabs.query({ windowId });

  // Find an existing empty/new tab page to switch to
  const emptyTab = tabs.find(t =>
    t.id !== tab.id &&
    isEmptyTabPage(t.url, t.title)
  );

  if (emptyTab) {
    // Switch to existing empty/new tab page
    await chrome.tabs.update(emptyTab.id, { active: true });
  } else {
    // No empty tab found, create a new blank tab
    await chrome.tabs.create({ windowId, url: 'about:blank', active: true });
  }
}

// Function to be executed in the tab context
function captureTabState(saveScroll, saveForm) {
  const state = {};

  if (saveScroll) {
    state.scrollPosition = {
      x: window.scrollX,
      y: window.scrollY
    };
  }

  if (saveForm) {
    state.formData = {};
    const inputs = document.querySelectorAll('input:not([type="password"]), textarea, select');

    inputs.forEach((el, index) => {
      const key = el.id || el.name || `element_${index}`;
      if (el.type === 'checkbox' || el.type === 'radio') {
        state.formData[key] = el.checked;
      } else {
        state.formData[key] = el.value;
      }
    });
  }

  return state;
}

// Sleep all other tabs (parallel processing, no state capture for speed)
async function handleSleepAllOther(currentTabId) {
  // Initialize batch operation state
  batchOperation = {
    isRunning: true,
    currentTabId,
    total: 0,
    processed: 0,
    slept: 0,
    skipped: 0,
    aborted: false
  };

  try {
    const tabs = await queryTabs();

    // Filter out current tab and already discarded tabs
    const tabsToProcess = tabs.filter(tab =>
      tab.id !== currentTabId && !tab.discarded
    );

    batchOperation.total = tabsToProcess.length;

    // No tabs to process
    if (tabsToProcess.length === 0) {
      batchOperation.isRunning = false;
      return { slept: 0, skipped: 0, reasons: [] };
    }

    const results = {
      slept: 0,
      skipped: 0,
      reasons: []
    };

    const CONCURRENCY = 10;

    // Process in batches
    for (let i = 0; i < tabsToProcess.length; i += CONCURRENCY) {
      // Check for abort
      if (batchOperation.aborted) {
        batchOperation.isRunning = false;
        return {
          ...results,
          aborted: true,
          message: 'Operation aborted by user'
        };
      }

      const batch = tabsToProcess.slice(i, i + CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(async (tab) => {
          const { canSleep, reason } = await canSleepTab(tab);
          if (!canSleep) {
            return { success: false, reason, title: tab.title };
          }
          return await handleSleepTab(tab.id, { skipBadgeUpdate: true, skipStateCapture: true });
        })
      );

      for (const result of batchResults) {
        batchOperation.processed++;
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            results.slept++;
            batchOperation.slept++;
          } else {
            results.skipped++;
            batchOperation.skipped++;
            if (result.value.title) {
              results.reasons.push({ title: result.value.title, reason: result.value.reason });
            }
          }
        } else {
          results.skipped++;
          batchOperation.skipped++;
        }
      }
    }

    // Update badge once at the end
    await updateBadge();

    batchOperation.isRunning = false;
    return results;
  } catch (error) {
    batchOperation.isRunning = false;
    return { slept: 0, skipped: 0, reasons: [], error: error.message };
  }
}

// Wake a tab (reload it)
async function handleWakeTab(tab) {
  try {
    const sleepingTabs = await getSleepingTabs();
    const tabState = sleepingTabs[tab.id];

    if (tabState) {
      // This tab was slept by the user/batch path and we captured state.
      // Reload it, then hand the captured scroll/form data to the content script.
      await reloadTab(tab.id);

      // Store state temporarily for content script to pick up
      const key = `restore_${tab.id}`;
      await chrome.storage.local.set({ [key]: tabState });

      // Clean up after a delay
      setTimeout(async () => {
        await chrome.storage.local.remove(key);
        await removeSleepingTab(tab.id);
      }, 5000);
    } else {
      // No captured state - e.g. a tab suspended at browser startup (it was
      // never loaded, so there is no scroll/form data to preserve). Chrome
      // reloads a discarded tab by itself when it is activated, so issuing an
      // extra reload here would only restart the load in flight.
    }

    await incrementWakeCount();
    await updateBadge();

    return { success: true };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

// Add domain to whitelist
async function handleAddToWhitelist(url) {
  const domain = extractDomain(url);
  if (!domain) {
    return { success: false, reason: 'Invalid URL' };
  }

  const added = await addToWhitelist(domain);
  return { success: added, domain };
}

// Remove domain from whitelist
async function handleRemoveFromWhitelist(domain) {
  const removed = await removeFromWhitelist(domain);
  return { success: removed };
}

// Update badge with active tab count
async function updateBadge() {
  const settings = await getSettings();

  if (!settings.showBadge) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const count = await getActiveTabCount();

  if (count === 0) {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    await chrome.action.setBadgeText({ text: count.toString() });
    await chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
  }
}

// ============ Auto Sleep Functions ============

/**
 * Setup auto-sleep alarm based on settings
 */
async function setupAutoSleep() {
  const settings = await getSettings();
  autoSleepState.isEnabled = settings.autoSleepEnabled;
  autoSleepState.timeoutMinutes = settings.autoSleepTimeout || 30;

  // Clear existing alarm
  await chrome.alarms.clear(AUTO_SLEEP_ALARM_NAME);

  if (settings.autoSleepEnabled) {
    // Create alarm to check every minute
    await chrome.alarms.create(AUTO_SLEEP_ALARM_NAME, {
      periodInMinutes: AUTO_SLEEP_CHECK_INTERVAL
    });
    console.log('[Tab Sleep] Auto-sleep enabled with timeout:', autoSleepState.timeoutMinutes, 'minutes');
  } else {
    console.log('[Tab Sleep] Auto-sleep disabled');
  }
}

/**
 * Handle auto-sleep alarm - check for idle tabs
 */
async function handleAutoSleepCheck() {
  if (!autoSleepState.isEnabled) {
    return;
  }

  const now = Date.now();
  const timeoutMs = autoSleepState.timeoutMinutes * 60 * 1000;

  try {
    const tabs = await queryTabs();
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab?.id;

    for (const tab of tabs) {
      // Skip already discarded tabs
      if (tab.discarded) continue;

      // Skip active tab
      if (tab.id === activeTabId) continue;

      // Get last active time (default to now if not tracked)
      const lastActive = autoSleepState.lastActiveTime[tab.id] || now;
      const idleTime = now - lastActive;

      // Check if tab has been idle long enough
      if (idleTime >= timeoutMs) {
        const { canSleep } = await canSleepTab(tab);
        if (canSleep) {
          console.log('[Tab Sleep] Auto-sleeping tab:', tab.title);
          await handleSleepTab(tab.id, { skipBadgeUpdate: true, skipStateCapture: true });
        }
      }
    }

    // Update badge after processing
    await updateBadge();
  } catch (error) {
    console.error('[Tab Sleep] Auto-sleep check error:', error);
  }
}

// Listen for alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_SLEEP_ALARM_NAME) {
    await handleAutoSleepCheck();
  }
});

// ============ Startup Suspend (启动抢先丢弃) ============
//
// Goal: when the browser reopens one or two hundred session-restored tabs,
// they must STAY unloaded instead of all loading at once and spiking memory.
//
// Mechanism (all native discard - no tab closing, no fake pages):
//   1. onCreated: session-restored tabs are created with status === 'unloaded'
//      and only navigated afterwards. Discarding in that instant intercepts
//      the load; the tab stays in the tab strip unloaded and loads when
//      clicked. Ordinary new tabs are active/pinned-checked and unaffected.
//   2. Fallback window (STARTUP_SUSPEND_WINDOW_MS after browser start): any
//      non-active tab seen 'loading' via onUpdated or via the periodic sweep
//      is discarded immediately - covers tabs that raced past the SW boot.
//   3. The window is opened by chrome.runtime.onStartup (the canonical
//      "browser just started" signal). The window boundary lives in
//      chrome.storage.session so an SW restart mid-window resumes instead of
//      re-arming. Extension reloads/updates do NOT fire onStartup, so they
//      correctly never open the window (no mass-discard on update).
//
// Settings: startupSuspendEnabled (master switch), startupIncludePinned
// (default off). Whitelisted domains and locked tabs are still respected.

async function sessionGet(key) {
  if (hasSessionStorage) {
    try {
      const result = await chrome.storage.session.get(key);
      return result[key];
    } catch (e) {
      // fall through to the in-memory fallback
    }
  }
  return sessionMemory.has(key) ? sessionMemory.get(key) : undefined;
}

async function sessionSet(obj) {
  if (hasSessionStorage) {
    try {
      await chrome.storage.session.set(obj);
      return;
    } catch (e) {
      // fall through to the in-memory fallback
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    sessionMemory.set(key, value);
  }
}

function isStartupWindowOpen() {
  return startupSuspend.windowEnd > Date.now();
}

async function initStartupSuspend() {
  if (startupSuspendInitDone) return;
  startupSuspendInitDone = true;
  try {
    const now = Date.now();
    const end = await sessionGet(SESSION_KEYS.STARTUP_WINDOW_END);

    if (end !== undefined && end > now) {
      // Window still open (SW restarted mid-window) - resume sweeps.
      startupSuspend.windowEnd = end;
      await refreshStartupSuspendCaches();
      await sweepStartupTabs('resume');
      scheduleStartupSweeps();
      scheduleStartupStatsFlush();
      return;
    }

    // Window not open: idle until chrome.runtime.onStartup fires (browser
    // start). Extension reloads/updates never fire onStartup, so they
    // correctly never open the window. (scripts/smoke-test.py opens the
    // window explicitly via chrome.storage.session + TRIGGER_STARTUP_SWEEP
    // because some automation environments don't deliver onStartup.)
  } catch (e) {
    console.warn('[Tab Sleep] Startup suspend init failed:', e);
  }
}

// Opens the startup suspend window. Called from chrome.runtime.onStartup
// (the canonical "browser just started" signal) only.
async function openStartupWindowIfNeeded() {
  await startupSuspendReady;
  await openStartupWindowNow();
}

// The actual window-opening logic. Does NOT await startupSuspendReady so it
// can be called from inside initStartupSuspend without deadlocking.
async function openStartupWindowNow() {
  if (isStartupWindowOpen()) return;
  const now = Date.now();
  const end = now + STARTUP_SUSPEND_WINDOW_MS;
  await sessionSet({ [SESSION_KEYS.STARTUP_WINDOW_END]: end });
  startupSuspend.windowEnd = end;
  console.log('[Tab Sleep] Startup suspend window open for', STARTUP_SUSPEND_WINDOW_MS, 'ms');
  await refreshStartupSuspendCaches();
  await sweepStartupTabs('startup');
  scheduleStartupSweeps();
  scheduleStartupStatsFlush();
}

// Cache settings/whitelist/locks in memory: the onCreated race is measured in
// milliseconds, so per-tab storage reads would be too slow. Invalidated by
// chrome.storage.onChanged below.
async function refreshStartupSuspendCaches() {
  const [settings, whitelist, lockedTabs] = await Promise.all([
    getSettings(),
    getWhitelist(),
    getLockedTabs()
  ]);
  startupSuspend.settings = settings;
  startupSuspend.whitelist = whitelist;
  startupSuspend.lockedTabs = lockedTabs;
}

async function getStartupSuspendContext() {
  if (!startupSuspend.settings || !startupSuspend.whitelist || !startupSuspend.lockedTabs) {
    await refreshStartupSuspendCaches();
  }
  return startupSuspend;
}

function invalidateStartupSuspendCaches() {
  startupSuspend.settings = null;
  startupSuspend.whitelist = null;
  startupSuspend.lockedTabs = null;
}

function isUrlInCachedWhitelist(ctx, url) {
  const domain = extractDomain(url);
  if (!domain) return false;
  return (ctx.whitelist || []).some(pattern => matchesPattern(domain, pattern));
}

// Discard one tab during the startup window.
// source: 'created' (only intercepts the unloaded -> loading transition),
//         'updated'  (kills in-flight loads of background tabs),
//         'sweep'    (also catches tabs that finished loading before the SW
//                     could see them - fast restores / slow SW boot).
// Tabs the user actually activated are never touched.
async function startupDiscardTab(ctx, tab, source) {
  try {
    if (!tab || tab.discarded) return false;
    if (tab.active) return false;                          // never a tab being viewed
    if (tab.pinned && !ctx.settings.startupIncludePinned) return false;
    if (tab.autoDiscardable === false) return false;        // browser forbids discarding it
    if (startupSuspend.userActivated.has(tab.id)) return false;
    if (source === 'created' && tab.status !== 'unloaded') return false;
    if (source === 'updated' && tab.status !== 'unloaded' && tab.status !== 'loading') return false;
    if (source === 'sweep' && tab.status !== 'unloaded' && tab.status !== 'loading' && tab.status !== 'complete') return false;
    if (isEmptyTabPage(tab.url, tab.title) || isChromeInternalPage(tab.url)) return false;
    if (ctx.lockedTabs && ctx.lockedTabs.has(tab.id)) return false;
    if (isUrlInCachedWhitelist(ctx, tab.url)) return false;

    await chrome.tabs.discard(tab.id);
    startupSuspend.pendingStats++;
    if (startupSuspend.pendingStats >= 10) flushStartupStats(); // incremental flush
    return true;
  } catch (e) {
    // Tab vanished, already discarded, or the load won the race - harmless,
    // the sweep retries within the window.
    return false;
  }
}

// Periodic sweep across ALL windows: catches restored tabs that started
// loading while the SW was booting, and retries tabs that raced past events.
async function sweepStartupTabs(reason) {
  try {
    const ctx = await getStartupSuspendContext();
    if (!ctx.settings.startupSuspendEnabled) return 0;
    const tabs = await chrome.tabs.query({});
    let discarded = 0;
    for (const tab of tabs) {
      if (tab.active) {
        // The tab being viewed (per window) - protect it from the sweep's
        // 'complete' rule even after the user later switches away from it.
        startupSuspend.userActivated.add(tab.id);
        continue;
      }
      if (await startupDiscardTab(ctx, tab, 'sweep')) discarded++;
    }
    if (discarded > 0) {
      console.log(`[Tab Sleep] Startup sweep (${reason}): discarded ${discarded} tabs`);
    }
    return discarded;
  } catch (e) {
    return 0;
  }
}

function scheduleStartupSweeps() {
  if (startupSuspend.sweepTimer) return;
  const tick = async () => {
    startupSuspend.sweepTimer = null;
    if (!isStartupWindowOpen()) return;
    await sweepStartupTabs('timer');
    if (isStartupWindowOpen()) {
      startupSuspend.sweepTimer = setTimeout(tick, STARTUP_SWEEP_INTERVAL_MS);
    }
  };
  startupSuspend.sweepTimer = setTimeout(tick, STARTUP_SWEEP_INTERVAL_MS);
}

function scheduleStartupStatsFlush() {
  const remaining = Math.max(0, startupSuspend.windowEnd - Date.now());
  setTimeout(flushStartupStats, remaining + 500);
}

async function flushStartupStats() {
  const count = startupSuspend.pendingStats;
  if (count <= 0) return;
  startupSuspend.pendingStats = 0;
  try {
    await incrementSleepCount(count);
    console.log('[Tab Sleep] Startup suspend flushed', count, 'discards to statistics');
  } catch (e) { /* statistics are cosmetic - ignore */ }
}

// ============ Badge debounce ============
// Bulk operations (startup window) would otherwise call updateBadge once per
// tab; collapse those into at most one update per interval.
let badgeUpdateTimer = null;
function updateBadgeSoon() {
  if (badgeUpdateTimer) return;
  badgeUpdateTimer = setTimeout(async () => {
    badgeUpdateTimer = null;
    try {
      await updateBadge();
    } catch (e) { /* ignore */ }
  }, 500);
}

// Listen for settings changes to update auto-sleep and drop cached startup data
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.settings) {
    const newSettings = changes.settings.newValue;
    if (newSettings?.autoSleepEnabled !== undefined) {
      await setupAutoSleep();
    }
    invalidateStartupSuspendCaches();
  }
  if (changes.whitelist) {
    startupSuspend.whitelist = null;
  }
  if (changes.lockedTabs) {
    startupSuspend.lockedTabs = null;
  }
});

// Log service worker activation
console.log('Tab Sleep Tool service worker loaded');
