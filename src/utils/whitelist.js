import { CHROME_INTERNAL_SCHEMES, STORAGE_KEYS } from './constants.js';
import { getWhitelist, saveWhitelist, withStorageLock } from './storage.js';

/**
 * Domain-matching rules shared by the service worker and both UI surfaces.
 *
 * This module is the *only* place that decides whether a URL is whitelisted,
 * browser-internal or an empty/new-tab page. The popup, the options page and
 * the sleep paths all call into it — previously each of them carried its own
 * copy of the rules and they had already started to diverge.
 */

/** URLs that are blank or browser-generated and therefore meaningless to sleep. */
const EMPTY_TAB_URLS = [
  'chrome://newtab/',
  'chrome://blank',
  'about:blank',
  'about:newtab',
  'edge://newtab/',
  'edge://blank',
  'chrome-search://local-ntp/local-ntp.html'
];

const EMPTY_TAB_TITLES = ['new tab', 'blank page', 'about:blank'];

/**
 * Extract the hostname from a URL.
 * @param {string} url
 * @returns {string} hostname, or '' when the input is not a URL
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Turn free-form user input ("https://Example.com/path", "example.com:8080",
 * "*.example.com") into the canonical pattern stored in the whitelist.
 * @param {string} input
 * @returns {string} normalised domain pattern, or '' when unusable
 */
export function normalizeDomainInput(input) {
  if (typeof input !== 'string') return '';

  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';

  // Wildcards are meaningful to us but not to URL(); keep the prefix.
  if (trimmed.startsWith('*.')) {
    return normalizeDomainInput(trimmed.slice(2))
      ? `*.${normalizeDomainInput(trimmed.slice(2))}`
      : '';
  }

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const hostAndPort = withoutScheme.split('/')[0].split('?')[0].split('#')[0];
  const host = hostAndPort.split('@').pop().split(':')[0];

  // Single-label hosts are allowed on purpose: `localhost` and intranet
  // hostnames are common whitelist entries.
  if (!host) return '';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) return '';

  return host;
}

/**
 * Check whether a domain matches one whitelist pattern.
 * Supports exact match and the `*.example.com` wildcard form.
 * @param {string} domain
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchesPattern(domain, pattern) {
  if (!domain || !pattern) return false;

  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    return domain === baseDomain || domain.endsWith('.' + baseDomain);
  }

  // A bare pattern also covers its subdomains: `example.com` matches
  // `mail.example.com` but not `notexample.com`.
  return domain === pattern || domain.endsWith('.' + pattern);
}

/**
 * @param {string} domain
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function matchesAnyPattern(domain, patterns) {
  if (!domain || !Array.isArray(patterns)) return false;
  return patterns.some((pattern) => matchesPattern(domain, pattern));
}

/**
 * @param {string} url
 * @returns {Promise<boolean>} true when the URL must never be slept
 */
export async function isWhitelisted(url) {
  const domain = extractDomain(url);
  if (!domain) return false;
  return matchesAnyPattern(domain, await getWhitelist());
}

/**
 * Add a domain to the whitelist.
 * @param {string} input - domain or URL
 * @returns {Promise<{added: boolean, domain: string}>}
 */
export async function addToWhitelist(input) {
  const domain = normalizeDomainInput(input);
  if (!domain) return { added: false, domain: '' };

  return withStorageLock(STORAGE_KEYS.WHITELIST, async () => {
    const whitelist = await getWhitelist();
    if (whitelist.includes(domain)) return { added: false, domain };
    whitelist.push(domain);
    await saveWhitelist(whitelist);
    return { added: true, domain };
  });
}

/**
 * Remove a domain from the whitelist.
 * @param {string} input - domain or URL
 * @returns {Promise<{removed: boolean, domain: string}>}
 */
export async function removeFromWhitelist(input) {
  const domain = normalizeDomainInput(input);
  if (!domain) return { removed: false, domain: '' };

  return withStorageLock(STORAGE_KEYS.WHITELIST, async () => {
    const whitelist = await getWhitelist();
    const index = whitelist.indexOf(domain);
    if (index === -1) return { removed: false, domain };
    whitelist.splice(index, 1);
    await saveWhitelist(whitelist);
    return { removed: true, domain };
  });
}

/**
 * Check whether a URL belongs to the browser itself.
 * @param {string} url
 * @returns {boolean} true for chrome://, edge://, about:, devtools://, ...
 */
export function isChromeInternalPage(url) {
  if (!url) return true;
  return CHROME_INTERNAL_SCHEMES.some((scheme) => url.startsWith(scheme));
}

/**
 * Check whether a tab holds no real content (fresh tab, blank page, internal
 * page). Such tabs are neither counted nor slept.
 * @param {string} url
 * @param {string} [title]
 * @returns {boolean}
 */
export function isEmptyTabPage(url, title = '') {
  if (!url) return true;

  if (EMPTY_TAB_URLS.some((emptyUrl) => url === emptyUrl || url.startsWith(emptyUrl))) {
    return true;
  }

  if (isChromeInternalPage(url)) {
    return true;
  }

  const lowerTitle = (title || '').toLowerCase();
  if (!EMPTY_TAB_TITLES.includes(lowerTitle)) return false;

  // The title alone is not enough ("New Tab" pages exist on real sites), so
  // require the URL to look browser-generated too.
  return url.includes('newtab') || url.includes('blank');
}
