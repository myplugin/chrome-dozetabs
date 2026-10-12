import { DEFAULT_SETTINGS, MESSAGE_TYPES } from '../utils/constants.js';
import { escapeHtml, showToast } from '../utils/dom.js';
import { applyTranslations, t } from '../utils/i18n.js';
import { faviconUrl } from '../utils/favicon.js';
import { isTabSleeping } from '../utils/tab-manager.js';
import { countSleepingTabs, waitForTab, waitForTabs } from '../utils/tab-wait.js';
import {
  extractDomain,
  isChromeInternalPage,
  isEmptyTabPage,
  matchesAnyPattern
} from '../utils/whitelist.js';

/**
 * Popup: the per-window tab list plus the two bulk actions.
 *
 * All decisions (may this tab be slept? is it whitelisted?) are delegated to
 * `src/utils/*` so that this file carries no duplicated rules.
 */

// --- DOM ---------------------------------------------------------------------

const refreshListBtn = document.getElementById('refreshList');
const sleepOtherTabsBtn = document.getElementById('sleepOtherTabs');
const openOptionsBtn = document.getElementById('openOptions');
const activeCountEl = document.getElementById('activeCount');
const sleepingCountEl = document.getElementById('sleepingCount');
const tabsListEl = document.getElementById('tabsList');
const viewTabs = document.querySelectorAll('.view-tab');

// --- State -------------------------------------------------------------------

let currentView = 'active';
let allTabs = [];
let currentTab = null;
let whitelist = [];
let lockedTabs = new Set();
let settings = { ...DEFAULT_SETTINGS };

// --- Icons -------------------------------------------------------------------

const ICONS = {
  moon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  sun: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  pin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
  volume:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  lockOpen:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  lockFilled:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"/></svg>'
};

const DEFAULT_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5f6368"><circle cx="12" cy="12" r="10"/></svg>'
  );

/** Sleep-block reason code -> message key. */
const REASON_KEYS = {
  alreadySleeping: 'reasonAlreadySleeping',
  locked: 'reasonLocked',
  emptyTab: 'reasonEmptyTab',
  internalPage: 'reasonInternalPage',
  pinnedTab: 'reasonPinnedTab',
  audibleTab: 'reasonAudibleTab',
  whitelisted: 'reasonWhitelisted',
  batchAlreadyRunning: 'reasonBatchRunning',
  unknownError: 'failedToSleepTab'
};

// --- Boot --------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  applyTranslations();
  await Promise.all([loadSettings(), loadTabs()]);
  await checkBatchStatus();
});

// --- Data loading ------------------------------------------------------------

async function loadSettings() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
    settings = { ...DEFAULT_SETTINGS, ...(response?.settings || {}) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

async function loadTabs({ preserveScroll = false } = {}) {
  try {
    if (!preserveScroll) tabsListEl.innerHTML = `<div class="loading">${t('loading')}</div>`;

    allTabs = await chrome.tabs.query({ currentWindow: true });
    [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const [whitelistResponse, lockedResponse] = await Promise.all([
      sendMessage({ type: MESSAGE_TYPES.GET_WHITELIST }),
      sendMessage({ type: MESSAGE_TYPES.GET_LOCKED_TABS })
    ]);
    whitelist = whitelistResponse?.whitelist || [];
    lockedTabs = new Set(lockedResponse?.lockedTabs || []);

    const activeTabs = allTabs.filter(
      (tab) => !isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title)
    );
    const sleepingTabs = allTabs.filter(
      (tab) => isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title)
    );

    activeCountEl.textContent = String(activeTabs.length);
    sleepingCountEl.textContent = String(sleepingTabs.length);

    renderTabsList(preserveScroll);
  } catch (error) {
    console.error('[Dozetabs] Failed to load tabs:', error);
    tabsListEl.innerHTML = `<div class="loading">${t('failedToLoadTabs')}</div>`;
  }
}

// --- Rendering ---------------------------------------------------------------

