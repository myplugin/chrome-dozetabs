import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock, makeTab, sendMessage, settle } from './helpers/chrome-mock.js';

/**
 * Sleep / wake / restore, driven through the real message channel.
 *
 * The first wake test is a regression guard: the popup used to call
 * `chrome.tabs.reload()` directly, which bypassed the service worker entirely —
 * so nothing counted the wake-up and the scroll/form restore handshake never
 * ran for tabs woken from the popup.
 */

const { chrome, state } = createChromeMock();
globalThis.chrome = chrome;

await import('../src/background/service-worker.js');
await settle(50);

beforeEach(() => {
  state.tabs = [];
  state.discarded = [];
  state.reloaded = [];
  state.created = [];
  state.local = {};
});

async function readStatistics() {
  return (await chrome.storage.local.get('statistics')).statistics;
}

describe('sleeping a tab', () => {
  it('discards it, captures its state and bumps the statistics', async () => {
    state.tabs = [makeTab(1, { url: 'https://example.com/a', title: 'Example' })];

    const response = await sendMessage(chrome, { type: 'sleepTab', payload: { tabId: 1 } });
    assert.deepEqual(response, { success: true });

    assert.deepEqual(state.discarded, [1]);
    const { sleepingTabs } = await chrome.storage.local.get('sleepingTabs');
    assert.equal(sleepingTabs[1].originalUrl, 'https://example.com/a');
    assert.equal(sleepingTabs[1].title, 'Example');
    assert.equal((await readStatistics()).totalSlept, 1);
  });

  it('refuses a locked tab', async () => {
    state.tabs = [makeTab(1)];
    await sendMessage(chrome, { type: 'lockTab', payload: { tabId: 1 } });

    const response = await sendMessage(chrome, { type: 'sleepTab', payload: { tabId: 1 } });
    assert.equal(response.success, false);
    assert.equal(response.reason, 'locked');
    assert.deepEqual(state.discarded, []);
  });

  it('moves the user away from the tab being slept', async () => {
    state.tabs = [makeTab(1, { active: true, index: 0 }), makeTab(2, { index: 1 })];

    const response = await sendMessage(chrome, { type: 'sleepTab', payload: { tabId: 1 } });
    assert.equal(response.success, true);
    assert.equal(state.tabs.find((tab) => tab.id === 2).active, true);
    assert.deepEqual(state.discarded, [1]);
  });

  it('does not litter the window with blank tabs', async () => {
    // Regression: sleeping the active tab used to always create about:blank.
    state.tabs = [makeTab(1, { active: true, index: 0 }), makeTab(2, { index: 1 })];
    await sendMessage(chrome, { type: 'sleepTab', payload: { tabId: 1 } });
    assert.deepEqual(state.created, []);
  });

  it('degrades gracefully when the tab is already gone', async () => {
    const response = await sendMessage(chrome, { type: 'sleepTab', payload: { tabId: 999 } });
    assert.equal(response.success, false);
    assert.equal(response.reason, 'unknownError');
  });
});

describe('waking a tab', () => {
  it('reloads a background tab and counts the wake-up', async () => {
    state.tabs = [makeTab(2, { discarded: true, status: 'unloaded', active: false })];

    const response = await sendMessage(chrome, { type: 'wakeTab', payload: { tabId: 2 } });
    assert.equal(response.success, true);

    assert.deepEqual(state.reloaded, [2]);
    assert.equal((await readStatistics()).totalWoken, 1);
  });

  it('leaves an active tab to Chrome and still counts the wake-up', async () => {
    // Chrome reloads a discarded tab by itself when it becomes active; issuing
    // a second reload would restart the load in flight.
    state.tabs = [makeTab(2, { discarded: true, status: 'unloaded', active: true })];

    const response = await sendMessage(chrome, { type: 'wakeTab', payload: { tabId: 2 } });
    assert.equal(response.success, true);
    assert.deepEqual(state.reloaded, []);
    assert.equal((await readStatistics()).totalWoken, 1);
  });

  it('does nothing for a tab that is already awake', async () => {
    state.tabs = [makeTab(2)];

    const response = await sendMessage(chrome, { type: 'wakeTab', payload: { tabId: 2 } });
    assert.deepEqual(response, { success: true, alreadyAwake: true });
    assert.deepEqual(state.reloaded, []);
    assert.equal((await readStatistics())?.totalWoken, undefined);
  });
});

