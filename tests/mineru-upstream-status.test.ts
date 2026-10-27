import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineruUpstreamStatus } from '../src/shared/mineru-upstream-status.ts';
import { mineruProgress } from '../src/shared/mineru-progress.ts';

test('queued upstream tasks never claim to be parsing or show stale page progress', () => {
  const status = mineruUpstreamStatus({ state: 'pending', progress: { extractedPages: 9, totalPages: 10 } });
  assert.equal(status.upstreamState, 'pending');
  assert.match(status.label!, /云端排队/);
  assert.equal(status.progress, undefined);
  assert.equal(status.phase, 'parsing');
  const ring = mineruProgress({ documentId: 'test', ...status, progress: { extractedPages: 9, totalPages: 10 } });
  assert.equal(ring.percent, null); assert.equal(ring.indeterminate, true); assert.match(ring.label, /云端排队/);
});

test('the upstream processing stages distinguish upload, parsing, conversion and download', () => {
  assert.match(mineruUpstreamStatus({ state: 'waiting-file' }).label!, /等待接收/);
  assert.equal(mineruUpstreamStatus({ state: 'waiting-file' }).phase, 'parsing');
  const progress = { extractedPages: 2, totalPages: 26 };
  assert.deepEqual(mineruUpstreamStatus({ state: 'running', progress }).progress, progress);
  assert.match(mineruUpstreamStatus({ state: 'running' }).label!, /正在解析/);
  assert.match(mineruUpstreamStatus({ state: 'converting' }).label!, /生成 Markdown/);
  assert.equal(mineruUpstreamStatus({ state: 'done' }).phase, 'downloading');
  assert.match(mineruUpstreamStatus({ state: 'unknown-new-state' }).label!, /查询/);
  assert.equal(mineruUpstreamStatus({}).upstreamState, undefined);
});
