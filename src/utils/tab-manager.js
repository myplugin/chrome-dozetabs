import { isWhitelisted, isChromeInternalPage, isEmptyTabPage } from './whitelist.js';
import { getSettings } from './storage.js';

/**
 * Query tabs in the current window
 * @param {Object} queryInfo - Additional query options
 * @returns {Promise<chrome.tabs.Tab[]>} - Array of tabs
 */
export async function queryTabs(queryInfo = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ currentWindow: true, ...queryInfo }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(tabs);
      }
    });
  });
}

/**
 * Get a specific tab by ID
 * @param {number} tabId - Tab ID
 * @returns {Promise<chrome.tabs.Tab>} - Tab object
 */
export async function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(tab);
      }
    });
  });
}

/**
 * Sleep a tab (discard it)
 * @param {number} tabId - Tab ID to sleep
 * @returns {Promise<chrome.tabs.Tab>} - Slept tab
 */
export async function sleepTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.discard(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(tab);
      }
    });
  });
}

/**
 * Reload a tab
 * @param {number} tabId - Tab ID to reload
 * @returns {Promise<void>}
 */
export async function reloadTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Check if a tab can be slept
 * @param {chrome.tabs.Tab} tab - Tab to check
 * @returns {Promise<{canSleep: boolean, reason: string}>} - Result with reason
 */
export async function canSleepTab(tab) {
  const settings = await getSettings();

  // Check if already sleeping
  if (tab.discarded) {
    return { canSleep: false, reason: 'Tab is already sleeping' };
  }

  // Check if empty/new tab page (should not count or sleep)
  if (isEmptyTabPage(tab.url, tab.title)) {
    return { canSleep: false, reason: 'Tab is an empty/new tab page' };
  }

  // Check if Chrome internal page
  if (isChromeInternalPage(tab.url)) {
    return { canSleep: false, reason: 'Cannot sleep Chrome internal pages' };
  }

  // Check if pinned
  if (settings.excludePinnedTabs && tab.pinned) {
    return { canSleep: false, reason: 'Tab is pinned' };
  }

  // Check if playing audio
  if (settings.excludeAudibleTabs && tab.audible) {
    return { canSleep: false, reason: 'Tab is playing audio' };
  }

  // Check whitelist
  if (await isWhitelisted(tab.url)) {
    return { canSleep: false, reason: 'Tab URL is in whitelist' };
  }

  return { canSleep: true, reason: '' };
}

/**
 * Get all sleepable tabs in current window
 * @returns {Promise<chrome.tabs.Tab[]>} - Array of sleepable tabs
 */
export async function getSleepableTabs() {
  const tabs = await queryTabs();
  const sleepable = [];

  for (const tab of tabs) {
    const { canSleep } = await canSleepTab(tab);
    if (canSleep) {
      sleepable.push(tab);
    }
  }

  return sleepable;
}

/**
 * Get count of sleeping (discarded) tabs
 * @returns {Promise<number>} - Number of discarded tabs
 */
export async function getSleepingTabCount() {
  const tabs = await queryTabs();
  return tabs.filter(tab => tab.discarded).length;
}

/**
 * Execute script in a tab
 * @param {number} tabId - Tab ID
 * @param {Object} details - Script details
 * @returns {Promise<any[]>} - Script results
 */
export async function executeScript(tabId, details) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      ...details
    }, (results) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(results);
      }
    });
  });
}
