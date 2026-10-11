import { canSleepTab, loadSleepContext, queryCurrentWindowTabs } from '../utils/tab-manager.js';
import { updateBadge } from './badge.js';
import { sleepTab } from './sleep.js';

/**
 * "Sleep all other tabs" — a cancellable batch over the current window.
 *
 * Tabs are processed in chunks so the service worker stays responsive and the
 * user can abort mid-flight. Storage state (settings, whitelist, locks) is
 * loaded once per batch instead of once per tab.
 */

const CONCURRENCY = 10;

let batch = createIdleBatch();

function createIdleBatch() {
  return {
    isRunning: false,
    currentTabId: null,
    total: 0,
    processed: 0,
    slept: 0,
    skipped: 0,
    aborted: false
  };
}

/** @returns {Object} live progress, polled by the popup */
export function getBatchStatus() {
  return {
    isRunning: batch.isRunning,
    currentTabId: batch.currentTabId,
    total: batch.total,
    processed: batch.processed,
    slept: batch.slept,
    skipped: batch.skipped
  };
}

/** @returns {{success: boolean, reason?: string}} */
export function abortBatch() {
  if (!batch.isRunning) return { success: false, reason: 'noBatchRunning' };
  batch.aborted = true;
  return { success: true };
}

/**
 * @param {number} currentTabId - the tab to keep awake
 * @returns {Promise<{slept: number, skipped: number, aborted?: boolean, reasons: Array, reason?: string}>}
 */
export async function sleepAllOtherTabs(currentTabId) {
  if (batch.isRunning) {
    return { slept: 0, skipped: 0, reasons: [], reason: 'batchAlreadyRunning' };
  }

  batch = { ...createIdleBatch(), isRunning: true, currentTabId };

  try {
    const [tabs, context] = await Promise.all([queryCurrentWindowTabs(), loadSleepContext()]);

    const targets = tabs.filter((tab) => tab.id !== currentTabId && !tab.discarded);
    batch.total = targets.length;

    if (targets.length === 0) {
      return { slept: 0, skipped: 0, reasons: [] };
    }

    const result = { slept: 0, skipped: 0, reasons: [] };

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      if (batch.aborted) {
        return { ...result, aborted: true };
      }

      const chunk = targets.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (tab) => {
          const { canSleep, reason } = await canSleepTab(tab, context);
          if (!canSleep) return { success: false, reason, title: tab.title };
          return sleepTab(tab.id, { context, skipBadgeUpdate: true, skipStateCapture: true });
        })
      );

      for (const outcome of settled) {
        batch.processed++;
        const value = outcome.status === 'fulfilled' ? outcome.value : { success: false };
        if (value.success) {
          result.slept++;
          batch.slept++;
        } else {
          result.skipped++;
          batch.skipped++;
          if (value.reason && value.title) {
            result.reasons.push({ title: value.title, reason: value.reason });
          }
        }
      }
    }

    await updateBadge();
    return result;
  } catch (error) {
    return { slept: 0, skipped: 0, reasons: [], reason: 'unknownError', error: error.message };
  } finally {
    batch.isRunning = false;
  }
}
