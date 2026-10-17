'use strict';
const actions = {
  'keep-strike-add': { title: '添加删除线', kind: 'strike', action: 'add' },
  'keep-strike-remove': { title: '删除删除线', kind: 'strike', action: 'remove' },
  'keep-highlight-add': { title: '一键高亮', kind: 'highlight', action: 'add' },
  'keep-highlight-remove': { title: '一键取消高亮', kind: 'highlight', action: 'remove' }
};
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, item] of Object.entries(actions)) {
      chrome.contextMenus.create({ id, title: item.title, contexts: ['selection'],
        documentUrlPatterns: ['https://keep.google.com/*'] });
    }
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const item = actions[info.menuItemId];
  if (!item || !Number.isInteger(tab?.id)) return;
  chrome.tabs.sendMessage(tab.id, { type: 'keep-edit-mark', kind: item.kind, action: item.action },
    { frameId: info.frameId ?? 0 }).catch(() => {
    // A closed/reloaded tab or a tab awaiting extension reload has no receiver.
  });
});
