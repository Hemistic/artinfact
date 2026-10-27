import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLayoutServer, RESOURCE } from '../src/server/server.ts';

test('legacy layout tools no longer advertise competing app entrypoints', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-mcp-test-'));
  const server = createLayoutServer({ workspace, html: '<!doctype html><html lang="zh-CN"><title>Work layout</title></html>' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'verification', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const opener = tools.tools.find(tool => tool.name === 'layout_open')!;
    assert.equal(opener._meta?.['openai/ui'], undefined);
    assert.equal((opener._meta?.ui as { resourceUri: string }).resourceUri, RESOURCE);
    assert.deepEqual((opener._meta?.ui as { visibility: string[] }).visibility, ['app']);
    const panel = tools.tools.find(tool => tool.name === 'layout_panel')!;
    assert.ok(panel);
    assert.equal(panel._meta?.['openai/ui'], undefined);
    assert.deepEqual((panel._meta?.ui as { visibility: string[] }).visibility, ['app']);
    const panelUri = (panel._meta?.ui as { resourceUri: string }).resourceUri;
    assert.notEqual(panelUri, RESOURCE);
    const panelResult = await client.callTool({ name: 'layout_panel', arguments: { workspace } });
    assert.equal((panelResult.structuredContent as { workspace: string }).workspace, workspace);
    const panelResource = await client.readResource({ uri: panelUri });
    assert.equal(panelResource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.equal((panelResource.contents[0]._meta?.ui as { prefersBorder: boolean }).prefersBorder, true);
    assert.ok('text' in panelResource.contents[0] && panelResource.contents[0].text.includes('data-surface="conversation"'));
    const initial = await client.callTool({ name: 'layout_open', arguments: {} });
    assert.equal(initial.isError, undefined);
    assert.equal((initial.structuredContent as { workspace: string }).workspace, workspace);
    const resource = await client.readResource({ uri: RESOURCE });
    assert.ok('text' in resource.contents[0] && resource.contents[0].text.includes('data-surface="sidebar"'));
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(resource.contents[0]._meta?.['openai/ui'], { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['fullscreen'] });
    await writeFile(join(workspace, 'README.md'), 'Test');
    const profile = { name: '测试', panels: [{ placement: 'right', target: { type: 'file', path: 'README.md' } }] };
    assert.equal((await client.callTool({ name: 'layout_save', arguments: { profile } })).isError, undefined);
    const plan = await client.callTool({ name: 'layout_plan', arguments: { name: '测试' } });
    assert.equal((plan.structuredContent as { calls: unknown[] }).calls.length, 1);
    const invalid = await client.callTool({ name: 'layout_plan', arguments: { name: '不存在' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); }
});

test('a sidebar launched from its plugin directory starts without a project and cannot save there', async () => {
  const pluginRoot = await mkdtemp(join(tmpdir(), 'codex-plugin-test-'));
  const project = await mkdtemp(join(tmpdir(), 'codex-project-test-'));
  const server = createLayoutServer({ workspace: pluginRoot, html: '<title>Layout</title>', ...{ pluginRoot } });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'sidebar-workspace-check', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const initial = await client.callTool({ name: 'layout_open', arguments: {} });
    assert.equal(initial.isError, undefined);
    assert.deepEqual(initial.structuredContent, { workspace: '', storePath: '', profiles: [], suggestedFile: '' });
    const profile = { name: '终端', panels: [{ placement: 'bottom', target: { type: 'terminal' } }] };
    for (const workspace of [undefined, pluginRoot]) {
      const result = await client.callTool({ name: 'layout_save', arguments: { ...(workspace ? { workspace } : {}), profile } });
      assert.equal(result.isError, true);
    }
    assert.equal(await stat(join(pluginRoot, '.codex')).then(() => true, () => false), false);
    const selected = await client.callTool({ name: 'layout_list', arguments: { workspace: project } });
    assert.equal((selected.structuredContent as { workspace: string }).workspace, project);
    assert.equal((await client.callTool({ name: 'layout_save', arguments: { workspace: project, profile } })).isError, undefined);
  } finally { await client.close(); await server.close(); }
});
