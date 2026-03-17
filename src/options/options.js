import { MESSAGE_TYPES, DEFAULT_SETTINGS, DEFAULT_WHITELIST } from '../utils/constants.js';

// DOM Elements
const excludePinned = document.getElementById('excludePinned');
const excludeAudible = document.getElementById('excludeAudible');
const showBadge = document.getElementById('showBadge');
const preserveScroll = document.getElementById('preserveScroll');
const preserveForm = document.getElementById('preserveForm');
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
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
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
[excludePinned, excludeAudible, showBadge, preserveScroll, preserveForm].forEach(toggle => {
  toggle.addEventListener('change', async () => {
    const settings = {
      excludePinnedTabs: excludePinned.checked,
      excludeAudibleTabs: excludeAudible.checked,
      showBadge: showBadge.checked,
      preserveScrollPosition: preserveScroll.checked,
      preserveFormData: preserveForm.checked
    };

    try {
      await sendMessage({
        type: MESSAGE_TYPES.UPDATE_SETTINGS,
        payload: { settings }
      });
      showToast('Settings saved', 'success');
    } catch (error) {
      showToast('Failed to save settings', 'error');
    }
  });
});

// Add domain to whitelist
addDomainBtn.addEventListener('click', async () => {
  const domain = newDomainInput.value.trim();

  if (!domain) {
    showToast('Please enter a domain', 'error');
    return;
  }

  // Clean domain
  const cleanDomain = extractDomain(domain);

  if (!cleanDomain) {
    showToast('Invalid domain format', 'error');
    return;
  }

  if (currentWhitelist.includes(cleanDomain)) {
    showToast('Domain already in whitelist', 'error');
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
      showToast('Domain added to whitelist', 'success');
    } else {
      showToast(response.reason || 'Failed to add domain', 'error');
    }
  } catch (error) {
    showToast('Failed to add domain', 'error');
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
    whitelistList.innerHTML = '<div class="empty-state">No domains in whitelist</div>';
    return;
  }

  whitelistList.innerHTML = currentWhitelist.map(domain => `
    <div class="whitelist-item">
      <span class="whitelist-domain">${escapeHtml(domain)}</span>
      <button class="btn btn-remove" data-domain="${escapeHtml(domain)}" title="Remove">
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
      showToast('Domain removed from whitelist', 'success');
    } else {
      showToast('Failed to remove domain', 'error');
    }
  } catch (error) {
    showToast('Failed to remove domain', 'error');
  }
}

// Reset statistics
resetStatsBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to reset all statistics?')) {
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
    showToast('Statistics reset', 'success');
  } catch (error) {
    showToast('Failed to reset statistics', 'error');
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