function renderTabsList(preserveScroll = false) {
  const savedScrollTop = preserveScroll ? tabsListEl.scrollTop : 0;

  const filtered = (
    currentView === 'active'
      ? allTabs.filter((tab) => !isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title))
      : allTabs.filter((tab) => isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title))
  ).slice();

  if (filtered.length === 0) {
    const emptyMessage = currentView === 'active' ? t('noActiveTabs') : t('noSleepingTabs');
    tabsListEl.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  // Current tab first, then locked tabs, then document order.
  filtered.sort((a, b) => {
    if (a.id === currentTab?.id) return -1;
    if (b.id === currentTab?.id) return 1;
    const aLocked = lockedTabs.has(a.id);
    const bLocked = lockedTabs.has(b.id);
    if (aLocked !== bLocked) return aLocked ? -1 : 1;
    return a.index - b.index;
  });

  tabsListEl.innerHTML = filtered.map(createTabItem).join('');

  tabsListEl.querySelectorAll('.tab-item').forEach((item) => {
    const tabId = Number.parseInt(item.dataset.tabId, 10);
    item.addEventListener('click', (event) => {
      if (!event.target.closest('.tab-action-btn')) {
        chrome.tabs.update(tabId, { active: true });
      }
    });
  });

  tabsListEl.querySelectorAll('.sleep-btn').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await onSleepTab(Number.parseInt(btn.dataset.tabId, 10));
    });
  });

  tabsListEl.querySelectorAll('.wake-btn').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await onWakeTab(Number.parseInt(btn.dataset.tabId, 10));
    });
  });

  tabsListEl.querySelectorAll('.lock-btn').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const tabId = Number.parseInt(btn.dataset.tabId, 10);
      await onToggleLock(tabId, !btn.classList.contains('locked'));
    });
  });

  loadFavicons();

  if (preserveScroll) tabsListEl.scrollTop = savedScrollTop;
}

function createTabItem(tab) {
  const isActive = tab.id === currentTab?.id;
  const isSleeping = isTabSleeping(tab);
  const isLocked = lockedTabs.has(tab.id);
  const isProtected =
    !isSleeping &&
    (matchesAnyPattern(extractDomain(tab.url), whitelist) || isChromeInternalPage(tab.url));

  let badge = '';
  if (tab.pinned) badge = `<span class="tab-badge pinned">${ICONS.pin}</span>`;
  else if (tab.audible) badge = `<span class="tab-badge audible">${ICONS.volume}</span>`;

  const lockBtn = !isSleeping
    ? `<button class="tab-action-btn lock-btn ${isLocked ? 'locked' : ''}" data-tab-id="${tab.id}" title="${isLocked ? t('unlockTab') : t('lockTab')}">${isLocked ? ICONS.lockFilled : ICONS.lockOpen}</button>`
    : '';

  const actionBtn = isSleeping
    ? `<button class="tab-action-btn wake-btn" data-tab-id="${tab.id}" title="${t('wakeTab')}">${ICONS.sun}</button>`
    : `<button class="tab-action-btn sleep-btn" data-tab-id="${tab.id}" title="${t('sleepTab')}" ${isProtected || isLocked ? 'disabled' : ''}>${ICONS.moon}</button>`;

  return `
    <div class="tab-item ${isActive ? 'active' : ''} ${isSleeping ? 'sleeping' : ''} ${isLocked ? 'locked' : ''}" data-tab-id="${tab.id}">
      <img class="tab-favicon" src="${DEFAULT_FAVICON}" data-favicon-page="${escapeHtml(tab.url || '')}" alt="">
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(tab.title || t('untitled'))}</div>
        <div class="tab-url">${escapeHtml(getShortUrl(tab.url))}</div>
      </div>
      ${badge}
      <div class="tab-actions">
        ${lockBtn}
        ${actionBtn}
      </div>
    </div>
  `;
}

/**
 * Point each row's icon at the browser's built-in favicon endpoint.
 *
 * No network request and no service-worker round trip: Chrome resolves the icon
 * from its own cache. The error listener is attached *before* `src` is set so a
 * missing icon falls back to the placeholder instead of a broken image.
 */
function loadFavicons() {
  tabsListEl.querySelectorAll('.tab-favicon[data-favicon-page]').forEach((img) => {
    const pageUrl = img.dataset.faviconPage;
    delete img.dataset.faviconPage;
    if (!pageUrl) return;

    img.addEventListener(
      'error',
      () => {
        img.src = DEFAULT_FAVICON;
      },
      { once: true }
    );
    img.src = faviconUrl(pageUrl);
  });
}

// --- Views -------------------------------------------------------------------

viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    if (view === currentView) return;
    currentView = view;
    viewTabs.forEach((other) => other.classList.toggle('active', other.dataset.view === view));
    renderTabsList();
  });
});

