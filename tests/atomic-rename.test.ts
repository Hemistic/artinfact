import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameWithRetry } from '../src/server/atomic-rename.ts';

test('transient Windows file locks are retried without deleting the destination', async () => {
  const attempts: string[][] = []; const delays: number[] = [];
  await renameWithRetry('new.tmp', 'job.json', {
    rename: async (source, target) => { attempts.push([source, target]); if (attempts.length < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' }); },
    sleep: async delay => { delays.push(delay); },
  });
  assert.deepEqual(attempts, Array.from({ length: 3 }, () => ['new.tmp', 'job.json']));
  assert.deepEqual(delays, [25, 50]);
});

test('permanent errors fail immediately and file lock retries have a bound', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' }); let attempts = 0;
  await assert.rejects(renameWithRetry('new.tmp', 'job.json', { rename: async () => { attempts++; throw missing; }, sleep: async () => {} }), error => error === missing);
  assert.equal(attempts, 1);
  const locked = Object.assign(new Error('locked'), { code: 'EBUSY' }); attempts = 0;
  await assert.rejects(renameWithRetry('new.tmp', 'job.json', { rename: async () => { attempts++; throw locked; }, sleep: async () => {} }), error => error === locked);
  assert.equal(attempts, 7);
});
