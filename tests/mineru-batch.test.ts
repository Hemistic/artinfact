import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { PdfStateStore } from '../src/server/pdf-store.ts';
import { MineruPipeline } from '../src/server/mineru.ts';
import { simplePdf } from './fixtures/simple-pdf.ts';

test('one real batch endpoint handles reordered files and saves successes despite a sibling failure; restart keeps original batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-mineru-batch-'));
  const items = await Promise.all([0, 1, 2].map(async n => {
    const bytes = Buffer.concat([simplePdf(), Buffer.from(`\n% document ${n}\n`)]);
    const sourcePath = join(root, `paper-${n}.pdf`); await writeFile(sourcePath, bytes);
    return { documentId: createHash('sha256').update(bytes).digest('hex'), name: `paper-${n}.pdf`, size: bytes.length, pages: [{ width: 612, height: 792 }], sourcePath };
  }));
  let origin = '', creates = 0, queries = 0, uploadCalls = 0, done = false; const uploads = new Set<string>();
  const archives = items.map((_, n) => zipSync({ 'full.md': strToU8(`# Paper ${n}\n\nOriginal converted body.`), 'content_list.json': strToU8(JSON.stringify([{ type: 'text', text: `Paper ${n}`, text_level: 1, page_idx: 0, bbox: [0, 0, 900, 30] }])) }));
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/mineru/upload-task-batches') {
      creates++; assert.equal(req.headers.authorization, 'Bearer batch-test-key');
      let body = ''; for await (const part of req) body += part; const input = JSON.parse(body);
      assert.deepEqual(input.files.map((f: any) => f.dataId), items.map(i => i.documentId));
      res.end(JSON.stringify({ batchId: 'shared-batch', files: [...items].reverse().map((item, n) => ({ dataId: item.documentId, taskId: `task-${n}`, uploadUrl: origin + '/upload/' + item.documentId })) }));
    } else if (req.method === 'PUT' && req.url?.startsWith('/upload/')) {
      uploadCalls++;
      const id = req.url.slice('/upload/'.length); const item = items.find(i => i.documentId === id)!;
      let bytes = Buffer.alloc(0); for await (const part of req) bytes = Buffer.concat([bytes, part]);
      assert.deepEqual(bytes, await readFile(item.sourcePath)); uploads.add(id); res.end();
    } else if (req.url === '/v1/mineru/upload-task-batches/shared-batch') {
      queries++; if (queries === 1) { res.statusCode = 500; res.end(JSON.stringify({ message: 'fetch failed' })); return; }
      res.end(JSON.stringify({ files: [...items].reverse().map(item => {
        const n = items.indexOf(item); return { dataId: item.documentId, state: done ? n === 1 ? 'failed' : 'done' : 'pending', errMsg: n === 1 ? 'one upstream file failed' : '', zipUrl: origin + '/zip/' + n };
      }) }));
    } else if (req.url?.startsWith('/zip/')) res.end(archives[Number(req.url.slice(5))]);
    else { res.statusCode = 404; res.end(JSON.stringify({ message: 'Single-file endpoint must never be used in this test' })); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const store = new PdfStateStore(root); let pipeline = new MineruPipeline(store);
  try {
    await pipeline.configure({ baseUrl: origin, clientKey: 'batch-test-key' });
    await store.update(items[0].documentId, { annotations: [{ id: 'manual-note', type: 'note', comment: 'Keep' }] });
    const started = await pipeline.startBatch(items); assert.equal(started.jobs.length, 3);
    for (let n = 0; n < 240 && queries < 2; n++) await new Promise(r => setTimeout(r, 25));
    assert.equal(creates, 1); assert.equal(uploads.size, 3); assert.ok(queries >= 2);
    const uploaded = await pipeline.status(items[0].documentId);
    assert.equal(uploaded.uploadStatus, 200); assert.equal(uploaded.uploadedBytes, items[0].size); assert.ok(uploaded.uploadedAt);
    await pipeline.close(); done = true; pipeline = new MineruPipeline(store);
    await Promise.all(items.map(i => pipeline.status(i.documentId)));
    for (let n = 0; n < 180; n++) {
      const states = await Promise.all(items.map(i => pipeline.status(i.documentId)));
      if (states.every(s => ['completed', 'failed'].includes(s.phase))) break;
      await new Promise(r => setTimeout(r, 30));
    }
    const states = await Promise.all(items.map(i => pipeline.status(i.documentId)));
    assert.deepEqual(states.map(s => s.phase), ['completed', 'failed', 'completed']);
    assert.equal(states[1].error, 'one upstream file failed'); assert.equal(creates, 1); assert.equal(uploads.size, 3);
    assert.equal(uploadCalls, 3);
    assert.match((await pipeline.markdown(items[0].documentId, 0, 1000)).text, /Paper 0/);
    assert.match((await pipeline.markdown(items[2].documentId, 0, 1000)).text, /Paper 2/);
    assert.ok((await store.read(items[0].documentId)).annotations.some(a => a.id === 'manual-note'));
    const skipped = await pipeline.startBatch([items[0], items[2]]); assert.equal(skipped.jobs.length, 0); assert.equal(skipped.skipped.length, 2);
    await assert.rejects(pipeline.startBatch([items[1], items[1]]), /重复/);
    await assert.rejects(pipeline.startBatch([{ ...items[1], documentId: 'a'.repeat(64) }]), /匹配/);
    assert.equal(creates, 1);
  } finally { await pipeline.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('explicit restart creates one new batch for queued PDFs, preserves completed results and old task records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-mineru-restart-'));
  const items = await Promise.all([0, 1].map(async n => {
    const bytes = Buffer.concat([simplePdf(), Buffer.from(`\n% retry ${n}\n`)]), sourcePath = join(root, `paper-${n}.pdf`); await writeFile(sourcePath, bytes);
    return { documentId: createHash('sha256').update(bytes).digest('hex'), name: `paper-${n}.pdf`, size: bytes.length, pages: [{ width: 612, height: 792 }], sourcePath };
  }));
  const zip = zipSync({ 'full.md': strToU8('# Actual converted result'), 'content_list.json': strToU8('[]') });
  let origin = '', creates = 0; const submissions: any[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'POST') {
      let body = ''; for await (const part of req) body += part; const input = JSON.parse(body); submissions.push(input); creates++;
      res.end(JSON.stringify({ batchId: `batch-${creates}`, files: input.files.map((f: any) => ({ dataId: f.dataId, uploadUrl: origin + '/upload' })) }));
    } else if (req.method === 'PUT') { for await (const _ of req) {} res.end(); }
    else if (req.url === '/zip') res.end(zip);
    else res.end(JSON.stringify({ files: items.filter(i => req.url?.endsWith('batch-1') || i === items[1]).map((i, n) => ({ dataId: i.documentId, state: req.url?.endsWith('batch-1') && n === 1 ? 'pending' : 'done', zipUrl: origin + '/zip' })) }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const store = new PdfStateStore(root), pipeline = new MineruPipeline(store, undefined, undefined, { batchWatchdogMs: 100 });
  try {
    await pipeline.configure({ baseUrl: origin, clientKey: 'restart-key' }); await pipeline.startBatch(items);
    for (let n = 0; n < 200; n++) { if ((await pipeline.status(items[0].documentId)).phase === 'completed' && (await pipeline.status(items[1].documentId)).upstreamState === 'pending') break; await new Promise(r => setTimeout(r, 25)); }
    await new Promise(r => setTimeout(r, 180));
    const queued = await pipeline.status(items[1].documentId); assert.equal(queued.phase, 'parsing'); assert.equal(queued.upstreamState, 'pending'); assert.ok(queued.warning); assert.ok(queued.upstreamStateSince);
    const prior = JSON.parse(await readFile(join(store.mineruFolder(items[1].documentId), 'job.json'), 'utf8'));
    const plain = await pipeline.startBatch(items); assert.equal(plain.jobs.length, 0); assert.equal(creates, 1);
    const restarted = await pipeline.startBatch(items.map(i => ({ ...i, options: { modelVersion: 'pipeline' as const } })), { restartQueued: true });
    assert.equal(restarted.jobs.length, 1); assert.equal(restarted.skipped.length, 1);
    for (let n = 0; n < 200; n++) { if ((await pipeline.status(items[1].documentId)).phase === 'completed') break; await new Promise(r => setTimeout(r, 25)); }
    assert.equal((await pipeline.status(items[1].documentId)).phase, 'completed'); assert.equal(creates, 2);
    assert.equal(submissions[1].modelVersion, 'pipeline'); assert.deepEqual(submissions[1].files.map((f: any) => f.dataId), [items[1].documentId]);
    const old = JSON.parse(await readFile(join(prior.directory, 'job.json'), 'utf8')); assert.equal(old.batchId, 'batch-1');
    assert.equal((await pipeline.status(items[0].documentId)).batchId, 'batch-1');
    assert.match((await pipeline.markdown(items[0].documentId, 0, 1000)).text, /Actual converted/);
  } finally { await pipeline.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('retrying a batch query failure resumes the saved batch without another POST or upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-mineru-batch-retry-'));
  const bytes = simplePdf(), documentId = createHash('sha256').update(bytes).digest('hex'), sourcePath = join(root, 'paper.pdf'); await writeFile(sourcePath, bytes);
  const item = { documentId, name: 'paper.pdf', size: bytes.length, pages: [{ width: 612, height: 792 }], sourcePath };
  const zip = zipSync({ 'full.md': strToU8('# Original result'), 'content_list.json': strToU8('[]') });
  let origin = '', creates = 0, uploads = 0, recover = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST') { creates++; for await (const _ of req) {} res.end(JSON.stringify({ batchId: 'saved-batch', files: [{ dataId: documentId, uploadUrl: origin + '/upload' }] })); }
    else if (req.method === 'PUT') { uploads++; for await (const _ of req) {} res.end(); }
    else if (req.url === '/zip') res.end(zip);
    else if (!recover) { res.statusCode = 503; res.end(JSON.stringify({ message: 'temporary query failure' })); }
    else res.end(JSON.stringify({ files: [{ dataId: documentId, state: 'done', zipUrl: origin + '/zip' }] }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const store = new PdfStateStore(root); let pipeline = new MineruPipeline(store);
  try {
    await pipeline.configure({ baseUrl: origin, clientKey: 'retry-key' }); await pipeline.startBatch([item]);
    for (let n = 0; n < 150; n++) { if ((await pipeline.status(documentId)).phase === 'failed') break; await new Promise(r => setTimeout(r, 25)); }
    assert.equal((await pipeline.status(documentId)).phase, 'failed'); assert.equal(creates, 1);
    await pipeline.close(); recover = true; pipeline = new MineruPipeline(store); await pipeline.startBatch([item]);
    for (let n = 0; n < 150; n++) { if ((await pipeline.status(documentId)).phase === 'completed') break; await new Promise(r => setTimeout(r, 25)); }
    const state = await pipeline.status(documentId); assert.equal(state.phase, 'completed', state.error);
    assert.equal(creates, 1); assert.equal(uploads, 1);
  } finally { await pipeline.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
