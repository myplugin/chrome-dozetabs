import { MESSAGE_TYPES } from '../utils/constants.js';
import { isEmptyTabPage } from '../utils/whitelist.js';

// i18n helper
function t(key, substitutions) {
  if (substitutions) {
    return chrome.i18n.getMessage(key, substitutions);
  }
  return chrome.i18n.getMessage(key);
}

// Apply i18n to all elements with data-i18n attribute
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
}

// DOM Elements
const sleepCurrentTabBtn = document.getElementById('sleepCurrentTab');
const sleepOtherTabsBtn = document.getElementById('sleepOtherTabs');
const activeCountEl = document.getElementById('activeCount');
const sleepingCountEl = document.getElementById('sleepingCount');
const tabsListEl = document.getElementById('tabsList');
const viewTabs = document.querySelectorAll('.view-tab');
const openOptionsBtn = document.getElementById('openOptions');
const refreshListBtn = document.getElementById('refreshList');

// Debug: Log DOM elements
console.log('[Tab Sleep] DOM Elements:', {
  sleepCurrentTabBtn: !!sleepCurrentTabBtn,
  sleepOtherTabsBtn: !!sleepOtherTabsBtn,
  activeCountEl: !!activeCountEl,
  sleepingCountEl: !!sleepingCountEl,
  tabsListEl: !!tabsListEl,
  viewTabs: viewTabs.length,
  openOptionsBtn: !!openOptionsBtn,
  refreshListBtn: !!refreshListBtn
});

// State
let currentView = 'active';
let allTabs = [];
let currentTab = null;
let whitelist = [];
let lockedTabs = new Set();

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Tab Sleep] Popup opened');

  // Apply translations
  applyTranslations();

  await loadTabs();

  // Setup view tab click handlers
  viewTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      switchView(view);
    });
  });
});

// Helper: Check if tab is sleeping
function isTabSleeping(tab) {
  return tab.discarded === true || tab.status === 'unloaded';
}

// Switch between views
function switchView(view) {
  currentView = view;

  // Update tab buttons
  viewTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  // Re-render list
  renderTabsList();
}

// Load tabs list
async function loadTabs(delay = 0, preserveScroll = false) {
  try {
    // Optional delay to wait for Chrome to update tab states
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (!preserveScroll) {
      tabsListEl.innerHTML = `<div class="loading">${t('loading')}</div>`;
    }

    allTabs = await chrome.tabs.query({ currentWindow: true });
    [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    whitelist = await getWhitelist();
    lockedTabs = await getLockedTabs();

    // Count tabs (excluding empty/new tab pages)
    const sleepingTabs = allTabs.filter(tab => isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title));
    const activeTabs = allTabs.filter(tab => !isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title));

    activeCountEl.textContent = activeTabs.length;
    sleepingCountEl.textContent = sleepingTabs.length;

    // Debug log
    console.log(`[Tab Sleep] Active: ${activeTabs.length}, Sleeping: ${sleepingTabs.length}`);
    sleepingTabs.forEach(tab => {
      console.log(`[Tab Sleep] SLEEPING: "${tab.title?.substring(0, 30)}" (discarded=${tab.discarded}, status=${tab.status})`);
    });

    // Render the list
    renderTabsList(preserveScroll);

  } catch (error) {
    console.error('[Tab Sleep] Failed to load tabs:', error);
    tabsListEl.innerHTML = `<div class="loading">${t('failedToLoadTabs')}</div>`;
  }
}