// --- Actions -----------------------------------------------------------------

async function onSleepTab(tabId) {
  try {
    const result = await sendMessage({ type: MESSAGE_TYPES.SLEEP_TAB, payload: { tabId } });
    if (result?.success) {
      showToast(t('tabSlept'), 'success');
      // Wait for the discard to actually land instead of sleeping blindly.
      await waitForTab(tabId, isTabSleeping);
      await loadTabs();
    } else {
      showToast(reasonText(result?.reason || result?.error), 'error');
    }
  } catch {
    showToast(t('failedToSleepTab'), 'error');
  }
}

/**
 * Waking goes through the service worker: it reloads the tab and counts the
 * wake-up. Calling `chrome.tabs.reload()` here would bypass both the wake
 * counter and the scroll/form restore handshake.
 */
async function onWakeTab(tabId) {
  try {
    const result = await sendMessage({ type: MESSAGE_TYPES.WAKE_TAB, payload: { tabId } });
    if (result?.success) {
      showToast(t('tabWoken'), 'success');
      await waitForTab(tabId, (tab) => !isTabSleeping(tab));
      await loadTabs();
    } else {
      showToast(reasonText(result?.reason || result?.error), 'error');
    }
  } catch {
    showToast(t('failedToWakeTab'), 'error');
  }
}

async function onToggleLock(tabId, shouldLock) {
  try {
    const type = shouldLock ? MESSAGE_TYPES.LOCK_TAB : MESSAGE_TYPES.UNLOCK_TAB;
    await sendMessage({ type, payload: { tabId } });
    showToast(shouldLock ? t('tabLocked') : t('tabUnlocked'), 'success');
    await loadTabs({ preserveScroll: true });
  } catch {
    showToast(t('failedToLockTab'), 'error');
  }
}

// "Sleep all other tabs" doubles as its own abort button.
sleepOtherTabsBtn.addEventListener('click', async () => {
  const status = await sendMessage({ type: MESSAGE_TYPES.GET_BATCH_STATUS });

  if (status?.isRunning) {
    const result = await sendMessage({ type: MESSAGE_TYPES.ABORT_BATCH });
    if (result?.success) showToast(t('batchAborted'));
    updateSleepAllButton(false);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // The confirm step is only skipped when the user turned the setting off.
  if (settings.confirmSleepAll && !window.confirm(t('confirmSleepAllPrompt'))) {
    return;
  }

  updateSleepAllButton(true);

  // Remember how many were asleep so we can tell when the batch has landed.
  const sleepingBefore = countSleepingTabs(allTabs);

  try {
    const result = await sendMessage({
      type: MESSAGE_TYPES.SLEEP_ALL_OTHER,
      payload: { currentTabId: tab.id }
    });

    if (result?.aborted) {
      showToast(t('batchAborted'));
      await loadTabs();
    } else if (typeof result?.slept === 'number') {
      showToast(t('tabsSlept', [String(result.slept), String(result.skipped)]), 'success');
      await waitForTabs((tabs) => countSleepingTabs(tabs) >= sleepingBefore + result.slept);
      await loadTabs();
    } else {
      showToast(reasonText(result?.reason || result?.error), 'error');
      await loadTabs();
    }
  } catch {
    showToast(t('failedToSleepTab'), 'error');
    await loadTabs();
  } finally {
    updateSleepAllButton(false);
  }
});

function updateSleepAllButton(isRunning) {
  sleepOtherTabsBtn.disabled = false;
  sleepOtherTabsBtn.classList.toggle('running', isRunning);
  sleepOtherTabsBtn.title = isRunning ? t('clickToAbort') : t('sleepOtherTabs');

  const icon = isRunning
    ? '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>'
    : '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';

  sleepOtherTabsBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
}

async function checkBatchStatus() {
  try {
    const status = await sendMessage({ type: MESSAGE_TYPES.GET_BATCH_STATUS });
    if (status?.isRunning) updateSleepAllButton(true);
  } catch {
    // The popup stays usable even if the worker is unreachable.
  }
}

refreshListBtn.addEventListener('click', async () => {
  await loadTabs();
  showToast(t('listRefreshed'));
});

openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// --- Helpers -----------------------------------------------------------------

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function reasonText(reason) {
  return t(REASON_KEYS[reason] || 'failedToSleepTab');
}

function getShortUrl(url) {
  return extractDomain(url) || url || '';
}
