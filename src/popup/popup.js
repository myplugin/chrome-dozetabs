import { MESSAGE_TYPES } from '../utils/constants.js';
import { isEmptyTabPage } from '../utils/whitelist.js';

// i18n helper
function t(key, substitutions) {
  if (substitutions) {
    return chrome.i18n.getMessage(key, substitutions);
  }
  return chrome.i18n.getMessage(key);
}

// Apply i18n
function applyTranslations() {
  // Text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
  // Title attributes
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    el.title = t(key);
  });
}

// DOM Elements
const refreshListBtn = document.getElementById('refreshList');
const sleepOtherTabsBtn = document.getElementById('sleepOtherTabs');
const openOptionsBtn = document.getElementById('openOptions');
const activeCountEl = document.getElementById('activeCount');
const sleepingCountEl = document.getElementById('sleepingCount');
const tabsListEl = document.getElementById('tabsList');
const viewTabs = document.querySelectorAll('.view-tab');

// State
let currentView = 'active';
let allTabs = [];
let currentTab = null;
let whitelist = [];
let lockedTabs = new Set();

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  applyTranslations();
  await loadTabs();
});

// Check if tab is sleeping
function isTabSleeping(tab) {
  return tab.discarded === true || tab.status === 'unloaded';
}

// Load tabs
async function loadTabs(delay = 0, preserveScroll = false) {
  try {
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

    const activeTabs = allTabs.filter(tab => !isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title));
    const sleepingTabs = allTabs.filter(tab => isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title));

    activeCountEl.textContent = activeTabs.length;
    sleepingCountEl.textContent = sleepingTabs.length;

    renderTabsList(preserveScroll);
  } catch (error) {
    console.error('[Tab Sleep] Failed to load tabs:', error);
    tabsListEl.innerHTML = `<div class="loading">${t('failedToLoadTabs')}</div>`;
  }
}

// Render tabs list
function renderTabsList(preserveScroll = false) {
  const savedScrollTop = preserveScroll ? tabsListEl.scrollTop : 0;

  const filteredTabs = currentView === 'active'
    ? allTabs.filter(tab => !isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title))
    : allTabs.filter(tab => isTabSleeping(tab) && !isEmptyTabPage(tab.url, tab.title));

  if (filteredTabs.length === 0) {
    const emptyMessage = currentView === 'active' ? t('noActiveTabs') : t('noSleepingTabs');
    tabsListEl.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  // Sort: current tab first, then locked tabs, then by index
  const sortedTabs = filteredTabs.sort((a, b) => {
    if (a.id === currentTab?.id) return -1;
    if (b.id === currentTab?.id) return 1;
    const aLocked = lockedTabs.has(a.id);
    const bLocked = lockedTabs.has(b.id);
    if (aLocked && !bLocked) return -1;
    if (!aLocked && bLocked) return 1;
    return a.index - b.index;
  });

  tabsListEl.innerHTML = sortedTabs.map(tab => createTabItem(tab)).join('');

  // Click to switch tab
  tabsListEl.querySelectorAll('.tab-item').forEach(item => {
    const tabId = parseInt(item.dataset.tabId);
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-action-btn')) {
        chrome.tabs.update(tabId, { active: true });
      }
    });
  });

  loadFavicons();

  // Sleep button
  tabsListEl.querySelectorAll('.sleep-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await handleSleepTab(parseInt(btn.dataset.tabId));
    });
  });

  // Wake button
  tabsListEl.querySelectorAll('.wake-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await handleWakeTab(parseInt(btn.dataset.tabId));
    });
  });

  // Lock button
  tabsListEl.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      const isLocked = btn.classList.contains('locked');
      await handleToggleLock(tabId, !isLocked);
    });
  });

  if (preserveScroll) {
    tabsListEl.scrollTop = savedScrollTop;
  }
}

// Icons
const ICONS = {
  moon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  sun: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  pin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
  volume: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  lockOpen: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  lockFilled: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"/></svg>'
};

const DEFAULT_FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5f6368"><circle cx="12" cy="12" r="10"/></svg>');

// Load favicons
async function loadFavicons() {
  const imgs = tabsListEl.querySelectorAll('.tab-favicon[data-favicon-url]');
  for (const img of imgs) {
    const url = img.dataset.faviconUrl;
    if (!url) continue;
    try {
      const result = await sendMessage({ type: MESSAGE_TYPES.FETCH_FAVICON, payload: { url } });
      if (result?.dataUrl) img.src = result.dataUrl;
    } catch {}
    delete img.dataset.faviconUrl;
  }
}

