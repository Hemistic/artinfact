import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorkspaceRuntime } from '../src/server/workspace-runtime.js';
import { WorkspaceLibrary } from '../src/server/workspaces.js';
import { PdfStateStore } from '../src/server/pdf-store.js';

test('production MCP routes identical PDFs by explicit workspace and keeps saved tabs independent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-routing-')); const pdf = join(root, 'one.pdf'); await writeFile(pdf, '%PDF-1.7\ntest');
  const client = new Client({ name: 'workspace-routing-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')], env: { ...process.env, CODEX_LAYOUT_WORKSPACE: root, CODEX_PDF_DATA_DIR: join(root, 'legacy') } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => { const r = await client.callTool({ name, arguments: args }); assert.equal(r.isError, undefined, JSON.stringify(r.content)); return r as any; };
  try {
    await call('pdf_workspace_list'); const second = (await call('pdf_workspace_create', { name: 'Second' }))._meta.workspace.id;
    const a = (await call('pdf_workspace_import_path', { workspaceId: 'default', path: pdf }))._meta.document;
    const b = (await call('pdf_workspace_import_path', { workspaceId: second, path: pdf }))._meta.document;
    assert.equal(a.id, b.id);
    await call('pdf_state_update', { workspaceId: 'default', documentId: a.id, patch: { annotations: [{ id: 'annotation', text: 'first workspace' }] } });
    assert.equal((await call('pdf_state_read', { workspaceId: second, documentId: a.id }))._meta.pdfState.annotations.length, 0);
    assert.equal((await call('pdf_mineru_status', { workspaceId: second, documentId: a.id }))._meta.mineruStatus.phase, 'idle');
    await call('pdf_workspace_session', { workspaceId: 'default', tabs: [a.id], activeDocumentId: a.id });
    assert.equal((await call('pdf_workspace_document_open', { workspaceId: 'default', documentId: a.id }))._meta.pdfReader.document.workspaceId, 'default');
    const invalid = await client.callTool({ name: 'pdf_state_read', arguments: { workspaceId: second, documentId: 'a'.repeat(64) } }); assert.equal(invalid.isError, true);
    const list = (await call('pdf_workspace_list'))._meta.workspaceSnapshot; assert.deepEqual(list.workspaces.find((w: any) => w.id === 'default').lastSession.openTabs, [a.id]);
  } finally { await client.close(); }
});

test('legacy plugin annotations and completed MinerU files are copied with pointers rewritten, preserving originals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-adoption-')); const library = new WorkspaceLibrary(() => root); await library.list();
  const legacy = new PdfStateStore(join(root, 'legacy')); const runtime = new WorkspaceRuntime(library, legacy);
  const doc = await library.importBytes('default', 'one.pdf', Buffer.from('%PDF-1.7\nfixture'));
  await legacy.update(doc.id, { annotations: [{ id: 'manual', text: 'preserve' }] });
  const old = legacy.mineruFolder(doc.id), output = join(old, 'runs', 'completed', 'output'); await mkdir(output, { recursive: true });
  await writeFile(join(old, 'result.json'), JSON.stringify({ directory: output, name: 'one.pdf', pages: [] })); await writeFile(join(output, 'document-mineru.md'), '# saved');
  await runtime.adoptLegacy('default', doc.id);
  assert.equal((await library.stateStore('default').read(doc.id)).annotations[0].text, 'preserve');
  const next = JSON.parse(await readFile(join(library.stateStore('default').mineruFolder(doc.id), 'result.json'), 'utf8')); assert.equal(await readFile(join(next.directory, 'document-mineru.md'), 'utf8'), '# saved');
  assert.equal(await readFile(join(output, 'document-mineru.md'), 'utf8'), '# saved');
  await runtime.adoptLegacy('default', doc.id); assert.equal((await library.stateStore('default').read(doc.id)).annotations.length, 1);
});
