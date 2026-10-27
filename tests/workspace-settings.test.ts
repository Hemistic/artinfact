import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSettings } from '../src/server/workspace-settings.ts';

test('each user gets their own Documents Artinfact, and a changed folder survives restart', async () => {
  const user = await mkdtemp(join(tmpdir(), 'codex-user-workspace-'));
  const docs = join(user, 'redirected-documents'); const settings = join(user, 'settings');
  const custom = join(user, 'custom'); await mkdir(custom);
  const first = new WorkspaceSettings(settings, undefined, async () => docs);
  assert.equal((await first.initialize()).workspace, join(docs, 'Artinfact'));
  await first.set(custom);
  assert.equal((await new WorkspaceSettings(settings, undefined, async () => docs).initialize()).workspace, custom);
  const anotherUser = new WorkspaceSettings(join(user, 'other-settings'), undefined, async () => join(user, 'other-documents'));
  assert.equal((await anotherUser.initialize()).workspace, join(user, 'other-documents', 'Artinfact'));
  await assert.rejects(first.set(join(user, 'missing')));
  assert.equal(first.read().workspace, custom);
});
test('explicit environment wins, and damaged settings are preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-workspace-config-'));
  await writeFile(join(root, 'workspace-settings.json'), 'broken');
  await assert.rejects(new WorkspaceSettings(root).initialize(), /损坏/);
  assert.equal(await readFile(join(root, 'workspace-settings.json'), 'utf8'), 'broken');
  assert.equal((await new WorkspaceSettings(root, root).initialize()).source, 'environment');
});
