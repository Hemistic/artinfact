import {registerAgentTaskTools} from './agent-task-tools.js';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { getResourcePath, OpenAIFileEntrypointInputSchema, type OpenAIUiToolMetadata, type OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { PdfStateStore, PdfPatchSchema } from './pdf-store.js';
import type { ReaderService } from './reader-service.js';
import { friendlyError } from '../shared/profile.js';
import { PLUGIN_VERSION } from '../shared/version.js';
import { PdfExporter } from './pdf-export.js';
import { ReaderPreferencesStore, ReaderAppearanceSchema } from './reader-preferences.js';
import { UiLanguageStore } from './ui-language.js';
import { registerMineruTools } from './mineru-tools.js';
import type { WorkspaceSettings } from './workspace-settings.js';
import type { WorkspaceRuntime } from './workspace-runtime.js';
import { WorkspaceIdSchema } from './workspaces.js';
import { registerWorkspaceTools } from './workspace-tools.js';
import { registerWorkspaceWhiteboards } from './whiteboard-tools.js';
import { registerResearchTools } from './research-tools.js';
import {registerPdfReferenceTools} from './pdf-reference-tools.js';
import { registerPagesTools } from './pages-tools.js';
import { WhiteboardPages } from './whiteboard-pages.js';
import { registerTranslationTools } from './translation-tools.js';
import { importMarkdown, importMarkdownPath, MAX_MARKDOWN_BYTES } from './markdown-workspace.js';
import { readFile, stat } from 'node:fs/promises';
import {compressedAppHtml} from './app-resource-html.js';

export const PDF_RESOURCE = `ui://codex-work-layout/pdf/${PLUGIN_VERSION}`;
// Reader assets are local; the retired Markdown renderer needed external image origins.
const READER_RESOURCE_DOMAINS = ['blob:', 'data:'];
export type PdfServerOptions = { service: ReaderService; store: PdfStateStore; html: string; workspace?: string; workspaceSettings?: WorkspaceSettings; workspaceRuntime?: WorkspaceRuntime };
export function registerPdfTools(server: McpServer, { service, store, html, workspace, workspaceSettings, workspaceRuntime }: PdfServerOptions) {
  registerTranslationTools(server, store.root);
  registerMineruTools(server, store, workspaceRuntime,()=>workspaceSettings?.read().workspace ?? workspace ?? process.cwd());
  if(workspaceRuntime)registerAgentTaskTools(server,workspaceRuntime);
  if (workspaceRuntime) registerWorkspaceTools(server, workspaceRuntime.library, service, workspaceRuntime);
  if (workspaceRuntime) {registerResearchTools(server, workspaceRuntime);registerWorkspaceWhiteboards(server,workspaceRuntime);registerPdfReferenceTools(server,workspaceRuntime);}
  if (workspaceRuntime) registerPagesTools(server, workspaceRuntime.library,new WhiteboardPages(workspaceRuntime).source);
  const scope = { workspaceId: WorkspaceIdSchema.optional() };
  const stateStore = async (id?: string, documentId?: string) => id && workspaceRuntime ? (await workspaceRuntime.scope(id, documentId)).store : store;
  const resourceUri = PDF_RESOURCE;
  const sidebarUri = `${PDF_RESOURCE}/sidebar`;
  const resourceHtml=new Map<string,string>();
  const resource = (uri: string, surface = 'conversation') => ({ contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE, text: resourceHtml.get(surface)??(()=>{const value=compressedAppHtml(html.replace('<html ', () => `<html data-surface="${surface}" `));resourceHtml.set(surface,value);return value;})(),
    _meta: {
      ui: { csp: { connectDomains: [], resourceDomains: READER_RESOURCE_DOMAINS, frameDomains: ['blob:'] }, prefersBorder: surface === 'conversation' },
      'openai/widgetCSP': { connect_domains: [], resource_domains: READER_RESOURCE_DOMAINS, frame_domains: ['blob:'] },
      'openai/ui': { availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen' } satisfies OpenAIUiResourceMetadata,
    },
  }] });
  registerAppResource(server, 'zotero-pdf-reader', resourceUri, {}, async () => resource(resourceUri));
  registerAppResource(server, 'zotero-pdf-sidebar', sidebarUri, {}, async () => resource(sidebarUri, 'sidebar'));
  // Persisted Sidebar App records retain the resource URI of the release that opened them.
  // Serve the current UI at those addresses so updating does not leave a broken pinned entry.
  const versionedResource=new ResourceTemplate('ui://codex-work-layout/pdf/{version}',{list:undefined});
  const versionedSidebar=new ResourceTemplate('ui://codex-work-layout/pdf/{version}/sidebar',{list:undefined});
  server.registerResource('zotero-pdf-versioned',versionedResource,{},async uri=>resource(uri.href,uri.href.endsWith('/sidebar')?'sidebar':'conversation'));
  server.registerResource('zotero-pdf-versioned-sidebar',versionedSidebar,{},async uri=>resource(uri.href,'sidebar'));
  for (const version of ['0.9.0','0.9.1','0.9.2','0.9.3','0.9.4','0.9.5','0.11.4','0.12.0','0.12.1','0.12.2','0.12.3','0.12.4','0.12.5','0.12.6','0.12.7','0.12.8'].filter(version => version !== PLUGIN_VERSION)) { const uri=`ui://codex-work-layout/pdf/${version}`;registerAppResource(server,`artinfact-legacy-${version}`,uri,{},async()=>resource(uri));registerAppResource(server,`artinfact-legacy-${version}-sidebar`,uri+'/sidebar',{},async()=>resource(uri+'/sidebar','sidebar')); }
  registerAppResource(server, 'zotero-pdf-legacy-089', 'ui://codex-work-layout/pdf/0.8.9', {}, async () => resource('ui://codex-work-layout/pdf/0.8.9'));
  registerAppResource(server, 'zotero-pdf-legacy-089-sidebar', 'ui://codex-work-layout/pdf/0.8.9/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.8.9/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-0810', 'ui://codex-work-layout/pdf/0.8.10', {}, async () => resource('ui://codex-work-layout/pdf/0.8.10'));
  registerAppResource(server, 'zotero-pdf-legacy-0810-sidebar', 'ui://codex-work-layout/pdf/0.8.10/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.8.10/sidebar', 'sidebar'));
  for (const previous of ['0.8.11', '0.8.12', '0.8.13']) {
    registerAppResource(server, `artinfact-legacy-${previous}`, `ui://codex-work-layout/pdf/${previous}`, {}, async () => resource(`ui://codex-work-layout/pdf/${previous}`));
    registerAppResource(server, `artinfact-legacy-${previous}-sidebar`, `ui://codex-work-layout/pdf/${previous}/sidebar`, {}, async () => resource(`ui://codex-work-layout/pdf/${previous}/sidebar`, 'sidebar'));
  }
  // Existing sidebar records can retain a previous tool resource URI after an update.
  registerAppResource(server, 'zotero-pdf-legacy', 'ui://codex-work-layout/pdf/0.4.0', {}, async () => resource('ui://codex-work-layout/pdf/0.4.0', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-stable', 'ui://codex-work-layout/pdf/0.4.2', {}, async () => resource('ui://codex-work-layout/pdf/0.4.2'));
  registerAppResource(server, 'zotero-pdf-legacy-sidebar', 'ui://codex-work-layout/pdf/0.4.2/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.4.2/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-theme-base', 'ui://codex-work-layout/pdf/0.4.3', {}, async () => resource('ui://codex-work-layout/pdf/0.4.3'));
  registerAppResource(server, 'zotero-pdf-legacy-theme-sidebar', 'ui://codex-work-layout/pdf/0.4.3/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.4.3/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-files-base', 'ui://codex-work-layout/pdf/0.4.4', {}, async () => resource('ui://codex-work-layout/pdf/0.4.4'));
  registerAppResource(server, 'zotero-pdf-legacy-files-sidebar', 'ui://codex-work-layout/pdf/0.4.4/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.4.4/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-export-base', 'ui://codex-work-layout/pdf/0.4.5', {}, async () => resource('ui://codex-work-layout/pdf/0.4.5'));
  registerAppResource(server, 'zotero-pdf-legacy-export-sidebar', 'ui://codex-work-layout/pdf/0.4.5/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.4.5/sidebar', 'sidebar'));
  server.registerResource('zotero-pdf-legacy-port', new ResourceTemplate('ui://codex-work-layout/pdf/0.4.1/{port}', { list: undefined }), {}, async uri => resource(uri.href, 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-preferences-base', 'ui://codex-work-layout/pdf/0.4.6', {}, async () => resource('ui://codex-work-layout/pdf/0.4.6'));
  registerAppResource(server, 'zotero-pdf-legacy-preferences-sidebar', 'ui://codex-work-layout/pdf/0.4.6/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.4.6/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-mineru-base', 'ui://codex-work-layout/pdf/0.5.0', {}, async () => resource('ui://codex-work-layout/pdf/0.5.0'));
  registerAppResource(server, 'zotero-pdf-legacy-mineru-sidebar', 'ui://codex-work-layout/pdf/0.5.0/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.5.0/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-ring-base', 'ui://codex-work-layout/pdf/0.5.1', {}, async () => resource('ui://codex-work-layout/pdf/0.5.1'));
  registerAppResource(server, 'zotero-pdf-legacy-ring-sidebar', 'ui://codex-work-layout/pdf/0.5.1/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.5.1/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-engine-base', 'ui://codex-work-layout/pdf/0.5.2', {}, async () => resource('ui://codex-work-layout/pdf/0.5.2'));
  registerAppResource(server, 'zotero-pdf-legacy-engine-sidebar', 'ui://codex-work-layout/pdf/0.5.2/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.5.2/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-reference-base', 'ui://codex-work-layout/pdf/0.5.3', {}, async () => resource('ui://codex-work-layout/pdf/0.5.3'));
  registerAppResource(server, 'zotero-pdf-legacy-reference-sidebar', 'ui://codex-work-layout/pdf/0.5.3/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.5.3/sidebar', 'sidebar'));
  registerAppResource(server, 'zotero-pdf-legacy-workspace-base', 'ui://codex-work-layout/pdf/0.5.4', {}, async () => resource('ui://codex-work-layout/pdf/0.5.4'));
  registerAppResource(server, 'zotero-pdf-legacy-workspace-sidebar', 'ui://codex-work-layout/pdf/0.5.4/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.5.4/sidebar', 'sidebar'));
  const appOnly = { ui: { visibility: ['app'] } };
  registerAppResource(server, 'zotero-pdf-legacy-settings-base', 'ui://codex-work-layout/pdf/0.5.5', {}, async () => resource('ui://codex-work-layout/pdf/0.5.5'));
  registerAppResource(server, 'zotero-pdf-legacy-settings-sidebar', 'ui://codex-work-layout/pdf/0.5.5/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.5.5/sidebar', 'sidebar'));
  if (String(PLUGIN_VERSION) !== '0.6.0') {
    registerAppResource(server, 'zotero-pdf-legacy-books-base', 'ui://codex-work-layout/pdf/0.6.0', {}, async () => resource('ui://codex-work-layout/pdf/0.6.0'));
    registerAppResource(server, 'zotero-pdf-legacy-books-sidebar', 'ui://codex-work-layout/pdf/0.6.0/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.6.0/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.0') {
    registerAppResource(server, 'zotero-pdf-legacy-research-base', 'ui://codex-work-layout/pdf/0.7.0', {}, async () => resource('ui://codex-work-layout/pdf/0.7.0'));
    registerAppResource(server, 'zotero-pdf-legacy-research-sidebar', 'ui://codex-work-layout/pdf/0.7.0/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.0/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.1') {
    registerAppResource(server, 'zotero-pdf-legacy-navigation-base', 'ui://codex-work-layout/pdf/0.7.1', {}, async () => resource('ui://codex-work-layout/pdf/0.7.1'));
    registerAppResource(server, 'zotero-pdf-legacy-navigation-sidebar', 'ui://codex-work-layout/pdf/0.7.1/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.1/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.2') {
    registerAppResource(server, 'zotero-pdf-legacy-white-navigation-base', 'ui://codex-work-layout/pdf/0.7.2', {}, async () => resource('ui://codex-work-layout/pdf/0.7.2'));
    registerAppResource(server, 'zotero-pdf-legacy-white-navigation-sidebar', 'ui://codex-work-layout/pdf/0.7.2/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.2/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.3') {
    registerAppResource(server, 'zotero-pdf-legacy-rate-limit-base', 'ui://codex-work-layout/pdf/0.7.3', {}, async () => resource('ui://codex-work-layout/pdf/0.7.3'));
    registerAppResource(server, 'zotero-pdf-legacy-rate-limit-sidebar', 'ui://codex-work-layout/pdf/0.7.3/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.3/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.5') {
    registerAppResource(server, 'zotero-pdf-legacy-md-chain-base', 'ui://codex-work-layout/pdf/0.7.5', {}, async () => resource('ui://codex-work-layout/pdf/0.7.5'));
    registerAppResource(server, 'zotero-pdf-legacy-md-chain-sidebar', 'ui://codex-work-layout/pdf/0.7.5/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.5/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.6') {
    registerAppResource(server, 'zotero-pdf-legacy-mineru-status-base', 'ui://codex-work-layout/pdf/0.7.6', {}, async () => resource('ui://codex-work-layout/pdf/0.7.6'));
    registerAppResource(server, 'zotero-pdf-legacy-mineru-status-sidebar', 'ui://codex-work-layout/pdf/0.7.6/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.6/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.7') {
    registerAppResource(server, 'zotero-pdf-legacy-research-delivery-base', 'ui://codex-work-layout/pdf/0.7.7', {}, async () => resource('ui://codex-work-layout/pdf/0.7.7'));
    registerAppResource(server, 'zotero-pdf-legacy-research-delivery-sidebar', 'ui://codex-work-layout/pdf/0.7.7/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.7/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.10') {
    registerAppResource(server, 'zotero-pdf-legacy-retry-base', 'ui://codex-work-layout/pdf/0.7.10', {}, async () => resource('ui://codex-work-layout/pdf/0.7.10'));
    registerAppResource(server, 'zotero-pdf-legacy-retry-sidebar', 'ui://codex-work-layout/pdf/0.7.10/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.10/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.9') {
    registerAppResource(server, 'zotero-pdf-legacy-progress-base', 'ui://codex-work-layout/pdf/0.7.9', {}, async () => resource('ui://codex-work-layout/pdf/0.7.9'));
    registerAppResource(server, 'zotero-pdf-legacy-progress-sidebar', 'ui://codex-work-layout/pdf/0.7.9/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.9/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.8') {
    registerAppResource(server, 'zotero-pdf-legacy-batch-base', 'ui://codex-work-layout/pdf/0.7.8', {}, async () => resource('ui://codex-work-layout/pdf/0.7.8'));
    registerAppResource(server, 'zotero-pdf-legacy-batch-sidebar', 'ui://codex-work-layout/pdf/0.7.8/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.8/sidebar', 'sidebar'));
  }
  if (String(PLUGIN_VERSION) !== '0.7.4') {
    registerAppResource(server, 'zotero-pdf-legacy-graph-tabs-base', 'ui://codex-work-layout/pdf/0.7.4', {}, async () => resource('ui://codex-work-layout/pdf/0.7.4'));
    registerAppResource(server, 'zotero-pdf-legacy-graph-tabs-sidebar', 'ui://codex-work-layout/pdf/0.7.4/sidebar', {}, async () => resource('ui://codex-work-layout/pdf/0.7.4/sidebar', 'sidebar'));
  }
  const exporter = new PdfExporter(store);
  const pdfExporter = async (id?: string, documentId?: string) => id && workspaceRuntime ? (await workspaceRuntime.scope(id, documentId)).exporter : exporter;
  const preferences = new ReaderPreferencesStore(store.root);
  const uiLanguage = new UiLanguageStore(store.root);
  const exportToken = z.string().uuid();
  const exportOnly = { _meta: appOnly, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } };
  const documentId = z.string().regex(/^[a-f0-9]{64}$/);
  const path = z.string().min(1).max(4000).describe('用户选择的本机 PDF / Markdown 文件绝对路径');
  async function attempt<T>(action: () => Promise<T>) {
    try { return await action(); } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: friendlyError(error) }] }; }
  }
  async function launch(path?: string, file?: { name: string; resourceUri: string }) {
    if (path && (/\.md$/i.test(path) || /\.md$/i.test(file?.name || ''))) {
      if (!workspaceRuntime) throw new Error('Markdown 工作区服务不可用');
      const library = workspaceRuntime.library; const workspaceId = (await library.list()).activeWorkspaceId;
      if ((await stat(path)).size > MAX_MARKDOWN_BYTES) throw new Error('Markdown 不能超过 2 MB');
      const note = /\.md$/i.test(path) ? await importMarkdownPath(library, workspaceId, path) : await importMarkdown(library, workspaceId, file!.name, await readFile(path));
      return { content: [{ type: 'text' as const, text: `已导入 Markdown：${note.name}。阅读和编辑请打开关联的 Pages；未关联时请保存或关联页面。` }], structuredContent: { reader: 'Pages', fileName: note.name }, _meta: { pdfReader: { baseUrl: service.baseUrl, markdown: { workspaceId, name: note.name } } } };
    }
    let document = path ? await service.open(path) : undefined;
    let workspaceId:string|undefined;
    if(document&&path&&workspaceRuntime){
      const library=workspaceRuntime.library;workspaceId=(await library.list()).activeWorkspaceId;
      const stored=await library.importBytes(workspaceId,document.name,await readFile(path),path);
      document={...document,name:stored.name,...{workspaceId}};
    }
    const visible = { reader: 'Zotero Reader', ...(document ? { document: { id: document.id, name: document.name, size: document.size } } : file ? { fileName: file.name } : {}) };
    return { content: [{ type: 'text' as const, text: document ? `已打开 PDF：${document.name}。选文可作为下一次提问的上下文。` : 'PDF 阅读器已就绪，请选择 PDF。' }], structuredContent: visible, _meta: { pdfReader: { baseUrl: service.baseUrl, workspace: workspaceSettings?.read().workspace ?? workspace, dataDirectory: store.root, ...(document ? { document,workspaceId } : {}), ...(!document && file ? { hostFile: file } : {}) } } };
  }
  server.registerTool('pdf_preferences_read', { description: '读取本机阅读器界面与纸面颜色选择。', inputSchema: {}, _meta: appOnly, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, () => attempt(async () => ({ content: [], _meta: { appearance: await preferences.read() } })));
  server.registerTool('pdf_ui_language_read', {description:'Read the saved Artinfact interface language.',inputSchema:{},_meta:appOnly,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},()=>attempt(async()=>({content:[],_meta:{uiLanguage:await uiLanguage.read()}})));
  server.registerTool('pdf_ui_language_update',{description:'Save the Artinfact interface language without changing paper content or translation preferences.',inputSchema:{language:z.enum(['zh','en'])},...exportOnly},args=>attempt(async()=>({content:[],_meta:{uiLanguage:await uiLanguage.write(args.language)}})));
  server.registerTool('pdf_preferences_update', { description: '保存用户选择的界面主题与独立纸面颜色。', inputSchema: { appearance: ReaderAppearanceSchema }, ...exportOnly }, args => attempt(async () => { await preferences.write(args.appearance); return { content: [] }; }));
  server.registerTool('pdf_export_start', { description: '为界面选定的 PDF 创建本机批注导出任务。', inputSchema: { ...scope, documentId, size: z.number().int().min(1).max(64 * 1024 * 1024) }, ...exportOnly }, args => attempt(async () => ({ content: [], _meta: { exportToken: (await pdfExporter(args.workspaceId, args.documentId)).start(args.documentId, args.size) } })));
  server.registerTool('pdf_export_upload', { description: '向本机导出任务分块传输当前 PDF。', inputSchema: { ...scope, token: exportToken, offset: z.number().int().min(0), data: z.string().max(1024 * 1024) }, ...exportOnly }, args => attempt(async () => { (await pdfExporter(args.workspaceId)).upload(args.token, args.offset, args.data); return { content: [] }; }));
  server.registerTool('pdf_export_finish', { description: '使用内置 Zotero PDF worker 把本机批注写入新的 PDF 副本。', inputSchema: { ...scope, token: exportToken }, ...exportOnly }, args => attempt(async () => ({ content: [], _meta: { size: await (await pdfExporter(args.workspaceId)).finish(args.token) } })));
  server.registerTool('pdf_export_read', { description: '分块读取生成的批注 PDF。', inputSchema: { ...scope, token: exportToken, offset: z.number().int().min(0), length: z.number().int().min(1).max(768 * 1024) }, ...exportOnly }, args => attempt(async () => ({ content: [], _meta: { exportChunk: (await pdfExporter(args.workspaceId)).read(args.token, args.offset, args.length) } })));
  server.registerTool('pdf_export_release', { description: '释放已完成或失败的本机导出任务。', inputSchema: { ...scope, token: exportToken }, ...exportOnly }, args => attempt(async () => { (await pdfExporter(args.workspaceId)).release(args.token); return { content: [] }; }));
  registerAppTool(server, 'pdf_open', {
    title: 'Artinfact', description: '在 Codex 面板中打开 PDF 阅读器，或导入 Markdown 并进入 Pages 关联入口。Markdown 阅读和编辑由 Pages 完成，插件不展示正文。path 仅使用用户明确选择或提供的 PDF / Markdown。PDF 选文通过应用更新上下文，供下一次提问使用，不自动发消息。',
    inputSchema: { path: path.optional(), file: OpenAIFileEntrypointInputSchema.shape.file.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri, visibility: ['model', 'app'] }, 'openai/ui': { entrypoints: [{ type: 'thread' }, { type: 'file', extensions: ['pdf', 'md'] }], preferredModelDisplayMode: 'fullscreen' } satisfies OpenAIUiToolMetadata },
  }, (args, extra) => attempt(() => launch(args.path ?? (args.file ? getResourcePath(extra._meta) : undefined), args.file)));
  registerAppTool(server, 'pdf_sidebar', {
    title: 'Artinfact', description: '从侧栏打开 Artinfact 多 PDF 工作区、阅读器与知识图谱；AI 大纲和智能洞察使用同源 MinerU Markdown 与结构 JSON。', inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: sidebarUri, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'global' }] } satisfies OpenAIUiToolMetadata },
  }, () => attempt(() => launch()));
  server.registerTool('pdf_document_read', {
    title: '读取已打开 PDF 的片段', description: '通过 MCP 将已明确打开的文件传给阅读器。', inputSchema: { url: z.string().max(500), offset: z.number().int().min(0), length: z.number().int().min(1).max(768 * 1024) }, _meta: appOnly,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, args => attempt(async () => ({ content: [{ type: 'text' as const, text: '已读取 PDF 片段' }], _meta: { pdfChunk: service.readDocument(args.url, args.offset, args.length) } })));
  server.registerTool('pdf_runtime_read', {
    title: '读取插件内置阅读器', description: '将本插件打包的阅读器资源传给应用，无法读取任意路径。', inputSchema: { offset: z.number().int().min(0), length: z.number().int().min(1).max(384 * 1024), encoding:z.enum(['utf8','gzip-base64']).optional() }, _meta: appOnly,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, args => attempt(async () => ({ content: [{ type: 'text' as const, text: '已读取内置阅读器片段' }], _meta: { readerRuntime: await service.readRuntime(args.offset, args.length,args.encoding) } })));
  server.registerTool('pdf_open_path', {
    title: '读取用户选定的 PDF', description: '由阅读器界面在用户选择路径时调用。', inputSchema: { path }, _meta: appOnly,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, args => attempt(() => launch(args.path)));
  server.registerTool('pdf_state_read', {
    title: '读取 PDF 批注', description: '按 PDF 内容哈希读取本机批注与阅读位置，批注通过应用私有元数据返回。', inputSchema: { ...scope, documentId }, _meta: appOnly,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, args => attempt(async () => {
    const state = await (await stateStore(args.workspaceId, args.documentId)).read(args.documentId);
    return { content: [{ type: 'text' as const, text: '已读取本机阅读状态' }], _meta: { pdfState: state } };
  }));
  server.registerTool('pdf_state_update', {
    title: '保存 PDF 批注', description: '保存用户在阅读器中编辑的批注、删除操作或阅读位置。原 PDF 不变，增量合并本机存档。', inputSchema: { ...scope, documentId, patch: PdfPatchSchema }, _meta: appOnly,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, args => attempt(async () => {
    const state = await (await stateStore(args.workspaceId, args.documentId)).update(args.documentId, args.patch);
    return { content: [{ type: 'text' as const, text: '已保存本机阅读状态' }], structuredContent: { revision: state.revision, annotationCount: state.annotations.length } };
  }));
}
