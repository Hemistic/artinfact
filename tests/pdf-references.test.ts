import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceIndex, resolveReferences } from '../src/shared/pdf-references.ts';
import { normalizeSelection, selectionContext } from '../src/shared/pdf-selection.ts';

test('reference resolution reuses numeric ranges, nested MinerU lists and reader overlay references', () => {
  const index = buildReferenceIndex([{ type: 'list', content: { list_items: [{ content: '[1] First paper' }, { content: '2. Second paper' }] } }, { text: '[3] Third paper' }]);
  const value = resolveReferences('Results [1–3], [2] and [9].', index, ['[2] Second paper']);
  assert.deepEqual(value.citationNumbers, ['1', '2', '3', '9']);
  assert.deepEqual(value.citationTexts, ['[2] Second paper', '[1] First paper', '[3] Third paper']);
  assert.deepEqual(value.missingCitationNumbers, ['9']);
  assert.equal(resolveReferences('No marker.', index).citationTexts.length, 0);
  assert.ok(resolveReferences('[1-999999]', index).citationNumbers.length === 0);
  assert.deepEqual(resolveReferences(`[${'9'.repeat(400)}-${'9'.repeat(400)}]`, index).citationNumbers, []);
  const fragments = buildReferenceIndex([[{ type: 'list', content: { list_items: [[{ text: '[4]' }, { text: 'Split title and authors' }]] } }]]);
  assert.equal(fragments.get('4'), '[4] Split title and authors');
});

test('selection context labels distinguish mixed visual selections and include reference text', () => {
  const selection = normalizeSelection({ selectedText: '正文 [1]', kind: 'pdf-text', citationTexts: ['[1] Actual source'], citationNumbers: ['1'] })!;
  const context = selectionContext({ id: 'a', name: 'paper.pdf' }, selection);
  assert.equal(context.structuredContent.displayLabel, '已选择 6 个文字，包含 1 篇参考文献');
  assert.match(context.content[0].text, /Actual source/);
  const visuals = normalizeSelection({ selectedText: 'Captions', kind: 'figure-annotation', selectedAnnotations: [{ id: 'a', type: 'image', layoutKind: 'table' }, { id: 'b', type: 'image', layoutKind: 'figure' }, { id: 'b', type: 'image', layoutKind: 'figure' }] })!;
  assert.equal(selectionContext({ id: 'a', name: 'paper.pdf' }, visuals).structuredContent.displayLabel, '已选择表格 1 个、图片 1 张');
});
