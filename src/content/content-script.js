/**
 * Content Script for Tab Sleep Tool
 * Handles saving and restoring tab state (scroll position, form data)
 */

(function() {
  'use strict';

  // Check if we need to restore state after a wake-up
  async function checkAndRestoreState() {
    // Get the restore key for this tab
    const tabId = await getTabId();
    if (!tabId) return;

    const key = `restore_${tabId}`;

    try {
      const result = await chrome.storage.local.get(key);
      const state = result[key];

      if (state) {
        // Wait for page to fully load
        if (document.readyState !== 'complete') {
          await new Promise(resolve => {
            window.addEventListener('load', resolve);
          });
        }

        // Small delay to ensure page is ready
        await new Promise(resolve => setTimeout(resolve, 100));

        // Restore scroll position
        if (state.scrollPosition) {
          window.scrollTo(state.scrollPosition.x, state.scrollPosition.y);
        }

        // Restore form data
        if (state.formData) {
          restoreFormData(state.formData);
        }

        console.log('Tab state restored');
      }
    } catch (error) {
      console.log('Could not restore tab state:', error.message);
    }
  }

  // Get current tab ID
  async function getTabId() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getTabId' }, (response) => {
        resolve(response?.tabId);
      });
    });
  }

  // Restore form data
  function restoreFormData(formData) {
    Object.entries(formData).forEach(([key, value]) => {
      // Try to find element by ID first
      let element = document.getElementById(key);

      // Try by name if not found
      if (!element) {
        element = document.querySelector(`[name="${key}"]`);
      }

      if (element) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          element.checked = value;
        } else {
          element.value = value;
        }

        // Trigger change event for frameworks
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  // Listen for requests to capture state
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'captureState') {
      const state = {};

      if (message.captureScroll) {
        state.scrollPosition = {
          x: window.scrollX,
          y: window.scrollY
        };
      }

      if (message.captureForm) {
        state.formData = captureFormData();
      }

      sendResponse(state);
    }

    if (message.type === 'restoreState') {
      if (message.state.scrollPosition) {
        window.scrollTo(message.state.scrollPosition.x, message.state.scrollPosition.y);
      }
      if (message.state.formData) {
        restoreFormData(message.state.formData);
      }
      sendResponse({ success: true });
    }

    return true;
  });

  // Capture form data
  function captureFormData() {
    const formData = {};
    const inputs = document.querySelectorAll('input:not([type="password"]), textarea, select');

    inputs.forEach((el, index) => {
      const key = el.id || el.name || `element_${index}`;

      if (el.type === 'checkbox' || el.type === 'radio') {
        formData[key] = el.checked;
      } else {
        formData[key] = el.value;
      }
    });

    return formData;
  }

  // Run restore check when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndRestoreState);
  } else {
    checkAndRestoreState();
  }
})();
