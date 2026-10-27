import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSelection, selectionContext } from '../src/shared/pdf-selection.ts';
test('figure selections retain image content alongside caption and PDF provenance', () => {
  const value = normalizeSelection({ kind: 'figure-annotation', selectedText: 'Figure 1. Chart', startLine: 3, attachments: [{ dataUrl: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }] })!;
  const context = selectionContext({ id: 'a'.repeat(64), name: 'paper.pdf' }, value);
  assert.equal(context.content.length, 2); assert.equal(context.content[1].type, 'image');
  assert.equal(context.structuredContent.startPage, 3);
  assert.ok(!JSON.stringify(selectionContext({ id: 'a'.repeat(64), name: 'paper.pdf' }, normalizeSelection({ selectedText: 'caption', attachments: [{ dataUrl: 'data:text/html;base64,aGVsbG8=' }] })!)).includes('text/html'));
});
