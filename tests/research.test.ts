import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfStateStore } from '../src/server/pdf-store.ts';
import { WorkspaceLibrary } from '../src/server/workspaces.ts';
import { ResearchWiki } from '../src/server/research-wiki.ts';

test('AI replacements preserve concurrent manual annotations, MinerU boxes, view and the other analysis scope', async () => {
  const store = new PdfStateStore(await mkdtemp(join(tmpdir(), 'research-state-')));
  const id = 'a'.repeat(64);
  await store.update(id, { annotations: [{ id: 'manual' }, { id: 'figure', mineruType: 'image' }], viewState: { pageIndex: 2 } });
  await store.updateResearch(id, { aiOutline: { items: [{ id: 'chapter' }] } });
  await Promise.all([store.update(id, { annotations: [{ id: 'new-user' }] }), store.updateResearch(id, { aiInsights: [{ id: 'insight', aiInsightKind: 'innovation' }], aiInsightMeta: { status: 'ready' } })]);
  let state = await store.read(id); assert.equal(state.annotations.length, 4); assert.equal(state.viewState?.pageIndex, 2); assert.equal((state.aiOutline?.items as any[]).length, 1);
  await store.updateResearch(id, { aiOutline: { status: 'cleared', items: [] } });
  assert.equal((await store.read(id)).annotations.length, 4);
  await store.updateResearch(id, { aiInsights: [] }); state = await store.read(id);
  assert.deepEqual(state.annotations.map(a => a.id).sort(), ['figure', 'manual', 'new-user']);
  await assert.rejects(store.updateResearch(id, { aiInsights: [{ id: 'manual', aiInsightKind: 'evidence' }] }), /冲突/);
});

test('original Wiki graph renders real links, survives reopening, rejects stale edits and workspace escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-wiki-')); const library = new WorkspaceLibrary(() => root); await library.list();
  const wiki = new ResearchWiki(library); await wiki.initialize('default');
  await wiki.write('default', 'wiki/concepts/one.md', '---\ntitle: One\ntype: concept\n---\n# One\n[[wiki/concepts/two]]', null);
  await wiki.write('default', 'wiki/concepts/two.md', '---\ntitle: Two\ntype: concept\n---\n# Two', null);
  const graph = await wiki.graph('default'); assert.ok(graph.edges.some((e: any) => e.relation === 'wikilink')); assert.match(await wiki.html('default'), /<canvas/);
  const firstView = await wiki.view('default');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await wiki.view('default')).generatedAt, firstView.generatedAt, 'Another plugin panel reading the same graph must not reset the current graph selection');
  const page = await wiki.read('default', 'wiki/concepts/one.md');
  await wiki.write('default', page.path, page.text + '\nEdited', page.revision);
  assert.notEqual((await wiki.view('default')).generatedAt, firstView.generatedAt, 'Saved Wiki changes must invalidate the displayed graph');
  await assert.rejects(wiki.write('default', page.path, 'stale', page.revision), /已改变/);
  assert.match((await new ResearchWiki(library).read('default', page.path)).text, /Edited/);
  await assert.rejects(wiki.write('default', '../outside.md', 'bad', null), /路径/);
  const outside = await mkdtemp(join(tmpdir(), 'research-outside-')); const vault = (await wiki.initialize('default')).rootDir;
  await symlink(outside, join(vault, 'wiki', 'escape'), 'junction');
  await assert.rejects(wiki.write('default', 'wiki/escape/oops.md', 'bad', null), /链接|边界/);
  await assert.rejects(wiki.graph('default'), /链接/);
  assert.match(await readFile(join(vault, page.path), 'utf8'), /Edited/);
});
