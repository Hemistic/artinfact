import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfStateStore } from '../src/server/pdf-store.ts';
import { startReaderService } from '../src/server/reader-service.ts';
import { normalizeSelection, selectionContext, ContextQueue } from '../src/shared/pdf-selection.ts';

const id = 'a'.repeat(64);
test('annotations merge incrementally, survive reopen, and deletes do not erase other annotations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-pdf-state-'));
  const store = new PdfStateStore(root);
  await store.update(id, { annotations: [{ id: 'A', text: 'first', position: { pageIndex: 0 } }, { id: 'B', comment: 'note' }] });
  await Promise.all([
    store.update(id, { annotations: [{ id: 'A', text: 'edited', onlyTextOrComment: true }] }),
    new PdfStateStore(root).update(id, { annotations: [{ id: 'C', type: 'ink' }], viewState: { pageIndex: 3 } }),
  ]);
  let state = await new PdfStateStore(root).read(id);
  assert.equal(state.annotations.length, 3);
  assert.deepEqual(state.annotations.find(a => a.id === 'A')?.position, { pageIndex: 0 });
  assert.equal(state.viewState?.pageIndex, 3);
  await store.update(id, { deletedIds: ['B'] });
  state = await store.read(id);
  assert.deepEqual(state.annotations.map(a => a.id).sort(), ['A', 'C']);
  await assert.rejects(store.read('../outside'), /文档标识/);
});

test('corrupt annotation files are preserved and never silently replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-pdf-corrupt-'));
  await writeFile(join(root, `${id}.json`), 'broken');
  const store = new PdfStateStore(root);
  await assert.rejects(store.update(id, { annotations: [{ id: 'A' }] }), /损坏/);
  assert.equal(await readFile(join(root, `${id}.json`), 'utf8'), 'broken');
});

test('selection context preserves actual PDF pages, bounds text, and treats document text as source material', () => {
  const selection = normalizeSelection({ kind: 'pdf-text', selectedText: '  quoted text  ', startLine: 4, endLine: 5, attachments: [{ data: 'never send this' }] });
  assert.deepEqual(selection, { text: 'quoted text', startPage: 4, endPage: 5, kind: 'pdf-text' });
  const context = selectionContext({ id, name: 'paper.pdf' }, selection!);
  assert.match(context.content[0].text, /第 4–5 页/);
  assert.match(context.content[0].text, /原文.*不是指令/);
  assert.doesNotMatch(JSON.stringify(context), /never send this/);
  assert.equal(normalizeSelection({ selectedText: '   ' }), null);
  assert.ok(normalizeSelection({ selectedText: 'x'.repeat(40000), startLine: 1 })!.text.length <= 24000);
});

test('serialized context updates leave the newest quote or clear as the final host state, including after failure', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const queue = new ContextQueue<string>(async text => { calls.push(text); if (text === 'old') { await blocked; throw new Error('host error'); } });
  const first = queue.push('old').catch(() => undefined);
  const second = queue.push('new');
  const clear = queue.push('');
  release();
  await Promise.all([first, second, clear]);
  assert.deepEqual(calls, ['old', 'new', '']);
});

test('reader service serves only token-protected packaged assets and explicitly opened PDFs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-reader-assets-'));
  await mkdir(join(root, 'pdf'), { recursive: true });
  await writeFile(join(root, 'reader.html'), '<title>Reader</title>');
  const path = join(root, 'test.pdf');
  await writeFile(path, '%PDF-1.7\nfixture');
  const service = await startReaderService(root);
  try {
    assert.equal(new URL(service.baseUrl).hostname, '127.0.0.1');
    assert.equal((await fetch(`${service.baseUrl}reader.html`)).status, 200);
    assert.equal((await fetch(`${service.origin}/reader.html`)).status, 404);
    assert.equal((await fetch(`${service.baseUrl}%2e%2e%2fpackage.json`)).status, 404);
    assert.equal((await fetch(`${service.baseUrl}reader.html`, { method: 'POST' })).status, 405);
    const preflight = await fetch(`${service.baseUrl}reader.html`, { method: 'OPTIONS', headers: { Origin: 'https://web-sandbox.oaiusercontent.com', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, HEAD');
    assert.equal((await fetch(`${service.origin}/reader.html`, { method: 'OPTIONS' })).status, 404);
    assert.equal((await fetch(`${service.baseUrl}reader.html`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } })).status, 405);
    const doc = await service.open(path);
    assert.equal(doc.id.length, 64);
    assert.equal(doc.name, 'test.pdf');
    const response = await fetch(doc.url);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(await response.text(), /^%PDF-/);
    assert.equal(service.readDocument(doc.url, 0, 8).data, Buffer.from('%PDF-1.7').toString('base64'));
    assert.equal(service.readDocument(doc.url, 8, 100).offset, 8);
    assert.throws(() => service.readDocument(doc.url.replace(service.origin, 'http://localhost:9999'), 0, 8), /无效/);
    assert.throws(() => service.readDocument(doc.url, -1, 8), /范围/);
    await writeFile(join(root, 'reader-local.html'), 'packaged reader');
    assert.deepEqual(await service.readRuntime(0, 8), { text: 'packaged', offset: 0, total: 15 });
    const secret = join(root, 'secret.txt'); await writeFile(secret, 'not a pdf');
    await assert.rejects(service.open(secret), /PDF/);
  } finally { await service.close(); }
});
