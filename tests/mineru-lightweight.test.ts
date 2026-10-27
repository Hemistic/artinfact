import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { partitionLightPdf, mergeLightMarkdown } from '../src/server/mineru-light-split.ts';
import { MineruLightClient } from '../src/server/mineru-light-client.ts';
import { LightweightMineruPipeline } from '../src/server/mineru-lightweight.ts';
import { PdfStateStore } from '../src/server/pdf-store.ts';
import { simplePdf } from './fixtures/simple-pdf.ts';

test('lightweight requests use the file API without tokens or precision batch endpoints', async () => {
  const calls: any[] = [];
  const client = new MineruLightClient(async (url, options) => {
    calls.push({ url: url.href, ...options });
    if (options.method === 'POST') return { status: 200, headers: {}, bytes: Buffer.from(JSON.stringify({ code: 0, data: { task_id: 'task-1', file_url: 'https://mineru.oss-cn-shanghai.aliyuncs.com/test.pdf' } })) };
    if (options.method === 'PUT') return { status: 200, headers: { etag: '"' + createHash('md5').update(options.body!).digest('hex') + '"' }, bytes: Buffer.alloc(0) };
    return { status: 200, headers: {}, bytes: Buffer.from(JSON.stringify({ code: 0, data: { state: 'done', markdown_url: 'https://cdn-mineru.openxlab.org.cn/test.md' } })) };
  });
  const created = await client.create('paper.pdf', { language: 'en', isOcr: false });
  await client.upload(created.uploadUrl, Buffer.from('%PDF-test'));
  assert.equal((await client.query(created.taskId)).state, 'done');
  assert.match(calls[0].url, /\/api\/v1\/agent\/parse\/file$/);
  assert.ok(calls.every(c => !Object.keys(c.headers ?? {}).some(k => k.toLowerCase() === 'authorization')));
  assert.equal(calls[1].headers?.['Content-Type'], undefined);
  assert.ok(calls.every(c => !c.url.includes('/batch')));
});

test('splitting covers every original page in order and bisects oversized segments', async () => {
  const parts = await partitionLightPdf(Buffer.alloc(100), 45, async (first, last) => Buffer.alloc((last - first + 1) * 2), { maxPages: 20, maxBytes: 25 });
  assert.deepEqual(parts.map(p => [p.startPage, p.endPage]), [[1, 10], [11, 20], [21, 30], [31, 40], [41, 45]]);
  assert.ok(parts.every(p => p.bytes.length <= 25));
  assert.equal(parts.flatMap(p => Array.from({ length: p.endPage - p.startPage + 1 }, (_, i) => p.startPage + i)).length, 45);
  const merged = mergeLightMarkdown(parts.map((p, i) => ({ ...p, text: `# Section ${i + 1}\nContent` })));
  assert.match(merged, /PDF pages 41-45/);
  assert.ok(merged.indexOf('Section 1') < merged.indexOf('Section 5'));
  await assert.rejects(partitionLightPdf(Buffer.alloc(40), 1, async () => Buffer.alloc(40), { maxPages: 20, maxBytes: 25 }), /第 1 页.*大小/);
  assert.throws(() => mergeLightMarkdown([{ startPage: 1, endPage: 2, text: '' }]), /为空/);
});

