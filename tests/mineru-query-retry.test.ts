import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMineruQueryRetry } from '../src/server/mineru-query-retry.ts';
test('a transient query fetch failure backs off and keeps the same original batch', async () => {
  let queries = 0; const waits: number[] = [];
  const result = await withMineruQueryRetry(async () => { if (++queries < 3) throw new TypeError('fetch failed'); return { batchId: 'original', state: 'pending' }; }, () => {}, async ms => { waits.push(ms); });
  assert.equal(result.batchId, 'original'); assert.equal(queries, 3); assert.deepEqual(waits, [2000, 4000]);
});
test('permanent authentication or upstream parsing failures are not retried; network retries are bounded', async () => {
  for (const error of ['Invalid client key.', 'parsing failed, please try again later']) {
    let queries = 0; await assert.rejects(withMineruQueryRetry(async () => { queries++; throw Error(error); }, () => {}, async () => {})); assert.equal(queries, 1);
  }
  let queries = 0; await assert.rejects(withMineruQueryRetry(async () => { queries++; throw new TypeError('fetch failed'); }, () => {}, async () => {})); assert.equal(queries, 5);
});
