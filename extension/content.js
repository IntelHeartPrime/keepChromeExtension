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
  let composing = false;
  let pressing = false;
  let frame = 0;
  let destroyed = false;
  const events = new AbortController();

  function clear() {
    CSS.highlights.delete(KEY);
    CSS.highlights.delete(EMPHASIS);
    for (const record of records.values()) {
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
    for (const match of KeepMarkStrike.matches(text)) {
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
    clear();
    for (const [element] of records) {
      if (!element.isConnected) {
        intersection.unobserve(element);
        resize.unobserve(element);
        records.delete(element);
      }
    }
    if (!enabled || composing || pressing || document.hidden || !getSelection()?.isCollapsed) return;
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(el => el.getClientRects().length);
    const highlights = new Highlight();
    const emphasis = new Highlight();
    for (const [element, record] of records) {
      if (!record.visible || !/(~~|==)/.test(element.textContent)) continue;
      const style = safe(element, dialog);
      if (!style) continue;
      const editing = element.contains(document.activeElement) || (element.isContentEditable && dialog?.contains(element));
      const text = element.innerText;
      const parts = KeepMarkStrike.parse(text);
      if (!editing && !parts.some(part => part.strike || part.highlight)) continue;
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
      if (editing) {
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
    clear();
    for (const change of changes) {
      for (const node of change.addedNodes) discover(node);
      if (change.type === 'attributes' && change.target.matches?.(BODY)) discover(change.target);
    }
    schedule();
  });

  function listen(type, handler, options = {}) {
    document.addEventListener(type, handler, { capture: true, signal: events.signal, ...options });
  }
  listen('pointerdown', () => { pressing = true; clear(); });
  listen('pointerup', () => { pressing = false; schedule(); });
  listen('pointercancel', () => { pressing = false; schedule(); });
  let menuSelection = null;
  function captureMenuSelection(event) {
    menuSelection = null;
    if (!enabled || composing) return;
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const editor = parent.closest(BODY);
    if (!editor?.isContentEditable || !editor.contains(document.activeElement)
        || !editor.contains(range.endContainer) || !safe(editor, null)) return;
    // Keep rich content and selections crossing paragraph boundaries untouched.
    if (range.cloneContents().querySelector('div,p,br')) return;
    const before = document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    if (!(event.target instanceof Node) || !editor.contains(event.target)) return;
    menuSelection = { editor, range: range.cloneRange(), text: editor.textContent,
      html: editor.innerHTML, start, end: start + range.toString().length };
  }
  function editMenuSelection(message) {
    const saved = menuSelection;
    menuSelection = null;
    if (!enabled || composing || !saved || !saved.editor.isConnected) return;
    const { editor, range } = saved;
    if (editor.textContent !== saved.text || editor.innerHTML !== saved.html
        || !editor.isContentEditable || !safe(editor, null)
        || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
    const change = KeepMarkStrike.editMark(saved.text, saved.start, saved.end, message.kind, message.action);
    if (!change) return;
    const selection = getSelection();
    function point(offset) {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      return [editor, editor.childNodes.length];
    }
    function select(start, end) {
      const next = document.createRange();
      next.setStart(...point(start)); next.setEnd(...point(end));
      selection.removeAllRanges(); selection.addRange(next);
    }
    clear();
    editor.focus();
    select(change.start, change.end);
    // Chromium's native editing command preserves undo and emits a real input
    // event. Never fall back to direct DOM writes or synthetic save events.
    if (document.execCommand('insertText', false, change.replacement)) {
      select(change.start + change.inset, change.start + change.replacement.length - change.inset);
    }
    schedule();
  }
  listen('contextmenu', event => { pressing = false; captureMenuSelection(event); schedule(); });
  const onMenuMessage = message => {
    if (message?.type === 'keep-edit-mark') editMenuSelection(message);
  };
  chrome.runtime.onMessage.addListener(onMenuMessage);
  listen('keydown', () => { menuSelection = null; clear(); schedule(); });
  listen('focusin', () => { clear(); schedule(); });
  listen('focusout', schedule);
  listen('compositionstart', () => { composing = true; clear(); });
  listen('compositionend', () => { composing = false; schedule(); });
  listen('beforeinput', clear);
  listen('input', schedule);
  listen('selectionchange', () => { clear(); schedule(); });
  listen('scroll', () => { clear(); schedule(); }, { passive: true });
  listen('visibilitychange', () => { pressing = false; clear(); schedule(); });
  listen('transitionrun', clear);
  listen('transitionend', schedule);
  window.addEventListener('resize', () => { clear(); schedule(); }, { signal: events.signal });
  window.addEventListener('blur', () => { pressing = false; clear(); }, { signal: events.signal });
  window.addEventListener('focus', schedule, { signal: events.signal });

  function destroy() {
    destroyed = true;
    clear();
    cancelAnimationFrame(frame);
    observer.disconnect(); intersection.disconnect(); resize.disconnect();
    chrome.runtime.onMessage.removeListener(onMenuMessage);
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
