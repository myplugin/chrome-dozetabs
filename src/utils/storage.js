import {
  STORAGE_KEYS,
  DEFAULT_WHITELIST,
  DEFAULT_SETTINGS,
  DEFAULT_STATISTICS
} from './constants.js';

/**
 * `chrome.storage.local` access layer.
 *
 * Two things matter here:
 *
 * 1. **Every read-modify-write is serialised per key.** The batch-sleep path
 *    processes up to 10 tabs concurrently and each of them bumps the same
 *    counters/maps. A naive `get` -> mutate -> `set` loses updates; the
 *    `withStorageLock` queue below makes those operations atomic within the
 *    service worker.
 *
 * 2. **Defaults are merged, never replaced.** `getSettings()` always returns a
 *    complete object so a newly added setting cannot come back `undefined`.
 */

/** Serialises read-modify-write sequences per storage key. */
const keyLocks = new Map();

/**
 * Run `task` after every previously queued task for `key` has settled.
 * @param {string} key - storage key the task mutates
 * @param {() => Promise<*>} task
 * @returns {Promise<*>} the task result
 */
export function withStorageLock(key, task) {
  const previous = keyLocks.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  keyLocks.set(key, tail);
  tail.then(() => {
    if (keyLocks.get(key) === tail) keyLocks.delete(key);
  });
  return run;
}

/**
 * Get data from chrome.storage.local
 * @param {string|string[]|null} keys - Storage key(s) to retrieve
 * @returns {Promise<Object>} - Storage data
 */
export async function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result || {});
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
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

/** @returns {Promise<string[]>} whitelisted domain patterns */
export async function getWhitelist() {
  const result = await getStorage(STORAGE_KEYS.WHITELIST);
  const stored = result[STORAGE_KEYS.WHITELIST];
  return Array.isArray(stored) ? stored : [...DEFAULT_WHITELIST];
}

/** @param {string[]} whitelist */
export async function saveWhitelist(whitelist) {
  await setStorage({ [STORAGE_KEYS.WHITELIST]: whitelist });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** @returns {Promise<Object>} settings merged over the defaults */
export async function getSettings() {
  const result = await getStorage(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

/** @param {Object} settings - full settings object to persist */
export async function saveSettings(settings) {
  await setStorage({ [STORAGE_KEYS.SETTINGS]: settings });
}

// ---------------------------------------------------------------------------
// Sleeping tab state (scroll position + form data captured before discard)
// ---------------------------------------------------------------------------

/** @returns {Promise<Object<number, Object>>} state keyed by tab id */
export async function getSleepingTabs() {
  const result = await getStorage(STORAGE_KEYS.SLEEPING_TABS);
  return result[STORAGE_KEYS.SLEEPING_TABS] || {};
}

/**
 * @param {number} tabId
 * @param {Object} data - captured tab state
 */
export async function saveSleepingTab(tabId, data) {
  await withStorageLock(STORAGE_KEYS.SLEEPING_TABS, async () => {
    const sleepingTabs = await getSleepingTabs();
    sleepingTabs[tabId] = data;
    await setStorage({ [STORAGE_KEYS.SLEEPING_TABS]: sleepingTabs });
  });
}

/** @param {number} tabId */
export async function removeSleepingTab(tabId) {
  await withStorageLock(STORAGE_KEYS.SLEEPING_TABS, async () => {
    const sleepingTabs = await getSleepingTabs();
    if (!(tabId in sleepingTabs)) return;
    delete sleepingTabs[tabId];
    await setStorage({ [STORAGE_KEYS.SLEEPING_TABS]: sleepingTabs });
  });
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** @returns {Promise<Object>} statistics merged over the defaults */
export async function getStatistics() {
  const result = await getStorage(STORAGE_KEYS.STATISTICS);
  return { ...DEFAULT_STATISTICS, ...(result[STORAGE_KEYS.STATISTICS] || {}) };
}

/** @param {number} [count] - how many sleeps to add */
export async function incrementSleepCount(count = 1) {
  if (count <= 0) return;
  await withStorageLock(STORAGE_KEYS.STATISTICS, async () => {
    const stats = await getStatistics();
    stats.totalSlept += count;
    await setStorage({ [STORAGE_KEYS.STATISTICS]: stats });
  });
}

/** @param {number} [count] - how many wakes to add */
export async function incrementWakeCount(count = 1) {
  if (count <= 0) return;
  await withStorageLock(STORAGE_KEYS.STATISTICS, async () => {
    const stats = await getStatistics();
    stats.totalWoken += count;
    await setStorage({ [STORAGE_KEYS.STATISTICS]: stats });
  });
}

export async function resetStatistics() {
  await setStorage({
    [STORAGE_KEYS.STATISTICS]: { ...DEFAULT_STATISTICS, lastReset: Date.now() }
  });
}

// ---------------------------------------------------------------------------
// Locked tabs (a lock survives batch operations)
// ---------------------------------------------------------------------------

/** @returns {Promise<Set<number>>} */
export async function getLockedTabs() {
  const result = await getStorage(STORAGE_KEYS.LOCKED_TABS);
  const stored = result[STORAGE_KEYS.LOCKED_TABS];
  return new Set(Array.isArray(stored) ? stored : []);
}

/** @param {number} tabId */
export async function lockTab(tabId) {
  await withStorageLock(STORAGE_KEYS.LOCKED_TABS, async () => {
    const lockedTabs = await getLockedTabs();
    lockedTabs.add(tabId);
    await setStorage({ [STORAGE_KEYS.LOCKED_TABS]: Array.from(lockedTabs) });
  });
}

/** @param {number} tabId */
export async function unlockTab(tabId) {
  await withStorageLock(STORAGE_KEYS.LOCKED_TABS, async () => {
    const lockedTabs = await getLockedTabs();
    if (!lockedTabs.delete(tabId)) return;
    await setStorage({ [STORAGE_KEYS.LOCKED_TABS]: Array.from(lockedTabs) });
  });
}

/**
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export async function isTabLocked(tabId) {
  const lockedTabs = await getLockedTabs();
  return lockedTabs.has(tabId);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/** Write defaults for any key that is still missing. */
export async function initializeStorage() {
  const existingData = await getStorage([
    STORAGE_KEYS.WHITELIST,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.STATISTICS,
    STORAGE_KEYS.SLEEPING_TABS,
    STORAGE_KEYS.LOCKED_TABS
  ]);

  const toSet = {};

  if (!Array.isArray(existingData[STORAGE_KEYS.WHITELIST])) {
    toSet[STORAGE_KEYS.WHITELIST] = [...DEFAULT_WHITELIST];
  }
  if (!existingData[STORAGE_KEYS.SETTINGS]) {
    toSet[STORAGE_KEYS.SETTINGS] = { ...DEFAULT_SETTINGS };
  }
  if (!existingData[STORAGE_KEYS.STATISTICS]) {
    toSet[STORAGE_KEYS.STATISTICS] = { ...DEFAULT_STATISTICS };
  }
  if (!existingData[STORAGE_KEYS.SLEEPING_TABS]) {
    toSet[STORAGE_KEYS.SLEEPING_TABS] = {};
  }
  if (!Array.isArray(existingData[STORAGE_KEYS.LOCKED_TABS])) {
    toSet[STORAGE_KEYS.LOCKED_TABS] = [];
  }

  if (Object.keys(toSet).length > 0) {
    await setStorage(toSet);
  }
}
