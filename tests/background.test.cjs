const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('native menus register four labels scoped to Keep and route to clicked frame', async () => {
  let install, click;
  const menus = [], messages = [];
  vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), { chrome: {
    runtime: { onInstalled: { addListener: f => install = f } },
    contextMenus: { removeAll: f => f(), create: item => menus.push(item), onClicked: { addListener: f => click = f } },
    tabs: { sendMessage: async (...args) => messages.push(args) }
  } });
  install();
  assert.deepEqual(menus.map(m => m.title), ['添加删除线', '删除删除线', '一键高亮', '一键取消高亮']);
  assert.ok(menus.every(m => m.contexts[0] === 'selection' && m.documentUrlPatterns[0] === 'https://keep.google.com/*'));
  click({ menuItemId: 'keep-highlight-remove', frameId: 2 }, { id: 7 });
  assert.equal(messages[0][0], 7);
  assert.equal(messages[0][1].kind, 'highlight');
  assert.equal(messages[0][1].action, 'remove');
  assert.equal(messages[0][2].frameId, 2);
  click({ menuItemId: 'unknown' }, { id: 7 });
  assert.equal(messages.length, 1);
});
