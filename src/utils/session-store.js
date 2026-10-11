/**
 * `chrome.storage.session` wrapper with an in-memory fallback.
 *
 * The session area is the right home for transient per-browser-run state (the
 * startup-suspend window, auto-sleep activity), but it only exists on
 * Chromium 102+. On older builds we degrade to a module-level Map, which is
 * still correct — the service worker just loses that state when it is recycled.
 */

const hasSessionStorage =
  typeof chrome !== 'undefined' &&
  typeof chrome.storage !== 'undefined' &&
  !!chrome.storage.session;

const memory = new Map();

/**
 * Read one session key.
 * @param {string} key
 * @returns {Promise<*>} the stored value, or undefined
 */
export async function sessionGet(key) {
  if (hasSessionStorage) {
    try {
      const result = await chrome.storage.session.get(key);
      return result ? result[key] : undefined;
    } catch {
      // fall through to the in-memory fallback
    }
  }
  return memory.has(key) ? memory.get(key) : undefined;
}

/**
 * Write one or more session keys.
 * @param {Object<string, *>} entries
 * @returns {Promise<void>}
 */
export async function sessionSet(entries) {
  if (hasSessionStorage) {
    try {
      await chrome.storage.session.set(entries);
      return;
    } catch {
      // fall through to the in-memory fallback
    }
  }
  for (const [key, value] of Object.entries(entries)) {
    memory.set(key, value);
  }
}
