/**
 * Favicon URLs served by the browser itself.
 *
 * Chrome (102+) exposes a built-in `_favicon/` endpoint that resolves a page's
 * icon from the browser's own cache. Using it means the extension never issues
 * a network request for an icon — the previous implementation `fetch()`ed the
 * page's declared `favIconUrl` from the service worker, which was the only
 * outbound request the extension made.
 *
 * It also fixes a visible gap: a discarded tab has no `favIconUrl`, so sleeping
 * tabs used to render the generic placeholder. The lookup is by page URL, so
 * they now show their real icon.
 *
 * Requires the `favicon` permission — which, per Chrome's documentation, only
 * triggers an install warning when neither `tabs` nor host permissions are
 * requested. This extension requests both, so the warning set is unchanged.
 */

/** Chrome renders 16px in the tab strip; 32px stays crisp on HiDPI. */
export const FAVICON_SIZE = 32;

/**
 * @param {string} pageUrl - the page whose icon should be shown
 * @param {number} [size]
 * @returns {string} a chrome-extension:// URL pointing at the built-in icon
 */
export function faviconUrl(pageUrl, size = FAVICON_SIZE) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}
