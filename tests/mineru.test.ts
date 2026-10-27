import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { PdfStateStore } from '../src/server/pdf-store.ts';
import { MineruPipeline } from '../src/server/mineru.ts';
import { simplePdf } from './fixtures/simple-pdf.ts';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const blocks = [
  { type: 'text', text: 'Paper', text_level: 1, page_idx: 0, bbox: [50, 0, 950, 15] },
  { type: 'text', text: '1 Introduction', text_level: 1, page_idx: 0, bbox: [50, 20, 950, 60] },
  { type: 'text', text: 'Body paragraph cites [1].', page_idx: 0, bbox: [50, 100, 950, 180] },
  { type: 'image', img_path: 'images/figure.png', image_caption: ['Figure 1. Original chart'], page_idx: 0, bbox: [100, 200, 500, 450] },
  { type: 'table', img_path: 'images/table.png', table_caption: ['Table 1. Results'], table_body: '<table><tr><td>Accuracy</td><td>99%</td></tr></table>', page_idx: 0, bbox: [100, 500, 800, 800] },
  { type: 'text', text: 'References', text_level: 1, page_idx: 0, bbox: [50, 850, 950, 900] },
  { type: 'ref_text', text: '[1] Reference source', page_idx: 0, bbox: [50, 920, 950, 1000] },
];

