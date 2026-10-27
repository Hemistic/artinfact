import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineruFailure } from '../src/shared/mineru-failure.ts';

test('a VLM upstream parsing failure offers an explicit Pipeline retry', () => {
  const value = mineruFailure({ documentId: 'a', phase: 'failed', modelVersion: 'vlm', error: 'parsing failed, please try again later' });
  assert.equal(value.canRetryPipeline, true); assert.match(value.message, /VLM/); assert.match(value.message, /Pipeline/);
  assert.equal(value.detail, 'parsing failed, please try again later');
});
test('Pipeline, connection and permission failures do not trigger automatic or misleading engine retries', () => {
  for (const [modelVersion, error] of [['pipeline', 'parsing failed'], ['vlm', 'Invalid client key'], ['vlm', 'Server unavailable']] as const) assert.equal(mineruFailure({ documentId: 'a', phase: 'failed', modelVersion, error }).canRetryPipeline, false);
  assert.equal(mineruFailure({ documentId: 'a', phase: 'completed', modelVersion: 'vlm' }).canRetryPipeline, false);
});
