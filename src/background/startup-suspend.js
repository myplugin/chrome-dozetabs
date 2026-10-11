import {
  SESSION_KEYS,
  STARTUP_SUSPEND_WINDOW_MS,
  STARTUP_SWEEP_INTERVAL_MS
} from '../utils/constants.js';
import { incrementSleepCount } from '../utils/storage.js';
import { sessionGet, sessionSet } from '../utils/session-store.js';
import { discardTab, loadSleepContext, queryAllTabs } from '../utils/tab-manager.js';
import { setUnrefTimeout } from '../utils/timers.js';
import {
  extractDomain,
  isEmptyTabPage,
  isChromeInternalPage,
  matchesAnyPattern
} from '../utils/whitelist.js';

/**
 * Startup suspend (启动抢先休眠).
 *
 * Goal: when the browser reopens one or two hundred session-restored tabs, they
 * must *stay* unloaded instead of all loading at once and spiking memory.
 *
 * Mechanism — all native discard, no tab closing and no placeholder pages:
 *
 *   1. `onCreated`: session-restored tabs are created with `status === 'unloaded'`
 *      and only navigated afterwards. Discarding in that instant intercepts the
 *      load; the tab stays in the strip and loads when clicked. Ordinary new
 *      tabs are unaffected (they are active, and the checks below guard them).
 *   2. Fallback window (`STARTUP_SUSPEND_WINDOW_MS` after browser start): any
 *      non-active tab seen `loading` via `onUpdated`, or caught by the periodic
 *      sweep, is discarded immediately — this covers tabs that raced past the
 *      worker's boot.
 *   3. The window is opened by `chrome.runtime.onStartup` (the canonical
 *      "browser just started" signal). Its deadline lives in
 *      `chrome.storage.session`, so a worker restart mid-window resumes instead
 *      of re-arming. Extension reloads/updates do NOT fire `onStartup`, so they
 *      correctly never open the window (no mass-discard on update).
 *
 * Settings: `startupSuspendEnabled` (master switch), `startupIncludePinned`
 * (default off). Whitelisted domains and locked tabs are still respected.
 */

const state = {
  windowEnd: 0, // ms timestamp; 0 or in the past => window closed
  context: null, // cached {settings, whitelist, lockedTabs} while the window is open
  userActivated: new Set(), // tabIds the user actually activated this session
  pendingStats: 0, // startup discards not yet written to statistics
  sweepTimer: null
};

let initDone = false;
let statsFlushTimer = null;

/**
 * Adopt a window boundary that something else already wrote to session storage.
 *
 * Production reaches this through `chrome.runtime.onStartup`; the real-browser
 * smoke test writes the boundary directly (some automation environments never
 * deliver `onStartup`) and then triggers a sweep. Reading it back here keeps a
 * single authorisation rule: **the window lives in session storage, and only an
 * open window permits discarding.**
 *
 * @returns {Promise<boolean>} whether an open window was adopted
 */
export async function adoptStartupWindowFromSession() {
  const end = await sessionGet(SESSION_KEYS.STARTUP_WINDOW_END);
  if (end === undefined || end <= Date.now()) return false;

  state.windowEnd = end;
  await refreshContext();
  scheduleSweeps();
  scheduleStatsFlush();
  return true;
}

/**
 * Detect a still-open window on worker boot (the worker may be recycled in the
 * middle of the window) and resume sweeping.
 * @returns {Promise<void>}
 */
export async function initStartupSuspend() {
  if (initDone) return;
  initDone = true;

  try {
    if (await adoptStartupWindowFromSession()) {
      await sweepStartupTabs('resume');
      return;
    }

    // Window closed: idle until chrome.runtime.onStartup fires. Extension
    // reloads never fire it, so reloading the extension never mass-discards.
    // (scripts/smoke-test.py opens the window explicitly, because some
    // automation environments never deliver onStartup.)
  } catch (error) {
    console.warn('[Tab Sleep] Startup suspend init failed:', error);
  }
}

/**
 * Open the window and run the first sweep. Only `chrome.runtime.onStartup`
 * should call this.
 * @returns {Promise<void>}
 */
export async function openStartupWindowIfNeeded() {
  if (isStartupWindowOpen()) return;

  const end = Date.now() + STARTUP_SUSPEND_WINDOW_MS;
  await sessionSet({ [SESSION_KEYS.STARTUP_WINDOW_END]: end });
  state.windowEnd = end;

  console.log('[Tab Sleep] Startup suspend window open for', STARTUP_SUSPEND_WINDOW_MS, 'ms');
  await refreshContext();
  await sweepStartupTabs('startup');
  scheduleSweeps();
  scheduleStatsFlush();
}

/** @returns {boolean} */
export function isStartupWindowOpen() {
  return state.windowEnd > Date.now();
}

/**
 * Record that a tab was activated by the user; such a tab is never discarded by
 * the startup window, not even after the user switches away from it.
 * @param {number} tabId
 */
