import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMineruRateLimit } from '../src/server/mineru-rate-limit.js';

test('Server throttling waits the requested interval and retries the same operation', async () => {
  let calls = 0; const waits: number[] = [];
  const batch = await withMineruRateLimit(async () => {
    calls++;
    if (calls <= 2) throw Error(`Too many requests for this API key. Retry in ${calls === 1 ? 2 : 10} seconds.`);
    return 'existing-batch';
  }, () => undefined, async ms => { waits.push(ms); });
  assert.equal(batch, 'existing-batch'); assert.equal(calls, 3); assert.deepEqual(waits, [3000, 11000]);
});

test('parsing, authentication and persistent rate errors remain bounded', async () => {
  for (const message of ['parsing failed', 'Unauthorized', 'HTTP 500']) {
    let calls = 0;
    await assert.rejects(withMineruRateLimit(async () => { calls++; throw Error(message); }, () => undefined, async () => undefined), new RegExp(message));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(withMineruRateLimit(async () => { calls++; throw Error('Too many requests for this API key. Retry in 1 seconds.'); }, () => undefined, async () => undefined), /Too many requests/);
  assert.equal(calls, 4);
});
