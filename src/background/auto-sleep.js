import { AUTO_SLEEP, SESSION_KEYS } from '../utils/constants.js';
import { getSettings } from '../utils/storage.js';
import { sessionGet, sessionSet } from '../utils/session-store.js';
import { canSleepTab, loadSleepContext, queryAllTabs } from '../utils/tab-manager.js';
import { setUnrefTimeout } from '../utils/timers.js';
import { updateBadge } from './badge.js';
import { sleepTab } from './sleep.js';

/**
 * Auto-sleep: discard tabs that have been idle longer than the configured
 * timeout.
 *
 * Two details matter for correctness in MV3:
 *
 * 1. **The idle clock must outlive the service worker.** An MV3 worker is
 *    recycled after ~30s of inactivity, so an in-memory `Map` of "last active"
 *    timestamps is wiped constantly — the previous implementation therefore
 *    reset every tab's timer on every worker restart and, in practice, almost
 *    never slept anything. Timestamps now live in `chrome.storage.session`.
 *
 * 2. **Enabling the feature must not cause a mass-sleep.** Every tab that is
 *    already open when auto-sleep is switched on is seeded with the current
 *    time, so each one gets a full timeout window from that moment.
 *
 * Idle time is evaluated across *all* windows, and the active tab of each
 * window is always excluded.
 */

/** tabId -> timestamp (ms) of the last observed activity */
const activity = new Map();

let enabled = false;
let timeoutMinutes = AUTO_SLEEP.DEFAULT_TIMEOUT_MINUTES;
let hydrated = false;
let persistTimer = null;

function clampTimeout(minutes) {
  const value = Number.parseInt(minutes, 10);
  if (!Number.isFinite(value)) return AUTO_SLEEP.DEFAULT_TIMEOUT_MINUTES;
  return Math.min(AUTO_SLEEP.MAX_TIMEOUT_MINUTES, Math.max(AUTO_SLEEP.MIN_TIMEOUT_MINUTES, value));
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  const stored = await sessionGet(SESSION_KEYS.AUTO_SLEEP_ACTIVITY);
  if (stored && typeof stored === 'object') {
    for (const [tabId, timestamp] of Object.entries(stored)) {
      activity.set(Number(tabId), timestamp);
    }
  }
}

async function persistActivity() {
  await sessionSet({
    [SESSION_KEYS.AUTO_SLEEP_ACTIVITY]: Object.fromEntries(activity)
  });
}

/** Coalesce writes triggered by tab switches (which can be very frequent). */
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setUnrefTimeout(async () => {
    persistTimer = null;
    await persistActivity();
  }, 5000);
}

/**
 * Re-read settings and (re)arm the periodic alarm. Called on install, on
 * browser startup and whenever the settings object changes.
 * @returns {Promise<void>}
 */
export async function setupAutoSleep() {
  const settings = await getSettings();
  enabled = !!settings.autoSleepEnabled;
  timeoutMinutes = clampTimeout(settings.autoSleepTimeout);

  await chrome.alarms.clear(AUTO_SLEEP.ALARM_NAME);

  if (!enabled) return;

  await hydrate();
  const now = Date.now();
  const tabs = await queryAllTabs({});
  for (const tab of tabs) {
    if (!activity.has(tab.id)) activity.set(tab.id, now);
  }
  await persistActivity();

  await chrome.alarms.create(AUTO_SLEEP.ALARM_NAME, {
    periodInMinutes: AUTO_SLEEP.CHECK_INTERVAL_MINUTES
  });
  console.log('[Tab Sleep] Auto-sleep armed, timeout', timeoutMinutes, 'min');
}

/**
 * Remember that a tab was just used.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function recordTabActivity(tabId) {
  if (!enabled) return;
  await hydrate();
  activity.set(tabId, Date.now());
  schedulePersist();
}

/** @param {number} tabId */
export async function forgetTabActivity(tabId) {
  if (!activity.delete(tabId)) return;
  schedulePersist();
}

/**
 * One auto-sleep pass. Invoked by the periodic alarm.
 * @returns {Promise<{slept: number}>}
 */
export async function runAutoSleepCheck() {
  if (!enabled) return { slept: 0 };

  await hydrate();
  const now = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;

  const [tabs, context] = await Promise.all([queryAllTabs({}), loadSleepContext()]);
  const activeTabIds = new Set(tabs.filter((tab) => tab.active).map((tab) => tab.id));

  let slept = 0;

  for (const tab of tabs) {
    if (tab.discarded || activeTabIds.has(tab.id)) {
      if (!activity.has(tab.id)) activity.set(tab.id, now);
      continue;
    }

    if (!activity.has(tab.id)) {
      // First sighting: `lastAccessed` (Chromium 121+) is a better estimate than
      // "now", but either way the tab gets a full timeout window.
      activity.set(tab.id, tab.lastAccessed || now);
    }

    if (now - activity.get(tab.id) < timeoutMs) continue;

    const { canSleep } = await canSleepTab(tab, context);
    if (!canSleep) continue;

    const result = await sleepTab(tab.id, {
      context,
      skipBadgeUpdate: true,
      skipStateCapture: true
    });
    if (result.success) slept++;
  }

  await persistActivity();
  if (slept > 0) await updateBadge();

  return { slept };
}
