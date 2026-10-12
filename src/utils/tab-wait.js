import { getTab, isTabSleeping, queryCurrentWindowTabs } from './tab-manager.js';

/**
 * Bounded waiting helpers for the popup.
 *
 * After sleeping or waking a tab the popup needs to re-render — but the browser
 * has not necessarily finished by the time `sendMessage` resolves. The popup
 * used to paper over that with a fixed `setTimeout(150ms)`, which is a guess:
 * too long on a fast machine, too short on a loaded one.
 *
 * These helpers poll the real tab state instead and give up after a bound, so
 * the common case resolves in a few milliseconds and a slow machine degrades
 * into a slightly stale list rather than a broken one.
 */

/** How long to keep polling before accepting that the change may not arrive. */
const DEFAULT_TIMEOUT_MS = 1200;
/** Poll interval. Small enough to feel instant, large enough to be cheap. */
const DEFAULT_INTERVAL_MS = 50;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until a single tab satisfies `predicate`.
 *
 * @param {number} tabId
 * @param {(tab: chrome.tabs.Tab) => boolean} predicate
 * @param {{timeoutMs?: number, intervalMs?: number}} [options]
 * @returns {Promise<boolean>} true when the predicate held before the deadline;
 *   false on timeout **or** when the tab disappeared while waiting
 */
export async function waitForTab(tabId, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    let tab;
    try {
      tab = await getTab(tabId);
    } catch {
      // The tab closed (or was replaced) while we waited — nothing to render.
      return false;
    }

    // Real Chrome rejects with lastError for a missing tab; be defensive anyway.
    if (!tab) return false;

    if (predicate(tab)) return true;
    if (Date.now() >= deadline) return false;

    await delay(intervalMs);
  }
}

/**
 * Wait until the current window's tabs satisfy `predicate`.
 *
 * @param {(tabs: chrome.tabs.Tab[]) => boolean} predicate
 * @param {{timeoutMs?: number, intervalMs?: number}} [options]
 * @returns {Promise<boolean>} true when the predicate held before the deadline
 */
export async function waitForTabs(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const tabs = await queryCurrentWindowTabs();
    if (predicate(tabs)) return true;
    if (Date.now() >= deadline) return false;

    await delay(intervalMs);
  }
}

/** @param {chrome.tabs.Tab[]} tabs */
export function countSleepingTabs(tabs) {
  return tabs.filter((tab) => isTabSleeping(tab)).length;
}
