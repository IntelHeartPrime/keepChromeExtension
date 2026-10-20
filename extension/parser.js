/* Pure parser shared by the content script and Node tests. No HTML parsing. */
((root) => {
  function* matches(text) {
    const pattern = /(?<!~)~~([^~]+)~~(?!~)|(?<!=)==([^=]+)==(?!=)/gu;
    for (const match of text.matchAll(pattern)) {
      yield { index: match.index, raw: match[0], text: match[1] ?? match[2], strike: match[1] !== undefined };
    }
  }

  // A divider must occupy a complete logical line; inline hyphens stay literal.
  function* dividers(text) {
    for (const match of text.matchAll(/^[\t ]*-{3,}[\t ]*$/gmu)) {
      yield { index: match.index, raw: match[0], divider: true };
    }
  }

  function parse(text) {
    const parts = [];
    let cursor = 0;
    // Exact pairs only. Runs of 3+ tildes and a single tilde inside a span
    // are intentionally unsupported; never reinterpret them as nesting.
    for (const match of matches(text)) {
      // Consume an invalid cross-line pair as raw text rather than treating its
      // closing delimiter as the opening delimiter of another span.
      if (/[\r\n\u2028\u2029]/u.test(match.text)) continue;
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), strike: false });
      parts.push(match.strike ? { text: match.text, strike: true } : { text: match.text, strike: false, highlight: true });
      cursor = match.index + match.raw.length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), strike: false });
    return parts;
  }
  // Explicit add/remove actions are idempotent; never nest marker pairs.
  function editMark(text, start, end, kind, action) {
    if (!['strike', 'highlight'].includes(kind) || !['add', 'remove'].includes(action)
        || start < 0 || end > text.length || start >= end) return null;
    const selected = text.slice(start, end);
    if (/[\r\n\u2028\u2029]/u.test(selected)) return null;
    const marker = kind === 'strike' ? '~~' : '==';
    const char = marker[0];
    const pairs = [...matches(text)];
    const pair = pairs.find(m => m.strike === (kind === 'strike')
      && ((m.index === start && m.index + m.raw.length === end)
        || (m.index + 2 === start && m.index + m.raw.length - 2 === end)));
    if (action === 'remove') {
      return pair ? { start: pair.index, end: pair.index + pair.raw.length,
        replacement: pair.text, inset: 0 } : null;
    }
    if (selected.includes(char) || text[start - 1] === char || text[end] === char
        || pairs.some(m => start < m.index + m.raw.length && end > m.index)) return null;
    return { start, end, replacement: marker + selected + marker, inset: 2 };
  }
  const api = Object.freeze({ parse, matches, dividers, editMark });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KeepMarkStrike = api;
})(globalThis);
