import { AUTO_SLEEP, STORAGE_KEYS } from '../utils/constants.js';
import { initializeStorage, unlockTab } from '../utils/storage.js';
import { getTab } from '../utils/tab-manager.js';
import {
  forgetTabActivity,
  recordTabActivity,
  runAutoSleepCheck,
  setupAutoSleep
} from './auto-sleep.js';
import { updateBadge, updateBadgeSoon } from './badge.js';
import { sleepAllOtherTabs } from './batch.js';
import { createContextMenus, handleContextMenuClick } from './menus.js';
import { registerMessageRouter } from './router.js';
import { forgetTab, pruneSleepingTabs, sleepTab, wakeTab } from './sleep.js';
import {
  handleStartupTabCreated,
  handleStartupTabLoading,
  initStartupSuspend,
  invalidateStartupSuspendCaches,
  isStartupWindowOpen,
  markUserActivated,
  openStartupWindowIfNeeded
} from './startup-suspend.js';

/**
 * MV3 service worker — the extension's only long-lived(ish) context.
 *
 * This file is deliberately thin: it wires Chrome events to the modules in this
 * directory and owns no business logic of its own. Handlers await
 * `startupSuspendReady` before touching startup state so that a worker restarted
 * mid-window never acts on a stale window boundary.
 */

// Kick off startup-window detection as soon as the worker boots.
const startupSuspendReady = initStartupSuspend();

// ---------------------------------------------------------------------------
// Install & browser start
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  await pruneSleepingTabs();
  await createContextMenus();
  await setupAutoSleep();
  console.log('[Tab Sleep] Extension installed/updated');
});

chrome.runtime.onStartup.addListener(async () => {
  // This event only fires when the browser (profile) itself starts — the
  // canonical signal for opening the startup-suspend window.
  await startupSuspendReady;
  try {
    await openStartupWindowIfNeeded();
  } catch (error) {
    console.warn('[Tab Sleep] Failed to open the startup suspend window:', error);
  }

  await initializeStorage();
  // Tab ids are session-scoped, so anything saved by the previous run is dead
  // weight at best and a wrong-state hazard at worst. Do this before session
  // restore hands out new ids.
  await pruneSleepingTabs();
  await createContextMenus();
  await updateBadge();
  await setupAutoSleep();
});

// ---------------------------------------------------------------------------
// Messages (popup / options / content script)
// ---------------------------------------------------------------------------

registerMessageRouter();

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------

// Startup suspend, first line of defence: session-restored tabs are created
// with status 'unloaded' and only navigated afterwards, so discarding them in
// this instant intercepts the load.
chrome.tabs.onCreated.addListener(async (tab) => {
  await startupSuspendReady;
  await recordTabActivity(tab.id);
  await handleStartupTabCreated(tab);
});

// Badge upkeep + the startup-suspend fallback rule.
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.discarded !== undefined) {
    updateBadgeSoon();
  }

  if (changeInfo.status === 'loading' && tab && !tab.active) {
    await startupSuspendReady;
    await handleStartupTabLoading(tab);
  }
});

// A discarded tab that becomes active is being woken up by the user.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (isStartupWindowOpen()) markUserActivated(activeInfo.tabId);
  await recordTabActivity(activeInfo.tabId);

  let tab;
  try {
    tab = await getTab(activeInfo.tabId);
  } catch {
    return; // the tab vanished between the event and our lookup
  }

  if (tab.discarded) await wakeTab(tab.id);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await unlockTab(tabId);
  await forgetTab(tabId);
  await forgetTabActivity(tabId);
  updateBadgeSoon();
});

// ---------------------------------------------------------------------------
// Alarms (auto-sleep)
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_SLEEP.ALARM_NAME) {
    await runAutoSleepCheck();
  }
});

// ---------------------------------------------------------------------------
// Context menus & keyboard shortcuts
// ---------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (command === 'sleep-current-tab') {
      await sleepTab(tab.id);
    } else if (command === 'sleep-other-tabs') {
      await sleepAllOtherTabs(tab.id);
    }
  } catch (error) {
    console.error('[Tab Sleep] Command handler failed:', error);
  }
});

// ---------------------------------------------------------------------------
// Settings changes
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[STORAGE_KEYS.SETTINGS]) {
    const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue;
    if (newSettings && newSettings.autoSleepEnabled !== undefined) {
      await setupAutoSleep();
    }
    invalidateStartupSuspendCaches();
  }

  // Whitelist and locks feed the sleep decision, including the startup window.
  if (changes[STORAGE_KEYS.WHITELIST] || changes[STORAGE_KEYS.LOCKED_TABS]) {
    invalidateStartupSuspendCaches();
  }
});

console.log('[Tab Sleep] Service worker started');
