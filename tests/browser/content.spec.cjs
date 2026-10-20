const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const base = path.resolve(__dirname, '../..');
const count = page => page.evaluate(() => CSS.highlights.get('keep-mark-strike-original')?.size || 0);

test.beforeEach(async ({ page }) => {
  // A deterministic Keep-shaped fixture, deliberately not a claim about live Keep.
  await page.setContent(readFileSync(path.join(base, 'tests/fixture.html'), 'utf8'));
  await page.evaluate(() => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const shadow = attachShadow.call(this, options);
      if (this.id === 'keep-mark-strike-layer') window.paintRoot = shadow;
      return shadow;
    };
    window.storageListeners = [];
    window.menuListeners = [];
    window.chrome = { runtime: { onMessage: { addListener: f => menuListeners.push(f), removeListener: f => { window.menuListeners = menuListeners.filter(x => x !== f); } } }, storage: {
      local: { get: async () => ({ enabled: true }) },
      onChanged: { addListener: listener => window.storageListeners.push(listener) }
    } };
    window.original = document.getElementById('notes').innerHTML;
    window.mutations = 0; window.inputEvents = 0;
    new MutationObserver(changes => window.mutations += changes.length)
      .observe(document.getElementById('notes'), { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener('input', () => window.inputEvents++);
  });
  await page.addStyleTag({ path: path.join(base, 'extension/content.css') });
  await page.addScriptTag({ path: path.join(base, 'extension/parser.js') });
  await page.addScriptTag({ path: path.join(base, 'extension/content.js') });
  await expect.poll(() => count(page)).toBe(2);
});

test('paint layer leaves original DOM and save/input events untouched', async ({ page }) => {
  await expect(page.locator('#plain')).toContainText('~~买面包~~');
  expect(await page.evaluate(() => ({ same: original === document.getElementById('notes').innerHTML, mutations, inputEvents })))
    .toEqual({ same: true, mutations: 0, inputEvents: 0 });
  await page.screenshot({ path: 'test-results/reading.png' });
});

test('focus, IME and blur preserve raw editable content', async ({ page }) => {
  await page.locator('#plain').focus();
  await expect.poll(() => count(page)).toBe(7);
  await page.locator('#plain').dispatchEvent('compositionstart');
  await expect.poll(() => count(page)).toBe(1);
  await page.locator('#plain').dispatchEvent('compositionend');
  await page.locator('#plain').fill('中文 ~~编辑后~~');
  await page.locator('#outside').click();
  await expect.poll(() => count(page)).toBe(2);
  await expect(page.locator('#plain')).toHaveText('中文 ~~编辑后~~');
});

test('selection retains markers and suppresses mirrors', async ({ page }) => {
  const selected = await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.getElementById('plain'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
    return getSelection().toString();
  });
  expect(selected).toContain('~~买面包~~');
  await expect.poll(() => count(page)).toBe(1);
  await page.evaluate(() => getSelection().removeAllRanges());
  // With no selection, every marked span can be decorated.
  await expect.poll(() => count(page)).toBe(9);
  await page.locator('#outside').click();
  await expect.poll(() => count(page)).toBe(2);
});

test('dynamic note replacement, removal and repeated updates do not loop', async ({ page }) => {
  await page.evaluate(() => {
    const note = document.createElement('div'); note.id = 'new'; note.className = 'IZ65Hb-vIzZGf-bVEB4e-qJTHM';
    note.textContent = '~~新笔记~~'; document.getElementById('notes').append(note);
  });
  await expect.poll(() => count(page)).toBe(3);
  await page.evaluate(() => { document.getElementById('new').textContent = '~~同步更新~~'; });
  await expect.poll(() => count(page)).toBe(3);
  await page.evaluate(() => document.getElementById('new').remove());
  await expect.poll(() => count(page)).toBe(2);
  const before = await page.evaluate(() => mutations);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => mutations)).toBe(before);
});

test('settings switch restores originals immediately', async ({ page }) => {
  await page.evaluate(() => storageListeners.forEach(f => f({ enabled: { newValue: false } }, 'local')));
  await expect.poll(() => count(page)).toBe(0);
  await page.evaluate(() => storageListeners.forEach(f => f({ enabled: { newValue: true } }, 'local')));
  await expect.poll(() => count(page)).toBe(2);
});

test('transformed and checklist content safely fall back', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('lines').setAttribute('role', 'checkbox');
    document.getElementById('plain').style.transform = 'rotate(5deg)';
  });
  await expect.poll(() => count(page)).toBe(0);
});

test('opening a dialog suppresses background mirrors', async ({ page }) => {
  await page.evaluate(() => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.cssText = 'position:fixed;inset:80px;background:white;z-index:100';
    dialog.innerHTML = '<div class="IZ65Hb-vIzZGf-bVEB4e-qJTHM">~~弹窗正文~~</div>';
    document.body.append(dialog);
  });
  await expect.poll(() => count(page)).toBe(1);
  await page.evaluate(() => document.querySelector('[role="dialog"]').remove());
  await expect.poll(() => count(page)).toBe(2);
});

