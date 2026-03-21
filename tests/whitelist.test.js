import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome.storage API
const mockStorage = {
  data: {},
  get: vi.fn((keys, callback) => {
    const result = {};
    const keyArray = Array.isArray(keys) ? keys : [keys];
    keyArray.forEach(key => {
      if (mockStorage.data[key] !== undefined) {
        result[key] = mockStorage.data[key];
      }
    });
    callback(result);
  }),
  set: vi.fn((data, callback) => {
    Object.assign(mockStorage.data, data);
    if (callback) callback();
  })
};

global.chrome = {
  storage: {
    local: mockStorage
  },
  runtime: {
    lastError: null
  }
};

// Import after mocking
const {
  extractDomain,
  matchesPattern,
  isChromeInternalPage,
  isEmptyTabPage
} = await import('../src/utils/whitelist.js');

describe('whitelist utilities', () => {
  beforeEach(() => {
    mockStorage.data = {
      whitelist: ['example.com', '*.test.com', 'google.com']
    };
  });

  describe('extractDomain', () => {
    it('should extract domain from valid URLs', () => {
      expect(extractDomain('https://example.com')).toBe('example.com');
      expect(extractDomain('https://www.example.com/path')).toBe('www.example.com');
      expect(extractDomain('http://sub.domain.example.com:8080')).toBe('sub.domain.example.com');
    });

    it('should return empty string for invalid URLs', () => {
      expect(extractDomain('')).toBe('');
      expect(extractDomain('not a url')).toBe('');
      expect(extractDomain(null)).toBe('');
    });
  });

  describe('matchesPattern', () => {
    it('should match exact domains', () => {
      expect(matchesPattern('example.com', 'example.com')).toBe(true);
      expect(matchesPattern('other.com', 'example.com')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(matchesPattern('sub.test.com', '*.test.com')).toBe(true);
      expect(matchesPattern('test.com', '*.test.com')).toBe(true);
      expect(matchesPattern('deep.sub.test.com', '*.test.com')).toBe(true);
      expect(matchesPattern('other.com', '*.test.com')).toBe(false);
    });

    it('should match subdomain patterns without wildcard', () => {
      expect(matchesPattern('sub.example.com', 'example.com')).toBe(true);
      expect(matchesPattern('deep.sub.example.com', 'example.com')).toBe(true);
    });

    it('should return false for empty inputs', () => {
      expect(matchesPattern('', 'example.com')).toBe(false);
      expect(matchesPattern('example.com', '')).toBe(false);
      expect(matchesPattern(null, 'example.com')).toBe(false);
    });
  });

  describe('isChromeInternalPage', () => {
    it('should identify Chrome internal pages', () => {
      expect(isChromeInternalPage('chrome://extensions')).toBe(true);
      expect(isChromeInternalPage('chrome://settings')).toBe(true);
      expect(isChromeInternalPage('chrome-extension://abc123/popup.html')).toBe(true);
      expect(isChromeInternalPage('edge://settings')).toBe(true);
      expect(isChromeInternalPage('about:blank')).toBe(true);
      expect(isChromeInternalPage('devtools://devtools')).toBe(true);
    });

    it('should not identify regular pages as internal', () => {
      expect(isChromeInternalPage('https://example.com')).toBe(false);
      expect(isChromeInternalPage('https://chrome.google.com')).toBe(false);
      expect(isChromeInternalPage('http://localhost:3000')).toBe(false);
    });

    it('should return true for empty/null URLs', () => {
      expect(isChromeInternalPage('')).toBe(true);
      expect(isChromeInternalPage(null)).toBe(true);
    });
  });

  describe('isEmptyTabPage', () => {
    it('should identify empty/new tab pages', () => {
      expect(isEmptyTabPage('chrome://newtab/')).toBe(true);
      expect(isEmptyTabPage('about:blank')).toBe(true);
      expect(isEmptyTabPage('about:newtab')).toBe(true);
      expect(isEmptyTabPage('edge://newtab/')).toBe(true);
      expect(isEmptyTabPage('chrome://blank')).toBe(true);
    });

    it('should not identify regular pages as empty', () => {
      expect(isEmptyTabPage('https://example.com')).toBe(false);
      expect(isEmptyTabPage('https://google.com')).toBe(false);
    });

    it('should handle title-based detection', () => {
      expect(isEmptyTabPage('about:blank', 'New Tab')).toBe(true);
      expect(isEmptyTabPage('chrome://newtab/', 'Blank Page')).toBe(true);
    });
  });
});
