import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock } from '../helpers/chrome-mock.js';
import { DEFAULT_SETTINGS, DEFAULT_WHITELIST, STORAGE_KEYS } from '../../src/utils/constants.js';
import {
  getLockedTabs,
  getSettings,
  getSleepingTabs,
  getStatistics,
  getWhitelist,
  incrementSleepCount,
  incrementWakeCount,
  initializeStorage,
  isTabLocked,
  lockTab,
  removeSleepingTab,
  removeSleepingTabs,
  saveSettings,
  saveSleepingTab,
  unlockTab
} from '../../src/utils/storage.js';

const { chrome, state } = createChromeMock();
globalThis.chrome = chrome;

beforeEach(() => {
  state.local = {};
});

describe('defaults', () => {
  it('merges stored settings over the defaults', async () => {
    state.local[STORAGE_KEYS.SETTINGS] = { showBadge: false };
    const settings = await getSettings();
    assert.equal(settings.showBadge, false);
    assert.equal(settings.excludePinnedTabs, DEFAULT_SETTINGS.excludePinnedTabs);
  });

  it('returns a fresh settings object every time', async () => {
    const first = await getSettings();
    first.showBadge = !DEFAULT_SETTINGS.showBadge;
    const second = await getSettings();
    assert.equal(second.showBadge, DEFAULT_SETTINGS.showBadge);
  });

  it('falls back to the shipped whitelist', async () => {
    assert.deepEqual(await getWhitelist(), DEFAULT_WHITELIST);
  });

  it('returns empty containers for state that was never written', async () => {
    assert.deepEqual(await getSleepingTabs(), {});
    assert.equal((await getLockedTabs()).size, 0);
    assert.equal((await getStatistics()).totalSlept, 0);
  });
});

describe('initializeStorage', () => {
  it('seeds every key once', async () => {
    await initializeStorage();
    assert.deepEqual(state.local[STORAGE_KEYS.WHITELIST], DEFAULT_WHITELIST);
    assert.deepEqual(state.local[STORAGE_KEYS.SETTINGS], DEFAULT_SETTINGS);
    assert.deepEqual(state.local[STORAGE_KEYS.SLEEPING_TABS], {});
    assert.deepEqual(state.local[STORAGE_KEYS.LOCKED_TABS], []);
  });

  it('never overwrites existing user data', async () => {
    state.local[STORAGE_KEYS.WHITELIST] = ['keep.me'];
    state.local[STORAGE_KEYS.SETTINGS] = { showBadge: false };
    await initializeStorage();
    assert.deepEqual(state.local[STORAGE_KEYS.WHITELIST], ['keep.me']);
    assert.deepEqual(state.local[STORAGE_KEYS.SETTINGS], { showBadge: false });
  });

  it('is idempotent', async () => {
    await initializeStorage();
    const first = structuredClone(state.local);
    await initializeStorage();
    assert.deepEqual(state.local, first);
  });
});

describe('concurrent read-modify-write', () => {
  // Regression: batch sleep runs ten tabs at a time and every tab bumps the
  // same counters. Without per-key serialisation the updates overwrite each
  // other and both the statistics and the restore state silently lose entries.

  it('does not lose sleep increments', async () => {
    await Promise.all(Array.from({ length: 25 }, () => incrementSleepCount()));
    assert.equal((await getStatistics()).totalSlept, 25);
  });

  it('does not lose wake increments', async () => {
    await Promise.all(Array.from({ length: 25 }, () => incrementWakeCount()));
    assert.equal((await getStatistics()).totalWoken, 25);
  });

  it('keeps sleep and wake counts independent', async () => {
    await Promise.all([
      ...Array.from({ length: 10 }, () => incrementSleepCount()),
      ...Array.from({ length: 4 }, () => incrementWakeCount())
    ]);
    const stats = await getStatistics();
    assert.equal(stats.totalSlept, 10);
    assert.equal(stats.totalWoken, 4);
  });

  it('keeps every concurrently saved tab state', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => saveSleepingTab(index + 1, { tabId: index + 1 }))
    );
    const sleepingTabs = await getSleepingTabs();
    assert.equal(Object.keys(sleepingTabs).length, 20);
    for (let id = 1; id <= 20; id++) {
      assert.deepEqual(sleepingTabs[id], { tabId: id });
    }
  });

  it('honours batched increments', async () => {
    await incrementSleepCount(7);
    assert.equal((await getStatistics()).totalSlept, 7);
  });
});

describe('sleeping tab state', () => {
  it('overwrites state when a tab is slept again', async () => {
    await saveSleepingTab(1, { sleptAt: 1 });
    await saveSleepingTab(1, { sleptAt: 2 });
    assert.equal((await getSleepingTabs())[1].sleptAt, 2);
  });

  it('removes a single entry and tolerates a miss', async () => {
    await saveSleepingTab(1, {});
    await saveSleepingTab(2, {});
    await removeSleepingTab(1);
    await removeSleepingTab(99);
    const sleepingTabs = await getSleepingTabs();
    assert.deepEqual(Object.keys(sleepingTabs), ['2']);
  });

  it('removes several entries in one write and reports how many existed', async () => {
    await saveSleepingTab(1, {});
    await saveSleepingTab(2, {});
    await saveSleepingTab(3, {});

    const removed = await removeSleepingTabs([2, 3, 99]);
    assert.equal(removed, 2, 'tab 99 never existed');
    assert.deepEqual(Object.keys(await getSleepingTabs()), ['1']);
  });

  it('does not write when nothing matches', async () => {
    await saveSleepingTab(1, { sleptAt: 1 });
    const before = structuredClone(state.local[STORAGE_KEYS.SLEEPING_TABS]);
    assert.equal(await removeSleepingTabs([42]), 0);
    assert.deepEqual(state.local[STORAGE_KEYS.SLEEPING_TABS], before);
  });

  it('handles an empty or missing id list', async () => {
    assert.equal(await removeSleepingTabs([]), 0);
    assert.equal(await removeSleepingTabs(undefined), 0);
  });
});

describe('per-tab locks', () => {
  it('locks, reports and unlocks a tab', async () => {
    await lockTab(7);
    assert.equal(await isTabLocked(7), true);
    await unlockTab(7);
    assert.equal(await isTabLocked(7), false);
  });

  it('keeps every concurrently added lock', async () => {
    await Promise.all(Array.from({ length: 15 }, (_, index) => lockTab(index + 1)));
    assert.equal((await getLockedTabs()).size, 15);
  });

  it('does not write when removing a lock that does not exist', async () => {
    await lockTab(1);
    const before = structuredClone(state.local[STORAGE_KEYS.LOCKED_TABS]);
    await unlockTab(2);
    assert.deepEqual(state.local[STORAGE_KEYS.LOCKED_TABS], before);
  });
});

describe('settings persistence', () => {
  it('round-trips through storage', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, showBadge: false });
    assert.equal((await getSettings()).showBadge, false);
  });
});
