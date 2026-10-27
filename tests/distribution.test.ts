import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { prepareWorkspace } from '../src/server/default-workspace.ts';

test('bundled app has valid module JavaScript and no external script dependencies', async () => {
  for (const path of ['dist/ui/index.html', 'dist/ui/pdf.html']) {
  const html = await readFile(path, 'utf8');
  const script = html.match(/<script type="module">([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.equal(spawnSync(process.execPath, ['--check', '--input-type=module'], { input: script, encoding: 'utf8' }).status, 0);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/);
  }
});

test('bundled production server starts over stdio and opens its real app resource', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-bundle-test-'));
  const client = new Client({ name: 'packaged-server-check', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')], cwd: workspace, env: { ...process.env, CODEX_LAYOUT_WORKSPACE: workspace } });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.find(tool => tool.name === 'layout_open')?._meta?.['openai/ui'], undefined);
    const globalApps = tools.tools.filter(tool => (tool._meta?.['openai/ui'] as { entrypoints?: { type: string }[] } | undefined)?.entrypoints?.some(entry => entry.type === 'global'));
    assert.deepEqual(globalApps.map(tool => tool.name), ['pdf_sidebar']);
    assert.equal(client.getServerVersion()?.title, 'Artinfact');
    const pdf = tools.tools.find(tool => tool.name === 'pdf_open');
    assert.ok(pdf?._meta?.['openai/ui']);
    const result = await client.callTool({ name: 'layout_open', arguments: {} });
    assert.equal((result.structuredContent as { workspace: string }).workspace, workspace);
    const resource = await client.readResource({ uri: 'ui://codex-work-layout/sidebar' });
    assert.ok('text' in resource.contents[0] && resource.contents[0].text.includes('<title>Artinfact</title>'));
    const pdfResource = await client.readResource({ uri: (pdf!._meta!.ui as { resourceUri: string }).resourceUri });
    assert.ok('text' in pdfResource.contents[0] && pdfResource.contents[0].text.includes('<title>Artinfact</title>'));
  } finally { await client.close(); }
});

test('bundled server starts with Documents Artinfact even when launched inside its package', async () => {
  const client = new Client({ name: 'installed-cwd-check', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')], cwd: process.cwd(), env: { ...process.env, CODEX_LAYOUT_WORKSPACE: '' } });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'layout_open', arguments: {} });
    assert.equal(result.isError, undefined);
    const root = await prepareWorkspace();
    assert.equal((result.structuredContent as { workspace: string }).workspace, root);
    const pdf = await client.callTool({ name: 'pdf_open', arguments: {} });
    assert.equal((pdf._meta?.pdfReader as { workspace: string }).workspace, root);
  } finally { await client.close(); }
});

test('a saved sidebar URI remains readable after restarting the production MCP process', async () => {
  let savedUri = '';
  for (let run = 0; run < 2; run++) {
    const client = new Client({ name: 'sidebar-restart-check', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')] }));
    try {
      const sidebar = (await client.listTools()).tools.find(tool => tool.name === 'pdf_sidebar')!;
      const uri = (sidebar._meta!.ui as { resourceUri: string }).resourceUri;
      if (!run) savedUri = uri;
      assert.equal(uri, savedUri);
      const resource = await client.readResource({ uri: savedUri });
      assert.ok('text' in resource.contents[0] && resource.contents[0].text.includes('data-surface="sidebar"'));
      const runtime = await client.callTool({ name: 'pdf_runtime_read', arguments: { offset: 0, length: 64 } });
      assert.equal((runtime._meta?.readerRuntime as { text: string }).text.length, 64);
    } finally { await client.close(); }
  }
});
