/**
 * A faithful in-memory mock of the `chrome.*` APIs used by this extension.
 *
 * Shared by every test that needs to boot the service worker. Design notes:
 *
 *   - `chrome.storage` **deep-clones** on read and write, exactly like the real
 *     API. Returning live references makes assertions such as
 *     `deepEqual(settings, beforeSettings)` pass vacuously.
 *   - `tabs.query()` honours `active`, `windowId` and `currentWindow`, so a
 *     bug in query construction is actually observable.
 *   - Storage writes fire `chrome.storage.onChanged`, which the service worker
 *     relies on to invalidate its caches.
 *   - `chrome.scripting.executeScript` is a stub: it cannot evaluate a page
 *     function without a DOM. Page-context code is covered by the smoke test.
 *
 * Usage:
 *   const { chrome, state } = createChromeMock();
 *   globalThis.chrome = chrome;
 *   await import('../src/background/service-worker.js');
 */

/** Create an event object with addListener/removeListener/trigger. */
export function createEvent() {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const index = listeners.indexOf(fn);
      if (index !== -1) listeners.splice(index, 1);
    },
    hasListener(fn) {
      return listeners.includes(fn);
    },
    async trigger(...args) {
      await Promise.all(listeners.map((fn) => fn(...args)));
    }
  };
}

/**
 * @param {Object} [options]
 * @param {Array} [options.tabs] - initial tabs
 * @param {string} [options.locale] - value returned by i18n.getMessage
 */