// Create tab item
function createTabItem(tab) {
  const isActive = tab.id === currentTab?.id;
  const isSleeping = isTabSleeping(tab);
  const isLocked = lockedTabs.has(tab.id);
  const isProtected = !isSleeping && (isWhitelisted(tab.url) || isChromeInternal(tab.url));

  // Badge: pinned > audible (locked 通过 lockBtn 显示)
  let badge = '';
  if (tab.pinned) badge = `<span class="tab-badge pinned">${ICONS.pin}</span>`;
  else if (tab.audible) badge = `<span class="tab-badge audible">${ICONS.volume}</span>`;

  // 锁按钮：未休眠的标签页显示，加锁后始终可见
  const lockBtn = !isSleeping
    ? `<button class="tab-action-btn lock-btn ${isLocked ? 'locked' : ''}" data-tab-id="${tab.id}" title="${isLocked ? t('unlockTab') : t('lockTab')}">${isLocked ? ICONS.lockFilled : ICONS.lockOpen}</button>`
    : '';

  const actionBtn = isSleeping
    ? `<button class="tab-action-btn wake-btn" data-tab-id="${tab.id}" title="${t('wakeTab')}">${ICONS.sun}</button>`
    : `<button class="tab-action-btn sleep-btn" data-tab-id="${tab.id}" title="${t('sleepTab')}" ${isProtected || isLocked ? 'disabled' : ''}>${ICONS.moon}</button>`;

  return `
    <div class="tab-item ${isActive ? 'active' : ''} ${isSleeping ? 'sleeping' : ''} ${isLocked ? 'locked' : ''}" data-tab-id="${tab.id}">
      <img class="tab-favicon" src="${DEFAULT_FAVICON}" data-favicon-url="${escapeHtml(tab.favIconUrl || '')}" alt="">
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

// View tab click - 只有点击不同的视图才切换
viewTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    if (view !== currentView) {
      currentView = view;
      viewTabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
      renderTabsList();
    }
  });
});

// Sleep other tabs
sleepOtherTabsBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    // 开始定期刷新 UI（每 300ms）
    const refreshInterval = setInterval(() => loadTabs(0, true), 300);

    try {
      const result = await sendMessage({
        type: MESSAGE_TYPES.SLEEP_ALL_OTHER,
        payload: { currentTabId: tab.id }
      });

      // 停止定期刷新
      clearInterval(refreshInterval);

      if (result?.slept !== undefined || result?.success) {
        showToast(t('tabsSlept', [String(result.slept || 0), String(result.skipped || 0)]));
        await loadTabs(100);
      } else {
        showToast(result?.reason || result?.error || 'Unknown error', true);
        await loadTabs();
      }
    } catch {
      clearInterval(refreshInterval);
      showToast(t('failedToSleepTab'), true);
      await loadTabs();
    }
  }
});

// Handle sleep tab
async function handleSleepTab(tabId) {
  try {
    const result = await sendMessage({ type: MESSAGE_TYPES.SLEEP_TAB, payload: { tabId } });
    if (result?.success) {
      showToast(t('tabSlept'));
      await loadTabs(200);
    } else {
      showToast(result?.reason || result?.error || t('failedToSleepTab'), true);
    }
  } catch {
    showToast(t('failedToSleepTab'), true);
  }
}

// Handle wake tab
async function handleWakeTab(tabId) {
  try {
    await chrome.tabs.reload(tabId);
    showToast(t('tabWoken'));
    await loadTabs();
  } catch {
    showToast(t('failedToWakeTab'), true);
  }
}

// Handle toggle lock
async function handleToggleLock(tabId, shouldLock) {
  try {
    const messageType = shouldLock ? MESSAGE_TYPES.LOCK_TAB : MESSAGE_TYPES.UNLOCK_TAB;
    await sendMessage({ type: messageType, payload: { tabId } });
    showToast(shouldLock ? t('tabLocked') : t('tabUnlocked'));
    await loadTabs(0, true);
  } catch {
    showToast(t('failedToLockTab'), true);
  }
}

// Refresh
refreshListBtn.addEventListener('click', async () => {
  await loadTabs();
  showToast(t('listRefreshed'));
});

// Options
openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// Helpers
function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function getWhitelist() {
  try {
    const res = await sendMessage({ type: MESSAGE_TYPES.GET_WHITELIST });
    return res?.whitelist || [];
  } catch {
    return [];
  }
}

async function getLockedTabs() {
  try {
    const res = await sendMessage({ type: MESSAGE_TYPES.GET_LOCKED_TABS });
    return new Set(res?.lockedTabs || []);
  } catch {
    return new Set();
  }
}

function isWhitelisted(url) {
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

function isChromeInternal(url) {
  if (!url) return true;
  return ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://'].some(s => url.startsWith(s));
}

function getShortUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function showToast(message, isError = false) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 2000);
}
