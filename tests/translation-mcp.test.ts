import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Script } from 'node:vm';

test('production translation tools are app-only, settings survive restart, and disabled translation cannot call upstream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-translation-mcp-'));
  for (let run = 0; run < 2; run++) {
    const client = new Client({ name: 'translation-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')], env: { ...process.env, CODEX_PDF_DATA_DIR: root } }));
    try {
      const tools = (await client.listTools()).tools;
      for (const name of ['pdf_selection_translate', 'pdf_translation_preferences_read', 'pdf_translation_preferences_update']) assert.deepEqual((tools.find(t => t.name === name)?._meta?.ui as { visibility: string[] }).visibility, ['app']);
      if (!run) {
        await client.callTool({ name: 'pdf_preferences_update', arguments: { appearance: { scheme: 'dark', paper: 'light' } } });
        await client.callTool({ name: 'pdf_translation_preferences_update', arguments: { preferences: { enabled: false, provider: 'google', target: 'en' } } });
      }
      const settings = await client.callTool({ name: 'pdf_translation_preferences_read', arguments: {} });
      assert.deepEqual(settings.content, []);
      assert.deepEqual(settings._meta?.translationPreferences, { enabled: false, provider: 'google', target: 'en' });
      assert.deepEqual((await client.callTool({ name: 'pdf_preferences_read', arguments: {} }))._meta?.appearance, { scheme: 'dark', paper: 'light' });
      const translated = await client.callTool({ name: 'pdf_selection_translate', arguments: { text: 'This is a sentence.' } });
      assert.equal(translated.isError, true); assert.match(JSON.stringify(translated.content), /已关闭/);
    } finally { await client.close(); }
  }
});

test('packaged reader sends Google selection request to parent and accepts its response with matching request ID', async () => {
  const html = await readFile('vendor/zotero-reader/runtime/reader-local.html', 'utf8');
  const start = html.indexOf('function normalizeSelectionTranslationProvider('), end = html.indexOf('function getEmbeddedParams(', start);
  assert.ok(start > 0 && end > start);
  const pending = new Map(); const requests: any[] = [];
  const context = { currentSettings: { selectionTranslationProvider: 'google', translationTarget: 'ja' }, selectionLookupRequestID: 0, pendingSelectionLookupRequests: pending, window: { __codexPost: (m: object) => requests.push(m), setTimeout, clearTimeout }, isEmbeddedMode: () => true };
  const script = new Script(html.slice(start, end) + '\nlookupSelection({text:"hello"})');
  const promise = script.runInNewContext(context);
  assert.equal(requests[0].type, 'electron-reader:lookup-selection-request');
  assert.equal(requests[0].payload.request.provider, 'google'); assert.equal(requests[0].payload.request.to, 'ja');
  try {
    const handlerStart = html.indexOf("if (event.data.type === 'electron-reader:lookup-selection-response')"), handlerEnd = html.indexOf("if (event.data.type === 'electron-reader:lookup-selection-stream')", handlerStart);
    assert.ok(handlerStart > 0 && handlerEnd > handlerStart);
    const response = { translatedText: 'こんにちは' };
    new Script('function receive(event){' + html.slice(handlerStart, handlerEnd) + '} receive(event);').runInNewContext({ ...context, event: { data: { type: 'electron-reader:lookup-selection-response', payload: { requestId: requests[0].payload.requestId, result: response } } } });
    assert.equal(await promise, response); assert.equal(pending.size, 0);
  } finally { for (const request of pending.values()) clearTimeout(request.timeoutId); }
});
