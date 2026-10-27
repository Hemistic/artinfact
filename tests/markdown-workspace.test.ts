import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceLibrary } from '../src/server/workspaces.js';
import { importMarkdown, importMarkdownPath } from '../src/server/markdown-workspace.js';

test('Markdown import, duplicate names, independent workspace and mixed reading session survive restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-md-')); const library = new WorkspaceLibrary(() => root); await library.list();
  const first = await importMarkdown(library, 'default', '研究.md', Buffer.from('# 标题\n\n正文'));
  const second = await importMarkdown(library, 'default', '研究.md', Buffer.from('# 第二份'));
  assert.notEqual(first.name, second.name);
  const pdf = await library.importBytes('default', 'paper.pdf', Buffer.from('%PDF-1.7\nfixture'));
  await library.session('default', [pdf.id, `md:${first.name}`], `md:${first.name}`);
  const copy = await library.create('另一工作区'); await importMarkdown(library, copy.id, first.name, Buffer.from('different'));
  const restarted = new WorkspaceLibrary(() => root);
  assert.equal((await restarted.readNote('default', first.name)).text, '# 标题\n\n正文');
  assert.equal((await restarted.get('default')).lastSession.activeDocumentId, `md:${first.name}`);
  await assert.rejects(library.session('default', ['md:missing.md'], 'md:missing.md'), /不属于/);
});

test('saving a Markdown revision detects external edits without overwriting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-md-revision-')); const library = new WorkspaceLibrary(() => root); await library.list();
  const note = await importMarkdown(library, 'default', 'note.md', Buffer.from('original'));
  const opened = await library.readNote('default', note.name);
  await library.writeNote('default', note.name, 'external');
  await assert.rejects(library.writeNote('default', note.name, 'stale', opened.revision), /修改/);
  assert.equal((await library.readNote('default', note.name)).text, 'external');
  const empty = await importMarkdown(library, 'default', '空白.md', Buffer.alloc(0)); assert.equal(empty.text, '');
});

test('absolute path Markdown import copies relative images and preserves the external original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-md-assets-')); const library = new WorkspaceLibrary(() => root); await library.list();
  const external = await mkdtemp(join(tmpdir(), 'artinfact-md-external-')); await mkdir(join(external, 'images'));
  await writeFile(join(external, 'images', '图.png'), Buffer.from('iVBORw0KGgo=', 'base64'));
  const original = '# Test\n\n![图](images/图.png)'; const path = join(external, 'paper.md'); await writeFile(path, original);
  const imported = await importMarkdownPath(library, 'default', path);
  assert.match(imported.text, /assets\/[a-f0-9]{64}\.png/); assert.equal(await readFile(path, 'utf8'), original);
  assert.equal((await library.noteAssets('default', imported.name))[0].mimeType, 'image/png');
  await assert.rejects(importMarkdown(library, 'default', '../escape.md', Buffer.from('bad')), /文件名/);
  await assert.rejects(importMarkdown(library, 'default', 'bad.md', Buffer.from([0xff, 0xfe, 0, 0])), /UTF-8/);
});

test('image references, HTML pictures, spaces and parentheses import without touching code or external URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aif-image-syntax-')); const library = new WorkspaceLibrary(() => root); await library.list();
  const external = await mkdtemp(join(tmpdir(), 'aif-image-source-')); await mkdir(join(external, 'images'));
  await writeFile(join(external, 'images', '图 (1).png'), Buffer.from('iVBORw0KGgo=', 'base64'));
  const original = '![space](<images/图 (1).png>)\n\n![reference][pic]\n\n[pic]: <images/图 (1).png>\n\n<img src="images/图 (1).png" alt="HTML">\n\n<picture><source srcset="images/%E5%9B%BE%20(1).png"><img src="images/图 (1).png"></picture>\n\n`![code](<images/图 (1).png>)`\n\n![remote](https://example.org/p.png)';
  const path = join(external,'test.md'); await writeFile(path,original); const note = await importMarkdownPath(library,'default',path);
  assert.equal((note.text.match(/assets\/[a-f0-9]{64}\.png/g) ?? []).length,5);
  assert.ok(note.text.includes('`![code](<images/图 (1).png>)`')); assert.ok(note.text.includes('https://example.org/p.png'));
  assert.equal(await readFile(path,'utf8'),original); assert.equal((await library.noteAssets('default',note.name)).length,1);
});

test('a missing cached image does not prevent opening the rest of a Markdown document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aif-missing-image-'));
  const library = new WorkspaceLibrary(() => root); await library.list();
  const path = `assets/${'a'.repeat(64)}.png`;
  const note = await importMarkdown(library, 'default', 'missing.md', Buffer.from(`# Still readable\n\n![missing](${path})`));
  assert.deepEqual(await library.noteAssets('default', note.name), []);
  assert.ok((await library.readNote('default', note.name)).text.includes(path));
});
