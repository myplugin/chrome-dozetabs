import { getSettings, getLockedTabs, getWhitelist } from './storage.js';
import {
  isEmptyTabPage,
  isChromeInternalPage,
  extractDomain,
  matchesAnyPattern
} from './whitelist.js';

/**
 * Thin, promise-based wrapper around the `chrome.tabs` / `chrome.scripting`
 * APIs, plus the "may this tab be slept?" decision.
 *
 * The decision needs three pieces of storage state. Reading them per tab is
 * O(n) storage round-trips, which is unacceptable when a batch touches 200
 * tabs, so callers load them once with `loadSleepContext()` and pass the result
 * into `canSleepTab()`.
 */

/**
 * @typedef {Object} SleepContext
 * @property {Object} settings
 * @property {string[]} whitelist
 * @property {Set<number>} lockedTabs
 */

/**
 * Reasons a tab cannot be slept. Stable codes on purpose: the UI translates
 * them, so the service worker carries no user-visible English strings.
 */
export const SLEEP_BLOCK_REASON = {
  ALREADY_SLEEPING: 'alreadySleeping',
  LOCKED: 'locked',
  EMPTY: 'emptyTab',
  INTERNAL: 'internalPage',
  PINNED: 'pinnedTab',
  AUDIBLE: 'audibleTab',
  WHITELISTED: 'whitelisted'
};

/**
 * @param {Object} [queryInfo]
 * @returns {Promise<chrome.tabs.Tab[]>} tabs of the current window
 */
export function queryCurrentWindowTabs(queryInfo = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ currentWindow: true, ...queryInfo }, (tabs) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(tabs || []);
    });
  });
}

/**
 * @param {Object} [queryInfo]
 * @returns {Promise<chrome.tabs.Tab[]>} tabs across every window
 */
export function queryAllTabs(queryInfo = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(tabs || []);
    });
  });
}

/**
 * @param {number} tabId
 * @returns {Promise<chrome.tabs.Tab>}
 */
export function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(tab);
    });
  });
}

/** @param {number} tabId @returns {Promise<chrome.tabs.Tab|undefined>} */
export function discardTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.discard(tabId, (tab) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(tab);
    });
  });
}

/** @param {number} tabId @returns {Promise<void>} */
export function reloadTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

/** @param {number} tabId @returns {Promise<void>} */
export function activateTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

/**
 * Run a self-contained function inside a tab.
 * @param {number} tabId
 * @param {(saveScroll: boolean, saveForm: boolean) => Object} func
 * @param {Array} args
 * @returns {Promise<*>} the function's return value, or undefined
 */
export async function executeScript(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return results && results[0] ? results[0].result : undefined;
}

/**
 * Check if a tab is sleeping (discarded or never loaded).
 * @param {chrome.tabs.Tab} tab
 * @returns {boolean}
 */
export function isTabSleeping(tab) {
  return tab.discarded === true || tab.status === 'unloaded';
}

/**
 * Load the storage state the sleep decision depends on.
 * @returns {Promise<SleepContext>}
 */
export async function loadSleepContext() {
  const [settings, whitelist, lockedTabs] = await Promise.all([
    getSettings(),
    getWhitelist(),
    getLockedTabs()
  ]);
  return { settings, whitelist, lockedTabs };
}

/**
 * Decide whether a tab may be slept.
 * @param {chrome.tabs.Tab} tab
 * @param {SleepContext} [context] - omit to load the state on the fly
 * @returns {Promise<{canSleep: boolean, reason: string}>}
 */
export async function canSleepTab(tab, context) {
  const ctx = context || (await loadSleepContext());
  const { settings } = ctx;

  if (tab.discarded) {
    return { canSleep: false, reason: SLEEP_BLOCK_REASON.ALREADY_SLEEPING };
  }

  if (ctx.lockedTabs.has(tab.id)) {
    return { canSleep: false, reason: SLEEP_BLOCK_REASON.LOCKED };
  }

  if (isEmptyTabPage(tab.url, tab.title)) {
    return { canSleep: false, reason: SLEEP_BLOCK_REASON.EMPTY };
  }

  if (isChromeInternalPage(tab.url)) {
    return { canSleep: false, reason: SLEEP_BLOCK_REASON.INTERNAL };
  }

  if (settings.excludePinnedTabs && tab.pinned) {
    return { canSleep: false, reason: SLEEP_BLOCK_REASON.PINNED };
  }

  if (settings.excludeAudibleTabs && tab.audible) {
    return { canSleep: false, reason: SLEEP_BLOCK_REASON.AUDIBLE };
  }

  if (matchesAnyPattern(extractDomain(tab.url), ctx.whitelist)) {
    return { canSleep: false, reason: SLEEP_BLOCK_REASON.WHITELISTED };
  }

  return { canSleep: true, reason: '' };
}

/**
 * @returns {Promise<number>} tabs in the current window that are loaded and not blank
 */
export async function getActiveTabCount() {
  const tabs = await queryCurrentWindowTabs();
  return tabs.filter((tab) => !isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title)).length;
}
