/**
 * Page-context state functions, executed *inside the page* via
 * `chrome.scripting.executeScript({ func: ... })`.
 *
 * Because these functions are serialised and injected, they must be completely
 * self-contained: no imports, no module state, no references to anything in an
 * outer scope — only `window`, `document` and other page globals.
 *
 * Keeping capture *and* restore here is the point: they are the two halves of
 * one job, and they used to live in different worlds (this module in the service
 * worker, the restore half in a permanently-injected content script) with the
 * form-field logic duplicated in both. See ADR-0008.
 */

/**
 * @param {boolean} saveScroll
 * @param {boolean} saveForm
 * @returns {{scrollPosition?: {x: number, y: number}, formData?: Object}}
 */
export function captureTabState(saveScroll, saveForm) {
  const state = {};

  if (saveScroll) {
    state.scrollPosition = { x: window.scrollX, y: window.scrollY };
  }

  if (saveForm) {
    state.formData = {};
    // Passwords are deliberately excluded: they must never be written to disk.
    const fields = document.querySelectorAll('input:not([type="password"]), textarea, select');

    fields.forEach((el, index) => {
      const key = el.id || el.name || `element_${index}`;
      if (el.type === 'checkbox' || el.type === 'radio') {
        state.formData[key] = el.checked;
      } else {
        state.formData[key] = el.value;
      }
    });
  }

  return state;
}

/**
 * Put captured scroll position and form contents back into a page that has just
 * loaded.
 *
 * The caller injects this only after the tab reports `status === 'complete'`.
 * Injecting earlier lands on a document that is about to be replaced: measured
 * at 1/25 success versus 25/25 once the load has completed (see docs/ROADMAP.md).
 *
 * @param {{scrollPosition?: {x: number, y: number}, formData?: Object}} state
 * @returns {boolean} whether anything was applied
 */
export function restoreTabState(state) {
  if (!state) return false;

  if (state.scrollPosition) {
    window.scrollTo(state.scrollPosition.x, state.scrollPosition.y);
  }

  if (state.formData) {
    Object.entries(state.formData).forEach(([key, value]) => {
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

  return true;
}
