import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceProgress } from '../src/shared/workspace-progress.ts';
test('workspace progress reports completed documents separately from queue and known parsed page progress', () => {
  const value = workspaceProgress([
    { documentId: 'a', phase: 'completed' }, { documentId: 'b', phase: 'parsing', upstreamState: 'pending', progress: { extractedPages: 7, totalPages: 10 } },
    { documentId: 'c', phase: 'parsing', upstreamState: 'running', progress: { extractedPages: 3, totalPages: 12 } }, { documentId: 'd', phase: 'failed', error: 'failure' }, { documentId: 'e', phase: 'idle' },
  ]);
  assert.equal(value.completed, 1); assert.equal(value.queued, 1); assert.equal(value.active, 2); assert.equal(value.failed, 1); assert.equal(value.total, 5);
  assert.equal(value.items[1].percent, null); assert.match(value.items[1].label, /排队/); assert.equal(value.items[2].percent, 25);
});