test('cross-node markup is preserved, plain translated cards still render', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('lines').innerHTML = '<span>~~跨</span><span>节点~~</span>';
    document.getElementById('plain').parentElement.style.transform = 'translate(2px, 2px)';
  });
  await expect.poll(() => count(page)).toBe(1);
});

 test('open editor decorates other lines, including pairs across DOM lines', async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.getElementById('plain');
    editor.innerHTML = '<div>正在编辑</div><div>~~第一行</div><div>第二行~~</div><div>~~另一段~~</div>';
    editor.focus();
    getSelection().setPosition(editor.firstChild.firstChild, 2);
    window.editorHTML = editor.innerHTML;
    window.eventsBefore = inputEvents;
  });
  await expect.poll(() => count(page)).toBe(5);
  const geometry = await page.evaluate(() => {
    const editor = document.getElementById('plain');
    const node = editor.children[2].firstChild;
    const range = document.createRange(); range.selectNodeContents(node);
    const before = range.getBoundingClientRect().toJSON();
    getSelection().setPosition(node, 2);
    return before;
  });
  await expect.poll(() => count(page)).toBe(3);
  expect(await page.evaluate(() => {
    const editor = document.getElementById('plain');
    const range = document.createRange(); range.selectNodeContents(editor.children[2].firstChild);
    return { same: editorHTML === editor.innerHTML, events: inputEvents === eventsBefore, rect: range.getBoundingClientRect().toJSON() };
  })).toEqual({ same: true, events: true, rect: geometry });
  await page.screenshot({ path: 'test-results/editing.png' });
  await page.evaluate(() => getSelection().setPosition(document.getElementById('plain').firstChild.firstChild, 0));
  await expect.poll(() => count(page)).toBe(5);
 });

const shortcut = process.platform === 'darwin' ? 'Meta+Shift+x' : 'Control+Shift+x';
async function selectText(page, start, end) {
  await page.evaluate(({ start, end }) => {
    const editor = document.getElementById('plain'); editor.focus();
    const range = document.createRange();
    function point(offset) {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (offset <= walker.currentNode.length) return [walker.currentNode, offset];
        offset -= walker.currentNode.length;
      }
      throw new Error('Selection outside editor');
    }
    range.setStart(...point(start)); range.setEnd(...point(end));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  }, { start, end });
}

test('context menu adds/removes strike and native undo restores original', async ({ page }) => {
  await page.locator('#plain').fill('保留 中文 内容');
  await selectText(page, 3, 5);
  await menuAction(page, 'strike', 'add');
  await expect(page.locator('#plain')).toHaveText('保留 ~~中文~~ 内容');
  expect(await page.evaluate(() => getSelection().toString())).toBe('中文');
  await menuAction(page, 'strike', 'remove');
  await expect(page.locator('#plain')).toHaveText('保留 中文 内容');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('#plain')).toHaveText('保留 ~~中文~~ 内容');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('#plain')).toHaveText('保留 中文 内容');
});

test('disabled and composing menu actions never write', async ({ page }) => {
  await page.locator('#plain').fill('不要修改');
  await selectText(page, 0, 4);
  await page.locator('#plain').dispatchEvent('compositionstart');
  await menuAction(page, 'strike', 'add');
  await expect(page.locator('#plain')).toHaveText('不要修改');
  await page.locator('#plain').dispatchEvent('compositionend');
  await page.evaluate(() => storageListeners.forEach(f => f({ enabled: { newValue: false } }, 'local')));
  await menuAction(page, 'strike', 'add');
  await expect(page.locator('#plain')).toHaveText('不要修改');
});

test('highlight reading and editor paint preserve source and clear on current line', async ({ page }) => {
  await page.locator('#plain').fill('正在编辑\n==重点内容==\n~~旧内容~~');
  await page.locator('#outside').click();
  await expect.poll(() => count(page)).toBe(2);
  await page.screenshot({ path: 'test-results/highlight-reading.png' });
  await selectText(page, 0, 0);
  const emphasis = () => page.evaluate(() => CSS.highlights.get('keep-mark-strike-emphasis')?.size || 0);
  await expect.poll(emphasis).toBe(1);
  await page.screenshot({ path: 'test-results/highlight-editing.png' });
  await selectText(page, 9, 9);
  await expect.poll(emphasis).toBe(0);
  await expect(page.locator('#plain')).toHaveText('正在编辑\n==重点内容==\n~~旧内容~~', { useInnerText: true });
});

