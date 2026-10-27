import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlan, loadStore, saveProfile, deleteProfile, ProfileSchema } from '../src/shared/layout.ts';

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-sidebar-test-'));
  await writeFile(join(workspace, '笔记 with spaces.md'), 'Example');
  const profile = {
    name: '开发',
    panels: [
      { placement: 'right', target: { type: 'file', path: '笔记 with spaces.md', line: 2 } },
      { placement: 'bottom', target: { type: 'browser', url: 'http://localhost:5173' } },
    ],
  };
  return { workspace, profile, store: join(workspace, '.codex', 'work-layouts.json') };
}

test('plan produces real host arguments and preserves Chinese paths and positions', async () => {
  const { workspace, profile } = await fixture();
  const result = await buildPlan(workspace, profile);
  assert.deepEqual(result.calls[0], {
    tool: 'mcp__codex_app__open_in_codex',
    arguments: { placement: 'right', target: { type: 'file', path: join(workspace, '笔记 with spaces.md'), line: 2 } },
  });
  assert.equal(result.calls[1].arguments.placement, 'bottom');
  assert.equal(result.applied, false);
});

test('saved v1 profiles are preserved when another profile is added', async () => {
  const { workspace, profile, store } = await fixture();
  await mkdir(join(workspace, '.codex'));
  await writeFile(store, '\ufeff' + JSON.stringify({ schemaVersion: 1, profiles: { 开发: profile } }));
  await saveProfile(workspace, { ...profile, name: '查阅' });
  assert.deepEqual(Object.keys((await loadStore(workspace)).profiles), ['开发', '查阅']);
});

test('parallel saves do not discard other profiles', async () => {
  const { workspace, profile } = await fixture();
  await Promise.all(Array.from({ length: 5 }, (_, i) => saveProfile(workspace, { ...profile, name: `配置${i}` })));
  assert.equal(Object.keys((await loadStore(workspace)).profiles).length, 5);
});

test('unsupported layout controls and stale IDs are rejected', () => {
  const invalid = [
    { placement: 'left', target: { type: 'terminal' } },
    { placement: 'right', width: 600, target: { type: 'terminal' } },
    { placement: 'bottom', target: { type: 'terminal', sessionId: 'old-session' } },
    { placement: 'bottom', target: { type: 'browser', url: 'javascript:alert(1)' } },
    { placement: 'bottom', target: { type: 'browser', url: 'https://user:password@example.com' } },
  ];
  for (const panel of invalid) assert.equal(ProfileSchema.safeParse({ name: '配置', panels: [panel] }).success, false);
});

test('missing files do not create a store or partially produce a plan', async () => {
  const { workspace, profile } = await fixture();
  profile.panels[0].target.path = 'missing.md';
  await assert.rejects(saveProfile(workspace, profile), /missing.md/);
  assert.equal(Object.keys((await loadStore(workspace)).profiles).length, 0);
});

test('corrupt profiles are preserved instead of being replaced', async () => {
  const { workspace, profile, store } = await fixture();
  await mkdir(join(workspace, '.codex'));
  await writeFile(store, '{broken');
  await assert.rejects(saveProfile(workspace, profile), /配置/);
  assert.equal(await readFile(store, 'utf8'), '{broken');
});

test('delete removes only the chosen saved profile', async () => {
  const { workspace, profile } = await fixture();
  await saveProfile(workspace, profile);
  await saveProfile(workspace, { ...profile, name: '其他' });
  await deleteProfile(workspace, '开发');
  assert.deepEqual(Object.keys((await loadStore(workspace)).profiles), ['其他']);
});

test('exact duplicate panels are opened only once', async () => {
  const { workspace, profile } = await fixture();
  profile.panels.push(profile.panels[0]);
  assert.equal((await buildPlan(workspace, profile)).calls.length, 2);
});
