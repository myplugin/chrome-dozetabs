import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUTO_SLEEP, DEFAULT_SETTINGS } from '../../src/utils/constants.js';
import { sanitizeSettings } from '../../src/utils/settings.js';

/**
 * `sanitizeSettings()` is the only gate between an untrusted message payload
 * and what gets persisted as the user's settings.
 */

describe('sanitizeSettings', () => {
  it('always returns a complete settings object', () => {
    const result = sanitizeSettings({});
    assert.deepEqual(Object.keys(result).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('drops unknown keys', () => {
    const result = sanitizeSettings({ evil: 'payload', autoSleepTimeout: 10 });
    assert.ok(!('evil' in result));
    assert.equal(result.autoSleepTimeout, 10);
  });

  it('keeps valid values', () => {
    const result = sanitizeSettings({ showBadge: false, autoSleepEnabled: true });
    assert.equal(result.showBadge, false);
    assert.equal(result.autoSleepEnabled, true);
  });

  it('falls back to the default when a boolean is not a boolean', () => {
    const result = sanitizeSettings({ showBadge: 'yes', excludePinnedTabs: 0 });
    assert.equal(result.showBadge, DEFAULT_SETTINGS.showBadge);
    assert.equal(result.excludePinnedTabs, DEFAULT_SETTINGS.excludePinnedTabs);
  });

  it('coerces numeric strings and rejects garbage', () => {
    assert.equal(sanitizeSettings({ autoSleepTimeout: '45' }).autoSleepTimeout, 45);
    assert.equal(
      sanitizeSettings({ autoSleepTimeout: 'soon' }).autoSleepTimeout,
      AUTO_SLEEP.DEFAULT_TIMEOUT_MINUTES
    );
  });

  it('clamps the auto-sleep timeout to the supported range', () => {
    assert.equal(
      sanitizeSettings({ autoSleepTimeout: 0 }).autoSleepTimeout,
      AUTO_SLEEP.MIN_TIMEOUT_MINUTES
    );
    assert.equal(
      sanitizeSettings({ autoSleepTimeout: 100000 }).autoSleepTimeout,
      AUTO_SLEEP.MAX_TIMEOUT_MINUTES
    );
  });

  it('survives non-object input', () => {
    for (const input of [null, undefined, 'nope', 42, []]) {
      const result = sanitizeSettings(input);
      assert.equal(result.showBadge, DEFAULT_SETTINGS.showBadge);
    }
  });
});
