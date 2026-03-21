import { MESSAGE_TYPES, DEFAULT_SETTINGS, DEFAULT_WHITELIST } from '../utils/constants.js';

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

  // Apply placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = t(key);
  });
}

// DOM Elements
const excludePinned = document.getElementById('excludePinned');
const excludeAudible = document.getElementById('excludeAudible');
const showBadge = document.getElementById('showBadge');
const preserveScroll = document.getElementById('preserveScroll');
const preserveForm = document.getElementById('preserveForm');
const autoSleepEnabled = document.getElementById('autoSleepEnabled');
const autoSleepTimeout = document.getElementById('autoSleepTimeout');
const autoSleepTimeoutContainer = document.getElementById('autoSleepTimeoutContainer');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomain');
const whitelistList = document.getElementById('whitelistList');
const totalSleptEl = document.getElementById('totalDiscarded');  // Element ID stays the same for HTML compatibility
const totalWokenEl = document.getElementById('totalWoken');
const resetStatsBtn = document.getElementById('resetStats');

// Current whitelist
let currentWhitelist = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Apply translations
  applyTranslations();

  await Promise.all([
    loadSettings(),
    loadWhitelist(),
    loadStatistics()
  ]);
});

// Load settings
async function loadSettings() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
    const settings = response.settings || DEFAULT_SETTINGS;

    excludePinned.checked = settings.excludePinnedTabs;
    excludeAudible.checked = settings.excludeAudibleTabs;
    showBadge.checked = settings.showBadge;
    preserveScroll.checked = settings.preserveScrollPosition;
    preserveForm.checked = settings.preserveFormData;
    autoSleepEnabled.checked = settings.autoSleepEnabled || false;
    autoSleepTimeout.value = settings.autoSleepTimeout || 30;
    updateAutoSleepTimeoutVisibility();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Update auto-sleep timeout visibility
function updateAutoSleepTimeoutVisibility() {
  autoSleepTimeoutContainer.style.opacity = autoSleepEnabled.checked ? '1' : '0.5';
  autoSleepTimeout.disabled = !autoSleepEnabled.checked;
}

// Load whitelist
async function loadWhitelist() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_WHITELIST });
    currentWhitelist = response.whitelist || DEFAULT_WHITELIST;
    renderWhitelist();
  } catch (error) {
    console.error('Failed to load whitelist:', error);
  }
}

// Load statistics
async function loadStatistics() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_STATISTICS });
    const stats = response.statistics || {};

    totalSleptEl.textContent = stats.totalSlept || 0;
    totalWokenEl.textContent = stats.totalWoken || 0;
  } catch (error) {
    console.error('Failed to load statistics:', error);
  }
}

// Save settings when toggles change
[excludePinned, excludeAudible, showBadge, preserveScroll, preserveForm, autoSleepEnabled].forEach(toggle => {
  toggle.addEventListener('change', async () => {
    const settings = {
      excludePinnedTabs: excludePinned.checked,
      excludeAudibleTabs: excludeAudible.checked,
      showBadge: showBadge.checked,
      preserveScrollPosition: preserveScroll.checked,
      preserveFormData: preserveForm.checked,
      autoSleepEnabled: autoSleepEnabled.checked,
      autoSleepTimeout: parseInt(autoSleepTimeout.value, 10) || 30
    };

    try {
      await sendMessage({
        type: MESSAGE_TYPES.UPDATE_SETTINGS,
        payload: { settings }
      });
      showToast(t('settingsSaved'), 'success');
      updateAutoSleepTimeoutVisibility();
    } catch (error) {
      showToast(t('failedToSaveSettings'), 'error');
    }
  });
});

