import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('Artinfact manifests preserve installed identity and prompts', async () => {
 const manifest=JSON.parse(await readFile('plugin.json','utf8'));
 const overlay=JSON.parse(await readFile('.codex-plugin/plugin.json','utf8'));
 const baseline=JSON.parse(await readFile('scripts/baseline.json','utf8'));
 assert.equal(manifest.name,baseline.name);
 assert.equal(overlay.name,baseline.name);
 assert.equal(manifest.extensions['com.openai'].interface.displayName,'Artinfact');
 assert.deepEqual(overlay.interface,manifest.extensions['com.openai'].interface);
 assert.deepEqual(overlay.interface.defaultPrompt,baseline.defaultPrompt);
 assert.equal(overlay.version,manifest.version);
});