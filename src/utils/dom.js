/**
 * Small DOM helpers shared by the popup and the options page.
 */

/**
 * Escape text before interpolating it into an HTML template string.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

/**
 * Show a transient toast. Only one toast is visible at a time.
 * @param {string} message
 * @param {'info'|'success'|'error'} [type]
 */
export function showToast(message, type = 'info') {
  document.querySelector('.toast')?.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}