// Render tabs list based on current view
function renderTabsList(preserveScroll = false) {
  // Save scroll position if needed
  const savedScrollTop = preserveScroll ? tabsListEl.scrollTop : 0;

  const filteredTabs = currentView === 'active'
    ? allTabs.filter(tab => !isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title))
    : allTabs.filter(tab => isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title));

  if (filteredTabs.length === 0) {
    const emptyMessage = currentView === 'active'
      ? t('noActiveTabs')
      : t('noSleepingTabs');
    tabsListEl.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  // Sort: current tab first, then locked tabs, then others by original index
  const sortedTabs = filteredTabs.sort((a, b) => {
    // Current tab always first
    if (a.id === currentTab?.id) return -1;
    if (b.id === currentTab?.id) return 1;
    // Then locked tabs (sorted by index)
    const aLocked = lockedTabs.has(a.id);
    const bLocked = lockedTabs.has(b.id);
    if (aLocked && !bLocked) return -1;
    if (!aLocked && bLocked) return 1;
    // Within same group, sort by original index
    return a.index - b.index;
  });

  tabsListEl.innerHTML = sortedTabs.map(tab => createTabItem(tab)).join('');

  // Add click handlers
  tabsListEl.querySelectorAll('.tab-item').forEach(item => {
    const tabId = parseInt(item.dataset.tabId);
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-action-btn')) {
        chrome.tabs.update(tabId, { active: true });
      }
    });
  });

  // Load favicons asynchronously via background script to avoid 403 errors in console
  loadFavicons();

  // Add sleep button handlers
  tabsListEl.querySelectorAll('.sleep-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      await handleSleepTab(tabId);
    });
  });

  // Add wake button handlers
  tabsListEl.querySelectorAll('.wake-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      await handleWakeTab(tabId);
    });
  });

  // Add lock button handlers
  tabsListEl.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      const isLocked = btn.classList.contains('locked');
      await handleToggleLock(tabId, !isLocked);
    });
  });

  // Restore scroll position if needed
  if (preserveScroll) {
    tabsListEl.scrollTop = savedScrollTop;
  }
}

// Lucide Icons as inline SVG strings
const ICONS = {
  moon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  sun: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  pin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
  volume: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  lock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  lockOpen: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  lockFilled: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"/></svg>'
};

// Default favicon SVG
const DEFAULT_FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5f6368"><circle cx="12" cy="12" r="10"/></svg>');

// Load favicons asynchronously via background script
async function loadFavicons() {
  const faviconImgs = tabsListEl.querySelectorAll('.tab-favicon[data-favicon-url]');

  for (const img of faviconImgs) {
    const faviconUrl = img.dataset.faviconUrl;
    if (!faviconUrl) continue;

    try {
      const result = await sendMessage({
        type: MESSAGE_TYPES.FETCH_FAVICON,
        payload: { url: faviconUrl }
      });

      if (result && result.dataUrl) {
        img.src = result.dataUrl;
      }
    } catch (error) {
      // Silently fail, keep default favicon
      console.debug('[Tab Sleep] Failed to load favicon:', faviconUrl);
    }

    // Remove data attribute to avoid re-fetching
    delete img.dataset.faviconUrl;
  }
}

