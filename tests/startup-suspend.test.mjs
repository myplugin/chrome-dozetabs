// Unit tests for the startup-suspend (启动抢先丢弃) feature. Mocks the
// chrome.* extension APIs and drives the service worker's event listeners /
// message handlers directly, so the core logic is validated without a real
// browser.
//
// Run: node tests/startup-suspend.test.mjs

import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// chrome API mock
// ---------------------------------------------------------------------------
const state = {
  tabs: [],                 // mock tab objects (chrome.tabs.query result)
  discarded: [],            // tabIds passed to chrome.tabs.discard
  reloaded: [],             // tabIds passed to chrome.tabs.reload
  local: {},                // chrome.storage.local contents
  session: {},              // chrome.storage.session contents
  windows: { lastFocusedId: 1 },
};

function makeEvent() {
  const fns = [];
  return {
    addListener(fn) { fns.push(fn); },
    trigger(...args) { return Promise.all(fns.map(fn => fn(...args))); },
  };
}

const chrome = {
  tabs: {
    onCreated: makeEvent(),
    onUpdated: makeEvent(),
    onActivated: makeEvent(),
    onRemoved: makeEvent(),
    query: (queryInfo, callback) => {
      const result = state.tabs.slice();
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    get: (id, callback) => {
      const tab = state.tabs.find(t => t.id === id);
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },
    discard: (tabId, callback) => {
      state.discarded.push(tabId);
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) { tab.discarded = true; tab.status = 'unloaded'; }
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },
    reload: (tabId, callback) => {
      state.reloaded.push(tabId);
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) { tab.status = 'loading'; tab.discarded = false; }
      if (callback) callback();
      return Promise.resolve();
    },
    update: async (id, props) => {
      const tab = state.tabs.find(t => t.id === id);
      if (tab) Object.assign(tab, props);
      return tab;
    },
  },
  storage: {
    local: {
      get: (keys, callback) => {
        const result = {};
        if (keys === null || keys === undefined) {
          Object.assign(result, state.local);
        } else if (Array.isArray(keys)) {
          for (const k of keys) if (k in state.local) result[k] = state.local[k];
        } else if (typeof keys === 'string') {
          if (keys in state.local) result[keys] = state.local[keys];
        } else {
          for (const k of Object.keys(keys)) if (k in state.local) result[k] = state.local[k];
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: async (obj, callback) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: state.local[k], newValue: v };
        }
        Object.assign(state.local, obj);
        if (callback) callback();
        // Real Chrome fires onChanged; the SW listens to invalidate caches.
        await chrome.storage.onChanged.trigger(changes, 'local');
        return Promise.resolve();
      },
      remove: (keys, callback) => {
        if (typeof keys === 'string') delete state.local[keys];
        else for (const k of keys) delete state.local[k];
        if (callback) callback();
        return Promise.resolve();
      },
      onChanged: makeEvent(),
    },
    session: {
      // sessionGet() does `result[key]`, so return a keyed object.
      get: async (key) => {
        if (key === null || key === undefined) return { ...state.session };
        return { [key]: state.session[key] };
      },
      set: async (obj) => { Object.assign(state.session, obj); },
      remove: async (key) => { delete state.session[key]; },
    },
    onChanged: makeEvent(),
  },
  runtime: {
    onStartup: makeEvent(),
    onInstalled: makeEvent(),
    onMessage: makeEvent(),
    lastError: null,
    id: 'test-extension-id',
    getManifest: () => ({ name: 'Tab Sleep Tool' }),
  },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: makeEvent() },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  contextMenus: { removeAll: async () => {}, create: () => {}, onClicked: makeEvent() },
  commands: { onCommand: makeEvent() },
  windows: {
    getLastFocused: async () => ({ id: state.windows.lastFocusedId }),
    getCurrent: async () => ({ id: state.windows.lastFocusedId }),
  },
  i18n: { getMessage: (key) => key },
};

globalThis.chrome = chrome;

