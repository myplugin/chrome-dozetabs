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

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  await createContextMenus();
  console.log('Tab Sleep Tool installed');
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  await initializeStorage();
  await createContextMenus();
  await updateBadge();
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

// Handle tab activation (waking up sleeping tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await getTab(activeInfo.tabId);

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
async function handleSleepTab(tabId) {
  console.log('[Tab Sleep] handleSleepTab start for tabId:', tabId);

  try {
    // Step 1: Get tab
    console.log('[Tab Sleep] Step 1: Getting tab...');
    const tab = await getTab(tabId);
    console.log('[Tab Sleep] Step 1 done, tab:', tab?.id, tab?.url?.substring(0, 50));

    // Step 2: Check if can sleep
    console.log('[Tab Sleep] Step 2: Checking if can sleep...');
    const { canSleep, reason } = await canSleepTab(tab);
    console.log('[Tab Sleep] Step 2 done, canSleep:', canSleep, 'reason:', reason);

    if (!canSleep) {
      return { success: false, reason };
    }

    // Step 3: Check if active tab
    console.log('[Tab Sleep] Step 3: Checking if active tab...');
    const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const isActiveTab = activeTab && activeTab.id === tabId;
    console.log('[Tab Sleep] Step 3 done, isActiveTab:', isActiveTab);

    // Step 4: Switch away if active
    if (isActiveTab) {
      console.log('[Tab Sleep] Step 4: Switching away from active tab...');
      await switchAwayFromTab(tab);
      console.log('[Tab Sleep] Step 4 done');
    }

    // Step 5: Get settings
    console.log('[Tab Sleep] Step 5: Getting settings...');
    const settings = await getSettings();
    console.log('[Tab Sleep] Step 5 done');

    // Step 6: Prepare tab state
    const tabState = {
      tabId,
      originalUrl: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      sleptAt: Date.now()
    };

    // Step 7: Capture scroll/form state (with timeout)
    if (settings.preserveScrollPosition || settings.preserveFormData) {
      console.log('[Tab Sleep] Step 6: Capturing tab state...');
      try {
        const capturePromise = executeScript(tabId, {
          func: captureTabState,
          args: [settings.preserveScrollPosition, settings.preserveFormData]
        });

        // 3 second timeout for script execution
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Script execution timeout')), 3000)
        );

        const results = await Promise.race([capturePromise, timeoutPromise]);

        if (results && results[0] && results[0].result) {
          const capturedState = results[0].result;
          if (settings.preserveScrollPosition) {
            tabState.scrollPosition = capturedState.scrollPosition;
          }
          if (settings.preserveFormData) {
            tabState.formData = capturedState.formData;
          }
        }
        console.log('[Tab Sleep] Step 6 done');
      } catch (e) {
        console.log('[Tab Sleep] Step 6 skipped:', e.message);
      }
    }

    // Step 8: Save state to storage
    console.log('[Tab Sleep] Step 7: Saving sleeping tab state...');
    await saveSleepingTab(tabId, tabState);
    console.log('[Tab Sleep] Step 7 done');

    // Step 9: Sleep the tab (discard)
    console.log('[Tab Sleep] Step 8: Discarding tab...');
    await sleepTab(tabId);
    console.log('[Tab Sleep] Step 8 done');

    // Step 10: Update statistics
    console.log('[Tab Sleep] Step 9: Incrementing sleep count...');
    await incrementSleepCount();
    console.log('[Tab Sleep] Step 9 done');

    // Step 11: Update badge
    console.log('[Tab Sleep] Step 10: Updating badge...');
    await updateBadge();
    console.log('[Tab Sleep] Step 10 done');

    // Step 12: Clear lock status (lock is one-time protection)
    await unlockTab(tabId);

    console.log('[Tab Sleep] handleSleepTab SUCCESS for tabId:', tabId);
    return { success: true };
  } catch (error) {
    console.error('[Tab Sleep] handleSleepTab ERROR for tabId:', tabId, error);
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

// Sleep all other tabs
async function handleSleepAllOther(currentTabId) {
  console.log('[Tab Sleep] handleSleepAllOther called with tabId:', currentTabId);

  try {
    const tabs = await queryTabs();
    console.log('[Tab Sleep] Found tabs:', tabs.length);

    const results = {
      slept: 0,
      skipped: 0,
      reasons: []
    };

    // Helper function with timeout
    const withTimeout = (promise, ms, errorMsg) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
      ]);
    };

    for (const tab of tabs) {
      if (tab.id === currentTabId) {
        console.log('[Tab Sleep] Skipping current tab:', tab.id);
        continue;
      }
      if (tab.discarded) {
        console.log('[Tab Sleep] Skipping already discarded tab:', tab.id);
        results.skipped++;
        continue;
      }

      try {
        console.log('[Tab Sleep] Processing tab:', tab.id, tab.url?.substring(0, 50));

        const { canSleep, reason } = await withTimeout(
          canSleepTab(tab),
          5000,
          'canSleepTab timeout'
        );
        console.log('[Tab Sleep] Tab', tab.id, 'canSleep:', canSleep, 'reason:', reason);

        if (canSleep) {
          // Add 10 second timeout for sleep operation
          const result = await withTimeout(
            handleSleepTab(tab.id),
            10000,
            'handleSleepTab timeout'
          );
          if (result.success) {
            results.slept++;
            console.log('[Tab Sleep] Successfully slept tab:', tab.id);
          } else {
            results.skipped++;
            console.log('[Tab Sleep] Failed to sleep tab:', tab.id, result.reason);
          }
        } else {
          results.skipped++;
          results.reasons.push({ title: tab.title, reason });
        }
      } catch (tabError) {
        console.error('[Tab Sleep] Error processing tab:', tab.id, tabError.message || tabError);
        results.skipped++;
      }
    }

    console.log('[Tab Sleep] handleSleepAllOther results:', results);
    await updateBadge();
    return results;
  } catch (error) {
    console.error('[Tab Sleep] handleSleepAllOther error:', error);
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

// Log service worker activation
console.log('Tab Sleep Tool service worker loaded');
