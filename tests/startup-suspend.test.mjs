import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { createChromeMock, makeTab, sendMessage, settle } from './helpers/chrome-mock.js';

/**
 * Startup suspend (启动抢先休眠) — the feature that keeps a session full of
 * restored tabs unloaded instead of loading them all at once.
 *
 * The service worker is booted against the shared chrome mock, then its event
 * listeners and message handlers are driven directly.
 */

const { chrome, state } = createChromeMock();
globalThis.chrome = chrome;

await import('../src/background/service-worker.js');
await settle(50);

before(async () => {
  // chrome.runtime.onStartup is the only signal that opens the window.
  await chrome.runtime.onStartup.trigger();
  await settle(10);
});

beforeEach(() => {
  state.tabs = [];
  state.discarded = [];
  state.reloaded = [];
});

async function setSetting(key, value) {
  const { settings } = await chrome.storage.local.get('settings');
  settings[key] = value;
  await chrome.storage.local.set({ settings });
}

describe('onCreated — the preemptive race', () => {
  it('discards an unloaded, non-active, discardable tab', async () => {
    const tab = makeTab(1, { status: 'unloaded' });
    state.tabs = [tab];
    await chrome.tabs.onCreated.trigger(tab);
    assert.deepEqual(state.discarded, [1]);
  });

  it('ignores an active tab (an ordinary new tab)', async () => {
    const tab = makeTab(2, { status: 'unloaded', active: true });
    state.tabs = [tab];
    await chrome.tabs.onCreated.trigger(tab);
    assert.deepEqual(state.discarded, []);
  });

  it('ignores a pinned tab by default', async () => {
    const tab = makeTab(3, { status: 'unloaded', pinned: true });
    state.tabs = [tab];
    await chrome.tabs.onCreated.trigger(tab);
    assert.deepEqual(state.discarded, []);
  });

  it('ignores a tab the browser refuses to discard', async () => {
    const tab = makeTab(4, { status: 'unloaded', autoDiscardable: false });
    state.tabs = [tab];
    await chrome.tabs.onCreated.trigger(tab);
    assert.deepEqual(state.discarded, []);
  });

  it('ignores a whitelisted domain', async () => {
    await chrome.storage.local.set({ whitelist: ['example.com'] });
    const tab = makeTab(5, { status: 'unloaded' });
    state.tabs = [tab];
    await chrome.tabs.onCreated.trigger(tab);
    assert.deepEqual(state.discarded, []);
    await chrome.storage.local.set({ whitelist: [] });
  });

  it('ignores a tab that already finished loading', async () => {
    // A restored tab that raced past us must not be discarded by onCreated;
    // the sweep is responsible for that case.
    const tab = makeTab(6, { status: 'complete' });
    state.tabs = [tab];
    await chrome.tabs.onCreated.trigger(tab);
    assert.deepEqual(state.discarded, []);
  });
});

describe('onUpdated — the fallback rule', () => {
  it('discards a loading background tab', async () => {
    const tab = makeTab(7, { status: 'loading' });
    state.tabs = [tab];
    await chrome.tabs.onUpdated.trigger(7, { status: 'loading' }, tab);
    assert.deepEqual(state.discarded, [7]);
  });

  it('ignores a loading active tab', async () => {
    const tab = makeTab(8, { status: 'loading', active: true });
    state.tabs = [tab];
    await chrome.tabs.onUpdated.trigger(8, { status: 'loading' }, tab);
    assert.deepEqual(state.discarded, []);
  });
});

describe('sweep', () => {
  it('catches a tab that finished loading before the worker noticed', async () => {
    const tab = makeTab(9, { status: 'complete' });
    state.tabs = [tab];
    const response = await sendMessage(chrome, { type: 'triggerStartupSweep' });
    assert.deepEqual(state.discarded, [9]);
    assert.ok(response.discarded >= 1, `expected a discard count, got ${JSON.stringify(response)}`);
  });

  it('protects the active tab of every window', async () => {
    state.tabs = [makeTab(10, { status: 'complete', active: true })];
    await sendMessage(chrome, { type: 'triggerStartupSweep' });
    assert.deepEqual(state.discarded, []);
  });

  it('protects a tab the user activated', async () => {
    const tab = makeTab(11, { status: 'complete' });
    state.tabs = [tab];
    await chrome.tabs.onActivated.trigger({ tabId: 11, windowId: 1 });
    await sendMessage(chrome, { type: 'triggerStartupSweep' });
    assert.deepEqual(state.discarded, []);
  });

  it('does nothing while the master switch is off', async () => {
    await setSetting('startupSuspendEnabled', false);
    state.tabs = [makeTab(12, { status: 'complete' })];
    await sendMessage(chrome, { type: 'triggerStartupSweep' });
    assert.deepEqual(state.discarded, []);
    await setSetting('startupSuspendEnabled', true);
  });

  it('respects the "include pinned tabs" option', async () => {
    await setSetting('startupIncludePinned', true);
    state.tabs = [makeTab(13, { status: 'complete', pinned: true })];
    await sendMessage(chrome, { type: 'triggerStartupSweep' });
    assert.deepEqual(state.discarded, [13]);
    await setSetting('startupIncludePinned', false);
  });
});

describe('settings integrity', () => {
  it('resets statistics without clobbering settings', async () => {
    const before = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      statistics: { totalSlept: 7, totalWoken: 3, lastReset: 1 }
    });

    const response = await sendMessage(chrome, { type: 'resetStatistics' });
    assert.equal(response.success, true);
    assert.equal(response.statistics.totalSlept, 0);

    const { settings, statistics } = await chrome.storage.local.get(null);
    assert.equal(statistics.totalWoken, 0);
    assert.deepEqual(settings, before.settings);
  });

  it('persists the startup settings', async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.startupSuspendEnabled = false;
    settings.startupIncludePinned = true;

    const response = await sendMessage(chrome, {
      type: 'updateSettings',
      payload: { settings }
    });
    assert.equal(response.success, true);

    const stored = await chrome.storage.local.get('settings');
    assert.equal(stored.settings.startupSuspendEnabled, false);
    assert.equal(stored.settings.startupIncludePinned, true);

    await setSetting('startupSuspendEnabled', true);
    await setSetting('startupIncludePinned', false);
  });

  it('drops unknown keys sent by a caller', async () => {
    await sendMessage(chrome, {
      type: 'updateSettings',
      payload: { settings: { showBadge: false, bogusKey: 'nope' } }
    });
    const { settings } = await chrome.storage.local.get('settings');
    assert.equal(settings.showBadge, false);
    assert.ok(!('bogusKey' in settings));
  });
});

describe('message routing', () => {
  it('reports unknown message types instead of throwing', async () => {
    const response = await sendMessage(chrome, { type: 'notARealMessage' });
    assert.equal(response.error, 'Unknown message type');
  });

  it('rejects malformed messages', async () => {
    assert.equal((await sendMessage(chrome, {})).error, 'Malformed message');
  });

  it('rejects a sender claiming to be a different extension', async () => {
    const response = await sendMessage(chrome, { type: 'getSettings' }, { id: 'someone-else' });
    assert.equal(response.error, 'Untrusted sender');
  });

  it('accepts our own content script as a sender', async () => {
    const response = await sendMessage(chrome, { type: 'getSettings' }, { id: chrome.runtime.id });
    assert.ok(response.settings);
  });
});