export function createChromeMock(options = {}) {
  let nextTabId = 1000;

  const state = {
    tabs: options.tabs ? structuredClone(options.tabs) : [],
    discarded: [],
    reloaded: [],
    created: [],
    injected: [],
    local: {},
    session: {},
    badgeText: '',
    badgeColor: '',
    alarms: {},
    contextMenus: [],
    focusedWindowId: 1
  };

  const onChanged = createEvent();

  const local = {
    get(keys, callback) {
      const result = {};
      if (keys === null || keys === undefined) {
        Object.assign(result, structuredClone(state.local));
      } else if (Array.isArray(keys)) {
        for (const key of keys)
          if (key in state.local) result[key] = structuredClone(state.local[key]);
      } else if (typeof keys === 'string') {
        if (keys in state.local) result[keys] = structuredClone(state.local[keys]);
      } else {
        for (const key of Object.keys(keys)) {
          if (key in state.local) result[key] = structuredClone(state.local[key]);
        }
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    async set(entries, callback) {
      const changes = {};
      for (const [key, value] of Object.entries(entries)) {
        changes[key] = {
          oldValue: structuredClone(state.local[key]),
          newValue: structuredClone(value)
        };
      }
      Object.assign(state.local, structuredClone(entries));
      if (callback) callback();
      // Yield so concurrent read-modify-write sequences can interleave — this is
      // what makes "lost update" bugs reproducible in a test.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await onChanged.trigger(changes, 'local');
    },
    async remove(keys, callback) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const key of list) {
        if (!(key in state.local)) continue;
        changes[key] = { oldValue: structuredClone(state.local[key]) };
        delete state.local[key];
      }
      if (callback) callback();
      await Promise.resolve();
      if (Object.keys(changes).length > 0) await onChanged.trigger(changes, 'local');
    }
  };

  const session = {
    // Mirrors chrome.storage.session.get(key) -> { [key]: value }
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(state.session);
      const list = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of list)
        if (key in state.session) result[key] = structuredClone(state.session[key]);
      return result;
    },
    async set(entries) {
      Object.assign(state.session, structuredClone(entries));
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete state.session[key];
    }
  };

  const tabs = {
    onCreated: createEvent(),
    onUpdated: createEvent(),
    onActivated: createEvent(),
    onRemoved: createEvent(),
    onMoved: createEvent(),

    query(queryInfo, callback) {
      let result = state.tabs.slice();
      const info = queryInfo || {};
      if (info.active !== undefined) result = result.filter((tab) => !!tab.active === info.active);
      if (info.pinned !== undefined) result = result.filter((tab) => !!tab.pinned === info.pinned);
      if (info.discarded !== undefined)
        result = result.filter((tab) => !!tab.discarded === info.discarded);
      if (info.windowId !== undefined)
        result = result.filter((tab) => tab.windowId === info.windowId);
      if (info.currentWindow || info.lastFocusedWindow) {
        result = result.filter((tab) => tab.windowId === state.focusedWindowId);
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    },

    get(tabId, callback) {
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },

    discard(tabId, callback) {
      state.discarded.push(tabId);
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (tab) {
        tab.discarded = true;
        tab.status = 'unloaded';
      }
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },

    reload(tabId, callback) {
      state.reloaded.push(tabId);
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (tab) {
        tab.status = 'loading';
        tab.discarded = false;
      }
      if (callback) callback();
      return Promise.resolve();
    },

    update(tabId, props, callback) {
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (tab) Object.assign(tab, props);
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },

    async create(props = {}) {
      const tab = makeTab(nextTabId++, {
        windowId: props.windowId ?? state.focusedWindowId,
        url: props.url || 'about:blank',
        active: props.active !== false,
        status: 'complete',
        index: state.tabs.length
      });
      state.tabs.push(tab);
      state.created.push(tab);
      return tab;
    },

    async remove(tabIds) {
      const list = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const tabId of list) {
        state.tabs = state.tabs.filter((tab) => tab.id !== tabId);
        await tabs.onRemoved.trigger(tabId, { windowId: 1, isWindowClosing: false });
      }
    }
  };

  const chrome = {
    tabs,
    storage: { local, session, onChanged },
    runtime: {
      onStartup: createEvent(),
      onInstalled: createEvent(),
      onMessage: createEvent(),
      onSuspend: createEvent(),
      lastError: null,
      id: 'test-extension-id',
      getManifest: () => ({ version: '1.0.0', name: 'Tab Sleep' }),
      getURL: (resourcePath) =>
        `chrome-extension://test-extension-id${resourcePath.startsWith('/') ? '' : '/'}${resourcePath}`
    },
    alarms: {
      create: async (name, info) => {
        state.alarms[name] = info;
      },
      clear: async (name) => {
        const existed = name in state.alarms;
        delete state.alarms[name];
        return existed;
      },
      onAlarm: createEvent()
    },
    action: {
      setBadgeText: async ({ text }) => {
        state.badgeText = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        state.badgeColor = color;
      }
    },
    contextMenus: {
      removeAll: async () => {
        state.contextMenus = [];
      },
      create: (item) => {
        state.contextMenus.push(item);
        return item.id;
      },
      onClicked: createEvent()
    },
    commands: { onCommand: createEvent() },
    scripting: {
      // Cannot evaluate page functions without a DOM. Calls are still recorded
      // so tests can assert *what* was injected, into which tab, and with which
      // arguments.
      executeScript: async (options) => {
        state.injected.push(options);
        return [{ result: undefined }];
      }
    },
    i18n: {
      getMessage: (key) => options.locale ?? key
    },
    windows: {
      getLastFocused: async () => ({ id: state.focusedWindowId }),
      getCurrent: async () => ({ id: state.focusedWindowId })
    }
  };

  return { chrome, state, events: { onChanged } };
}

/**
 * Build a tab object with sensible defaults.
 * @param {number} id
 * @param {Object} [overrides]
 */
export function makeTab(id, overrides = {}) {
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
    ...overrides
  };
}

/**
 * Send a message through the mocked runtime channel and await the response.
 * @param {Object} chrome
 * @param {Object} message
 * @param {Object} [sender]
 */
export function sendMessage(chrome, message, sender = {}) {
  return new Promise((resolve) => {
    chrome.runtime.onMessage.trigger(message, sender, resolve);
  });
}

/** Wait for pending microtasks/timers to settle. */
export function settle(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
