import {
  STORAGE_KEYS,
  DEFAULT_WHITELIST,
  DEFAULT_SETTINGS,
  DEFAULT_STATISTICS
} from './constants.js';

/**
 * Get data from chrome.storage.local
 * @param {string|string[]} keys - Storage key(s) to retrieve
 * @returns {Promise<Object>} - Storage data
 */
export async function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Set data in chrome.storage.local
 * @param {Object} data - Key-value pairs to store
 * @returns {Promise<void>}
 */
export async function setStorage(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Remove data from chrome.storage.local
 * @param {string|string[]} keys - Storage key(s) to remove
 * @returns {Promise<void>}
 */
export async function removeStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get the whitelist from storage
 * @returns {Promise<string[]>} - Array of whitelisted domains
 */
export async function getWhitelist() {
  const result = await getStorage(STORAGE_KEYS.WHITELIST);
  return result[STORAGE_KEYS.WHITELIST] || DEFAULT_WHITELIST;
}

/**
 * Save the whitelist to storage
 * @param {string[]} whitelist - Array of domains to whitelist
 * @returns {Promise<void>}
 */
export async function saveWhitelist(whitelist) {
  await setStorage({ [STORAGE_KEYS.WHITELIST]: whitelist });
}

/**
 * Get settings from storage
 * @returns {Promise<Object>} - Settings object
 */
export async function getSettings() {
  const result = await getStorage(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

/**
 * Save settings to storage
 * @param {Object} settings - Settings object to save
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  await setStorage({ [STORAGE_KEYS.SETTINGS]: settings });
}

/**
 * Get sleeping tabs data from storage
 * @returns {Promise<Object>} - Sleeping tabs data keyed by tab ID
 */
export async function getSleepingTabs() {
  const result = await getStorage(STORAGE_KEYS.SLEEPING_TABS);
  return result[STORAGE_KEYS.SLEEPING_TABS] || {};
}

/**
 * Save sleeping tab data
 * @param {number} tabId - Tab ID
 * @param {Object} data - Tab state data
 * @returns {Promise<void>}
 */
export async function saveSleepingTab(tabId, data) {
  const sleepingTabs = await getSleepingTabs();
  sleepingTabs[tabId] = data;
  await setStorage({ [STORAGE_KEYS.SLEEPING_TABS]: sleepingTabs });
}

/**
 * Remove sleeping tab data
 * @param {number} tabId - Tab ID to remove
 * @returns {Promise<void>}
 */
export async function removeSleepingTab(tabId) {
  const sleepingTabs = await getSleepingTabs();
  delete sleepingTabs[tabId];
  await setStorage({ [STORAGE_KEYS.SLEEPING_TABS]: sleepingTabs });
}

/**
 * Get statistics from storage
 * @returns {Promise<Object>} - Statistics object
 */
export async function getStatistics() {
  const result = await getStorage(STORAGE_KEYS.STATISTICS);
  return { ...DEFAULT_STATISTICS, ...result[STORAGE_KEYS.STATISTICS] };
}

/**
 * Increment the sleep counter
 * @param {number} count - Number to increment by
 * @returns {Promise<void>}
 */
export async function incrementSleepCount(count = 1) {
  const stats = await getStatistics();
  stats.totalSlept += count;
  await setStorage({ [STORAGE_KEYS.STATISTICS]: stats });
}

/**
 * Increment the wake counter
 * @param {number} count - Number to increment by
 * @returns {Promise<void>}
 */
export async function incrementWakeCount(count = 1) {
  const stats = await getStatistics();
  stats.totalWoken += count;
  await setStorage({ [STORAGE_KEYS.STATISTICS]: stats });
}

/**
 * Initialize storage with default values if not exists
 * @returns {Promise<void>}
 */
export async function initializeStorage() {
  const existingData = await getStorage([
    STORAGE_KEYS.WHITELIST,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.STATISTICS,
    STORAGE_KEYS.SLEEPING_TABS
  ]);

  const toSet = {};

  if (!existingData[STORAGE_KEYS.WHITELIST]) {
    toSet[STORAGE_KEYS.WHITELIST] = DEFAULT_WHITELIST;
  }

  if (!existingData[STORAGE_KEYS.SETTINGS]) {
    toSet[STORAGE_KEYS.SETTINGS] = DEFAULT_SETTINGS;
  }

  if (!existingData[STORAGE_KEYS.STATISTICS]) {
    toSet[STORAGE_KEYS.STATISTICS] = DEFAULT_STATISTICS;
  }

  if (!existingData[STORAGE_KEYS.SLEEPING_TABS]) {
    toSet[STORAGE_KEYS.SLEEPING_TABS] = {};
  }

  if (Object.keys(toSet).length > 0) {
    await setStorage(toSet);
  }
}
