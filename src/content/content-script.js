/**
 * Content script: puts scroll position and form contents back after a sleeping
 * tab is woken up.
 *
 * How it works: `sleepTab()` persists the captured state *before* discarding
 * the tab, so by the time a wake-up reloads the page the state is already in
 * storage. The script simply asks the service worker to hand it over
 * ("consume"), which also clears the entry so a later plain reload does not
 * replay stale input.
 *
 * Note: a content script is a classic script, so it cannot `import` the shared
 * constants. The message type below must stay in sync with
 * `MESSAGE_TYPES.CONSUME_RESTORE_STATE` in `src/utils/constants.js` —
 * `npm run validate` enforces that.
 */
(function () {
  'use strict';

  const CONSUME_RESTORE_STATE = 'consumeRestoreState';

  async function restoreState() {
    let state;

    try {
      const response = await chrome.runtime.sendMessage({ type: CONSUME_RESTORE_STATE });
      state = response && response.state;
    } catch {
      // The worker may have been recycled. Restoring is best-effort.
      return;
    }

    if (!state) return;

    if (document.readyState !== 'complete') {
      await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
    }

    // Give frameworks a moment to hydrate before writing values back.
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (state.scrollPosition) {
      window.scrollTo(state.scrollPosition.x, state.scrollPosition.y);
    }

    if (state.formData) {
      restoreFormData(state.formData);
    }
  }

  function restoreFormData(formData) {
    Object.entries(formData).forEach(([key, value]) => {
      let element = document.getElementById(key);
      if (!element) {
        element = document.querySelector(`[name="${CSS.escape(key)}"]`);
      }
      if (!element) return;

      if (element.type === 'checkbox' || element.type === 'radio') {
        element.checked = value;
      } else {
        element.value = value;
      }

      // Let frameworks (React/Vue/...) notice the change.
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreState, { once: true });
  } else {
    restoreState();
  }
})();
