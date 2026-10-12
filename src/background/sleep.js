import {
  getSleepingTabs,
  removeSleepingTab,
  removeSleepingTabs,
  saveSleepingTab,
  incrementSleepCount,
  incrementWakeCount
} from '../utils/storage.js';
import {
  activateTab,
  canSleepTab,
  discardTab,
  executeScript,
  getTab,
  isTabSleeping,
  loadSleepContext,
  queryAllTabs,
  reloadTab
} from '../utils/tab-manager.js';
import { isEmptyTabPage } from '../utils/whitelist.js';
import { updateBadge } from './badge.js';
import { captureTabState, restoreTabState } from './tab-state.js';

/**
 * Sleep / wake a single tab.
 *
 * "Sleeping" is always Chrome's own discard mechanism — no placeholder page, no
 * DOM replacement. The tab keeps its title, favicon and position in the strip.
 */

/**
 * @typedef {Object} SleepOptions
 * @property {import('../utils/tab-manager.js').SleepContext} [context] - pre-loaded state
 * @property {boolean} [skipBadgeUpdate] - batch callers refresh the badge once at the end
 * @property {boolean} [skipStateCapture] - batch callers trade state for speed
 */

/**
 * @param {number} tabId
 * @param {SleepOptions} [options]
 * @returns {Promise<{success: boolean, reason?: string, error?: string}>}
 */
export async function sleepTab(tabId, options = {}) {
  const { context, skipBadgeUpdate = false, skipStateCapture = false } = options;

  try {
    const tab = await getTab(tabId);
    const ctx = context || (await loadSleepContext());
    const { canSleep, reason } = await canSleepTab(tab, ctx);

    if (!canSleep) return { success: false, reason };

    if (await isActiveTab(tab)) {
      // Chrome refuses to discard the tab the user is looking at, so move the
      // user somewhere sensible first.
      await switchAwayFromTab(tab);
    }

    const tabState = {
      tabId,
      originalUrl: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      sleptAt: Date.now()
    };

    if (
      !skipStateCapture &&
      (ctx.settings.preserveScrollPosition || ctx.settings.preserveFormData)
    ) {
      const captured = await captureState(tabId, ctx.settings);
      if (captured) {
        if (ctx.settings.preserveScrollPosition) tabState.scrollPosition = captured.scrollPosition;
        if (ctx.settings.preserveFormData) tabState.formData = captured.formData;
      }
    }

    // Persist before discarding: the content script reads this on the way back
    // up, and writing it first removes any dependency on a timer.
    await saveSleepingTab(tabId, tabState);
    await discardTab(tabId);
    await incrementSleepCount();

    if (!skipBadgeUpdate) await updateBadge();

    return { success: true };
  } catch (error) {
    return { success: false, reason: 'unknownError', error: error.message };
  }
}

/**
 * Wake a sleeping tab.
 *
 * Chrome reloads a discarded tab by itself when it becomes active, so an
 * explicit reload is only needed when the tab is still in the background.
 * @param {number} tabId
 * @returns {Promise<{success: boolean, alreadyAwake?: boolean, reason?: string, error?: string}>}
 */
export async function wakeTab(tabId) {
  try {
    const tab = await getTab(tabId);
    if (!isTabSleeping(tab)) return { success: true, alreadyAwake: true };

    if (!tab.active) await reloadTab(tabId);

    await incrementWakeCount();
    await updateBadge();

    return { success: true };
  } catch (error) {
    return { success: false, reason: 'unknownError', error: error.message };
  }
}

/**
 * Put a tab's saved state back into its page, then forget it.
 *
 * Called when a tab finishes loading. The state is deleted **only after a
 * successful injection**, so a transient failure loses nothing — the next load
 * of that tab tries again, and the entry is pruned at browser start regardless.
 *
 * @param {number} tabId
 * @returns {Promise<boolean>} whether state existed and was applied
 */
export async function restoreIntoTab(tabId) {
  const sleepingTabs = await getSleepingTabs();
  const state = sleepingTabs[tabId];
  if (!state) return false;

  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await executeScript(tabId, restoreTabState, [state]);
      await removeSleepingTab(tabId);
      return true;
    } catch (error) {
      if (attempt === attempts) {
        console.warn('[Tab Sleep] Could not restore state into tab', tabId, '-', error.message);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return false;
}

/**
 * Forget every trace of a closed tab.
 * @param {number} tabId
 */
export async function forgetTab(tabId) {
  await removeSleepingTab(tabId);
}

/**
 * Drop saved state whose tab no longer exists.
 *
 * A tab that is slept and then lost to a crash (or simply never woken) leaves an
 * entry behind. Tab ids are only unique within a browser run, so such an entry
 * can later collide with a freshly assigned id and apply the wrong scroll
 * position or form data to an unrelated page. Called on browser start, before
 * session restore has handed out ids.
 *
 * @returns {Promise<number>} number of stale entries removed
 */
export async function pruneSleepingTabs() {
  const [sleepingTabs, tabs] = await Promise.all([getSleepingTabs(), queryAllTabs({})]);
  const alive = new Set(tabs.map((tab) => tab.id));
  const stale = Object.keys(sleepingTabs)
    .map(Number)
    .filter((tabId) => !alive.has(tabId));

  if (stale.length === 0) return 0;

  const removed = await removeSleepingTabs(stale);
  if (removed > 0) {
    console.log('[Tab Sleep] Pruned', removed, 'stale tab-state entries');
  }
  return removed;
}

/**
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<boolean>}
 */
async function isActiveTab(tab) {
  const activeTabs = await queryAllTabs({ active: true, windowId: tab.windowId });
  return activeTabs.some((activeTab) => activeTab.id === tab.id);
}

/**
 * Move the user off the tab that is about to be discarded.
 *
 * Preference order: an existing blank tab, then a neighbouring tab, and only
 * as a last resort a brand-new blank tab — the previous implementation always
 * opened one, which quietly littered the window with `about:blank` tabs.
 * @param {chrome.tabs.Tab} tab
 */
async function switchAwayFromTab(tab) {
  const tabs = await queryAllTabs({ windowId: tab.windowId });

  const blank = tabs.find((other) => other.id !== tab.id && isEmptyTabPage(other.url, other.title));
  if (blank) {
    await activateTab(blank.id);
    return;
  }

  const candidates = tabs.filter((other) => other.id !== tab.id && !isTabSleeping(other));
  const neighbour =
    candidates.find((other) => other.index > tab.index) || candidates[candidates.length - 1];

  if (neighbour) {
    await activateTab(neighbour.id);
    return;
  }

  await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true });
}

/**
 * @param {number} tabId
 * @param {Object} settings
 * @returns {Promise<Object|null>} captured state, or null when the page cannot be scripted
 */
async function captureState(tabId, settings) {
  try {
    return await executeScript(tabId, captureTabState, [
      settings.preserveScrollPosition,
      settings.preserveFormData
    ]);
  } catch {
    // Restricted pages, frames that vanished mid-flight, ... — capture is
    // best-effort and must never block the discard itself.
    return null;
  }
}
