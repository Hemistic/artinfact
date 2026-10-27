import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('production MCP exposes model Pages result tools, app controls and guards the writeback request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-pages-mcp-')); const client = new Client({ name: 'pages-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')], env: { ...process.env, CODEX_LAYOUT_WORKSPACE: root, CODEX_PDF_DATA_DIR: join(root, 'state'), CODEX_WORKSPACE_SETTINGS_DIR: join(root, 'settings') } }));
  const call = async (name: string, args: Record<string, unknown>) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result.content)); return result as any; };
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual((tools.find(t => t.name === 'pdf_workspace_pages_begin')!._meta?.ui as any).visibility, ['app']);
    for (const name of ['pdf_pages_request_read', 'pdf_pages_preview_save', 'pdf_pages_request_fail']) assert.equal(tools.find(t => t.name === name)!._meta?.ui, undefined);
    const note = (await call('pdf_workspace_note_create', { workspaceId: 'default', name: 'Pages 测试' }))._meta.note;
    const scope = { workspaceId: 'default', name: note.name };
    const original = (await call('pdf_workspace_note_read', scope))._meta.note;
    const begun = (await call('pdf_workspace_pages_begin', { ...scope, intent: 'refresh', reference: 'page_bac4e4ce94bc819199e10ba296328c69' }))._meta.pagesPreview;
    const job = { ...scope, requestId: begun.request.id };
    const task = (await call('pdf_pages_request_read', job)).structuredContent.pagesPreview; assert.equal(task.request.intent, 'refresh'); assert.equal(task.markdown, undefined);
    await call('pdf_workspace_pages_delivery', { ...job, mode: 'draft' });
    const pending = (await call('pdf_workspace_pages_read', scope))._meta.pagesPreview; assert.equal(pending.request.status, 'pending'); assert.equal(pending.cache, undefined);
    await call('pdf_pages_preview_save', { ...job, pageId: task.request.pageId, url: task.request.url, title: '真实返回标题', sequence: 0, blocks: [{ id: 'real-block', kind: 'markdown', hash: 'a'.repeat(64), markdown: '同步测试' }] });
    const complete = (await call('pdf_workspace_pages_read', scope))._meta.pagesPreview; assert.equal(complete.request.status, 'completed'); assert.equal(complete.cache.title, '真实返回标题'); assert.equal(complete.cache.blocks, undefined);
    const listed = (await call('pdf_workspace_pages_list', { workspaceId: 'default' }))._meta.pagesPreview.entries;
    assert.deepEqual(listed[0].card, { name: note.name, pageId: task.request.pageId, url: task.request.url, title: '真实返回标题', syncedAt: complete.cache.syncedAt, excerpt:'同步测试' });
    assert.equal(listed[0].card.blocks, undefined);
    assert.deepEqual((tools.find(t => t.name === 'pdf_workspace_pages_list')!._meta?.ui as any).visibility, ['app']);
    assert.equal((await call('pdf_workspace_note_read', scope))._meta.note.text, original.text);
    const board=(await call('whiteboard_create',{workspaceId:'default',title:'Pages cards',templateId:'free',expectedRevision:0,requestId:'board'})).structuredContent;
    await call('whiteboard_patch',{workspaceId:'default',boardId:board.board.id,actor:'user',expectedRevision:board.revision,requestId:'node',operations:[{op:'put_node',node:{id:'my-note',title:'My research note',note:'**Evidence**',kind:'note',x:80,y:90}}]});
    const target=(await call('whiteboard_pages_target',{workspaceId:'default',boardId:board.board.id,nodeId:'my-note'})).structuredContent;
    assert.match(target.name,/^graph-card:/);assert.equal(target.card,undefined);
    const graphScope={workspaceId:'default',name:target.name},graphRequest=(await call('pdf_workspace_pages_begin',{...graphScope,intent:'create'}))._meta.pagesPreview.request;
    const graphTask=(await call('pdf_pages_request_read',{...graphScope,requestId:graphRequest.id})).structuredContent.pagesPreview;
    assert.equal(graphTask.markdown,'# My research note\n\n**Evidence**');
    await call('pdf_pages_preview_save',{...graphScope,requestId:graphRequest.id,pageId:task.request.pageId,url:task.request.url,title:'Pages research note',blocks:[{id:'cloud-block',kind:'markdown',hash:'b'.repeat(64),markdown:'**Pages content**'}]});
    const graphCards=(await call('whiteboard_pages_list',{workspaceId:'default',boardId:board.board.id})).structuredContent.entries;
    assert.equal(graphCards[0].card.title,'Pages research note');assert.equal(graphCards[0].card.excerpt,'**Pages content**');
    assert.equal((await call('whiteboard_read',{workspaceId:'default',boardId:board.board.id})).structuredContent.board.board.nodes[0].note,'**Evidence**');
    assert.deepEqual((tools.find(t=>t.name==='whiteboard_pages_list')!._meta?.ui as any).visibility,['app']);
    const late = await client.callTool({ name: 'pdf_pages_request_fail', arguments: { ...job, error: '过期' } }); assert.equal(late.isError, true);
  } finally { await client.close(); }
});
