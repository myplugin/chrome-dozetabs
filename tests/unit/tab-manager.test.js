import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock, makeTab } from '../helpers/chrome-mock.js';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../src/utils/constants.js';
import {
  SLEEP_BLOCK_REASON,
  canSleepTab,
  getActiveTabCount,
  isTabSleeping,
  loadSleepContext
} from '../../src/utils/tab-manager.js';

const { chrome, state } = createChromeMock();
globalThis.chrome = chrome;

beforeEach(() => {
  state.local = {
    [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS },
    [STORAGE_KEYS.WHITELIST]: ['blocked.example'],
    [STORAGE_KEYS.LOCKED_TABS]: []
  };
  state.tabs = [];
});

describe('isTabSleeping', () => {
  it('detects discarded and never-loaded tabs', () => {
    assert.equal(isTabSleeping(makeTab(1, { discarded: true })), true);
    assert.equal(isTabSleeping(makeTab(2, { status: 'unloaded' })), true);
    assert.equal(isTabSleeping(makeTab(3)), false);
  });
});

describe('canSleepTab', () => {
  it('allows an ordinary background tab', async () => {
    const result = await canSleepTab(makeTab(1));
    assert.deepEqual(result, { canSleep: true, reason: '' });
  });

  it('refuses a tab that is already sleeping', async () => {
    const result = await canSleepTab(makeTab(1, { discarded: true }));
    assert.equal(result.reason, SLEEP_BLOCK_REASON.ALREADY_SLEEPING);
  });

  it('refuses a locked tab', async () => {
    state.local[STORAGE_KEYS.LOCKED_TABS] = [1];
    const result = await canSleepTab(makeTab(1));
    assert.equal(result.reason, SLEEP_BLOCK_REASON.LOCKED);
  });

  it('refuses blank, new-tab and internal pages', async () => {
    assert.equal(
      (await canSleepTab(makeTab(1, { url: 'about:blank' }))).reason,
      SLEEP_BLOCK_REASON.EMPTY
    );
    assert.equal(
      (await canSleepTab(makeTab(2, { url: 'chrome://settings' }))).reason,
      SLEEP_BLOCK_REASON.EMPTY
    );
  });

  it('refuses pinned tabs while the setting is on', async () => {
    const result = await canSleepTab(makeTab(1, { pinned: true }));
    assert.equal(result.reason, SLEEP_BLOCK_REASON.PINNED);
  });

  it('allows pinned tabs once the setting is off', async () => {
    state.local[STORAGE_KEYS.SETTINGS] = { ...DEFAULT_SETTINGS, excludePinnedTabs: false };
    assert.equal((await canSleepTab(makeTab(1, { pinned: true }))).canSleep, true);
  });

  it('refuses audible tabs while the setting is on', async () => {
    const result = await canSleepTab(makeTab(1, { audible: true }));
    assert.equal(result.reason, SLEEP_BLOCK_REASON.AUDIBLE);
  });

  it('allows audible tabs once the setting is off', async () => {
    state.local[STORAGE_KEYS.SETTINGS] = { ...DEFAULT_SETTINGS, excludeAudibleTabs: false };
    assert.equal((await canSleepTab(makeTab(1, { audible: true }))).canSleep, true);
  });

  it('refuses whitelisted domains, including subdomains', async () => {
    assert.equal(
      (await canSleepTab(makeTab(1, { url: 'https://blocked.example/x' }))).reason,
      SLEEP_BLOCK_REASON.WHITELISTED
    );
    assert.equal(
      (await canSleepTab(makeTab(2, { url: 'https://sub.blocked.example/x' }))).reason,
      SLEEP_BLOCK_REASON.WHITELISTED
    );
  });

  it('trusts a supplied context instead of re-reading storage', async () => {
    // Perf contract: a batch must not hit storage once per tab. A context with
    // an empty whitelist must therefore win over the stored whitelist.
    const context = {
      settings: { ...DEFAULT_SETTINGS },
      whitelist: [],
      lockedTabs: new Set()
    };
    const result = await canSleepTab(makeTab(1, { url: 'https://blocked.example/x' }), context);
    assert.equal(result.canSleep, true);
  });
});

describe('loadSleepContext', () => {
  it('loads settings, whitelist and locks in one shot', async () => {
    state.local[STORAGE_KEYS.LOCKED_TABS] = [5];
    const context = await loadSleepContext();
    assert.equal(context.settings.excludePinnedTabs, DEFAULT_SETTINGS.excludePinnedTabs);
    assert.deepEqual(context.whitelist, ['blocked.example']);
    assert.equal(context.lockedTabs.has(5), true);
  });
});

describe('window queries', () => {
  it('counts loaded, non-blank tabs of the current window only', async () => {
    state.tabs = [
      makeTab(1),
      makeTab(2, { discarded: true }),
      makeTab(3, { url: 'about:blank' }),
      makeTab(4, { windowId: 2 })
    ];
    assert.equal(await getActiveTabCount(), 1);
  });
});
