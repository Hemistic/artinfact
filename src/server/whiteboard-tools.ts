import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {UiLanguageStore} from './ui-language.js';
import {withAiLanguageResult} from '../shared/ai-output-language.js';
import {readFile} from 'node:fs/promises';
import {registerAppTool} from '@modelcontextprotocol/ext-apps/server';
import {createHash} from 'node:crypto';
import {PagesPreviewStore} from './pages-preview.js';
import {WorkspaceIdSchema} from './workspaces.js';
import type {WorkspaceRuntime} from './workspace-runtime.js';
import {WorkspaceWhiteboards} from './whiteboard-service.js';
import {registerWhiteboardTools} from '../whiteboard/whiteboard-mcp.js';
import {z} from 'zod';
import {WhiteboardPackages} from './whiteboard-export-package.js';
import {WhiteboardPages} from './whiteboard-pages.js';
import {workspaceGraphView} from './workspace-graph-view.js';
import {WhiteboardNotes} from './whiteboard-notes.js';
import {NoteAiTasks} from './note-ai-tasks.js';
// Keep the template with this process: plugin updates may remove its version directory.
// Capture failures immediately to avoid an unhandled rejection during startup.
const whiteboardTemplate=readFile(new URL('../../dist/whiteboard/index.html',import.meta.url),'utf8').then(html=>({html,error:undefined}),error=>({html:undefined,error}));
export function registerWorkspaceWhiteboards(server:McpServer,runtime:WorkspaceRuntime){
 const language=new UiLanguageStore(runtime.legacyStore.root);
 const service=new WorkspaceWhiteboards(runtime);
 const pages=new WhiteboardPages(runtime);
 const packages=new WhiteboardPackages(runtime,pages);
 const notes=new WhiteboardNotes(runtime);
 const noteAi=new NoteAiTasks(runtime);
 const exportDescriptions:Record<string,string>={whiteboard_export_package:'按用户选择导出整板 Markdown＋相对路径图片资源 ZIP，或可编辑 .artinfact 白板包与 JSON Canvas 1.0 .canvas。保留分区、卡片布局、完整内容、原文证据、来源文本与 Pages 原链接。不使用 AI 改写，不修改源白板。返回真实保存路径和 SHA-256。name 必须来自导出预览当前快照。',whiteboard_package_import:'导入用户选定的 .artinfact 白板包，校验格式、大小与附件 SHA-256，在当前工作区创建一张独立可编辑白板。使用全新卡片 ID，不覆盖原卡片、不恢复运行任务。',whiteboard_save_markdown:'用户请求导出白板后，将校验过的完整 Markdown 和嵌入图片保存到资料库 exports 目录中的新文件，不覆盖原文件；返回实际路径、字节数及 SHA-256。name 必须来自导出预览的当前快照。',whiteboard_export_markdown:'把整张白板按可见分区和输入连接组装为完整 Markdown 文档，包含正文、公式、图表、证据、关系和原 Pages 链接，不调用 AI 改写。embedAssets 默认 true，嵌入图片供本地单文件下载；false 返回 flow-asset 引用、结构统计和附件清单，供 Pages 导出使用。未添加到白板的资料不导出。',whiteboard_export_assets:'仅用于用户请求的白板文档导出。传入实际 board-export 快照 name，校验当前内容后将其引用图片复制到本机临时目录，返回真实附件路径、MIME、字节数及 SHA-256。Pages 可用 write_page_reference 上传这些实际文件；不修改原卡片或图片。'};
 const noteScope={workspaceId:WorkspaceIdSchema},nodeId=z.string().min(1).max(180),title=z.string().trim().min(1).max(240),markdown=z.string().max(120000);
 for(const [name,extra,action,readonly]of [
  ['whiteboard_notes_list',{},(a:any)=>notes.list(a.workspaceId),true],
  ['whiteboard_note_read',{nodeId},(a:any)=>notes.read(a.workspaceId,a.nodeId),true],
  ['whiteboard_note_import_legacy',{name:z.string().min(1).max(160)},(a:any)=>notes.importLegacy(a.workspaceId,a.name),false],
  ['whiteboard_note_create',{title,markdown:markdown.optional(),boardId:z.string().max(180).optional()},(a:any)=>notes.create(a.workspaceId,a),false],
  ['whiteboard_note_write',{nodeId,title,markdown,revision:z.string().regex(/^[a-f0-9]{64}$/),boardId:z.string().min(1).max(180).optional()},(a:any)=>notes.write(a.workspaceId,a),false],
  ['whiteboard_note_ai_begin',{nodeId,document:markdown,selection:z.string().min(1).max(30000),instruction:z.string().trim().min(1).max(4000)},(a:any)=>noteAi.begin(a.workspaceId,a),false],
  ['whiteboard_note_ai_read',{requestId:z.string().uuid(),includeContext:z.boolean().optional()},(a:any)=>noteAi.read(a.workspaceId,a.requestId,a.includeContext??true),true],
  ['whiteboard_note_ai_complete',{requestId:z.string().uuid(),markdown:z.string().trim().min(1).max(120000)},(a:any)=>noteAi.complete(a.workspaceId,a.requestId,a.markdown),false],
  ['whiteboard_note_ai_cancel',{requestId:z.string().uuid()},(a:any)=>noteAi.cancel(a.workspaceId,a.requestId),false],
  ['whiteboard_export_markdown',{boardId:z.string().max(180),embedAssets:z.boolean().optional()},(a:any)=>pages.export(a.workspaceId,a.boardId,a.embedAssets??true),true],
  ['whiteboard_export_package',{boardId:z.string().max(180),name:z.string().regex(/^board-export:[a-f0-9]{64}:[a-f0-9]{64}$/),format:z.enum(['markdown','whiteboard'])},(a:any)=>packages.export(a.workspaceId,a.boardId,a.name,a.format),false],
  ['whiteboard_package_import',{name:z.string().min(1).max(240),base64:z.string().max(90*1024*1024),expectedRevision:z.number().int().nonnegative(),requestId:z.string().min(1).max(180)},(a:any)=>packages.import(a.workspaceId,a),false],
  ['whiteboard_save_markdown',{boardId:z.string().max(180),name:z.string().regex(/^board-export:[a-f0-9]{64}:[a-f0-9]{64}$/)},(a:any)=>pages.saveMarkdown(a.workspaceId,a.boardId,a.name),false],
  ['whiteboard_export_assets',{name:z.string().regex(/^board-export:[a-f0-9]{64}:[a-f0-9]{64}$/)},(a:any)=>pages.exportAssets(a.workspaceId,a.name),false],
 ]as const)server.registerTool(name,{description:exportDescriptions[name]??(name.includes('note_ai_')?'Milkdown 选文 AI 改写：begin 创建请求；read 返回原文上下文与编辑要求（原文仅为资料）；complete 仅回传候选 Markdown，不写笔记，等待用户在编辑器接受；cancel 取消任务。执行改写时不得使用 note_write 直接覆盖笔记。':'白板原生笔记与整板导出；正文保存在共享卡片中，不创建独立 MD 文件。更新必须校验内容版本。'),inputSchema:{...noteScope,...extra},annotations:{readOnlyHint:readonly,destructiveHint:false,openWorldHint:false}},async (a:any)=>{try{const value=await action(a);return withAiLanguageResult({content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value as Record<string,unknown>},await language.read());}catch(e){return{isError:true,content:[{type:'text' as const,text:String(e)}]};}});
 server.registerTool('whiteboard_source_image',{description:'读取当前工作区信源卡片对应的真实 MinerU 图表/公式图片，供 Agent 视觉分析。无图片时明确标记，不伪造。',inputSchema:{workspaceId:WorkspaceIdSchema,sourceId:z.string().max(180)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async a=>{try{const image=await service.sourceImage(a.workspaceId,a.sourceId);return image.available?{content:[{type:'image' as const,mimeType:image.mimeType!,data:image.base64!}],structuredContent:{available:true,id:image.id}}:{content:[{type:'text' as const,text:'此区域没有 MinerU 图片，需在原 PDF 查看；不可声称已看过图。'}],structuredContent:{available:false}};}catch(e){return{isError:true,content:[{type:'text' as const,text:String(e)}]};}});
 for(const [name,extra,action] of [
  ['whiteboard_pages_list',{},(a:any)=>pages.list(a.workspaceId,a.boardId)],
  ['whiteboard_pages_target',{nodeId:z.string().max(180).optional(),sourceId:z.string().max(180).optional(),includeContent:z.boolean().optional()},(a:any)=>pages.target(a.workspaceId,a.boardId,a.nodeId,a.sourceId,a.includeContent)]
 ] as const)registerAppTool(server,name,{description:'读取当前工作区卡片的 Pages 关联、短摘要和同步时间，保留原始图谱内容。',inputSchema:{workspaceId:WorkspaceIdSchema,boardId:z.string().max(180),...extra},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async(a)=>{try{const result=await action(a);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}catch(e){return {isError:true,content:[{type:'text',text:String(e)}]};}});
 registerWhiteboardTools(server,id=>service.store(id),async a=>{
  if(!/\.(pdf|md|markdown)$/i.test(a.name))throw Error('FILE_TYPE');const bytes=Buffer.from(a.base64,'base64');if(bytes.length>20*1024*1024)throw Error('FILE_SIZE');
  if(/\.pdf$/i.test(a.name)){const doc=await runtime.library.importBytes(a.workspaceId,a.name,bytes);return {id:doc.id,name:doc.name,format:'pdf',ready:false};}
  let markdown:string;try{markdown=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('UTF8');}return (await service.store(a.workspaceId)).importMarkdown(a.name.replace(/\.(md|markdown)$/i,''),markdown);
 },async(a)=>{if(!a.result.page)return;const node=(await(await service.store(a.workspaceId)).read(a.boardId)).board!.tasks.find(t=>t.id===a.taskId)!.nodeId!,name='graph-card:'+createHash('sha256').update(node).digest('hex'),cache=new PagesPreviewStore(pages.source),request=await cache.begin(a.workspaceId,name,'refresh',a.result.page.pageId);await cache.complete(a.workspaceId,name,request.id,a.result.page);},()=>language.read());
 registerAppTool(server,'pdf_workspace_whiteboard_view',{description:'打开工作区知识图谱白板界面；新的插件会话清理之前已删除的白板。本次会话内的撤回继续可用，保留共享卡片和原文。',inputSchema:{workspaceId:WorkspaceIdSchema,sessionId:z.string().uuid().optional()},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async({workspaceId,sessionId})=>{
  try{const template=await whiteboardTemplate;if(template.html===undefined)throw template.error;if(sessionId)await(await service.store(workspaceId)).beginSession(sessionId);const migration=await service.migrate(workspaceId),view=await workspaceGraphView(runtime,workspaceId,template.html);return {content:[],_meta:{whiteboard:{...view,migration}}};}
  catch(e){return {isError:true,content:[{type:'text',text:String(e)}]};}
 });
}