describe('state restore handshake', () => {
  const sender = { id: 'test-extension-id', tab: { id: 1 } };

  it('hands the captured state over exactly once', async () => {
    state.tabs = [makeTab(1, { url: 'https://example.com/', title: 'Example' })];
    await sendMessage(chrome, { type: 'sleepTab', payload: { tabId: 1 } });

    const first = await sendMessage(chrome, { type: 'consumeRestoreState' }, sender);
    assert.ok(first.state, 'the state should be returned to the page');
    assert.equal(first.state.originalUrl, 'https://example.com/');

    const second = await sendMessage(chrome, { type: 'consumeRestoreState' }, sender);
    assert.equal(second.state, null, 'a second page load must not replay stale input');
  });

  it('returns null when there is nothing to restore', async () => {
    const response = await sendMessage(chrome, { type: 'consumeRestoreState' }, sender);
    assert.equal(response.state, null);
  });

  it('returns null when the sender has no tab', async () => {
    const response = await sendMessage(
      chrome,
      { type: 'consumeRestoreState' },
      { id: 'test-extension-id' }
    );
    assert.equal(response.state, null);
  });
});

describe('batch sleep', () => {
  it('sleeps every other tab and reports what it skipped', async () => {
    state.tabs = [
      makeTab(1, { active: true, index: 0 }),
      makeTab(2, { index: 1 }),
      makeTab(3, { index: 2, pinned: true }),
      makeTab(4, { index: 3, discarded: true, status: 'unloaded' })
    ];

    const response = await sendMessage(chrome, {
      type: 'sleepAllOther',
      payload: { currentTabId: 1 }
    });

    assert.equal(response.slept, 1);
    assert.equal(response.skipped, 1);
    assert.equal(response.reasons[0].reason, 'pinnedTab');
    assert.deepEqual(state.discarded, [2]);
    assert.equal((await readStatistics()).totalSlept, 1);
  });

  it('resolves the sleep decision without re-reading storage per tab', async () => {
    // Regression guard for the batch path: settings, whitelist and locks must
    // be read once per batch. Evaluating them per tab meant 3 extra storage
    // round-trips for every one of 200 tabs.
    state.tabs = [makeTab(1, { active: true, index: 0 })];
    for (let id = 2; id <= 31; id++) state.tabs.push(makeTab(id, { index: id - 1 }));

    const readsByKey = new Map();
    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = (keys, callback) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        readsByKey.set(key, (readsByKey.get(key) || 0) + 1);
      }
      return originalGet(keys, callback);
    };

    try {
      const response = await sendMessage(chrome, {
        type: 'sleepAllOther',
        payload: { currentTabId: 1 }
      });
      assert.equal(response.slept, 30);
    } finally {
      chrome.storage.local.get = originalGet;
    }

    for (const key of ['settings', 'whitelist', 'lockedTabs']) {
      const reads = readsByKey.get(key) || 0;
      assert.ok(reads <= 3, `"${key}" was read ${reads} times for a 30-tab batch`);
    }
  });

  it('reports that no batch is running before anything starts', async () => {
    // Note: the counters describe the last batch and deliberately stay put;
    // the popup only acts on `isRunning`.
    const status = await sendMessage(chrome, { type: 'getBatchStatus' });
    assert.equal(status.isRunning, false);
  });

  it('refuses to abort when no batch is running', async () => {
    const response = await sendMessage(chrome, { type: 'abortBatch' });
    assert.deepEqual(response, { success: false, reason: 'noBatchRunning' });
  });
});

describe('closing a tab', () => {
  it('forgets its lock and its saved state', async () => {
    state.tabs = [makeTab(5)];
    await sendMessage(chrome, { type: 'sleepTab', payload: { tabId: 5 } });
    await sendMessage(chrome, { type: 'lockTab', payload: { tabId: 5 } });

    // Sanity check: both pieces of state really were stored.
    const before = await chrome.storage.local.get(['lockedTabs', 'sleepingTabs']);
    assert.ok(before.lockedTabs.includes(5));
    assert.ok(before.sleepingTabs[5]);

    await chrome.tabs.remove(5);

    const after = await chrome.storage.local.get(['lockedTabs', 'sleepingTabs']);
    assert.ok(!after.lockedTabs.includes(5));
    assert.equal(after.sleepingTabs[5], undefined);
  });
});

describe('lock management', () => {
  it('lists locked tabs as an array', async () => {
    await sendMessage(chrome, { type: 'lockTab', payload: { tabId: 42 } });
    const response = await sendMessage(chrome, { type: 'getLockedTabs' });
    assert.deepEqual(response.lockedTabs, [42]);
  });

  it('unlocks on request', async () => {
    await sendMessage(chrome, { type: 'lockTab', payload: { tabId: 42 } });
    await sendMessage(chrome, { type: 'unlockTab', payload: { tabId: 42 } });
    assert.deepEqual((await sendMessage(chrome, { type: 'getLockedTabs' })).lockedTabs, []);
  });
});
