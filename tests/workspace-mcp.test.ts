import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('workspace setting is app-only, updates both layout and PDF defaults, and persists in the production server', async () => {
  const settings = await mkdtemp(join(tmpdir(), 'codex-workspace-mcp-'));
  const chosen = await mkdtemp(join(tmpdir(), 'codex-workspace-chosen-'));
  const script = resolve('dist/server/index.js');
  for (let run = 0; run < 2; run++) {
    const client = new Client({ name: 'workspace-setting-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [script], env: { ...process.env, CODEX_LAYOUT_WORKSPACE: '', CODEX_WORKSPACE_SETTINGS_DIR: settings } }));
    try {
      const tools = (await client.listTools()).tools;
      assert.deepEqual((tools.find(t => t.name === 'layout_workspace_update')?._meta?.ui as { visibility: string[] }).visibility, ['app']);
      assert.deepEqual((tools.find(t => t.name === 'pdf_workspace_mineru_status')?._meta?.ui as { visibility: string[] }).visibility, ['app']);
      const batch = tools.find(t => t.name === 'pdf_workspace_mineru_batch')!;
      assert.deepEqual((batch._meta?.ui as { visibility: string[] }).visibility, ['app']);
      assert.ok(batch.inputSchema.properties?.restartQueued);
      if (!run) { const result = await client.callTool({ name: 'layout_workspace_update', arguments: { workspace: chosen } }); assert.equal(result.isError, undefined); }
      const layout = await client.callTool({ name: 'layout_list', arguments: {} });
      assert.equal((layout.structuredContent as { workspace: string }).workspace, chosen);
      const pdf = await client.callTool({ name: 'pdf_open', arguments: {} });
      assert.equal((pdf._meta?.pdfReader as { workspace: string }).workspace, chosen);
      const progress = await client.callTool({ name: 'pdf_workspace_mineru_status', arguments: { workspaceId: 'default' } });
      assert.equal(progress.isError, undefined); assert.deepEqual((progress._meta?.mineruWorkspaceStatus as { statuses: unknown[] }).statuses, []);
    } finally { await client.close(); }
  }
});