// The service worker logs every message/response at info level; that floods
// the test output once wake-all starts polling. Keep warnings/errors visible.
const _log = console.log;
console.log = (...args) => {
  const line = args.map(a => (typeof a === 'string' ? a : '')).join('');
  if (line.startsWith('[Tab Sleep] Received message') ||
      line.startsWith('[Tab Sleep] Processing message') ||
      line.startsWith('[Tab Sleep] Sending response')) {
    return;
  }
  _log(...args);
};

// ---------------------------------------------------------------------------
// Import the service worker (runs its top-level code against the mock).
// ---------------------------------------------------------------------------
await import('../src/background/service-worker.js');
// Let the top-level initStartupSuspend settle.
await new Promise(r => setTimeout(r, 100));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTab(id, overrides = {}) {
  return {
    id,
    status: 'complete',
    active: false,
    pinned: false,
    autoDiscardable: true,
    audible: false,
    discarded: false,
    url: `http://example.com/page${id}`,
    title: `Page ${id}`,
    windowId: 1,
    index: id - 1,
    ...overrides,
  };
}

// Triggering onStartup opens the startup window (sets the module-level
// windowEnd via openStartupWindowNow).
async function openWindow() {
  await chrome.runtime.onStartup.trigger();
}

async function sendMessage(message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sendMessage timeout')), timeoutMs);
    const sendResponse = (result) => { clearTimeout(timer); resolve(result); };
    chrome.runtime.onMessage.trigger(message, {}, sendResponse);
  });
}

async function waitFor(condition, timeout = 5000, poll = 10) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, poll));
  }
  throw new Error('waitFor timeout');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
async function test(name, fn) {
  // Reset per-test state (keep the window open between tests).
  state.tabs = [];
  state.discarded = [];
  state.reloaded = [];
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error('      ' + (e && e.message ? e.message : e));
    failed++;
  }
}

console.log('Startup suspend unit tests\n');

// --- onCreated: the preemptive race ---------------------------------------

await test('onCreated discards an unloaded, non-active, autoDiscardable tab', async () => {
  await openWindow();
  const tab = makeTab(1, { status: 'unloaded' });
  state.tabs = [tab];
  await chrome.tabs.onCreated.trigger(tab);
  assert.ok(state.discarded.includes(1), `expected discard(1), got [${state.discarded}]`);
});

await test('onCreated ignores an active tab (ordinary new tab)', async () => {
  const tab = makeTab(2, { status: 'unloaded', active: true });
  state.tabs = [tab];
  await chrome.tabs.onCreated.trigger(tab);
  assert.ok(!state.discarded.includes(2), `active tab must not be discarded, got [${state.discarded}]`);
});

await test('onCreated ignores a pinned tab (default)', async () => {
  const tab = makeTab(3, { status: 'unloaded', pinned: true });
  state.tabs = [tab];
  await chrome.tabs.onCreated.trigger(tab);
  assert.ok(!state.discarded.includes(3), `pinned tab must not be discarded, got [${state.discarded}]`);
});

await test('onCreated ignores a tab with autoDiscardable=false', async () => {
  const tab = makeTab(4, { status: 'unloaded', autoDiscardable: false });
  state.tabs = [tab];
  await chrome.tabs.onCreated.trigger(tab);
  assert.ok(!state.discarded.includes(4), `non-discardable tab must be skipped, got [${state.discarded}]`);
});

await test('onCreated ignores a whitelisted domain', async () => {
  await chrome.storage.local.set({ whitelist: ['example.com'] });
  const tab = makeTab(5, { status: 'unloaded' });
  state.tabs = [tab];
  await chrome.tabs.onCreated.trigger(tab);
  assert.ok(!state.discarded.includes(5), `whitelisted tab must be skipped, got [${state.discarded}]`);
  await chrome.storage.local.set({ whitelist: [] });
});

// --- onUpdated: the fallback window ---------------------------------------

