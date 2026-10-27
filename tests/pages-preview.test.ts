import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceLibrary } from '../src/server/workspaces.js';
import { PagesPreviewStore } from '../src/server/pages-preview.js';
import { pageReference, pagesTaskPrompt } from '../src/shared/pages-preview.js';

const pageId = 'page_bac4e4ce94bc819199e10ba296328c69';
const payload = (markdown = '**第一版**', sequence = 0) => ({ pageId, url: `https://chatgpt.com/space/${pageId}`, title: 'Pages 演示', blocks: [{ id: 'block-1', kind: 'markdown' as const, hash: 'a'.repeat(64), markdown }], sequence });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'artinfact-pages-')); const library = new WorkspaceLibrary(() => root); await library.list(); const note = await library.importNote('default', '原文.md', '# 原文\n'); return { root, library, note, store: new PagesPreviewStore(library) }; }

test('Pages preview sync persists independently of local Markdown and rejects stale requests and another Page', async () => {
  const { library, store, note } = await fixture(); const request = await store.begin('default', note.name, 'refresh', pageId);
  await assert.rejects(store.complete('default', note.name, '00000000-0000-4000-8000-000000000000', payload()), /请求/);
  await assert.rejects(store.complete('default', note.name, request.id, { ...payload(), pageId: 'page_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', url: 'https://chatgpt.com/space/page_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), /页面/);
  await store.complete('default', note.name, request.id, payload());
  const restored = await new PagesPreviewStore(library).read('default', note.name); assert.equal(restored.cache?.blocks[0].markdown, '**第一版**'); assert.equal(restored.cache?.sequence, 0); assert.equal((await library.readNote('default', note.name)).text, '# 原文\n');
  const newer = await store.begin('default', note.name, 'refresh'); await store.complete('default', note.name, newer.id, payload('第二版', 3));
  const stale = await store.begin('default', note.name, 'refresh'); await assert.rejects(store.complete('default', note.name, stale.id, payload('倒退', 2)), /旧版本/);
  await store.fail('default', note.name, stale.id, '访问失败'); assert.equal((await store.read('default', note.name)).cache?.blocks[0].markdown, '第二版');
});

test('Pages create retries reuse pending request, replay is idempotent and workspace isolation is enforced', async () => {
  const { root, library, store, note } = await fixture(); const request = await store.begin('default', note.name, 'create');
  assert.equal((await store.begin('default', note.name, 'create')).id, request.id); assert.match(pagesTaskPrompt('default', note.name, request), /pdf_pages_request_read/); assert.match(pagesTaskPrompt('default', note.name, request), /不执行/);
  const w = await library.create('其他区'); await library.importNote(w.id, note.name, '另一个笔记'); await assert.rejects(store.complete(w.id, note.name, request.id, payload()), /请求/);
  await store.complete('default', note.name, request.id, payload()); await store.complete('default', note.name, request.id, payload());
  await assert.rejects(store.complete('default', note.name, request.id, payload('被替换', 1)), /请求/);
  await assert.rejects(store.begin('default', '../越界.md', 'refresh', pageId));
  await writeFile(join(root, 'workspaces/default/notes/原文.md'), '本机新内容'); assert.equal((await store.read('default', note.name)).localChanged, true);
  assert.equal((await readFile(join(root, 'workspaces/default/notes/原文.md'), 'utf8')), '本机新内容');
});

test('Pages references only allow canonical authorized links', () => {
  assert.deepEqual(pageReference(`https://chatgpt.com/space/${pageId}`), { pageId, url: `https://chatgpt.com/space/${pageId}` });
  for (const ref of ['https://evil.example/space/' + pageId, 'https://chatgpt.com.evil.example/space/' + pageId, 'javascript:alert(1)']) assert.throws(() => pageReference(ref));
});
