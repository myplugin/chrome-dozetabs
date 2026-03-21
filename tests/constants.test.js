import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEYS,
  DEFAULT_WHITELIST,
  DEFAULT_SETTINGS,
  DEFAULT_STATISTICS,
  CHROME_INTERNAL_SCHEMES,
  MESSAGE_TYPES,
  ICONS
} from '../src/utils/constants.js';

describe('constants', () => {
  describe('STORAGE_KEYS', () => {
    it('should have all required storage keys', () => {
      expect(STORAGE_KEYS).toHaveProperty('WHITELIST');
      expect(STORAGE_KEYS).toHaveProperty('SLEEPING_TABS');
      expect(STORAGE_KEYS).toHaveProperty('SETTINGS');
      expect(STORAGE_KEYS).toHaveProperty('STATISTICS');
      expect(STORAGE_KEYS).toHaveProperty('LOCKED_TABS');
    });
  });

  describe('DEFAULT_WHITELIST', () => {
    it('should be an array', () => {
      expect(Array.isArray(DEFAULT_WHITELIST)).toBe(true);
    });

    it('should include common productivity domains', () => {
      expect(DEFAULT_WHITELIST).toContain('gmail.com');
      expect(DEFAULT_WHITELIST).toContain('slack.com');
      expect(DEFAULT_WHITELIST).toContain('notion.so');
      expect(DEFAULT_WHITELIST).toContain('figma.com');
    });
  });

  describe('DEFAULT_SETTINGS', () => {
    it('should have all required settings', () => {
      expect(DEFAULT_SETTINGS).toHaveProperty('excludeAudibleTabs');
      expect(DEFAULT_SETTINGS).toHaveProperty('excludePinnedTabs');
      expect(DEFAULT_SETTINGS).toHaveProperty('preserveFormData');
      expect(DEFAULT_SETTINGS).toHaveProperty('preserveScrollPosition');
      expect(DEFAULT_SETTINGS).toHaveProperty('showBadge');
      expect(DEFAULT_SETTINGS).toHaveProperty('confirmSleepAll');
    });

    it('should have sensible defaults', () => {
      expect(DEFAULT_SETTINGS.excludeAudibleTabs).toBe(true);
      expect(DEFAULT_SETTINGS.excludePinnedTabs).toBe(true);
      expect(DEFAULT_SETTINGS.preserveFormData).toBe(true);
      expect(DEFAULT_SETTINGS.preserveScrollPosition).toBe(true);
      expect(DEFAULT_SETTINGS.showBadge).toBe(true);
    });
  });

  describe('DEFAULT_STATISTICS', () => {
    it('should have required properties', () => {
      expect(DEFAULT_STATISTICS).toHaveProperty('totalSlept');
      expect(DEFAULT_STATISTICS).toHaveProperty('totalWoken');
      expect(DEFAULT_STATISTICS).toHaveProperty('lastReset');
    });

    it('should initialize counters to zero', () => {
      expect(DEFAULT_STATISTICS.totalSlept).toBe(0);
      expect(DEFAULT_STATISTICS.totalWoken).toBe(0);
    });
  });

  describe('CHROME_INTERNAL_SCHEMES', () => {
    it('should be an array', () => {
      expect(Array.isArray(CHROME_INTERNAL_SCHEMES)).toBe(true);
    });

    it('should include common internal schemes', () => {
      expect(CHROME_INTERNAL_SCHEMES).toContain('chrome://');
      expect(CHROME_INTERNAL_SCHEMES).toContain('chrome-extension://');
      expect(CHROME_INTERNAL_SCHEMES).toContain('about:');
      expect(CHROME_INTERNAL_SCHEMES).toContain('devtools://');
    });
  });

  describe('MESSAGE_TYPES', () => {
    it('should have all required message types', () => {
      expect(MESSAGE_TYPES).toHaveProperty('SLEEP_TAB');
      expect(MESSAGE_TYPES).toHaveProperty('SLEEP_ALL_OTHER');
      expect(MESSAGE_TYPES).toHaveProperty('WAKE_TAB');
      expect(MESSAGE_TYPES).toHaveProperty('GET_WHITELIST');
      expect(MESSAGE_TYPES).toHaveProperty('ADD_TO_WHITELIST');
      expect(MESSAGE_TYPES).toHaveProperty('REMOVE_FROM_WHITELIST');
      expect(MESSAGE_TYPES).toHaveProperty('GET_SETTINGS');
      expect(MESSAGE_TYPES).toHaveProperty('UPDATE_SETTINGS');
      expect(MESSAGE_TYPES).toHaveProperty('GET_STATISTICS');
      expect(MESSAGE_TYPES).toHaveProperty('LOCK_TAB');
      expect(MESSAGE_TYPES).toHaveProperty('UNLOCK_TAB');
      expect(MESSAGE_TYPES).toHaveProperty('IS_TAB_LOCKED');
      expect(MESSAGE_TYPES).toHaveProperty('GET_LOCKED_TABS');
      expect(MESSAGE_TYPES).toHaveProperty('GET_BATCH_STATUS');
      expect(MESSAGE_TYPES).toHaveProperty('ABORT_BATCH');
    });
  });

  describe('ICONS', () => {
    it('should have normal and sleeping icon sets', () => {
      expect(ICONS).toHaveProperty('NORMAL');
      expect(ICONS).toHaveProperty('SLEEPING');
    });

    it('should have all required icon sizes', () => {
      expect(ICONS.NORMAL).toHaveProperty(16);
      expect(ICONS.NORMAL).toHaveProperty(32);
      expect(ICONS.NORMAL).toHaveProperty(48);
      expect(ICONS.NORMAL).toHaveProperty(128);
      expect(ICONS.SLEEPING).toHaveProperty(16);
      expect(ICONS.SLEEPING).toHaveProperty(32);
    });
  });
});