await test('onUpdated discards a loading, non-active tab', async () => {
  const tab = makeTab(6, { status: 'loading' });
  state.tabs = [tab];
  await chrome.tabs.onUpdated.trigger(6, { status: 'loading' }, tab);
  assert.ok(state.discarded.includes(6), `expected discard(6), got [${state.discarded}]`);
});

await test('onUpdated ignores a loading active tab', async () => {
  const tab = makeTab(7, { status: 'loading', active: true });
  state.tabs = [tab];
  await chrome.tabs.onUpdated.trigger(7, { status: 'loading' }, tab);
  assert.ok(!state.discarded.includes(7), `active tab must not be discarded, got [${state.discarded}]`);
});

// --- sweep: catches tabs that finished loading before the SW saw them ------

await test('sweep discards a complete, non-active tab (fast restore)', async () => {
  const tab = makeTab(8, { status: 'complete' });
  state.tabs = [tab];
  const res = await sendMessage({ type: 'triggerStartupSweep' });
  assert.ok(state.discarded.includes(8), `expected discard(8), got [${state.discarded}]`);
  assert.ok(res.discarded >= 1, `expected sweep to report >=1 discarded, got ${res}`);
});

await test('sweep protects the active tab', async () => {
  const tab = makeTab(9, { status: 'complete', active: true });
  state.tabs = [tab];
  await sendMessage({ type: 'triggerStartupSweep' });
  assert.ok(!state.discarded.includes(9), `active tab must be protected, got [${state.discarded}]`);
});

await test('sweep protects a tab the user activated', async () => {
  const tab = makeTab(10, { status: 'complete' });
  state.tabs = [tab];
  await chrome.tabs.onActivated.trigger({ tabId: 10, windowId: 1 });
  await sendMessage({ type: 'triggerStartupSweep' });
  assert.ok(!state.discarded.includes(10), `user-activated tab must be protected, got [${state.discarded}]`);
});

await test('sweep skips when the feature is disabled', async () => {
  const { settings } = await chrome.storage.local.get('settings');
  settings.startupSuspendEnabled = false;
  await chrome.storage.local.set({ settings });
  const tab = makeTab(11, { status: 'complete' });
  state.tabs = [tab];
  await sendMessage({ type: 'triggerStartupSweep' });
  assert.ok(!state.discarded.includes(11), `disabled feature must not discard, got [${state.discarded}]`);
  settings.startupSuspendEnabled = true;
  await chrome.storage.local.set({ settings });
});

// --- settings & statistics integrity --------------------------------------

await test('RESET_STATISTICS zeroes stats WITHOUT clobbering settings', async () => {
  // Regression: the options page used to send UPDATE_SETTINGS with a
  // statistics-only object, which overwrote the whole settings object.
  const before = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ statistics: { totalSlept: 7, totalWoken: 3, lastReset: 1 } });
  const res = await sendMessage({ type: 'resetStatistics' });
  assert.ok(res.success, `reset failed: ${JSON.stringify(res)}`);
  const { settings, statistics } = await chrome.storage.local.get(null);
  assert.equal(statistics.totalSlept, 0, 'statistics should be reset');
  assert.equal(statistics.totalWoken, 0, 'statistics should be reset');
  assert.deepEqual(settings, before.settings, 'settings must survive a statistics reset');
});

await test('UPDATE_SETTINGS still persists the startup settings', async () => {
  const { settings } = await chrome.storage.local.get('settings');
  settings.startupSuspendEnabled = false;
  settings.startupIncludePinned = true;
  await chrome.storage.local.set({ settings });
  const res = await sendMessage({
    type: 'updateSettings',
    payload: { settings }
  });
  assert.ok(res.success, `update failed: ${JSON.stringify(res)}`);
  const stored = await chrome.storage.local.get('settings');
  assert.equal(stored.settings.startupSuspendEnabled, false, 'master switch must persist');
  assert.equal(stored.settings.startupIncludePinned, true, 'pinned option must persist');
  // restore for later tests
  settings.startupSuspendEnabled = true;
  settings.startupIncludePinned = false;
  await chrome.storage.local.set({ settings });
});

// --- summary ----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
