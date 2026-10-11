import { AUTO_SLEEP, DEFAULT_SETTINGS } from './constants.js';

/**
 * Settings are a plain, flat object — keep them that way.
 *
 * `sanitizeSettings()` is the single gate between "whatever arrived over
 * `chrome.runtime.sendMessage`" and what is written to storage. It drops
 * unknown keys and coerces every value to the type of its default, so a
 * malformed message can never leave the extension with, say, a string where a
 * boolean is expected.
 */

/**
 * @param {Object} input - untrusted settings object
 * @returns {Object} a complete, type-correct settings object
 */
export function sanitizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const clean = {};

  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const value = source[key];

    if (typeof fallback === 'boolean') {
      clean[key] = typeof value === 'boolean' ? value : fallback;
    } else if (typeof fallback === 'number') {
      const parsed = Number.parseInt(value, 10);
      clean[key] = Number.isFinite(parsed) ? parsed : fallback;
    } else {
      clean[key] = value === undefined || value === null ? fallback : value;
    }
  }

  // Auto-sleep timeouts are bounded, matching the number input in the options UI.
  clean.autoSleepTimeout = Math.min(
    AUTO_SLEEP.MAX_TIMEOUT_MINUTES,
    Math.max(AUTO_SLEEP.MIN_TIMEOUT_MINUTES, clean.autoSleepTimeout)
  );

  return clean;
}
