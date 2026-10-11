/**
 * State capture executed *inside the page*, via
 * `chrome.scripting.executeScript({ func: captureTabState })`.
 *
 * Because it is serialised and injected, this function must be completely
 * self-contained: it cannot reference imports, module state or any outer
 * variable. That constraint is the reason the page-context restore logic in
 * `src/content/content-script.js` exists as a separate (small) implementation —
 * see docs/ARCHITECTURE.md.
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
