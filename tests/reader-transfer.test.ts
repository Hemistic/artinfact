import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDataTransferAnnotations } from '../src/shared/reader-transfer.ts';
test('annotation dragging and copying have a repeatable transfer callback without changing plain text', () => {
  const data = new Map<string, string>([['text/plain', 'native caption']]);
  const transfer = { setData: (kind: string, value: string) => { data.set(kind, value); } };
  for (let i = 0; i < 2; i++) setDataTransferAnnotations(transfer, [{ id: 'a', type: 'image' }]);
  assert.equal(data.get('text/plain'), 'native caption');
  assert.equal(JSON.parse(data.get('application/x-zotero-annotations')!).length, 1);
});
