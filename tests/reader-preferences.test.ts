import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { ReaderPreferencesStore } from '../src/server/reader-preferences.ts';
import { effectiveAppearance } from '../src/shared/reader-preferences.ts';

test('manual appearance and paper color survive host mode notifications and server restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-appearance-'));
  const store = new ReaderPreferencesStore(root);
  assert.equal(await store.read(), null);
  await store.write({ scheme: 'dark', paper: 'light' });
  const saved = await new ReaderPreferencesStore(root).read();
  assert.deepEqual(effectiveAppearance('light', saved), { scheme: 'dark', paper: 'light' });
  assert.deepEqual(effectiveAppearance('dark', saved), { scheme: 'dark', paper: 'light' });
  assert.deepEqual(effectiveAppearance('dark', null), { scheme: 'dark', paper: 'dark' });
});

test('missing PDF text nodes do not throw or discard the current native selection', async () => {
  const html = await readFile('vendor/zotero-reader/runtime/reader-local.html', 'utf8');
  const reader = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][2][1];
  const start = reader.indexOf('function setTextLayerSelection(');
  const end = reader.indexOf('\n}\n', start) + 2;
  let changed = false;
  const scope = { getNodeOffset: () => undefined, win: { document: { querySelector: () => null, createRange: () => { changed = true; } }, getSelection: () => { changed = true; } }, ranges: [{ anchorOffset: 0, headOffset: 9, position: { pageIndex: 0 } }] };
  new Script(reader.slice(start, end) + ';setTextLayerSelection(win,ranges)').runInNewContext(scope);
  assert.equal(changed, false);
});