async function menuAction(page, kind, action) {
  await page.locator('#plain').dispatchEvent('contextmenu');
  await page.evaluate(({ kind, action }) => menuListeners.forEach(f => f({ type: 'keep-edit-mark', kind, action })), { kind, action });
}

test('highlight menu is idempotent and removal preserves plain content', async ({ page }) => {
  await page.locator('#plain').fill('重点内容');
  await selectText(page, 0, 4);
  await menuAction(page, 'highlight', 'add');
  await expect(page.locator('#plain')).toHaveText('==重点内容==');
  await menuAction(page, 'highlight', 'add');
  await expect(page.locator('#plain')).toHaveText('==重点内容==');
  await menuAction(page, 'highlight', 'remove');
  await expect(page.locator('#plain')).toHaveText('重点内容');
  await menuAction(page, 'highlight', 'remove');
  await expect(page.locator('#plain')).toHaveText('重点内容');
  await page.keyboard.press(shortcut);
  await expect(page.locator('#plain')).toHaveText('重点内容');
});

test('menu ignores stale text and retains selection across focus loss', async ({ page }) => {
  await page.locator('#plain').fill('重点内容');
  await selectText(page, 0, 4);
  await page.locator('#plain').dispatchEvent('contextmenu');
  await page.evaluate(() => {
    document.getElementById('plain').blur(); getSelection().removeAllRanges();
    menuListeners.forEach(f => f({ type: 'keep-edit-mark', kind: 'highlight', action: 'add' }));
  });
  await expect(page.locator('#plain')).toHaveText('==重点内容==');
  await page.locator('#plain').dispatchEvent('contextmenu');
  await page.evaluate(() => {
    document.getElementById('plain').textContent = '同步更新';
    menuListeners.forEach(f => f({ type: 'keep-edit-mark', kind: 'highlight', action: 'remove' }));
  });
  await expect(page.locator('#plain')).toHaveText('同步更新');
});

for (const html of ['上文\n---\n下文', '<div>上文</div><div><span>--</span><span>-</span></div><div>下文</div>', '上文<br>---<br>下文']) {
  test(`divider paints without changing source and reveals on caret: ${html}`, async ({ page }) => {
    await page.evaluate(html => { document.getElementById('plain').innerHTML = html; }, html);
    const dividers = () => page.evaluate(() => paintRoot.querySelectorAll('.divider').length);
    await expect.poll(dividers).toBe(1);
    const before = await page.locator('#plain').innerHTML();
    const events = await page.evaluate(() => inputEvents);
    await page.screenshot({ path: 'test-results/divider.png' });
    await selectText(page, 0, 0);
    await expect.poll(dividers).toBe(1);
    await page.evaluate(() => {
      const editor = document.getElementById('plain');
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const index = walker.currentNode.data.indexOf('--');
        if (index >= 0) { getSelection().setPosition(walker.currentNode, index + 1); break; }
      }
    });
    await expect.poll(dividers).toBe(0);
    await page.locator('#outside').click();
    await expect.poll(dividers).toBe(1);
    expect(await page.locator('#plain').innerHTML()).toBe(before);
    expect(await page.evaluate(() => inputEvents)).toBe(events);
    await page.evaluate(() => { document.getElementById('plain').textContent = '上文---下文'; });
    await expect.poll(dividers).toBe(0);
  });
}

 test('other notes hover, transitions, selection and IME never remove the divider', async ({ page }) => {
  await page.evaluate(() => { document.getElementById('plain').textContent = '上文\n---\n下文'; });
  await expect.poll(() => page.evaluate(() => paintRoot.querySelectorAll('.divider').length)).toBe(1);
  const samples = await page.evaluate(async () => {
    const other = document.getElementById('lines');
    const samples = [];
    const sample = () => samples.push({
      line: paintRoot.querySelectorAll('.divider').length,
      hidden: [...(CSS.highlights.get('keep-mark-strike-original') || [])]
        .some(range => document.getElementById('plain').contains(range.startContainer))
    });
    for (let i = 0; i < 12; i++) {
      other.classList.toggle('hover');
      other.dispatchEvent(new TransitionEvent('transitionrun', { bubbles: true, propertyName: 'box-shadow' }));
      await Promise.resolve(); // MutationObserver runs before the next animation frame.
      sample();
      await new Promise(requestAnimationFrame);
      sample();
      other.dispatchEvent(new TransitionEvent(i % 2 ? 'transitionend' : 'transitioncancel', { bubbles: true }));
      sample();
    }
    other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    sample();
    const range = document.createRange(); range.selectNodeContents(other);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise(requestAnimationFrame); sample();
    other.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    getSelection().removeAllRanges();
    other.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    sample(); await new Promise(requestAnimationFrame); sample();
    other.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    return samples;
  });
  expect(samples.every(sample => sample.line === 1 && sample.hidden)).toBe(true);
  await expect(page.locator('#plain')).toHaveText('上文\n---\n下文');
});
