import { getWhitelist, saveWhitelist } from './storage.js';

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} - Domain name
 */
export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

/**
 * Check if a domain matches a whitelist pattern
 * Supports exact match and subdomain wildcard (*.example.com)
 * @param {string} domain - Domain to check
 * @param {string} pattern - Whitelist pattern
 * @returns {boolean} - True if matches
 */
export function matchesPattern(domain, pattern) {
  if (!domain || !pattern) return false;

  // Exact match
  if (domain === pattern) return true;

  // Wildcard subdomain match (e.g., *.example.com)
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    return domain === baseDomain || domain.endsWith('.' + baseDomain);
  }

  // Check if pattern is a suffix of domain (e.g., example.com matches sub.example.com)
  return domain.endsWith('.' + pattern);
}

/**
 * Check if a URL is in the whitelist
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} - True if whitelisted
 */
export async function isWhitelisted(url) {
  const domain = extractDomain(url);
  if (!domain) return false;

  const whitelist = await getWhitelist();
  return whitelist.some(pattern => matchesPattern(domain, pattern));
}

/**
 * Add a domain to the whitelist
 * @param {string} domain - Domain to add
 * @returns {Promise<boolean>} - True if added, false if already exists
 */
export async function addToWhitelist(domain) {
  // Clean up the domain
  const cleanDomain = extractDomain('https://' + domain.replace(/^https?:\/\//, ''));

  if (!cleanDomain) return false;

  const whitelist = await getWhitelist();

  // Check if already exists
  if (whitelist.includes(cleanDomain)) {
    return false;
  }

  whitelist.push(cleanDomain);
  await saveWhitelist(whitelist);
  return true;
}

/**
 * Remove a domain from the whitelist
 * @param {string} domain - Domain to remove
 * @returns {Promise<boolean>} - True if removed
 */
export async function removeFromWhitelist(domain) {
  const whitelist = await getWhitelist();
  const index = whitelist.indexOf(domain);

  if (index === -1) return false;

  whitelist.splice(index, 1);
  await saveWhitelist(whitelist);
  return true;
}

/**
 * Check if URL is a Chrome internal page
 * @param {string} url - URL to check
 * @returns {boolean} - True if internal page
 */
export function isChromeInternalPage(url) {
  if (!url) return true;

  const internalSchemes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'chrome-search://',
    'devtools://'
  ];

  return internalSchemes.some(scheme => url.startsWith(scheme));
}

/**
 * Check if URL is an empty/new tab page that should be excluded
 * These are tabs that are "blank" and shouldn't be counted or put to sleep
 * @param {string} url - URL to check
 * @param {string} title - Tab title (optional)
 * @returns {boolean} - True if empty/new tab page
 */
export function isEmptyTabPage(url, title = '') {
  if (!url) return true;

  // URLs that are definitely empty/new tab pages
  const emptyUrls = [
    'chrome://newtab/',
    'chrome://blank',
    'about:blank',
    'about:newtab',
    'edge://newtab/',
    'edge://blank',
    'chrome-search://local-ntp/local-ntp.html'
  ];

  // Check if URL matches empty URLs
  if (emptyUrls.some(emptyUrl => url === emptyUrl || url.startsWith(emptyUrl))) {
    return true;
  }

  // Check if it's a Chrome internal page with no real content
  if (isChromeInternalPage(url)) {
    return true;
  }

  // Optional: Check if title suggests empty page
  // But be careful - some pages might legitimately have "New Tab" as title
  // So we only consider it empty if URL also matches patterns
  const emptyTitlePatterns = ['new tab', 'blank page', 'about:blank'];
  const lowerTitle = title.toLowerCase();

  if (emptyTitlePatterns.some(pattern => lowerTitle === pattern)) {
    // Double check URL is also suspicious
    if (url.includes('newtab') || url.includes('blank') || url === 'about:blank') {
      return true;
    }
  }

  return false;
}
