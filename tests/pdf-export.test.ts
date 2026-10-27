import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PdfExporter } from '../src/server/pdf-export.ts';
import { PdfStateStore, type PdfPatch } from '../src/server/pdf-store.ts';
import { simplePdf } from './fixtures/simple-pdf.ts';

test('export embeds persisted annotations in a new PDF without modifying source bytes', async () => {
  const source = simplePdf();
  const id = createHash('sha256').update(source).digest('hex');
  const store = new PdfStateStore(await mkdtemp(join(tmpdir(), 'codex-export-test-')));
  const base = { color: '#ffd400', authorName: 'Test', comment: 'Exported note', dateModified: '2026-10-01T00:00:00Z', position: { pageIndex: 0, rects: [[72, 670, 194, 692]] } };
  const annotations: PdfPatch['annotations'] = ['note', 'highlight', 'underline', 'image', 'text'].map(type => ({ ...base, id: `TEST-${type}`, type, position: { ...base.position, rotation: 0, fontSize: 12 } }));
  annotations.push({ ...base, id: 'TEST-ink', type: 'ink', position: { pageIndex: 0, width: 2, paths: [[72, 670, 94, 692]] } });
  await store.update(id, { annotations });
  const exporter = new PdfExporter(store, new URL('../dist/server/pdf-export-worker.js', import.meta.url));
  const job = exporter.start(id, source.length);
  assert.throws(() => exporter.upload(job, 1, source.toString('base64')), /顺序/);
  exporter.upload(job, 0, source.toString('base64'));
  const size = await exporter.finish(job);
  const exported = Buffer.from(exporter.read(job, 0, size).data, 'base64');
  assert.match(exported.toString('latin1'), /%PDF-/);
  assert.match(exported.toString('latin1'), /\/Subtype\s*\/Text/);
  for (const type of ['Highlight', 'Underline', 'Square', 'FreeText', 'Ink']) assert.match(exported.toString('latin1'), new RegExp('/Subtype\\s*/'+type));
  assert.match(exported.toString('latin1'), /Exported note/);
  assert.ok(!source.includes(Buffer.from('Exported note')));
  exporter.release(job);
  assert.throws(() => exporter.read(job, 0, 10), /不存在/);
});

test('export rejects a PDF whose content does not match the annotation document', async () => {
  const store = new PdfStateStore(await mkdtemp(join(tmpdir(), 'codex-export-hash-')));
  const exporter = new PdfExporter(store);
  const bytes = Buffer.from('%PDF-1.7\nwrong file');
  const job = exporter.start('a'.repeat(64), bytes.length);
  exporter.upload(job, 0, bytes.toString('base64'));
  await assert.rejects(exporter.finish(job), /不匹配/);
  assert.throws(() => exporter.start('bad', bytes.length), /标识/);
  assert.throws(() => exporter.start('a'.repeat(64), 65 * 1024 * 1024), /64 MB/);
});
