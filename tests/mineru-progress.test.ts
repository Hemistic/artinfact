import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineruProgress } from '../src/shared/mineru-progress.ts';

test('MinerU ring shows actual page progress, not invented overall percentages', () => {
  const state = mineruProgress({ documentId: 'a', phase: 'parsing', progress: { extractedPages: 3, totalPages: 12 } });
  assert.equal(state.percent, 25); assert.equal(state.busy, true); assert.equal(state.indeterminate, false);
  assert.match(state.label, /25%.*3\/12/);
  for (const phase of ['creating', 'uploading', 'downloading', 'indexing'] as const) {
    const value = mineruProgress({ documentId: 'a', phase, progress: { extractedPages: 12, totalPages: 12 } });
    assert.equal(value.percent, null); assert.equal(value.indeterminate, true);
  }
});

test('MinerU ring handles unknown totals, completed/failed states and a new document', () => {
  for (const progress of [undefined, { extractedPages: 3, totalPages: 0 }, { extractedPages: NaN, totalPages: 10 }]) assert.equal(mineruProgress({ documentId: 'a', phase: 'parsing', progress }).indeterminate, true);
  const done = mineruProgress({ documentId: 'a', phase: 'completed' }); assert.equal(done.percent, 100); assert.equal(done.busy, false); assert.equal(done.state, 'completed');
  const failed = mineruProgress({ documentId: 'a', phase: 'failed', error: 'Server unavailable' }); assert.equal(failed.state, 'failed'); assert.equal(failed.busy, false); assert.match(failed.label, /Server unavailable/);
  assert.equal(mineruProgress().state, 'idle'); assert.equal(mineruProgress().percent, null);
  assert.equal(mineruProgress({ documentId: 'a', phase: 'parsing', progress: { extractedPages: 15, totalPages: 10 } }).percent, 100);
});
