/**
 * Favicon proxy for the popup's tab list.
 *
 * The popup cannot load a favicon URL directly: its own CSP forbids remote
 * images from arbitrary hosts (and using `fetch` there would leak the popup's
 * origin). The service worker holds `<all_urls>` anyway, so it fetches the
 * icon once and hands the popup a `data:` URL.
 *
 * Results are cached in memory — opening the popup repeatedly must not refetch
 * every icon.
 */

const DEFAULT_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5f6368"><circle cx="12" cy="12" r="10"/></svg>'
  );

/** Bounded cache: favicon URL -> data URL. */
const cache = new Map();
const CACHE_LIMIT = 300;

/**
 * @param {string} url - the page's favIconUrl
 * @returns {Promise<{success: boolean, dataUrl: string}>}
 */
export async function fetchFavicon(url) {
  if (!url) return { success: false, dataUrl: DEFAULT_FAVICON };
  if (cache.has(url)) return { success: true, dataUrl: cache.get(url) };

  try {
    const response = await fetch(url);
    if (!response.ok) return { success: false, dataUrl: DEFAULT_FAVICON };

    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });

    if (cache.size >= CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(url, dataUrl);
    return { success: true, dataUrl };
  } catch {
    return { success: false, dataUrl: DEFAULT_FAVICON };
  }
}