// Save auto-sleep timeout when changed
autoSleepTimeout.addEventListener('change', async () => {
  let timeout = parseInt(autoSleepTimeout.value, 10);
  if (timeout < 1) timeout = 1;
  if (timeout > 120) timeout = 120;
  autoSleepTimeout.value = timeout;

  const settings = {
    excludePinnedTabs: excludePinned.checked,
    excludeAudibleTabs: excludeAudible.checked,
    showBadge: showBadge.checked,
    preserveScrollPosition: preserveScroll.checked,
    preserveFormData: preserveForm.checked,
    autoSleepEnabled: autoSleepEnabled.checked,
    autoSleepTimeout: timeout
  };

  try {
    await sendMessage({
      type: MESSAGE_TYPES.UPDATE_SETTINGS,
      payload: { settings }
    });
    showToast(t('settingsSaved'), 'success');
  } catch (error) {
    showToast(t('failedToSaveSettings'), 'error');
  }
});

// Add domain to whitelist
addDomainBtn.addEventListener('click', async () => {
  const domain = newDomainInput.value.trim();

  if (!domain) {
    showToast(t('pleaseEnterDomain'), 'error');
    return;
  }

  // Clean domain
  const cleanDomain = extractDomain(domain);

  if (!cleanDomain) {
    showToast(t('invalidDomainFormat'), 'error');
    return;
  }

  if (currentWhitelist.includes(cleanDomain)) {
    showToast(t('domainAlreadyInWhitelist'), 'error');
    return;
  }

  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.ADD_TO_WHITELIST,
      payload: { url: 'https://' + cleanDomain }
    });

    if (response.success) {
      currentWhitelist.push(cleanDomain);
      renderWhitelist();
      newDomainInput.value = '';
      showToast(t('domainAdded'), 'success');
    } else {
      showToast(response.reason || t('failedToAddDomain'), 'error');
    }
  } catch (error) {
    showToast(t('failedToAddDomain'), 'error');
  }
});

// Handle Enter key in domain input
newDomainInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addDomainBtn.click();
  }
});

// Render whitelist
function renderWhitelist() {
  if (currentWhitelist.length === 0) {
    whitelistList.innerHTML = `<div class="empty-state">${t('noDomainsInWhitelist')}</div>`;
    return;
  }

  whitelistList.innerHTML = currentWhitelist.map(domain => `
    <div class="whitelist-item">
      <span class="whitelist-domain">${escapeHtml(domain)}</span>
      <button class="btn btn-remove" data-domain="${escapeHtml(domain)}" title="${t('remove')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `).join('');

  // Add remove handlers
  whitelistList.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      await removeDomain(domain);
    });
  });
}

// Remove domain from whitelist
async function removeDomain(domain) {
  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.REMOVE_FROM_WHITELIST,
      payload: { domain }
    });

    if (response.success) {
      currentWhitelist = currentWhitelist.filter(d => d !== domain);
      renderWhitelist();
      showToast(t('domainRemoved'), 'success');
    } else {
      showToast(t('failedToRemoveDomain'), 'error');
    }
  } catch (error) {
    showToast(t('failedToRemoveDomain'), 'error');
  }
}

// Reset statistics
resetStatsBtn.addEventListener('click', async () => {
  if (!confirm(t('confirmResetStats'))) {
    return;
  }

  try {
    await sendMessage({
      type: MESSAGE_TYPES.UPDATE_SETTINGS,
      payload: {
        settings: {
          statistics: {
            totalSlept: 0,
            totalWoken: 0,
            lastReset: Date.now()
          }
        }
      }
    });

    totalSleptEl.textContent = '0';
    totalWokenEl.textContent = '0';
    showToast(t('statisticsReset'), 'success');
  } catch (error) {
    showToast(t('failedToResetStatistics'), 'error');
  }
});

// Helper: Send message to background
function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// Helper: Extract domain from URL or string
function extractDomain(input) {
  // Remove protocol if present
  let domain = input.replace(/^https?:\/\//, '');
  // Remove path and query string
  domain = domain.split('/')[0];
  // Remove port
  domain = domain.split(':')[0];
  // Remove www prefix (optional, keep for now)
  return domain.toLowerCase();
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper: Show toast notification
function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger show
  setTimeout(() => toast.classList.add('show'), 10);

  // Hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
