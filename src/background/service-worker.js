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
  initializeStorage
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
    title: 'Sleep this tab',
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'sleep-other-tabs',
    title: 'Sleep all other tabs',
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'separator-1',
    type: 'separator',
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'add-to-whitelist',
    title: 'Add domain to whitelist',
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'remove-from-whitelist',
    title: 'Remove domain from whitelist',
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

// Update badge when tabs are removed
chrome.tabs.onRemoved.addListener(async () => {
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
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.SLEEP_TAB:
      return await handleSleepTab(payload.tabId);

    case MESSAGE_TYPES.SLEEP_ALL_OTHER:
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

    default:
      return { error: 'Unknown message type' };
  }
}

// Sleep a single tab
async function handleSleepTab(tabId) {
  try {
    const tab = await getTab(tabId);
    const { canSleep, reason } = await canSleepTab(tab);

    if (!canSleep) {
      return { success: false, reason };
    }

    // Check if this is the currently active tab in its window
    const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const isActiveTab = activeTab && activeTab.id === tabId;

    // If sleeping the active tab, switch to another tab first
    if (isActiveTab) {
      await switchAwayFromTab(tab);
    }

    // Save tab state before sleeping
    const settings = await getSettings();
    const tabState = {
      tabId,
      originalUrl: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      sleptAt: Date.now()
    };

    // Try to save scroll position and form data
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
        console.log('Could not capture tab state:', e.message);
      }
    }

    // Save state to storage
    await saveSleepingTab(tabId, tabState);

    // Sleep the tab
    await sleepTab(tabId);

    // Update statistics and badge
    await incrementSleepCount();
    await updateBadge();

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

// Sleep all other tabs
async function handleSleepAllOther(currentTabId) {
  const tabs = await queryTabs();
  const results = {
    slept: 0,
    skipped: 0,
    reasons: []
  };

  for (const tab of tabs) {
    if (tab.id === currentTabId) continue;
    if (tab.discarded) {
      results.skipped++;
      continue;
    }

    const { canSleep, reason } = await canSleepTab(tab);

    if (canSleep) {
      const result = await handleSleepTab(tab.id);
      if (result.success) {
        results.slept++;
      } else {
        results.skipped++;
      }
    } else {
      results.skipped++;
      results.reasons.push({ title: tab.title, reason });
    }
  }

  await updateBadge();
  return results;
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
