import {
  MESSAGE_TYPES,
  STORAGE_KEYS,
  ICONS
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
  getSleepingTabCount
} from '../utils/tab-manager.js';
import {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  isChromeInternalPage,
  isEmptyTabPage,
  extractDomain
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

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  await createContextMenus();
  await setupAutoSleep();
  console.log('Tab Sleep Tool installed');
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
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
  const tab = await getTab(activeInfo.tabId);

  // Update last active time for auto-sleep
  autoSleepState.lastActiveTime[activeInfo.tabId] = Date.now();

  if (tab.discarded) {
    // Tab is being woken up
    await handleWakeTab(tab);
  }
});

// Update badge and clear lock status when tabs are removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await unlockTab(tabId); // Clear lock status when tab is closed
  await updateBadge();
});

// Update badge when tabs are updated
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.discarded !== undefined) {
    await updateBadge();
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

    // Reload the tab
    await reloadTab(tab.id);

    // Restore state after reload (if we have it)
    if (tabState) {
      // Store state temporarily for content script to pick up
      const key = `restore_${tab.id}`;
      await chrome.storage.local.set({ [key]: tabState });

      // Clean up after a delay
      setTimeout(async () => {
        await chrome.storage.local.remove(key);
        await removeSleepingTab(tab.id);
      }, 5000);
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

// Update badge with sleeping tab count
async function updateBadge() {
  const settings = await getSettings();

  if (!settings.showBadge) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const count = await getSleepingTabCount();

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

// Listen for settings changes to update auto-sleep
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.settings) {
    const newSettings = changes.settings.newValue;
    if (newSettings?.autoSleepEnabled !== undefined) {
      await setupAutoSleep();
    }
  }
});

// Log service worker activation
console.log('Tab Sleep Tool service worker loaded');
