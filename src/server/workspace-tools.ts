import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WorkspaceLibrary, WorkspaceIdSchema, DocumentIdSchema, ReadingIdSchema } from './workspaces.js';
import type { ReaderService } from './reader-service.js';
import { MAX_PDF_BYTES } from './reader-service.js';
import type { WorkspaceRuntime } from './workspace-runtime.js';
import { spawn } from 'node:child_process';
import { pdfMetadata } from './pdf-metadata.js';
import { isolatedPdfTask } from './pdf-process.js';
import { importMarkdown, importMarkdownPath } from './markdown-workspace.js';
import { MineruOptionsSchema } from './mineru.js';
import {WhiteboardNotes} from './whiteboard-notes.js';
import {validBookTitle,validBookAuthor} from '../shared/book-metadata.js';

export function registerWorkspaceTools(server: McpServer, library: WorkspaceLibrary, reader: ReaderService, runtime?: WorkspaceRuntime) {
  const workspaceId = WorkspaceIdSchema;
  const uploads = new Map<string, { workspaceId: string; name: string; bytes: Buffer; offset: number; expires: number }>();
  const appOnly = { ui: { visibility: ['app'] } };
  const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const write = { ...read, readOnlyHint: false };
  const attempt = async (action: () => Promise<Record<string, unknown>>) => { try { return { content: [], _meta: await action() }; } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; } };
  const snapshot = async () => ({ workspaceSnapshot: await library.list() });
  const tool = (name: string, inputSchema: z.ZodRawShape, action: (args: any) => Promise<Record<string, unknown>>, readonly = false) => server.registerTool(name, { inputSchema, description: '用户操作的本机工作区资料管理。', _meta: appOnly, annotations: readonly ? read : write }, args => attempt(() => action(args)));
  tool('pdf_workspace_list', {}, snapshot, true);
  tool('pdf_workspace_document_describe', {workspaceId,documentId:DocumentIdSchema}, async a=>{
    const before=await library.document(a.workspaceId,a.documentId);
    if(validBookTitle(before.title,before.name)&&validBookAuthor(before.author))return {document:before};
    const found=await pdfMetadata(await readFile(before.sourcePath)),current=await library.document(a.workspaceId,a.documentId);
    const title=current.title!==before.title||validBookTitle(current.title,current.name)?current.title:found.title;
    const author=current.author!==before.author||validBookAuthor(current.author)?current.author:found.author;
    if(title!==current.title||author!==current.author)await library.metadata(a.workspaceId,a.documentId,title??'',author??'');
    return {document:await library.document(a.workspaceId,a.documentId)};
  });
  const layoutScope = { workspaceId, documentId: DocumentIdSchema };
  async function parseLocal(a: { workspaceId: string; documentId: string }, force: boolean) {
    if (!runtime) throw new Error('本机 MinerU 服务不可用');
    const doc = await library.document(a.workspaceId, a.documentId);
    const service = (await runtime.scope(a.workspaceId, a.documentId)).mineru;
    const prior = await service.status(doc.id);
    if (!['idle', 'failed', 'completed'].includes(prior.phase)) return prior;
    if (!force) { const cached = await service.cachedLayoutStatus(doc.id); if (cached) return { ...prior, phase: 'completed' as const, label: '已复用结构 JSON，无需下载或重新识别' }; }
    if ((await stat(doc.sourcePath)).size !== doc.size) throw new Error('PDF 文件大小已变化，请重新导入');
    const bytes = await readFile(doc.sourcePath);
    const metadata = await isolatedPdfTask(new URL('../../dist/server/pdf-metrics-worker.js', import.meta.url), { bytes: Uint8Array.from(bytes).buffer }, 30000);
    const result = await service.startBatch([{ documentId: doc.id, name: doc.name, sourcePath: doc.sourcePath, size: doc.size, pages: metadata.pages, outline: metadata.outline }], { reconvertCompleted: true });
    return result.jobs[0] ?? result.skipped[0];
  }
  tool('pdf_workspace_layout_start', { ...layoutScope, restart: z.boolean().default(false) }, async a => {
    await parseLocal(a, a.restart);
    return { layoutStatus: await (await runtime!.scope(a.workspaceId, a.documentId)).mineru.layoutStatus(a.documentId) };
  });
  tool('pdf_workspace_layout_status', layoutScope, async a => {
    if (!runtime) throw new Error('本机 MinerU 服务不可用');
    return { layoutStatus: await (await runtime.scope(a.workspaceId, a.documentId)).mineru.layoutStatus(a.documentId) };
  }, true);
  tool('pdf_workspace_layout_read', layoutScope, async a => {
    if (!runtime) throw new Error('本机 MinerU 服务不可用');
    return { layoutAnnotations: await (await runtime.scope(a.workspaceId, a.documentId)).mineru.layout(a.documentId) };
  }, true);
  tool('pdf_workspace_mineru_status', { workspaceId }, async a => {
    if (!runtime) throw new Error('工作区转换服务不可用');
    const workspace = await library.get(a.workspaceId), service = (await runtime.scope(a.workspaceId)).mineru;
    const statuses = await Promise.all(workspace.documents.map(d => service.status(d.id)));
    return { mineruWorkspaceStatus: { workspaceId: a.workspaceId, checkedAt: new Date().toISOString(), statuses } };
  }, true);
  server.registerTool('pdf_workspace_mineru_convert', { description: '用户点击后，用独立的本机 MinerU 标准处理器生成 Markdown、JSON、结构树和布局；保留旧产物，PDF 不上传云端。', inputSchema: { ...layoutScope }, _meta: appOnly, annotations: write }, a => attempt(async () => ({ mineruStatus: await parseLocal(a, true) })));
  tool('pdf_workspace_create', { name: z.string().min(1).max(160) }, async a => { const workspace = await library.create(a.name); return { workspace, ...await snapshot() }; });
  tool('pdf_workspace_rename', { workspaceId, name: z.string().min(1).max(160) }, async a => { await library.rename(a.workspaceId, a.name); return snapshot(); });
  tool('pdf_workspace_archive', { workspaceId }, async a => { await runtime?.requireIdle(a.workspaceId); await library.archive(a.workspaceId); return snapshot(); });
  tool('pdf_workspace_activate', { workspaceId }, async a => { await library.activate(a.workspaceId); return snapshot(); });
  tool('pdf_workspace_folder', { workspaceId }, async a => { const w=await library.get(a.workspaceId);const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';await new Promise<void>((resolve,reject)=>{const child=spawn(command,[w.rootDir],{detached:true,stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});return {}; });
  tool('pdf_workspace_session', { workspaceId, tabs: z.array(ReadingIdSchema).max(64), activeDocumentId: z.string().max(163) }, async a => { await library.session(a.workspaceId, a.tabs, a.activeDocumentId); return {}; });
  tool('pdf_workspace_import_path', { workspaceId, path: z.string().min(1).max(4000) }, async a => { if (/\.md$/i.test(a.path)&&runtime){if(!isAbsolute(a.path)||(await stat(a.path)).size>120000)throw Error('请选择不超过 120000 字符的 Markdown 绝对路径');let markdown:string;try{markdown=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(a.path));}catch{throw Error('Markdown 需要 UTF-8 编码');}return{boardNote:await new WhiteboardNotes(runtime).create(a.workspaceId,{title:basename(a.path).replace(/\.md$/i,''),markdown}),...await snapshot()};}if (/\.md$/i.test(a.path)) return { note: await importMarkdownPath(library, a.workspaceId, a.path), ...await snapshot() }; if (!isAbsolute(a.path) || (await stat(a.path)).size > MAX_PDF_BYTES) throw new Error('请选择不超过 64 MB 的 PDF 绝对路径'); const bytes = await readFile(a.path); const document = await library.importBytes(a.workspaceId, basename(a.path), bytes, a.path); const metadata = await pdfMetadata(bytes); await library.metadata(a.workspaceId, document.id, metadata.title, metadata.author); await runtime?.adoptLegacy(a.workspaceId, document.id); return { document, ...await snapshot() }; });
  tool('pdf_workspace_upload_start', { workspaceId, name: z.string().min(1).max(240), size: z.number().int().nonnegative().max(MAX_PDF_BYTES) }, async a => { if (!a.size && !/\.md$/i.test(a.name)) throw new Error('PDF 文件不能为空'); if (/\.md$/i.test(a.name) && a.size > 2 * 1024 * 1024) throw new Error('Markdown 不能超过 2 MB'); await library.get(a.workspaceId); for (const [token, value] of uploads) if (value.expires < Date.now()) uploads.delete(token); if (uploads.size >= 2) throw new Error('请等待当前文件传输完成'); const token = randomUUID(); uploads.set(token, { ...a, bytes: Buffer.alloc(a.size), offset: 0, expires: Date.now() + 600000 }); return { token }; });
  tool('pdf_workspace_upload', { token: z.string().uuid(), offset: z.number().int().nonnegative(), data: z.string().max(1024 * 1024) }, async a => { const job = uploads.get(a.token); if (!job || job.expires < Date.now() || job.offset !== a.offset || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.data)) throw new Error('文件传输顺序错误或已过期'); const part = Buffer.from(a.data, 'base64'); if (!part.length || part.length + job.offset > job.bytes.length) throw new Error('文件片段大小错误'); part.copy(job.bytes, job.offset); job.offset += part.length; job.expires = Date.now() + 600000; return {}; });
  tool('pdf_workspace_upload_finish', { token: z.string().uuid() }, async a => { const job = uploads.get(a.token); if (!job || job.expires < Date.now() || job.offset !== job.bytes.length) throw new Error('文件尚未传输完成'); try { if (/\.md$/i.test(job.name)) return { note: await importMarkdown(library, job.workspaceId, job.name, job.bytes), ...await snapshot() }; const document = await library.importBytes(job.workspaceId, job.name, job.bytes); const metadata = await pdfMetadata(job.bytes); await library.metadata(job.workspaceId, document.id, metadata.title, metadata.author); await runtime?.adoptLegacy(a.workspaceId ?? job.workspaceId, document.id); return { document, ...await snapshot() }; } finally { uploads.delete(a.token); } });
  tool('pdf_workspace_document_open', { workspaceId, documentId: DocumentIdSchema }, async a => { const doc = await library.document(a.workspaceId, a.documentId); await library.touch(a.workspaceId, a.documentId); const document = await reader.open(doc.sourcePath); return { pdfReader: { baseUrl: reader.baseUrl, workspaceId: a.workspaceId, document: { ...document, name: doc.name, workspaceId: a.workspaceId } } }; });
  tool('pdf_workspace_document_remove', { workspaceId, documentId: DocumentIdSchema }, async a => { await runtime?.requireIdle(a.workspaceId, a.documentId); await library.removeDocument(a.workspaceId, a.documentId); return snapshot(); });
  server.registerTool('pdf_workspace_mineru_batch', { description: '用户点击后，将多个 PDF 加入本机标准解析队列，生成同源的 Markdown、结构 JSON 和图表布局。不调用轻量或云端 API。', inputSchema: { workspaceId, documentIds: z.array(DocumentIdSchema).min(1).max(200), options: MineruOptionsSchema.optional(), restartQueued: z.boolean().default(false) }, _meta: appOnly, annotations: write }, a => attempt(async () => {
    if (!runtime) throw new Error('工作区转换服务不可用');
    if (new Set(a.documentIds).size !== a.documentIds.length) throw new Error('所选 PDF 存在重复');
    const service = (await runtime.scope(a.workspaceId)).mineru;
    const documents = await Promise.all(a.documentIds.map(id => library.document(a.workspaceId, id)));
    const items = [];
    for (const doc of documents) {
      const status = await service.status(doc.id);
      if (!['idle', 'failed'].includes(status.phase)) continue;
      if ((await stat(doc.sourcePath)).size !== doc.size) throw new Error('PDF 文件大小已变化，请重新导入');
      const bytes = await readFile(doc.sourcePath);
      const metadata = await isolatedPdfTask(new URL('../../dist/server/pdf-metrics-worker.js', import.meta.url), { bytes: Uint8Array.from(bytes).buffer }, 30000);
      items.push({ documentId: doc.id, name: doc.name, sourcePath: doc.sourcePath, size: doc.size, pages: metadata.pages, outline: metadata.outline, options: a.options });
    }
    return { mineruBatch: items.length ? await service.startBatch(items, { restartQueued: a.restartQueued }) : { jobs: [], skipped: documents.map(d => ({ documentId: d.id })) } };
  }));
  tool('pdf_workspace_note_create', { workspaceId, name: z.string().min(1).max(140) }, async a => ({ note: await library.createNote(a.workspaceId, a.name), ...await snapshot() }));
  tool('pdf_workspace_note_read', { workspaceId, name: z.string().min(1).max(160) }, async a => ({ note: await library.readNote(a.workspaceId, a.name) }), true);
  tool('pdf_workspace_note_asset', { workspaceId, data: z.string().max(12 * 1024 * 1024) }, async a => ({ asset: await library.saveNoteAsset(a.workspaceId, a.data) }));
  tool('pdf_workspace_document_metadata', { workspaceId, documentId: DocumentIdSchema, title: z.string().max(500), author: z.string().max(500) }, async a => { await library.metadata(a.workspaceId, a.documentId, a.title, a.author); return {}; });
  tool('pdf_workspace_document_folder', { workspaceId, documentId: DocumentIdSchema }, async a => { const doc = await library.document(a.workspaceId, a.documentId); const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'; await new Promise<void>((resolve, reject) => { const child = spawn(command, [doc.projectDir], { detached: true, stdio: 'ignore', windowsHide: true }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); }); return {}; });
  server.registerTool('pdf_workspace_inventory', { description: '读取选定工作区的 PDF、笔记和资料路径，供跨文档研究使用。workspaceId 来自阅读器引用，不扫描其他目录。', inputSchema: { workspaceId }, annotations: read }, a => attempt(async () => ({ workspace: await library.get(a.workspaceId) })).then(r => { if (r.isError) return r; return { content: [{ type: 'text' as const, text: JSON.stringify(r._meta?.workspace) }], structuredContent: r._meta as Record<string, unknown> }; }));
  tool('pdf_workspace_note_write', { workspaceId, name: z.string().min(1).max(160), text: z.string().max(2 * 1024 * 1024), revision: z.string().regex(/^[a-f0-9]{64}$/).optional() }, async a => ({ note: await library.writeNote(a.workspaceId, a.name, a.text, a.revision) }));
  tool('pdf_workspace_note_rename', { workspaceId, name: z.string().max(160), next: z.string().max(160) }, async a => ({ note: await library.renameNote(a.workspaceId, a.name, a.next), ...await snapshot() }));
  tool('pdf_workspace_note_assets', { workspaceId, name: z.string().max(160) }, async a => ({ assets: (await library.noteAssets(a.workspaceId, a.name)).map(({ data, ...asset }) => ({ ...asset, size: Buffer.from(data, 'base64').length })) }), true);
  tool('pdf_workspace_note_asset_read', { workspaceId, name: z.string().max(160), path: z.string().max(100), offset: z.number().int().nonnegative(), length: z.number().int().min(1).max(384 * 1024) }, async a => { const asset = (await library.noteAssets(a.workspaceId, a.name)).find(v => v.path === a.path); if (!asset) throw new Error('图片不属于当前 Markdown'); const bytes = Buffer.from(asset.data, 'base64'); if (a.offset > bytes.length) throw new Error('图片读取范围无效'); return { assetChunk: { offset: a.offset, total: bytes.length, data: bytes.subarray(a.offset, a.offset + a.length).toString('base64') } }; }, true);
}
