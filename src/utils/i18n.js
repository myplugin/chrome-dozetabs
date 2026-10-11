/**
 * i18n helpers shared by the popup and the options page.
 *
 * `t()` falls back to the key itself: a missing translation then shows up as
 * an obviously wrong string instead of an empty label, which is far easier to
 * catch in review (and `npm run validate` fails the build for it anyway).
 */

/**
 * @param {string} key - message key from `_locales/<lang>/messages.json`
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
export function t(key, substitutions) {
  const message = chrome.i18n.getMessage(key, substitutions);
  return message || key;
}

/**
 * Translate every `data-i18n*` annotated element below `root`.
 * @param {ParentNode} [root]
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