test('MinerU server protocol produces Markdown, figure/table frames and injectable structure without overwriting manual annotations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-mineru-'));
  const bytes = simplePdf(); const id = createHash('sha256').update(bytes).digest('hex');
  const archive = zipSync({ 'full.md': strToU8('# Full source Markdown\n\n' + 'Complete body text with links and formulas. '.repeat(10)), 'content_list.json': strToU8(JSON.stringify(blocks)), 'images/figure.png': image, 'images/table.png': image });
  let origin = ''; const calls: string[] = []; let created = 0; let submitted: any;
  const server = createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url === '/v1/mineru/upload-tasks' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer local-test-key'); created++;
      let body = ''; for await (const part of req) body += part; submitted = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ batchId: 'task-1', uploadUrl: origin + '/upload' }));
    } else if (req.url === '/upload') { let uploaded = Buffer.alloc(0); for await (const part of req) uploaded = Buffer.concat([uploaded, part]); assert.deepEqual(uploaded, bytes); res.end(); }
    else if (req.url === '/v1/mineru/upload-tasks/task-1') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ state: 'done', zipUrl: origin + '/result.zip' })); }
    else if (req.url === '/result.zip') res.end(archive);
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const store = new PdfStateStore(root); const pipeline = new MineruPipeline(store);
  try {
    await pipeline.configure({ baseUrl: origin, clientKey: 'local-test-key' });
    assert.equal(JSON.stringify(await pipeline.settings()).includes('local-test-key'), false);
    await store.update(id, { annotations: [{ id: 'manual', type: 'note', comment: 'Keep me' }] });
    const job = await pipeline.start({ documentId: id, name: 'Paper.pdf', size: bytes.length, pages: [{ width: 612, height: 792 }], outline: [] });
    pipeline.upload(job.token, 0, bytes.toString('base64')); await pipeline.run(job.token);
    for (let n = 0; n < 150; n++) { const status = await pipeline.status(id); if (status.phase === 'completed' || status.phase === 'failed') break; await new Promise(r => setTimeout(r, 40)); }
    const status = await pipeline.status(id); assert.equal(status.phase, 'completed', status.error);
    assert.equal(status.figures, 1); assert.equal(status.tables, 1); assert.equal(created, 1);
    assert.equal(submitted.fileName, 'Paper.pdf'); assert.equal(submitted.dataId, id);
    const saved = await store.read(id); assert.ok(saved.annotations.some(a => a.id === 'manual'));
    const figure = saved.annotations.find(a => a.layoutKind === 'figure')!;
    const rect = (figure.position as { rects: number[][] }).rects[0];
    [61.2, 435.6, 306, 633.6].forEach((expected, index) => assert.ok(Math.abs(rect[index] - expected) < 1e-8));
    const restored = new MineruPipeline(store);
    assert.equal((await restored.status(id)).phase, 'completed');
    const tree = await restored.tree(id); assert.ok(tree.stats.sectionCount > 0);
    const find = (nodes: typeof tree.children, kind: string): typeof tree.children[number] | undefined => { for (const n of nodes) { if (n.type === kind) return n; } };
    const section = tree.children.find(n => n.type === 'section')!;
    const children = (await restored.tree(id, section.id)).children;
    const table = find(children, 'table')!; assert.ok(table);
    const context = await restored.node(id, table.id); assert.match(JSON.stringify(context), /99%/); assert.ok(context.content.some(c => c.type === 'image'));
    assert.ok(context.structuredContent.position);
    assert.equal(context.structuredContent.displayLabel, '已选择表格 1 个');
    const references = await restored.references(id, 'Selected paragraph [1,9].');
    assert.deepEqual(references.citationTexts, ['[1] Reference source']);
    assert.deepEqual(references.missingCitationNumbers, ['9']);
    const md = await restored.markdown(id, 20, 30); assert.equal(md.text.length, 30); assert.equal(md.nextOffset, 50);
    await store.update(id, { annotations: [{ ...figure, id: 'stale-box' }] });
    await restored.layout(id); assert.ok(!(await store.read(id)).annotations.some(a => a.id === 'stale-box'));
    assert.ok((await store.read(id)).annotations.some(a => a.id === 'manual'));
    const result = await restored.read(id, 'bundle', 0, 768 * 1024);
    const extracted = unzipSync(Buffer.from(result.data, 'base64')); assert.ok(extracted['images/figure.png']); assert.ok(extracted['Paper-mineru.md']);
    assert.match(Buffer.from((await restored.read(id, 'markdown', 0, 100000)).data, 'base64').toString(), /Full source Markdown/);
    assert.deepEqual(calls, ['POST /v1/mineru/upload-tasks', 'PUT /upload', 'GET /v1/mineru/upload-tasks/task-1', 'GET /result.zip']);
    assert.ok((await readFile(join(root, 'mineru-settings.json'), 'utf8')).includes('local-test-key'));
  } finally { await pipeline.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('an interrupted worker resumes the same Server batch without creating a second billable task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-mineru-resume-')); const store = new PdfStateStore(root);
  const bytes = simplePdf(); const id = createHash('sha256').update(bytes).digest('hex'); let done = false; let creates = 0; let uploads = 0; let origin = '';
  const archive = zipSync({ 'full.md': strToU8('# Paper\n\n# Introduction\n\n' + 'Original content. '.repeat(40)), 'content_list.json': strToU8(JSON.stringify(blocks)), 'images/figure.png': image, 'images/table.png': image });
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { creates++; for await (const _ of req) { /* Consume request. */ } res.end(JSON.stringify({ batchId: 'resume-batch', uploadUrl: origin + '/upload' })); }
    else if (req.method === 'PUT') { uploads++; for await (const _ of req) { /* Consume upload. */ } res.end(); }
    else if (req.url === '/zip') res.end(archive);
    else res.end(JSON.stringify(done ? { state: 'done', zipUrl: origin + '/zip' } : { state: 'pending' }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let pipeline = new MineruPipeline(store);
  try {
    await pipeline.configure({ baseUrl: origin, clientKey: 'resume-key' }); const task = await pipeline.start({ documentId: id, name: 'Paper.pdf', size: bytes.length, pages: [{ width: 612, height: 792 }] });
    pipeline.upload(task.token, 0, bytes.toString('base64')); await pipeline.run(task.token);
    for (let n = 0; n < 100; n++) { const status = await pipeline.status(id); if (status.batchId && status.upstreamState === 'pending') break; await new Promise(r => setTimeout(r, 25)); }
    const queued = await pipeline.status(id);
    assert.equal(queued.phase, 'parsing'); assert.equal(queued.upstreamState, 'pending'); assert.match(queued.label!, /云端排队/); assert.equal(queued.progress, undefined);
    await pipeline.close(); done = true;
    pipeline = new MineruPipeline(store);
    for (let n = 0; n < 100; n++) { const status = await pipeline.status(id); if (['completed', 'failed'].includes(status.phase)) break; await new Promise(r => setTimeout(r, 40)); }
    const status = await pipeline.status(id); assert.equal(status.phase, 'completed', status.error); assert.equal(creates, 1); assert.equal(uploads, 1);
  } finally { await pipeline.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('incomplete or mismatched PDF chunks never create a remote conversion task', async () => {
  const pipeline = new MineruPipeline(new PdfStateStore(await mkdtemp(join(tmpdir(), 'codex-mineru-hash-'))));
  await pipeline.configure({ baseUrl: 'http://127.0.0.1:1', clientKey: 'test' });
  const bytes = simplePdf(); const job = await pipeline.start({ documentId: 'a'.repeat(64), name: 'x.pdf', size: bytes.length, pages: [{ width: 612, height: 792 }] });
  await assert.rejects(pipeline.run(job.token), /完整/);
  assert.throws(() => pipeline.upload(job.token, 1, bytes.toString('base64')), /顺序/);
  pipeline.upload(job.token, 0, bytes.toString('base64'));
  await assert.rejects(pipeline.run(job.token), /不匹配/);
  await pipeline.close();
});
