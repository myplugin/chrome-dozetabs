import { addToWhitelist, removeFromWhitelist } from '../utils/whitelist.js';
import { sleepAllOtherTabs } from './batch.js';
import { sleepTab } from './sleep.js';

/**
 * Right-click menu. The same four actions are reachable from every page.
 */

const MENU_ID = {
  SLEEP_CURRENT: 'sleep-current-tab',
  SLEEP_OTHERS: 'sleep-other-tabs',
  SEPARATOR: 'separator-1',
  ADD_WHITELIST: 'add-to-whitelist',
  REMOVE_WHITELIST: 'remove-from-whitelist'
};

/** (Re)create the context menus. Safe to call repeatedly. */
export async function createContextMenus() {
  await chrome.contextMenus.removeAll();

  const items = [
    { id: MENU_ID.SLEEP_CURRENT, titleKey: 'contextMenuSleep' },
    { id: MENU_ID.SLEEP_OTHERS, titleKey: 'contextMenuSleepOthers' },
    { id: MENU_ID.SEPARATOR, type: 'separator' },
    { id: MENU_ID.ADD_WHITELIST, titleKey: 'contextMenuAddToWhitelist' },
    { id: MENU_ID.REMOVE_WHITELIST, titleKey: 'contextMenuRemoveFromWhitelist' }
  ];

  for (const item of items) {
    chrome.contextMenus.create({
      id: item.id,
      ...(item.type ? { type: item.type } : { title: chrome.i18n.getMessage(item.titleKey) }),
      contexts: ['page', 'action']
    });
  }
}

/**
 * @param {chrome.contextMenus.OnClickData} info
 * @param {chrome.tabs.Tab} [tab]
 * @returns {Promise<void>}
 */
export async function handleContextMenuClick(info, tab) {
  if (!tab) return;

  switch (info.menuItemId) {
    case MENU_ID.SLEEP_CURRENT:
      await sleepTab(tab.id);
      break;
    case MENU_ID.SLEEP_OTHERS:
      await sleepAllOtherTabs(tab.id);
      break;
    case MENU_ID.ADD_WHITELIST:
      await addToWhitelist(tab.url || '');
      break;
    case MENU_ID.REMOVE_WHITELIST:
      await removeFromWhitelist(tab.url || '');
      break;
    default:
      break;
  }
}
