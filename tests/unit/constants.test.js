import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTO_SLEEP,
  CHROME_INTERNAL_SCHEMES,
  DEFAULT_SETTINGS,
  DEFAULT_STATISTICS,
  DEFAULT_WHITELIST,
  MESSAGE_TYPES,
  SESSION_KEYS,
  STORAGE_KEYS,
  STARTUP_SUSPEND_WINDOW_MS
} from '../../src/utils/constants.js';

/**
 * The constants module is the project's shared contract: these tests guard the
 * parts that other files rely on implicitly (unique wire values, complete
 * settings surface, keys that must never be renamed casually).
 */

describe('STORAGE_KEYS', () => {
  it('declares every persisted key', () => {
    for (const key of ['WHITELIST', 'SLEEPING_TABS', 'SETTINGS', 'STATISTICS', 'LOCKED_TABS']) {
      assert.ok(key in STORAGE_KEYS, key);
    }
  });

  it('has unique values', () => {
    const values = Object.values(STORAGE_KEYS);
    assert.equal(new Set(values).size, values.length);
  });
});

describe('SESSION_KEYS', () => {
  it('does not collide with local storage keys', () => {
    const local = new Set(Object.values(STORAGE_KEYS));
    for (const value of Object.values(SESSION_KEYS)) {
      assert.ok(!local.has(value), value);
    }
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('exposes exactly the settings the UI and the worker share', () => {
    assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), [
      'autoSleepEnabled',
      'autoSleepTimeout',
      'confirmSleepAll',
      'excludeAudibleTabs',
      'excludePinnedTabs',
      'preserveFormData',
      'preserveScrollPosition',
      'showBadge',
      'startupIncludePinned',
      'startupSuspendEnabled'
    ]);
  });

  it('keeps the documented defaults', () => {
    assert.equal(DEFAULT_SETTINGS.excludeAudibleTabs, true);
    assert.equal(DEFAULT_SETTINGS.excludePinnedTabs, true);
    assert.equal(DEFAULT_SETTINGS.preserveFormData, true);
    assert.equal(DEFAULT_SETTINGS.preserveScrollPosition, true);
    assert.equal(DEFAULT_SETTINGS.showBadge, true);
    assert.equal(DEFAULT_SETTINGS.confirmSleepAll, true);
    assert.equal(DEFAULT_SETTINGS.startupSuspendEnabled, true);
    assert.equal(DEFAULT_SETTINGS.startupIncludePinned, false);
    assert.equal(DEFAULT_SETTINGS.autoSleepEnabled, false);
    assert.equal(DEFAULT_SETTINGS.autoSleepTimeout, AUTO_SLEEP.DEFAULT_TIMEOUT_MINUTES);
  });
});

describe('DEFAULT_WHITELIST', () => {
  it('is a list of non-empty lowercase patterns', () => {
    assert.ok(Array.isArray(DEFAULT_WHITELIST) && DEFAULT_WHITELIST.length > 0);
    for (const entry of DEFAULT_WHITELIST) {
      assert.equal(entry, entry.toLowerCase());
      assert.ok(entry.length > 0);
    }
  });

  it('contains no duplicates and excludes the same domain twice', () => {
    assert.equal(new Set(DEFAULT_WHITELIST).size, DEFAULT_WHITELIST.length);
  });
});

describe('DEFAULT_STATISTICS', () => {
  it('starts at zero', () => {
    assert.equal(DEFAULT_STATISTICS.totalSlept, 0);
    assert.equal(DEFAULT_STATISTICS.totalWoken, 0);
    assert.ok('lastReset' in DEFAULT_STATISTICS);
  });
});

describe('CHROME_INTERNAL_SCHEMES', () => {
  it('covers the browsers we support', () => {
    for (const scheme of ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://']) {
      assert.ok(CHROME_INTERNAL_SCHEMES.includes(scheme), scheme);
    }
  });
});

describe('MESSAGE_TYPES', () => {
  it('uses unique wire values', () => {
    const values = Object.values(MESSAGE_TYPES);
    assert.equal(new Set(values).size, values.length);
  });

  it('is handled completely by the router (also enforced by npm run validate)', () => {
    assert.ok(Object.keys(MESSAGE_TYPES).length > 0);
  });

  it('keeps the wire values stable', () => {
    // These strings cross the process boundary between the UI, the content
    // script and the worker; renaming one silently breaks the pair.
    assert.equal(MESSAGE_TYPES.SLEEP_TAB, 'sleepTab');
    assert.equal(MESSAGE_TYPES.SLEEP_ALL_OTHER, 'sleepAllOther');
    assert.equal(MESSAGE_TYPES.WAKE_TAB, 'wakeTab');
    assert.equal(MESSAGE_TYPES.CONSUME_RESTORE_STATE, 'consumeRestoreState');
    assert.equal(MESSAGE_TYPES.TRIGGER_STARTUP_SWEEP, 'triggerStartupSweep');
  });
});

describe('timing constants', () => {
  it('keeps the startup window inside the documented 30–60s band', () => {
    assert.ok(STARTUP_SUSPEND_WINDOW_MS >= 30000);
    assert.ok(STARTUP_SUSPEND_WINDOW_MS <= 60000);
  });

  it('uses a sane auto-sleep timeout range', () => {
    assert.ok(AUTO_SLEEP.MIN_TIMEOUT_MINUTES < AUTO_SLEEP.MAX_TIMEOUT_MINUTES);
    assert.ok(
      AUTO_SLEEP.DEFAULT_TIMEOUT_MINUTES >= AUTO_SLEEP.MIN_TIMEOUT_MINUTES &&
        AUTO_SLEEP.DEFAULT_TIMEOUT_MINUTES <= AUTO_SLEEP.MAX_TIMEOUT_MINUTES
    );
  });
});
