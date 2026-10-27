import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfStateStore } from '../src/server/pdf-store.ts';

test('native PDF sidebar selection survives closing and reopening a document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-workspace-'));
  try {
    const store = new PdfStateStore(root);
    await store.update('a'.repeat(64), { sidebar: { open: true, view: 'pdfs' } });
    assert.deepEqual((await new PdfStateStore(root).read('a'.repeat(64))).sidebar, { open: true, view: 'pdfs' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
