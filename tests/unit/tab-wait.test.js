import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock, makeTab } from '../helpers/chrome-mock.js';
import { isTabSleeping } from '../../src/utils/tab-manager.js';
import { countSleepingTabs, waitForTab, waitForTabs } from '../../src/utils/tab-wait.js';

const { chrome, state } = createChromeMock();
globalThis.chrome = chrome;

beforeEach(() => {
  state.tabs = [];
  state.local = {};
});

/** Fast, deterministic timings for tests. */
const FAST = { timeoutMs: 400, intervalMs: 5 };

describe('waitForTab', () => {
  it('returns immediately when the tab already satisfies the predicate', async () => {
    state.tabs = [makeTab(1, { discarded: true, status: 'unloaded' })];

    const started = Date.now();
    const satisfied = await waitForTab(1, isTabSleeping, FAST);

    assert.equal(satisfied, true);
    assert.ok(Date.now() - started < 50, 'must not burn the poll interval when it already holds');
  });

  it('polls until the tab reaches the expected state', async () => {
    const tab = makeTab(1);
    state.tabs = [tab];

    // The discard lands shortly after the popup asks about it.
    setTimeout(() => {
      tab.discarded = true;
      tab.status = 'unloaded';
    }, 30);

    const satisfied = await waitForTab(1, isTabSleeping, FAST);
    assert.equal(satisfied, true);
  });

  it('gives up after the timeout instead of hanging', async () => {
    state.tabs = [makeTab(1)];

    const started = Date.now();
    const satisfied = await waitForTab(1, isTabSleeping, { timeoutMs: 60, intervalMs: 5 });
    const elapsed = Date.now() - started;

    assert.equal(satisfied, false);
    assert.ok(elapsed >= 55, `gave up too early after ${elapsed}ms`);
    assert.ok(elapsed < 400, `kept polling too long: ${elapsed}ms`);
  });

  it('returns false when the tab is gone', async () => {
    state.tabs = [];
    const satisfied = await waitForTab(999, isTabSleeping, FAST);
    assert.equal(satisfied, false);
  });

  it('returns false when the tab disappears while waiting', async () => {
    const tab = makeTab(1);
    state.tabs = [tab];
    setTimeout(() => {
      state.tabs = [];
    }, 25);

    const satisfied = await waitForTab(1, () => false, FAST);
    assert.equal(satisfied, false);
  });
});

describe('waitForTabs', () => {
  it('waits until the window satisfies the predicate', async () => {
    state.tabs = [makeTab(1), makeTab(2)];

    setTimeout(() => {
      state.tabs[1].discarded = true;
      state.tabs[1].status = 'unloaded';
    }, 30);

    const satisfied = await waitForTabs((tabs) => countSleepingTabs(tabs) >= 1, FAST);
    assert.equal(satisfied, true);
  });

  it('reports a timeout rather than throwing', async () => {
    state.tabs = [makeTab(1)];
    const satisfied = await waitForTabs((tabs) => countSleepingTabs(tabs) >= 5, {
      timeoutMs: 60,
      intervalMs: 5
    });
    assert.equal(satisfied, false);
  });
});

describe('countSleepingTabs', () => {
  it('counts discarded and never-loaded tabs', () => {
    const tabs = [
      makeTab(1),
      makeTab(2, { discarded: true }),
      makeTab(3, { status: 'unloaded' }),
      makeTab(4, { status: 'loading' })
    ];
    assert.equal(countSleepingTabs(tabs), 2);
  });

  it('returns zero for an empty window', () => {
    assert.equal(countSleepingTabs([]), 0);
  });
});
