import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareWorkspace } from '../src/server/default-workspace.ts';

test('default workspace follows the system Documents directory and preserves existing Artinfact files', async () => {
  const documents = await mkdtemp(join(tmpdir(), 'codex-documents-'));
  const root = await prepareWorkspace(undefined, async () => documents);
  assert.equal(root, join(documents, 'Artinfact')); assert.ok((await stat(root)).isDirectory());
  await writeFile(join(root, 'keep.txt'), 'existing');
  assert.equal(await prepareWorkspace('', async () => documents), root);
  assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'existing');
});
test('explicit workspace wins and invalid overrides do not silently create a different root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-explicit-'));
  assert.equal(await prepareWorkspace(root, async () => { throw Error('default should not be used'); }), root);
  await assert.rejects(prepareWorkspace(join(root, 'missing'), async () => root));
});
