const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../extension/parser.js');

test('multiple nonempty Chinese/English/emoji spans', () => {
  const parts = parse('保留 ~~旧方案~~ 采用 ~~new 123 👩‍💻~~');
  assert.deepEqual(parts.filter(p => p.strike).map(p => p.text), ['旧方案', 'new 123 👩‍💻']);
  assert.equal(parts.map(p => p.text).join(''), '保留 旧方案 采用 new 123 👩‍💻');
});
for (const input of ['', 'plain', '~~未闭合', '~~~~', '~~~nested~~~', '~~a\nb~~', '~~a\r\nb~~', '~~a\u2028b~~', '~~a~b~~']) {
  test(`preserve invalid syntax ${JSON.stringify(input)}`, () => {
    assert.equal(parse(input).some(p => p.strike), false);
    assert.equal(parse(input).map(p => p.text).join(''), input);
  });
}
test('cross-line pair stays raw and does not steal the next valid pair', () => {
  assert.deepEqual(parse('~~bad\nline~~ ~~good~~').filter(p => p.strike), [{ text: 'good', strike: true }]);
});
test('no interpretation of HTML or escape syntax', () => {
  assert.equal(parse('~~<img onerror=alert(1)>~~')[0].text, '<img onerror=alert(1)>');
  assert.equal(parse('\\~~text~~')[1].strike, true);
});
test('long unmatched input is handled', () => {
  const input = '~'.repeat(100000) + '文字';
  assert.equal(parse(input).map(p => p.text).join(''), input);
});

test('highlight and strike coexist, invalid highlight stays raw', () => {
  assert.deepEqual(parse('==重点 👩‍💻== ~~旧版~~').filter(p => p.highlight || p.strike), [
    { text: '重点 👩‍💻', strike: false, highlight: true }, { text: '旧版', strike: true }
  ]);
  for (const input of ['====', '===a===', '==a=b==', '==未闭合', '==跨\n行==']) {
    assert.equal(parse(input).map(p => p.text).join(''), input);
  }
});
test('explicit mark actions add/remove without nesting or toggling', () => {
  const { editMark } = require('../extension/parser.js');
  for (const [kind, marker] of [['strike', '~~'], ['highlight', '==']]) {
    assert.deepEqual(editMark('中文', 0, 2, kind, 'add'), { start: 0, end: 2, replacement: marker + '中文' + marker, inset: 2 });
    const marked = marker + '中文' + marker;
    for (const [start, end] of [[2, 4], [0, 6]]) {
      assert.deepEqual(editMark(marked, start, end, kind, 'remove'), { start: 0, end: 6, replacement: '中文', inset: 0 });
      assert.equal(editMark(marked, start, end, kind, 'add'), null);
    }
    assert.equal(editMark('中文', 0, 2, kind, 'remove'), null);
    assert.equal(editMark(marked, 3, 4, kind, 'remove'), null);
    assert.equal(editMark('a\nb', 0, 3, kind, 'add'), null);
  }
  assert.equal(editMark('==重点==', 2, 4, 'strike', 'add'), null);
});