export function markUserActivated(tabId) {
  if (!isStartupWindowOpen()) return;
  state.userActivated.add(tabId);
}

/**
 * `chrome.tabs.onCreated` handler body.
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<boolean>} whether the tab was discarded
 */
export async function handleStartupTabCreated(tab) {
  if (!isStartupWindowOpen()) return false;
  const ctx = await getContext();
  if (!ctx.settings.startupSuspendEnabled) return false;
  return discardIfIdle(ctx, tab, 'created');
}

/**
 * `chrome.tabs.onUpdated` handler body for the fallback rule.
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<boolean>} whether the tab was discarded
 */
export async function handleStartupTabLoading(tab) {
  if (!tab || tab.active || !isStartupWindowOpen()) return false;
  const ctx = await getContext();
  if (!ctx.settings.startupSuspendEnabled) return false;
  return discardIfIdle(ctx, tab, 'updated');
}

/**
 * One sweep across every window. Catches restored tabs that started loading
 * while the worker was booting, and retries tabs that raced past the events.
 * @param {string} reason - for logging only
 * @returns {Promise<number>} number of tabs discarded
 */
export async function sweepStartupTabs(reason) {
  try {
    // The window is the only thing that authorises discarding; the settings
    // switch alone must never be enough (an extension reload would otherwise
    // mass-discard every background tab).
    if (!isStartupWindowOpen()) return 0;

    const ctx = await getContext();
    if (!ctx.settings.startupSuspendEnabled) return 0;

    const tabs = await queryAllTabs({});
    let discarded = 0;

    for (const tab of tabs) {
      if (tab.active) {
        // The tab being viewed (per window) — protect it from the sweep's
        // 'complete' rule even after the user later switches away.
        state.userActivated.add(tab.id);
        continue;
      }
      if (await discardIfIdle(ctx, tab, 'sweep')) discarded++;
    }

    if (discarded > 0) {
      console.log(`[Tab Sleep] Startup sweep (${reason}): discarded ${discarded} tabs`);
    }
    return discarded;
  } catch {
    return 0;
  }
}

/** Drop the cached settings/whitelist/locks (called on chrome.storage change). */
export function invalidateStartupSuspendCaches() {
  state.context = null;
}

/**
 * Discard one tab during the startup window.
 * @param {import('../utils/tab-manager.js').SleepContext} ctx
 * @param {chrome.tabs.Tab} tab
 * @param {'created'|'updated'|'sweep'} source - how strict the status check is
 * @returns {Promise<boolean>}
 */
async function discardIfIdle(ctx, tab, source) {
  try {
    if (!tab || tab.discarded) return false;
    if (tab.active) return false; // never a tab being viewed
    if (tab.pinned && !ctx.settings.startupIncludePinned) return false;
    if (tab.autoDiscardable === false) return false; // the browser forbids it
    if (state.userActivated.has(tab.id)) return false;

    if (source === 'created' && tab.status !== 'unloaded') return false;
    if (source === 'updated' && tab.status !== 'unloaded' && tab.status !== 'loading') return false;
    if (
      source === 'sweep' &&
      tab.status !== 'unloaded' &&
      tab.status !== 'loading' &&
      tab.status !== 'complete'
    ) {
      return false;
    }

    if (isEmptyTabPage(tab.url, tab.title) || isChromeInternalPage(tab.url)) return false;
    if (ctx.lockedTabs && ctx.lockedTabs.has(tab.id)) return false;
    if (matchesAnyPattern(extractDomain(tab.url), ctx.whitelist)) return false;

    await discardTab(tab.id);

    state.pendingStats++;
    if (state.pendingStats >= 10) await flushStats();
    return true;
  } catch {
    // The tab vanished, was already discarded, or the load won the race —
    // harmless, the sweep retries within the window.
    return false;
  }
}

async function refreshContext() {
  state.context = await loadSleepContext();
}

async function getContext() {
  if (!state.context) await refreshContext();
  return state.context;
}

function scheduleSweeps() {
  if (state.sweepTimer) return;

  const tick = async () => {
    state.sweepTimer = null;
    if (!isStartupWindowOpen()) {
      // The window is over: the protection set is only meaningful inside it.
      state.userActivated.clear();
      return;
    }
    await sweepStartupTabs('timer');
    if (isStartupWindowOpen()) {
      state.sweepTimer = setUnrefTimeout(tick, STARTUP_SWEEP_INTERVAL_MS);
    }
  };

  state.sweepTimer = setUnrefTimeout(tick, STARTUP_SWEEP_INTERVAL_MS);
}

function scheduleStatsFlush() {
  const remaining = Math.max(0, state.windowEnd - Date.now());
  if (statsFlushTimer) clearTimeout(statsFlushTimer);
  statsFlushTimer = setUnrefTimeout(flushStats, remaining + 500);
}

async function flushStats() {
  const count = state.pendingStats;
  if (count <= 0) return;
  state.pendingStats = 0;
  try {
    await incrementSleepCount(count);
  } catch {
    // Statistics are cosmetic — never surface this failure.
  }
}
