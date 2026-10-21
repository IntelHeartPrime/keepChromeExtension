(() => {
  'use strict';
  if (!globalThis.KeepMarkStrike || !globalThis.CSS?.highlights || !globalThis.Highlight) return;
  if (document.getElementById('keep-mark-strike-layer')) return;

  // Verified in Keep's Elements panel on 2026-10-15: preview and editor.
  // .IZ65Hb-n0tgWb is the CARD, not the title. Titles live in r4nke-haAclf.
  const BODY = '.IZ65Hb-vIzZGf-bVEB4e-qJTHM, .IZ65Hb-vIzZGf-L9AdLc-haAclf';
  const KEY = 'keep-mark-strike-original';
  const EMPHASIS = 'keep-mark-strike-emphasis';
  const host = document.createElement('div');
  host.id = 'keep-mark-strike-layer';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483000!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = document.createElement('style');
  sheet.textContent = ':host{pointer-events:none} .mirror{position:fixed;pointer-events:none;user-select:none;overflow:hidden;box-sizing:border-box} mark{background:#ffe077;color:#202124;border-radius:2px} s{text-decoration:line-through;text-decoration-thickness:1.5px}';
  shadow.append(sheet);
  document.documentElement.append(host);
  const records = new Map();
  let enabled = false;
  let composing = null;
  let pressing = null;
  let frame = 0;
  let destroyed = false;
  const events = new AbortController();

  function clear(element) {
    if (!element) {
      CSS.highlights.delete(KEY);
      CSS.highlights.delete(EMPHASIS);
    }
    for (const [body, record] of records) {
      if (element && body !== element) continue;
      if (element) {
        for (const key of [KEY, EMPHASIS]) {
          const highlight = CSS.highlights.get(key);
          if (highlight) for (const range of [...highlight]) {
            if (body.contains(range.startContainer)) highlight.delete(range);
          }
        }
      }
      record.mirror?.remove();
      record.mirror = null;
    }
  }

  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(render);
  }

  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target);
      if (record) record.visible = entry.isIntersecting;
    }
    schedule();
  });
  const resize = new ResizeObserver(schedule);

  function discover(root) {
    if (!(root instanceof Element) || root === host) return;
    const found = root.matches(BODY) ? [root] : [];
    found.push(...root.querySelectorAll(BODY));
    for (const element of found) {
      if (records.has(element)) continue;
      records.set(element, { visible: false, mirror: null });
      intersection.observe(element);
      resize.observe(element);
    }
  }

  const properties = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent',
    'text-transform', 'white-space', 'overflow-wrap', 'word-break', 'direction',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'color',
    'text-decoration', 'text-rendering', '-webkit-font-smoothing'];

  function copyContent(source, target) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        for (const part of KeepMarkStrike.parse(child.data)) {
          const node = document.createElement(part.strike ? 's' : part.highlight ? 'mark' : 'span');
          node.textContent = part.text;
          target.append(node);
        }
      } else if (child instanceof Element) {
        const clone = document.createElement(child.tagName);
        const computed = getComputedStyle(child);
        for (const property of [...properties, 'display', 'margin-top', 'margin-bottom',
          'margin-left', 'margin-right', 'vertical-align', 'unicode-bidi']) {
          clone.style.setProperty(property, computed.getPropertyValue(property));
        }
        copyContent(child, clone);
        target.append(clone);
      }
    }
  }

  // Decorate the native editor in place visually, without changing its DOM or
  // collapsing delimiter widths. This keeps selection/caret geometry stable.
  function decorateEditor(element, mirror, highlights, emphasis, bounds) {
    const nodes = [];
    let text = '';
    function visit(parent) {
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          nodes.push({ node: child, start: text.length, end: text.length + child.length });
          text += child.data;
        } else if (child instanceof Element) {
          const block = ['DIV', 'P'].includes(child.tagName);
          if (block && text && !text.endsWith('\n')) text += '\n';
          if (child.tagName === 'BR') text += '\n';
          else visit(child);
          if (block && !text.endsWith('\n')) text += '\n';
        }
      }
    }
    visit(element);
    function ranges(start, end) {
      return nodes.filter(n => n.end > start && n.start < end).map(n => {
        const range = document.createRange();
        range.setStart(n.node, Math.max(0, start - n.start));
        range.setEnd(n.node, Math.min(n.node.length, end - n.start));
        return range;
      });
    }
    const selection = getSelection();
    const caret = selection?.rangeCount && element.contains(document.activeElement)
      && element.contains(selection.focusNode) ? selection.getRangeAt(0) : null;
    for (const match of [...KeepMarkStrike.matches(text), ...KeepMarkStrike.dividers(text)]) {
      const start = match.index, end = start + match.raw.length;
      // The entire logical line(s) containing the pair stay raw while editing.
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const nextBreak = text.indexOf('\n', end);
      const lineEnd = nextBreak < 0 ? text.length : nextBreak;
      const lineNodes = nodes.filter(n => n.end >= lineStart && n.start <= lineEnd);
      if (caret && lineNodes.length) {
        const line = document.createRange();
        const first = lineNodes[0], last = lineNodes[lineNodes.length - 1];
        line.setStart(first.node, Math.max(0, lineStart - first.start));
        line.setEnd(last.node, Math.min(last.node.length, lineEnd - last.start));
        if (line.comparePoint(caret.startContainer, caret.startOffset) === 0) continue;
      }
      if (match.divider) {
        const ruleRanges = ranges(start, end);
        const rect = ruleRanges[0]?.getBoundingClientRect();
        if (!rect) continue;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const left = Math.max(bounds.left, box.left + parseFloat(style.paddingLeft));
        const right = Math.min(bounds.right, box.right - parseFloat(style.paddingRight));
        const y = rect.top + rect.height / 2;
        if (right <= left || y < bounds.top || y >= bounds.bottom) continue;
        for (const range of ruleRanges) highlights.add(range);
        const line = document.createElement('div');
        line.className = 'divider';
        line.style.cssText = `position:fixed;left:${left}px;top:${y}px;width:${right - left}px;height:1px;pointer-events:none`;
        line.style.backgroundColor = style.color;
        line.style.opacity = '0.35';
        mirror.append(line);
        continue;
      }
      for (const range of [...ranges(start, start + 2), ...ranges(end - 2, end)]) highlights.add(range);
      for (const range of ranges(start + 2, end - 2)) {
        if (!match.strike) { emphasis.add(range); continue; }
        for (const rect of range.getClientRects()) {
          const left = Math.max(bounds.left, rect.left), right = Math.min(bounds.right, rect.right);
          const y = rect.top + rect.height * 0.55;
          if (right <= left || y < bounds.top || y >= bounds.bottom) continue;
          const line = document.createElement('div');
          line.style.cssText = `position:fixed;left:${left}px;top:${y}px;width:${right - left}px;height:1.5px;pointer-events:none`;
          line.style.backgroundColor = getComputedStyle(range.startContainer.parentElement).color;
          mirror.append(line);
        }
      }
    }
  }

  function safe(element, dialog) {
    if (dialog && !dialog.contains(element)) return false;
    if (element.closest('[role="checkbox"], [role="listitem"], [aria-hidden="true"], [hidden], .IZ65Hb-r4nke-haAclf')) return false;
    if (element.querySelector('[role="checkbox"], input, textarea, img, svg, a, button, ul, ol, table')) return false;
    const base = getComputedStyle(element);
    if (base.visibility !== 'visible' || base.display === 'none' || base.writingMode !== 'horizontal-tb') return false;
    // Layout transformations / animation / clipping cannot be safely mirrored.
    for (let p = element; p && p !== document.documentElement; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.transform !== 'none') {
        const matrix = new DOMMatrixReadOnly(style.transform);
        // Pure translation is already reflected in getBoundingClientRect().
        if (!matrix.is2D || matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1) return false;
      }
      if (Number(style.opacity) !== 1 || style.visibility !== 'visible') return false;
    }
    for (const child of element.querySelectorAll('*')) {
      if (!['DIV', 'P', 'SPAN', 'BR'].includes(child.tagName)) return false;
      if (child.tagName === 'BR') continue;
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.position === 'absolute' || style.transform !== 'none') return false;
    }
    return base;
  }

  function render() {
    frame = 0;
    // Clear and rebuild synchronously in one animation frame, so the browser
    // never paints an empty layer between unrelated page updates.
    clear();
    for (const [element] of records) {
      if (!element.isConnected) {
        intersection.unobserve(element);
        resize.unobserve(element);
        records.delete(element);
      }
    }
    if (!enabled || document.hidden) return;
    const selection = getSelection();
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(el => el.getClientRects().length);
    const highlights = new Highlight();
    const emphasis = new Highlight();
    for (const [element, record] of records) {
      if (element === composing || element === pressing) continue;
      if (selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount },
        (_, index) => selection.getRangeAt(index)).some(range => range.intersectsNode(element))) continue;
      if (!record.visible || !/(~~|==|---)/.test(element.textContent)) continue;
      const style = safe(element, dialog);
      if (!style) continue;
      const editing = element.contains(document.activeElement) || (element.isContentEditable && dialog?.contains(element));
      const text = element.innerText;
      const parts = KeepMarkStrike.parse(text);
      const hasDivider = [...KeepMarkStrike.dividers(text)].length > 0;
      if (!editing && !hasDivider && !parts.some(part => part.strike || part.highlight)) continue;
      // A pair may not span multiple text nodes, even if their styles match.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let localPairs = 0;
      while (walker.nextNode()) localPairs += KeepMarkStrike.parse(walker.currentNode.data).filter(p => p.strike || p.highlight).length;
      if (!editing && localPairs !== parts.filter(p => p.strike || p.highlight).length) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      // Do not paint over scroll containers, clipped cards, or unrelated UI.
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      for (let p = element.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
        if (/(hidden|clip|scroll|auto)/.test(ps.overflowX)) { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
        if (/(hidden|clip|scroll|auto)/.test(ps.overflowY)) { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
      }
      if (left >= right || top >= bottom) continue;
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (!hit || !(element === hit || element.contains(hit))) continue;
      const mirror = document.createElement('div');
      if (editing || hasDivider) {
        decorateEditor(element, mirror, highlights, emphasis, { left, top, right, bottom });
        shadow.append(mirror);
        record.mirror = mirror;
        continue;
      }
      mirror.className = 'mirror';
      for (const property of properties) mirror.style.setProperty(property, style.getPropertyValue(property));
      Object.assign(mirror.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
        // innerText includes visual line breaks from DIV/BR; preserve these.
        whiteSpace: 'pre-wrap',
        clipPath: `inset(${top - rect.top}px ${rect.right - right}px ${rect.bottom - bottom}px ${left - rect.left}px)`
      });
      copyContent(element, mirror);
      shadow.append(mirror);
      record.mirror = mirror;
      const range = document.createRange();
      range.selectNodeContents(element);
      highlights.add(range);
    }
    if (highlights.size) CSS.highlights.set(KEY, highlights);
    if (emphasis.size) CSS.highlights.set(EMPHASIS, emphasis);
  }

  const observer = new MutationObserver(changes => {
    // Shadow-root updates are not observed. Only discover in newly added subtrees.
    // Keep the existing paint until render; hover often mutates unrelated UI.
    for (const change of changes) {
      for (const node of change.addedNodes) discover(node);
      if (change.type === 'attributes' && change.target.matches?.(BODY)) discover(change.target);
    }
    schedule();
  });

  function listen(type, handler, options = {}) {
    document.addEventListener(type, handler, { capture: true, signal: events.signal, ...options });
  }
  function eventBody(event) {
    return event.target instanceof Element ? event.target.closest(BODY) : null;
  }
  function clearEventBody(event) {
    const body = eventBody(event);
    if (body) clear(body);
  }
  listen('pointerdown', event => { pressing = eventBody(event); clearEventBody(event); schedule(); });
  listen('pointerup', () => { pressing = null; schedule(); });
  listen('pointercancel', () => { pressing = null; schedule(); });
  let menuSelection = null;
  let recentSelection = null;
  let menuOpen = false;
  let noticeTimer;
  let notice;
  function menuNotice(text) {
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#202124;color:white;padding:12px 18px;border-radius:8px;font:14px/1.5 sans-serif;pointer-events:none;max-width:80vw';
      document.documentElement.append(notice);
    }
    notice.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice?.remove(); notice = null; }, 5000);
  }
  let selectionFailure = '';
  function editableMenuBody(editor) {
    if (!editor?.isConnected || !editor.isContentEditable) return false;
    // This is an explicit edit of the user's selection on Keep, not paint
    // discovery. Keep's generated BODY classes are not an editing contract.
    if (editor.closest('[role="checkbox"], [aria-hidden="true"], [hidden], .IZ65Hb-r4nke-haAclf, [role="search"], [role="searchbox"]')) return false;
    const label = `${editor.getAttribute('aria-label') || ''} ${editor.getAttribute('data-placeholder') || ''}`;
    return !/(^|\s)(title|search)(\s|$)|标题|標題|搜索|搜尋/iu.test(label);
  }
  function crossesMenuLine(editor, start, end) {
    // A wrapper is not a line break. Only boundaries strictly BETWEEN
    // selected characters count, so selecting a whole DIV/P or its trailing
    // BR remains a single-line selection.
    let offset = 0;
    let crosses = false;
    const boundary = () => { if (start < offset && offset < end) crosses = true; };
    function visit(parent) {
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const from = Math.max(0, start - offset);
          const to = Math.min(child.length, end - offset);
          if (to > from && /[\r\n\u2028\u2029]/u.test(child.data.slice(from, to))) crosses = true;
          offset += child.length;
        } else if (child instanceof Element) {
          const block = ['block', 'flow-root', 'list-item', 'flex', 'grid', 'table', 'table-row']
            .includes(getComputedStyle(child).display);
          if (block || child.tagName === 'BR') boundary();
          visit(child);
          if (block) boundary();
        }
      }
    }
    visit(editor);
    return crosses;
  }
  function readMenuSelection() {
    const fail = reason => { selectionFailure = reason; return null; };
    if (!enabled || composing) return null;
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed)
      return fail('右键打开时选区已丢失，请重新选中文字后右键。');
    const range = selection.getRangeAt(0);
    const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    let editor = parent;
    while (editor?.isContentEditable && editor.parentElement?.isContentEditable) editor = editor.parentElement;
    if (!editableMenuBody(editor))
      return fail('选中文字所在节点不是可编辑正文，或位于标题／搜索框中。');
    if (!editor.contains(range.endContainer))
      return fail('选区跨越了不同编辑区，请只选择同一正文中的文字。');
    const endParent = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer : range.endContainer.parentElement;
    // An editable host may itself be nested in contenteditable="false".
    // Only non-editable nodes INSIDE the host block the operation.
    if (!parent.isContentEditable || !endParent.isContentEditable)
      return fail('选区包含不可编辑内容，请只选择正文文字。');
    const fragment = range.cloneContents();
    if (fragment.querySelector('a,img,svg,input,textarea,button,[contenteditable="false"]')
        || parent.closest('a') || endParent.closest('a'))
      return fail('选区包含链接或其他非纯文本内容，请只选择普通文字。');
    const before = document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString();
    // Triple-click/line selections can include a terminal newline. Keep that
    // separator outside the native replacement rather than deleting it.
    const leading = raw.match(/^[\r\n\u2028\u2029]*/u)[0].length;
    const trailing = raw.match(/[\r\n\u2028\u2029]*$/u)[0].length;
    const start = before.toString().length + leading;
    const end = before.toString().length + raw.length - trailing;
    if (start >= end) return fail('选区没有可标记的文字。');
    if (crossesMenuLine(editor, start, end))
      return fail('选区实际跨过了换行或段落边界，请选择同一行内的文字。');
    selectionFailure = '';
    return { editor, text: editor.textContent, html: editor.innerHTML,
      selected: selection.toString(), start, end };
  }
  function editMenuSelection(message) {
    const saved = menuSelection;
    menuSelection = recentSelection = null;
    menuOpen = false;
    if (!enabled) return { ok: false, reason: '扩展已关闭，请先开启。' };
    if (composing) return { ok: false, reason: '请先结束输入法输入，再执行右键操作。' };
    if (!saved) return { ok: false, reason: selectionFailure || '右键选区未保存，请重新选择文字后右键。' };
    const { editor } = saved;
    if (!editableMenuBody(editor) || editor.textContent !== saved.text || editor.innerHTML !== saved.html)
      return { ok: false, reason: '正文已变化，请重新选中文字后右键。' };
    const normalizeSelection = text => text.replace(/\s+/gu, ' ').trim();
    if (typeof message.selectionText === 'string'
        && normalizeSelection(message.selectionText) !== normalizeSelection(saved.selected))
      return { ok: false, reason: '右键选区已变化，请重新选中文字后右键。' };
    const change = KeepMarkStrike.editMark(saved.text, saved.start, saved.end, message.kind, message.action);
    if (!change) return { ok: false, reason: message.action === 'remove'
      ? '请选中完整的已标记文字（可以包含两边的标记）再取消。'
      : '选区已带标记或包含不支持的内容，请选择未标记的一行文字。' };
    const selection = getSelection();
    function point(offset, endPoint = false) {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (offset < node.length || (endPoint && offset === node.length && node.length)) return [node, offset];
        offset -= node.length;
      }
      return [editor, editor.childNodes.length];
    }
    function select(start, end) {
      const next = document.createRange();
      next.setStart(...point(start)); next.setEnd(...point(end, true));
      selection.removeAllRanges(); selection.addRange(next);
    }
    clear();
    editor.focus({ preventScroll: true });
    // Focus handlers in Keep may replace the editor contents synchronously.
    if (!editor.isConnected || editor.textContent !== saved.text || editor.innerHTML !== saved.html)
      return { ok: false, reason: '编辑区在聚焦时发生变化，请重新选择文字。' };
    select(change.start, change.end);
    const expected = saved.text.slice(0, change.start) + change.replacement + saved.text.slice(change.end);
    document.execCommand('insertText', false, change.replacement);
    schedule();
    if (editor.textContent !== expected)
      return { ok: false, reason: 'Keep 未完成选区编辑，请重新打开笔记后再试。' };
    select(change.start + change.inset, change.start + change.replacement.length - change.inset);
    return { ok: true };
  }
  // Preserve the selection before a native menu takes focus. Do not allow a
  // later click or another note's menu to reuse the saved range.
  listen('pointerdown', event => {
    menuOpen = false;
    menuSelection = null;
    recentSelection = event.button === 2 || (event.button === 0 && event.ctrlKey)
      ? readMenuSelection() : null;
  });
  listen('contextmenu', event => {
    pressing = null;
    const selection = getSelection();
    const current = readMenuSelection();
    const saved = current || ((!selection?.rangeCount || selection.isCollapsed) ? recentSelection : null);
    menuSelection = saved && event.target instanceof Node && saved.editor.contains(event.target) ? saved : null;
    if (saved && !menuSelection) selectionFailure = '右键位置不在已选中的编辑区内，请在选中文字上右键。';
    menuOpen = true;
    schedule();
  });
  const onMenuMessage = (message, sender, sendResponse) => {
    if (message?.type !== 'keep-edit-mark') return;
    let result;
    try { result = editMenuSelection(message); }
    catch { result = { ok: false, reason: '无法恢复编辑选区，请重新选择文字后再试。' }; }
    if (!result.ok) menuNotice(result.reason);
    sendResponse?.(result);
  };
  chrome.runtime.onMessage.addListener(onMenuMessage);
  listen('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
      menuSelection = recentSelection = null;
      menuOpen = false;
    }
    clearEventBody(event); schedule();
  });
  listen('focusin', schedule);
  listen('focusout', schedule);
  listen('compositionstart', event => { composing = eventBody(event); clearEventBody(event); schedule(); });
  listen('compositionend', () => { composing = null; schedule(); });
  listen('beforeinput', clearEventBody);
  listen('input', schedule);
  listen('selectionchange', () => {
    if (!menuOpen) {
      const current = readMenuSelection();
      if (current) recentSelection = current;
    }
    schedule();
  });
  listen('scroll', schedule, { passive: true });
  listen('visibilitychange', () => { pressing = null; clear(); schedule(); });
  listen('transitionrun', schedule);
  listen('transitionend', schedule);
  listen('transitioncancel', schedule);
  window.addEventListener('resize', schedule, { signal: events.signal });
  window.addEventListener('blur', () => { pressing = null; clear(); }, { signal: events.signal });
  window.addEventListener('focus', schedule, { signal: events.signal });

  function destroy() {
    destroyed = true;
    clear();
    cancelAnimationFrame(frame);
    observer.disconnect(); intersection.disconnect(); resize.disconnect();
    chrome.runtime.onMessage.removeListener(onMenuMessage);
    clearTimeout(noticeTimer); notice?.remove();
    events.abort(); host.remove();
  }
  // On extension reload, context invalidation should leave the original visible.
  try {
    chrome.storage.local.get({ enabled: true }).then(settings => {
      enabled = settings.enabled !== false;
      schedule();
    }).catch(destroy);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.enabled) {
        enabled = changes.enabled.newValue !== false;
        clear(); schedule();
      }
    });
  } catch { destroy(); return; }
  discover(document.body);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'contenteditable', 'aria-hidden', 'hidden', 'role'] });
})();
