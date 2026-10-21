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
  chrome.tabs.sendMessage(tab.id, { type: 'keep-edit-mark', kind: item.kind, action: item.action,
    selectionText: info.selectionText },
    { frameId: info.frameId ?? 0 }).then(result => {
    chrome.action.setBadgeText({ tabId: tab.id, text: result?.ok ? '' : '!' }).catch(() => {});
    chrome.action.setTitle({ tabId: tab.id, title: result?.ok ? 'Keep 标记删除线'
      : result?.reason || '未收到编辑结果，请刷新 Keep 页面后重试。' }).catch(() => {});
  }).catch(() => {
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
    chrome.action.setTitle({ tabId: tab.id,
      title: '扩展尚未连接当前页面，请刷新 Keep 页面后重试。' }).catch(() => {});
  });
});
