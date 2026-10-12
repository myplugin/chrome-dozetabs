import {
  AUTO_SLEEP,
  DEFAULT_SETTINGS,
  DEFAULT_WHITELIST,
  MESSAGE_TYPES
} from '../utils/constants.js';
import { escapeHtml, showToast } from '../utils/dom.js';
import { applyTranslations, t } from '../utils/i18n.js';
import { normalizeDomainInput } from '../utils/whitelist.js';

/**
 * Options page: settings, whitelist and statistics.
 *
 * Every toggle writes the *complete* settings object (built by
 * `collectSettings()`), so a newly added setting can never be dropped by an
 * unrelated save. The service worker sanitises it again before persisting.
 */

// --- DOM ---------------------------------------------------------------------

const toggles = {
  excludePinnedTabs: document.getElementById('excludePinned'),
  excludeAudibleTabs: document.getElementById('excludeAudible'),
  showBadge: document.getElementById('showBadge'),
  preserveScrollPosition: document.getElementById('preserveScroll'),
  preserveFormData: document.getElementById('preserveForm'),
  confirmSleepAll: document.getElementById('confirmSleepAll'),
  autoSleepEnabled: document.getElementById('autoSleepEnabled'),
  startupSuspendEnabled: document.getElementById('startupSuspendEnabled'),
  startupIncludePinned: document.getElementById('startupIncludePinned')
};

const autoSleepTimeout = document.getElementById('autoSleepTimeout');
const autoSleepTimeoutContainer = document.getElementById('autoSleepTimeoutContainer');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomain');
const whitelistList = document.getElementById('whitelistList');
const totalSleptEl = document.getElementById('totalSlept');
const totalWokenEl = document.getElementById('totalWoken');
const resetStatsBtn = document.getElementById('resetStats');
const versionEl = document.getElementById('versionText');

let currentWhitelist = [];

// --- Boot --------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  applyTranslations();

  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

  await Promise.all([loadSettings(), loadWhitelist(), loadStatistics()]);
});

// --- Settings ----------------------------------------------------------------

async function loadSettings() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
    const settings = { ...DEFAULT_SETTINGS, ...(response?.settings || {}) };

    for (const [key, element] of Object.entries(toggles)) {
      if (element) element.checked = !!settings[key];
    }

    autoSleepTimeout.value = String(settings.autoSleepTimeout);
    updateAutoSleepTimeoutVisibility();
  } catch (error) {
    console.error('[Dozetabs] Failed to load settings:', error);
    showToast(t('failedToLoadSettings'), 'error');
  }
}

/** Read the whole settings object back out of the UI. */
function collectSettings() {
  const settings = {};
  for (const [key, element] of Object.entries(toggles)) {
    settings[key] = element.checked;
  }
  settings.autoSleepTimeout = clampTimeout(autoSleepTimeout.value);
  return settings;
}

function clampTimeout(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return AUTO_SLEEP.DEFAULT_TIMEOUT_MINUTES;
  return Math.min(AUTO_SLEEP.MAX_TIMEOUT_MINUTES, Math.max(AUTO_SLEEP.MIN_TIMEOUT_MINUTES, parsed));
}

function updateAutoSleepTimeoutVisibility() {
  const enabled = toggles.autoSleepEnabled.checked;
  autoSleepTimeoutContainer.style.opacity = enabled ? '1' : '0.5';
  autoSleepTimeout.disabled = !enabled;
}

async function saveSettings() {
  try {
    await sendMessage({
      type: MESSAGE_TYPES.UPDATE_SETTINGS,
      payload: { settings: collectSettings() }
    });
    showToast(t('settingsSaved'), 'success');
  } catch {
    showToast(t('failedToSaveSettings'), 'error');
  }
}

for (const element of Object.values(toggles)) {
  element.addEventListener('change', async () => {
    updateAutoSleepTimeoutVisibility();
    await saveSettings();
  });
}

autoSleepTimeout.addEventListener('change', async () => {
  autoSleepTimeout.value = String(clampTimeout(autoSleepTimeout.value));
  await saveSettings();
});

// --- Whitelist ---------------------------------------------------------------

async function loadWhitelist() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_WHITELIST });
    currentWhitelist = response?.whitelist || [...DEFAULT_WHITELIST];
    renderWhitelist();
  } catch (error) {
    console.error('[Dozetabs] Failed to load whitelist:', error);
  }
}

function renderWhitelist() {
  if (currentWhitelist.length === 0) {
    whitelistList.innerHTML = `<div class="empty-state">${t('noDomainsInWhitelist')}</div>`;
    return;
  }

  whitelistList.innerHTML = currentWhitelist
    .map(
      (domain) => `
    <div class="whitelist-item">
      <span class="whitelist-domain">${escapeHtml(domain)}</span>
      <button class="btn btn-remove" data-domain="${escapeHtml(domain)}" title="${t('remove')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `
    )
    .join('');

  whitelistList.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeDomain(btn.dataset.domain));
  });
}

async function addDomain() {
  const raw = newDomainInput.value.trim();
  if (!raw) {
    showToast(t('pleaseEnterDomain'), 'error');
    return;
  }

  const domain = normalizeDomainInput(raw);
  if (!domain) {
    showToast(t('invalidDomainFormat'), 'error');
    return;
  }

  if (currentWhitelist.includes(domain)) {
    showToast(t('domainAlreadyInWhitelist'), 'error');
    return;
  }

  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.ADD_TO_WHITELIST,
      payload: { url: domain }
    });

    if (response?.success) {
      currentWhitelist.push(domain);
      renderWhitelist();
      newDomainInput.value = '';
      showToast(t('domainAdded'), 'success');
    } else {
      showToast(t('failedToAddDomain'), 'error');
    }
  } catch {
    showToast(t('failedToAddDomain'), 'error');
  }
}

async function removeDomain(domain) {
  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.REMOVE_FROM_WHITELIST,
      payload: { domain }
    });

    if (response?.success) {
      currentWhitelist = currentWhitelist.filter((entry) => entry !== domain);
      renderWhitelist();
      showToast(t('domainRemoved'), 'success');
    } else {
      showToast(t('failedToRemoveDomain'), 'error');
    }
  } catch {
    showToast(t('failedToRemoveDomain'), 'error');
  }
}

addDomainBtn.addEventListener('click', addDomain);

newDomainInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addDomain();
});

// --- Statistics --------------------------------------------------------------

async function loadStatistics() {
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_STATISTICS });
    const stats = response?.statistics || {};

    totalSleptEl.textContent = String(stats.totalSlept || 0);
    totalWokenEl.textContent = String(stats.totalWoken || 0);
  } catch (error) {
    console.error('[Dozetabs] Failed to load statistics:', error);
  }
}

resetStatsBtn.addEventListener('click', async () => {
  if (!window.confirm(t('confirmResetStats'))) return;

  try {
    // Reset the dedicated statistics key — never UPDATE_SETTINGS, which would
    // overwrite the whole settings object.
    await sendMessage({ type: MESSAGE_TYPES.RESET_STATISTICS });
    totalSleptEl.textContent = '0';
    totalWokenEl.textContent = '0';
    showToast(t('statisticsReset'), 'success');
  } catch {
    showToast(t('failedToResetStatistics'), 'error');
  }
});

// --- Helpers -----------------------------------------------------------------

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}
