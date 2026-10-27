import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceLibrary } from '../src/server/workspaces.js';

test('workspace lifecycle preserves independent documents, annotations, notes and reading sessions across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-library-'));
  const library = new WorkspaceLibrary(() => root);
  const initial = await library.list();
  assert.equal(initial.activeWorkspaceId, 'default');
  const bytes = Buffer.from('%PDF-1.7\nworkspace fixture');
  const first = await library.importBytes('default', 'one.pdf', bytes);
  await library.stateStore('default').update(first.id, { annotations: [{ id: 'one', text: 'original' }] });
  await library.session('default', [first.id], first.id);
  const second = await library.create('另一工作区');
  const copied = await library.importBytes(second.id, 'one.pdf', bytes);
  assert.equal(copied.id, first.id);
  assert.deepEqual((await library.stateStore(second.id).read(copied.id)).annotations, []);
  const note = await library.createNote('default', '阅读记录');
  await library.writeNote('default', note.name, '# Reading\nEvidence');
  const restarted = new WorkspaceLibrary(() => root);
  assert.equal((await restarted.list()).activeWorkspaceId, second.id);
  assert.deepEqual((await restarted.get('default')).lastSession.openTabs, [first.id]);
  assert.equal((await restarted.readNote('default', note.name)).text, '# Reading\nEvidence');
  assert.equal(await readFile(first.sourcePath, 'utf8'), bytes.toString());
  await restarted.rename(second.id, 'Renamed');
  assert.equal((await restarted.get(second.id)).name, 'Renamed');
  await restarted.archive(second.id);
  assert.equal((await restarted.list()).workspaces.length, 1);
  const archive = (await readdir(join(root, 'workspace-archives')))[0];
  assert.equal(await readFile(join(root, 'workspace-archives', archive, copied.id, 'source.pdf'), 'utf8'), bytes.toString());
  await assert.rejects(restarted.archive('default'), /至少保留/);
});

test('workspace writes merge across independent instances, reject traversal and preserve corrupted state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-boundary-'));
  const a = new WorkspaceLibrary(() => root), b = new WorkspaceLibrary(() => root);
  await a.list();
  await Promise.all([a.create('A'), b.create('B')]);
  assert.equal((await a.list()).workspaces.length, 3);
  await assert.rejects(a.get('../outside'), /标识/);
  await assert.rejects(a.writeNote('default', '../outside.md', 'bad'), /笔记/);
  await assert.rejects(a.importBytes('default', 'invalid.pdf', Buffer.from('bad')), /PDF/);
  await a.importBytes('default', 'duplicate.pdf', Buffer.from('%PDF-1.7\nduplicate'));
  await a.importBytes('default', 'duplicate.pdf', Buffer.from('%PDF-1.7\nduplicate'));
  assert.equal((await a.get('default')).documents.length, 1);
  const path = join(root, 'workspace-state.json');
  await writeFile(path, 'damaged');
  await assert.rejects(a.list(), /损坏/);
  assert.equal(await readFile(path, 'utf8'), 'damaged');
});

test('annotation images live in their workspace notes assets and invalid sessions cannot cross workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-assets-')); const library = new WorkspaceLibrary(() => root); await library.list();
  const data = 'data:image/png;base64,iVBORw0KGgo=';
  const asset = await library.saveNoteAsset('default', data);
  assert.match(asset.path, /^assets\/[a-f0-9]{64}\.png$/);
  assert.equal((await readFile(join(root, 'workspaces', 'default', 'notes', asset.path))).length, 8);
  await assert.rejects(library.saveNoteAsset('default', 'data:text/html;base64,AAAA'), /图片/);
  await assert.rejects(library.session('default', ['a'.repeat(64)], 'a'.repeat(64)), /不属于/);
});