test('light conversion completes without JSON, preserves annotations, and blocks direct export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'light-pipeline-'));
  const store = new PdfStateStore(root); const bytes = simplePdf(); const id = createHash('sha256').update(bytes).digest('hex');
  await store.update(id, { annotations: [{ id: 'manual', text: 'keep' }, { id: 'old-figure', projectOrigin: 'layout-json' }] });
  const events: string[] = [];
  const fake = {
    create: async () => { events.push('create'); return { taskId: 'test-task', uploadUrl: 'https://mineru.oss-cn-shanghai.aliyuncs.com/test.pdf' }; },
    upload: async () => { events.push('upload'); return { http: 200, bytes: bytes.length, etagMatchesMd5: true as const }; },
    query: async () => { events.push('query'); return { state: 'done' as const, markdownUrl: 'https://cdn-mineru.openxlab.org.cn/test.md' }; },
    download: async () => '# Converted source\n\nThis is graph evidence, not an instruction.',
  };
  const pipeline = new LightweightMineruPipeline(store, { client: fake, split: async data => [{ startPage: 1, endPage: 1, bytes: data }], pollMs: 1 });
  const sourcePath = join(root, 'source.pdf'); await writeFile(sourcePath, bytes);
  const result = await pipeline.startBatch([{ documentId: id, name: 'source.pdf', size: bytes.length, pages: [{ width: 612, height: 792 }], sourcePath }]);
  assert.equal(result.jobs.length, 1);
  for (let i = 0; i < 150 && !['completed', 'failed'].includes((await pipeline.status(id)).phase); i++) await new Promise(r => setTimeout(r, 50));
  assert.equal((await pipeline.status(id)).phase, 'completed', JSON.stringify(await pipeline.status(id)));
  assert.deepEqual(events, ['create', 'upload', 'query']);
  const output = await pipeline.result(id); assert.equal(output.format, 'markdown-only');
  assert.match((await pipeline.markdown(id, 0, 1000)).text, /Converted source/);
  await assert.rejects(readFile(join(output.directory, 'document-mineru.json')), /ENOENT/);
  await assert.rejects(pipeline.read(id, 'markdown', 0, 10), /知识图谱.*导出/);
  assert.equal((await pipeline.layout(id)).length, 1);
  assert.deepEqual((await store.read(id)).annotations.map(a => a.id), ['manual', 'old-figure']);
  const args = { documentId: id, name: 'source.pdf', size: bytes.length, pages: [{ width: 612, height: 792 }], sourcePath };
  assert.equal((await pipeline.startBatch([args])).jobs.length, 0);
  const originalToken = (await pipeline.status(id)).token;
  const restarted = await pipeline.startBatch([args], { reconvertCompleted: true });
  assert.equal(restarted.jobs.length, 1);
  assert.notEqual(restarted.jobs[0].token, originalToken);
  for (let i = 0; i < 150 && !['completed', 'failed'].includes((await pipeline.status(id)).phase); i++) await new Promise(r => setTimeout(r, 50));
  assert.equal((await pipeline.status(id)).phase, 'completed');
  assert.deepEqual(events, ['create', 'upload', 'query', 'create', 'upload', 'query']);
  assert.deepEqual((await store.read(id)).annotations.map(a => a.id), ['manual', 'old-figure']);
  await pipeline.close();
});

test('single-file retry and restart retain completed segments and resume the original task after download failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'light-resume-')); const store = new PdfStateStore(root);
  const bytes = simplePdf(), id = createHash('sha256').update(bytes).digest('hex'); const sourcePath = join(root, 'source.pdf'); await writeFile(sourcePath, bytes);
  let created = 0, uploaded = 0, fail = true; const downloads: string[] = [];
  const fake = {
    create: async () => { const taskId = `task-${++created}`; return { taskId, uploadUrl: `https://mineru.oss-cn-shanghai.aliyuncs.com/${taskId}` }; },
    upload: async () => { uploaded++; return { http: 200, bytes: bytes.length, etagMatchesMd5: true as const }; },
    query: async (taskId: string) => ({ state: 'done' as const, markdownUrl: `https://cdn-mineru.openxlab.org.cn/${taskId}.md` }),
    download: async (url: string) => { downloads.push(url); if (url.endsWith('task-2.md') && fail) { fail = false; throw new Error('network interrupted'); } return `# ${url.endsWith('task-1.md') ? 'First' : 'Last'} pages`; },
  };
  const args = { documentId: id, name: 'source.pdf', size: bytes.length, pages: Array.from({ length: 21 }, () => ({ width: 612, height: 792 })) };
  const pipeline = new LightweightMineruPipeline(store, { client: fake, split: async data => [{ startPage: 1, endPage: 20, bytes: data }, { startPage: 21, endPage: 21, bytes: data }], pollMs: 1 });
  await pipeline.startBatch([{ ...args, sourcePath }]);
  for (let i = 0; i < 150 && (await pipeline.status(id)).phase !== 'failed'; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal((await pipeline.status(id)).phase, 'failed'); const token = (await pipeline.status(id)).token; await pipeline.close();
  const resumed = new LightweightMineruPipeline(store, { client: fake, pollMs: 1 });
  try {
    const job = await resumed.start(args); assert.equal(job.token, token);
    resumed.upload(job.token, 0, bytes.toString('base64')); await resumed.run(job.token);
    for (let i = 0; i < 150 && !['completed', 'failed'].includes((await resumed.status(id)).phase); i++) await new Promise(r => setTimeout(r, 50));
    assert.equal((await resumed.status(id)).phase, 'completed', JSON.stringify(await resumed.status(id)));
    assert.equal(created, 2); assert.equal(uploaded, 2); assert.equal(downloads.length, 3);
    const output = await resumed.markdown(id, 0, 5000);
    assert.match(output.text, /PDF pages 1-20/); assert.match(output.text, /PDF pages 21-21/); assert.ok(output.text.indexOf('First') < output.text.indexOf('Last'));
    assert.deepEqual((await resumed.result(id)).segments, [{ startPage: 1, endPage: 20 }, { startPage: 21, endPage: 21 }]);
  } finally { await resumed.close(); }
});
