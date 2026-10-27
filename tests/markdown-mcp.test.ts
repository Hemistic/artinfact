import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('Markdown import retains original notes and revisions for Pages without exposing an editor runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-md-mcp-')); const file = join(root, '外部.md'); await writeFile(file, '# 外部\n');
  const client = new Client({ name: 'markdown-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')], env: { ...process.env, CODEX_LAYOUT_WORKSPACE: root, CODEX_PDF_DATA_DIR: join(root, 'state'), CODEX_WORKSPACE_SETTINGS_DIR: join(root, 'settings') } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result.content)); return result._meta as any; };
  try {
    const tools = (await client.listTools()).tools;
    assert.doesNotMatch(tools.find(t => t.name === 'pdf_open')!.description!, /快照编辑器|Milkdown/);
    const entrypoints = (tools.find(t => t.name === 'pdf_open')!._meta?.['openai/ui'] as any).entrypoints;
    assert.ok(entrypoints.find((e: any) => e.type === 'file').extensions.includes('md'));
    assert.equal(tools.some(t => t.name === 'pdf_workspace_markdown_runtime'), false);
    for (const name of ['pdf_workspace_note_write', 'pdf_workspace_note_assets']) assert.deepEqual((tools.find(t => t.name === name)!._meta?.ui as any).visibility, ['app']);
    const openResult = await client.callTool({ name: 'pdf_open', arguments: { path: file } });
    assert.equal((openResult.structuredContent as any).reader, 'Pages');
    const opened = (openResult._meta as any).pdfReader.markdown;
    const legacy = await client.readResource({ uri:'ui://codex-work-layout/pdf/0.9.1/sidebar' });
    const csp=(legacy.contents[0]._meta?.ui as any).csp;
    assert.deepEqual(csp.resourceDomains, ['blob:', 'data:']); assert.deepEqual(csp.connectDomains,[]);
    assert.equal(opened.workspaceId, 'default'); assert.equal(opened.name, '外部.md');
    const bytes = Buffer.from('# 上传\n'); const start = await call('pdf_workspace_upload_start', { workspaceId: 'default', name: '上传.md', size: bytes.length });
    await call('pdf_workspace_upload', { token: start.token, offset: 0, data: bytes.toString('base64') });
    const upload = await call('pdf_workspace_upload_finish', { token: start.token }); assert.equal(upload.note.name, '上传.md');
    const initial = (await call('pdf_workspace_note_read', { workspaceId: 'default', name: upload.note.name })).note;
    await call('pdf_workspace_note_write', { workspaceId: 'default', name: initial.name, text: 'new', revision: initial.revision });
    const conflict = await client.callTool({ name: 'pdf_workspace_note_write', arguments: { workspaceId: 'default', name: initial.name, text: 'stale', revision: initial.revision } }); assert.equal(conflict.isError, true);
    const removedRuntime = await client.callTool({ name: 'pdf_workspace_markdown_runtime', arguments: { offset: 0, length: 1024 } }); assert.equal(removedRuntime.isError, true);
    const rename = await call('pdf_workspace_note_rename', { workspaceId: 'default', name: initial.name, next: '重命名.md' }); assert.equal(rename.note.text, 'new');
  } finally { await client.close(); }
});
