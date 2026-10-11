import { MESSAGE_TYPES } from '../utils/constants.js';
import { sanitizeSettings } from '../utils/settings.js';
import {
  getLockedTabs,
  getSettings,
  getStatistics,
  getWhitelist,
  lockTab,
  resetStatistics,
  saveSettings,
  unlockTab
} from '../utils/storage.js';
import { addToWhitelist, removeFromWhitelist } from '../utils/whitelist.js';
import { abortBatch, getBatchStatus, sleepAllOtherTabs } from './batch.js';
import { fetchFavicon } from './favicon.js';
import { consumeRestoreState, sleepTab, wakeTab } from './sleep.js';
import { adoptStartupWindowFromSession, sweepStartupTabs } from './startup-suspend.js';

/**
 * The single entry point for `chrome.runtime.onMessage`.
 *
 * Every message type maps to one handler in a dispatch table instead of a
 * 100-line `switch`, so adding a message type is a one-line change and the
 * response shape stays explicit.
 *
 * @typedef {(payload: Object, sender: chrome.runtime.MessageSender) => Promise<*>} MessageHandler
 */

/** @type {Object<string, MessageHandler>} */
const handlers = {
  // --- tab lifecycle -------------------------------------------------------
  [MESSAGE_TYPES.SLEEP_TAB]: (payload) => sleepTab(payload.tabId),

  [MESSAGE_TYPES.SLEEP_ALL_OTHER]: (payload) => sleepAllOtherTabs(payload.currentTabId),

  [MESSAGE_TYPES.WAKE_TAB]: (payload) => wakeTab(payload.tabId),

  [MESSAGE_TYPES.CONSUME_RESTORE_STATE]: async (_payload, sender) => {
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    if (typeof tabId !== 'number') return { state: null };
    return { state: await consumeRestoreState(tabId) };
  },

  // --- whitelist -----------------------------------------------------------
  [MESSAGE_TYPES.GET_WHITELIST]: async () => ({ whitelist: await getWhitelist() }),

  [MESSAGE_TYPES.ADD_TO_WHITELIST]: async (payload) => {
    const { added, domain } = await addToWhitelist(payload.url || payload.domain || '');
    return { success: added, domain };
  },

  [MESSAGE_TYPES.REMOVE_FROM_WHITELIST]: async (payload) => {
    const { removed, domain } = await removeFromWhitelist(payload.domain || payload.url || '');
    return { success: removed, domain };
  },

  // --- settings & statistics ----------------------------------------------
  [MESSAGE_TYPES.GET_SETTINGS]: async () => ({ settings: await getSettings() }),

  [MESSAGE_TYPES.UPDATE_SETTINGS]: async (payload) => {
    await saveSettings(sanitizeSettings(payload.settings));
    return { success: true };
  },

  [MESSAGE_TYPES.GET_STATISTICS]: async () => ({ statistics: await getStatistics() }),

  [MESSAGE_TYPES.RESET_STATISTICS]: async () => {
    await resetStatistics();
    return { success: true, statistics: await getStatistics() };
  },

  // --- per-tab lock --------------------------------------------------------
  [MESSAGE_TYPES.LOCK_TAB]: async (payload) => {
    await lockTab(payload.tabId);
    return { success: true };
  },

  [MESSAGE_TYPES.UNLOCK_TAB]: async (payload) => {
    await unlockTab(payload.tabId);
    return { success: true };
  },

  [MESSAGE_TYPES.GET_LOCKED_TABS]: async () => ({
    lockedTabs: Array.from(await getLockedTabs())
  }),

  // --- batch ("sleep all other tabs") --------------------------------------
  [MESSAGE_TYPES.GET_BATCH_STATUS]: async () => getBatchStatus(),

  [MESSAGE_TYPES.ABORT_BATCH]: async () => abortBatch(),

  // --- misc ----------------------------------------------------------------
  [MESSAGE_TYPES.FETCH_FAVICON]: (payload) => fetchFavicon(payload.url),

  // Test hook: the real-browser smoke test writes the startup-window boundary
  // into chrome.storage.session (some automation environments never deliver
  // chrome.runtime.onStartup) and then asks for a sweep. Re-reading the boundary
  // here keeps the rule intact: only an open window permits discarding.
  [MESSAGE_TYPES.TRIGGER_STARTUP_SWEEP]: async () => {
    await adoptStartupWindowFromSession();
    return { discarded: await sweepStartupTabs('manual') };
  }
};

/**
 * Only accept messages from our own extension. Messages sent by a content
 * script carry the sender's tab; `sender.id` is our extension id. A sender
 * without an id (unit-test harnesses) is allowed through.
 * @param {chrome.runtime.MessageSender} sender
 * @returns {boolean}
 */
function isTrustedSender(sender) {
  if (!sender || typeof sender.id !== 'string') return true;
  return sender.id === chrome.runtime.id;
}

/**
 * @param {Object} message
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<*>}
 */
export async function handleMessage(message, sender) {
  if (!message || typeof message.type !== 'string') {
    return { error: 'Malformed message' };
  }
  if (!isTrustedSender(sender)) {
    return { error: 'Untrusted sender' };
  }

  const handler = handlers[message.type];
  if (!handler) {
    return { error: 'Unknown message type' };
  }

  return handler(message.payload || {}, sender);
}

/** Attach the router to the runtime message channel. Call once, on boot. */
export function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Tab Sleep] Message handler failed:', message && message.type, error);
        sendResponse({ success: false, reason: 'unknownError', error: error.message });
      });

    return true; // keep the channel open for the async response
  });
}
