import { getSettings } from '../utils/storage.js';
import { getActiveTabCount } from '../utils/tab-manager.js';
import { setUnrefTimeout } from '../utils/timers.js';

/**
 * Toolbar badge = number of loaded, non-blank tabs in the current window.
 */

/** @returns {Promise<void>} */
export async function updateBadge() {
  const settings = await getSettings();

  if (!settings.showBadge) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const count = await getActiveTabCount();

  if (count === 0) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  await chrome.action.setBadgeText({ text: String(count) });
  await chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
}

let pendingUpdate = null;

/**
 * Debounced `updateBadge()`. Bulk operations (startup suspend, batch sleep)
 * would otherwise trigger one badge update per tab.
 */
export function updateBadgeSoon() {
  if (pendingUpdate) return;
  pendingUpdate = setUnrefTimeout(async () => {
    pendingUpdate = null;
    try {
      await updateBadge();
    } catch {
      // The badge is cosmetic; never let it break an event handler.
    }
  }, 500);
}