// Create tab item HTML
function createTabItem(tab) {
  const isActive = tab.id === currentTab?.id;
  const isSleeping = isTabSleeping(tab);
  const isLocked = lockedTabs.has(tab.id);
  const isProtected = !isSleeping && (isWhitelisted(tab.url, whitelist) || isChromeInternal(tab.url));

  // Store favicon URL in data attribute, use default for initial display
  const faviconUrl = tab.favIconUrl || '';

  let badge = '';
  if (tab.pinned) {
    badge = `<span class="tab-badge pinned">${ICONS.pin}</span>`;
  } else if (tab.audible) {
    badge = `<span class="tab-badge audible">${ICONS.volume}</span>`;
  }

  // Lock button for active tabs
  const lockBtn = !isSleeping
    ? `<button class="tab-action-btn lock-btn ${isLocked ? 'locked' : ''}" data-tab-id="${tab.id}" title="${isLocked ? t('unlockTab') : t('lockTab')}">${isLocked ? ICONS.lockFilled : ICONS.lockOpen}</button>`
    : '';

  const actionBtn = isSleeping
    ? `<button class="tab-action-btn wake-btn" data-tab-id="${tab.id}" title="${t('wakeTab')}">${ICONS.sun}</button>`
    : `<button class="tab-action-btn sleep-btn" data-tab-id="${tab.id}" title="${t('sleepTab')}" ${isProtected || isLocked ? 'disabled' : ''}>${ICONS.moon}</button>`;

  return `
    <div class="tab-item ${isActive ? 'active' : ''} ${isSleeping ? 'sleeping' : ''}" data-tab-id="${tab.id}">
      <img class="tab-favicon" src="${DEFAULT_FAVICON}" data-favicon-url="${escapeHtml(faviconUrl)}" alt="">
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

// Handle sleep current tab
sleepCurrentTabBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await handleSleepTab(tab.id);
  }
});

// Handle sleep other tabs
sleepOtherTabsBtn.addEventListener('click', async () => {
  console.log('[Tab Sleep] Sleep other tabs button clicked');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[Tab Sleep] Current tab:', tab);

  if (tab) {
    console.log('[Tab Sleep] Sending SLEEP_ALL_OTHER for tabId:', tab.id);

    try {
      const message = {
        type: MESSAGE_TYPES.SLEEP_ALL_OTHER,
        payload: { currentTabId: tab.id }
      };
      console.log('[Tab Sleep] Message to send:', message);

      const result = await sendMessage(message);

      console.log('[Tab Sleep] SLEEP_ALL_OTHER result:', result);

      if (result && (result.slept !== undefined || result.success)) {
        showToast(t('tabsSlept', [String(result.slept || result.discarded || 0), String(result.skipped || 0)]));
        // Add delay to let Chrome update tab states after discard
        await loadTabs(200);
      } else {
        const errorMsg = result?.reason || result?.error || 'Unknown error';
        console.error('[Tab Sleep] SLEEP_ALL_OTHER failed:', errorMsg);
        showToast(errorMsg, true);
      }
    } catch (error) {
      console.error('[Tab Sleep] SLEEP_ALL_OTHER error:', error);
      showToast(t('failedToSleepTab'), true);
    }
  } else {
    console.error('[Tab Sleep] No current tab found');
  }
});

// Handle sleeping a tab
async function handleSleepTab(tabId) {
  console.log('[Tab Sleep] Sending SLEEP_TAB for tabId:', tabId);

  try {
    const result = await sendMessage({
      type: MESSAGE_TYPES.SLEEP_TAB,
      payload: { tabId }
    });

    console.log('[Tab Sleep] SLEEP_TAB result:', result);

    if (result && result.success) {
      showToast(t('tabSlept'));
      // Add delay to let Chrome update tab states after discard
      await loadTabs(200);
    } else {
      showToast(result?.reason || result?.error || t('failedToSleepTab'), true);
    }
  } catch (error) {
    console.error('[Tab Sleep] SLEEP_TAB error:', error);
    showToast(t('failedToSleepTab'), true);
  }
}

// Handle waking a tab
async function handleWakeTab(tabId) {
  try {
    await chrome.tabs.reload(tabId);
    showToast(t('tabWoken'));
    await loadTabs();
  } catch (error) {
    showToast(t('failedToWakeTab'), true);
  }
}

// Handle toggle lock
async function handleToggleLock(tabId, shouldLock) {
  try {
    const messageType = shouldLock ? MESSAGE_TYPES.LOCK_TAB : MESSAGE_TYPES.UNLOCK_TAB;
    await sendMessage({
      type: messageType,
      payload: { tabId }
    });
    showToast(shouldLock ? t('tabLocked') : t('tabUnlocked'));
    await loadTabs(0, true); // Preserve scroll position
  } catch (error) {
    showToast(t('failedToLockTab'), true);
  }
}

// Refresh button
refreshListBtn.addEventListener('click', async () => {
  await loadTabs();
  showToast(t('listRefreshed'));
});

// Open options page
openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Helper: Send message to background
function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// Helper: Get whitelist
async function getWhitelist() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_WHITELIST });
    return response?.whitelist || [];
  } catch {
    return [];
  }
}

// Helper: Get locked tabs
async function getLockedTabs() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_LOCKED_TABS });
    return new Set(response?.lockedTabs || []);
  } catch {
    return new Set();
  }
}

// Helper: Check if URL is whitelisted
function isWhitelisted(url, whitelist) {
  if (!url) return false;
  try {
    const domain = new URL(url).hostname;
    return whitelist.some(pattern => {
      if (pattern.startsWith('*.')) {
        const base = pattern.slice(2);
        return domain === base || domain.endsWith('.' + base);
      }
      return domain === pattern || domain.endsWith('.' + pattern);
    });
  } catch {
    return false;
  }
}

// Helper: Check if Chrome internal page
function isChromeInternal(url) {
  if (!url) return true;
  const internalSchemes = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://'];
  return internalSchemes.some(scheme => url.startsWith(scheme));
}

// Helper: Get short URL
function getShortUrl(url) {
  if (!url) return '';
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url || '';
  }
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// Helper: Show toast notification
function showToast(message, isError = false) {
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
