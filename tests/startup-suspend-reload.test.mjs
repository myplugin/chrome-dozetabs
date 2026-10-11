import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createChromeMock, makeTab, sendMessage, settle } from './helpers/chrome-mock.js';

/**
 * Reloading or updating the extension must never look like a browser restart.
 *
 * This lives in its own file on purpose: the startup window is opened once per
 * service-worker process, so the invariant can only be observed in a process
 * where `chrome.runtime.onStartup` never fired.
 */

const { chrome, state } = createChromeMock();
globalThis.chrome = chrome;

await import('../src/background/service-worker.js');
await settle(50);

describe('extension reload / update', () => {
  it('does not open the startup window', async () => {
    await chrome.runtime.onInstalled.trigger();
    assert.equal(state.session.startupWindowEnd, undefined);
  });

  it('never discards background tabs', async () => {
    state.tabs = [
      makeTab(1, { status: 'complete' }),
      makeTab(2, { status: 'complete' }),
      makeTab(3, { status: 'unloaded' })
    ];

    await chrome.runtime.onInstalled.trigger();
    await sendMessage(chrome, { type: 'triggerStartupSweep' });
    await chrome.tabs.onCreated.trigger(state.tabs[2]);

    assert.deepEqual(state.discarded, [], 'no tab may be discarded outside the startup window');
  });

  it('still initialises storage and the context menus', async () => {
    assert.ok(state.local.settings, 'settings should be seeded on install');
    assert.ok(state.contextMenus.length > 0, 'context menus should be created');
  });
});
