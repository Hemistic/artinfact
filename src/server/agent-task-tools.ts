import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import type {WorkspaceRuntime} from './workspace-runtime.js';
import {WorkspaceIdSchema,DocumentIdSchema} from './workspaces.js';
import {WorkspaceWhiteboards} from './whiteboard-service.js';
import {ResearchAI} from './research-ai.js';
import {PdfReferenceService} from './pdf-reference-actions.js';
import {NoteAiTasks} from './note-ai-tasks.js';
import {UiLanguageStore} from './ui-language.js';
import {withAiLanguageResult} from '../shared/ai-output-language.js';
import {CardActionResult} from '../whiteboard/card-actions.js';
import {ResearchResult} from '../whiteboard/research-workbench.js';
import {WorkflowResult} from '../whiteboard/workflow.js';
import {WhiteboardPages} from './whiteboard-pages.js';
import {PagesPreviewStore} from './pages-preview.js';
import {requirePdfAi} from '../shared/pdf-features.js';
import {agentReadingTools,cardResultGuide} from '../shared/agent-reading-plan.js';

const id=z.string().min(1).max(180);
const targetSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('card'),taskId:id,boardId:id}).strict(),
 z.object({kind:z.literal('workflow'),taskId:id,boardId:id}).strict(),
 z.object({kind:z.literal('board'),taskId:id,boardId:id}).strict(),
 z.object({kind:z.literal('research'),taskId:id}).strict(),
 z.object({kind:z.literal('pdf_ai'),taskId:id,documentId:DocumentIdSchema}).strict(),
 z.object({kind:z.literal('reference'),taskId:id,documentId:DocumentIdSchema}).strict(),
 z.object({kind:z.literal('note'),taskId:z.string().uuid()}).strict(),
]);
type Target=z.infer<typeof targetSchema>;
const live=(task:any)=>['queued','running'].includes(task.status);
const quote=z.object({start:z.number().int().nonnegative(),end:z.number().int().positive(),quote:z.string().min(18).max(2400)}).strict();
const abstractResult=z.object({paperTitle:z.string().min(10).max(500),sourceUrl:z.string().url().max(4000),abstract:z.string().min(40).max(16000),title:z.string().min(1).max(500),markdown:z.string().min(1).max(4000),citations:z.array(quote).min(1).max(6)}).strict();
const referenceResult=z.object({title:z.string().min(1).max(500),markdown:z.string().min(1).max(12000),paperHash:z.string().regex(/^[a-f0-9]{64}$/),citations:z.array(quote).min(2).max(12),annotations:z.array(quote.extend({section:z.string().trim().min(1).max(240),comment:z.string().trim().min(10).max(1800)}).strict()).min(2).max(24).optional()}).strict();

export function registerAgentTaskTools(server:McpServer,runtime:WorkspaceRuntime){
 const boards=new WorkspaceWhiteboards(runtime),ai=new ResearchAI(runtime),references=new PdfReferenceService(runtime),notes=new NoteAiTasks(runtime),language=new UiLanguageStore(runtime.legacyStore.root);
 async function boardContext(workspaceId:string,target:Target):Promise<any>{
  const store=await boards.store(workspaceId);
  if(target.kind==='research')return store.researchRead(target.taskId);
  if(!('boardId'in target))throw Error('TASK_SCOPE');
  const header=await store.agentTaskHeader(target.taskId,target.boardId),task=header.task as typeof header.task&{kind?:string};
  const expected=target.kind==='card'?'card_action':target.kind==='workflow'?'workflow':undefined;
  if(expected?task.kind!==expected:['card_action','workflow'].includes(task.kind??''))throw Error('TASK_KIND');
  if(!live(task))return {revision:header.revision,task};
  return target.kind==='card'?store.cardActionRead(target.boardId,target.taskId):target.kind==='workflow'?store.workflowRead(target.boardId,target.taskId):{revision:header.revision,task,board:(await store.read(target.boardId)).board};
 }
 async function open(workspaceId:string,target:Target){
  let context:any;
  if(target.kind==='pdf_ai'){
   requirePdfAi();z.string().uuid().parse(target.taskId);const current=await ai.read(workspaceId,target.documentId),task=Object.values(current.jobs).find((t:any)=>t.id===target.taskId) as any;
   if(!task)throw Error('TASK_NOT_FOUND: 分析任务已替换');
   context={task,...(live(task)?await ai.context(workspaceId,target.documentId):{})};
  }else if(target.kind==='reference'){
   context=await references.read(workspaceId,target.documentId,target.taskId);
   if(context.task.status==='queued')context.task=await references.status(workspaceId,target.documentId,target.taskId,'running');
  }else if(target.kind==='note')context={task:await notes.read(workspaceId,target.taskId,true)};
  else for(let attempt=0;attempt<3;attempt++){
   context=await boardContext(workspaceId,target);if(context.task.status!=='queued')break;
   const store=await boards.store(workspaceId),args={taskId:target.taskId,expectedRevision:context.revision,requestId:randomUUID(),status:'running' as const};
   try{const next=target.kind==='research'?await store.researchStatus(args):await store.taskStatus({...args,boardId:target.boardId});context.revision=next.revision;context.task={...context.task,status:'running'};break;}
   catch(error){if(attempt===2||!String(error).includes('REVISION_CONFLICT'))throw error;}
  }
  const task={...context.task,instructions:context.task.instructions??context.task.instruction},outputLanguage=task.outputLanguage??await language.read(),terminal=!live(task);
  const action=task.cardAction?.action,selectionOnly=target.kind==='note'||target.kind==='card'&&['organize','rewrite','translate','summarize','extract_key_points'].includes(action)&&!context.source;
  const resultContract=target.kind==='card'?{markdown:'Markdown 正文',title:'可选',presentation:'update 且原卡为公式/证据时保持同类型；related-note 不传',imageAssetId:'仅实际生成新图时传'}:target.kind==='research'?{summary:'简短报告',findings:'[{title,markdown,basis:reported|inference|hypothesis,citations:[{sourceId,start,end,quote}],relatedNodeIds}]'}:target.kind==='pdf_ai'?{input:task.scope==='outline'?'只传 aiOutline':'只传 aiInsights 与 aiInsightMeta'}:target.kind==='note'?{markdown:'仅选文的候选 Markdown；等待用户接受'}:target.kind==='workflow'?{markdown:'Markdown',findings:'可选',citations:'精确来源',page:'可选，实际 Pages 全部 blocks',imageAssetId:'可选，实际图片附件'}:task.action==='abstract'?{paperTitle:'核实的题名',sourceUrl:'官方摘要地址',abstract:'实际完整摘要',title:'批注标题',markdown:'简短解读，明确仅依据摘要',citations:'摘要内精确切片'}:{title:'批注标题',markdown:'实际研读笔记',paperHash:'paper_read 返回值',citations:'精确切片',annotations:'study 必须覆盖不同章节'};
  const args={workspaceId,target};
  return {protocolVersion:1,target,task:{...task,outputLanguage},terminal,context:terminal?undefined:Object.fromEntries(Object.entries(context).filter(([key])=>key!=='task')),
   readPlan:{mode:selectionOnly?'selection':target.kind==='reference'&&task.action==='abstract'?'official_abstract':target.kind==='pdf_ai'?'mineru_blocks':'full_sources',sourceIds:task.sourceIds??[],instructions:selectionOnly?'只处理当前选文/笔记，引用的原文保持原样；无需例行通读无关论文。':'按任务范围补齐正文；分页按 nextOffset/end 继续，全文任务不得跳过方法、实验、限制与附录。图表必须通过 source_image/asset_read 实际看图。已返回内容不要重复获取。',citationOffsets:'JavaScript UTF-16 原样偏移',referenceRules:target.kind==='reference'?'abstract 只读官方摘要，不下载；study 必须 readingProgress.complete，下载仅 task.addToWorkspace 授权时加入原 workspace。':undefined},
   readTools:terminal?undefined:agentReadingTools(workspaceId,target,task,context,selectionOnly),
   completion:terminal?null:target.kind==='board'?{tool:task.kind==='source_cards'?'whiteboard_apply_source_cards':'whiteboard_apply_analysis',arguments:{workspaceId,boardId:target.boardId,taskId:target.taskId},instructions:'按原工具合同提交，expectedRevision 使用最新版本。'}:target.kind==='reference'&&task.action==='download'?{tool:'pdf_reference_paper_read',arguments:{workspaceId,documentId:target.documentId,taskId:target.taskId},instructions:'用 prepare/resolve 复用或绑定核实的论文；paper_read 等待后台下载完成，程序自动导入。'}:{tool:'agent_task_complete',arguments:args,resultContract,...(target.kind==='card'?{outputGuide:cardResultGuide(task,context)}:{})},
   failure:{tool:target.kind==='pdf_ai'?'pdf_ai_task_fail':target.kind==='reference'?'pdf_reference_action_status':target.kind==='note'?'whiteboard_note_ai_cancel':target.kind==='research'?'whiteboard_research_status':'whiteboard_task_status',arguments:{workspaceId,...('documentId'in target?{documentId:target.documentId}:{}),...('boardId'in target?{boardId:target.boardId}:{}),...(target.kind==='pdf_ai'?{jobId:target.taskId}:target.kind==='note'?{requestId:target.taskId}:{taskId:target.taskId,status:'failed'})}}};
 }
 async function complete(workspaceId:string,target:Target,result:Record<string,unknown>){
  if(target.kind==='board')throw Error('使用任务 completion 指定的旧版分析工具');
  let value:any;
  if(target.kind==='note')value=await notes.complete(workspaceId,target.taskId,z.object({markdown:z.string().trim().min(1).max(120000)}).strict().parse(result).markdown);
  else if(target.kind==='pdf_ai'){
   requirePdfAi();const input=z.object({input:z.record(z.string(),z.unknown())}).strict().parse(result).input;value=await ai.write(workspaceId,target.documentId,input,target.taskId);if(!value.valid)return {ok:false,valid:false,diagnostics:value.diagnostics};if(input.aiInsights){try{await(await boards.store(workspaceId)).syncInsightCards(target.documentId);}catch(error){return{ok:true,receipt:{persisted:true,taskId:target.taskId,kind:target.kind,status:'completed',destination:'pdf_reader',pendingCardsReady:false},warnings:['洞察已保存，待添加卡片同步失败：'+String(error)]};}}
  }else if(target.kind==='reference'){
   const context=await references.read(workspaceId,target.documentId,target.taskId);value=context.task.action==='abstract'?await references.completeAbstract(workspaceId,target.documentId,target.taskId,abstractResult.parse(result)):await references.complete(workspaceId,target.documentId,target.taskId,referenceResult.parse(result));
  }else{
   const store=await boards.store(workspaceId),requestId=randomUUID();
   for(let attempt=0;attempt<3;attempt++){
    const context=await store.agentTaskHeader(target.taskId,'boardId'in target?target.boardId:undefined);if(target.kind==='card'&&(context.task as any).kind!=='card_action'||target.kind==='workflow'&&(context.task as any).kind!=='workflow')throw Error('TASK_KIND');if(context.task.status==='completed')return{ok:true,receipt:{persisted:true,alreadyCompleted:true,submittedResultApplied:false,taskId:target.taskId,revision:context.revision,resultIds:(context.task as any).resultIds??[]}};
    if(!live(context.task))throw Error('TASK_STATE: 任务已结束或取消');
    const args={taskId:target.taskId,requestId,expectedRevision:context.revision};
    try{value=target.kind==='card'?await store.completeCardAction({...args,boardId:target.boardId,result:CardActionResult.parse(result)}):target.kind==='research'?await store.completeResearch({...args,result:ResearchResult.parse(result)}):await store.applyWorkflow({...args,boardId:target.boardId,result:WorkflowResult.parse(result)});break;}
    catch(error){if(attempt===2||!String(error).includes('REVISION_CONFLICT'))throw error;}
   }
   if(target.kind==='workflow'&&result.page){const page=WorkflowResult.parse(result).page!,node=value.board!.tasks.find((t:any)=>t.id===target.taskId).nodeId,name='graph-card:'+createHash('sha256').update(node).digest('hex'),cache=new PagesPreviewStore(new WhiteboardPages(runtime).source),request=await cache.begin(workspaceId,name,'refresh',page.pageId);await cache.complete(workspaceId,name,request.id,page);}
  }
  const task=value.task??value.board?.tasks?.find((t:any)=>t.id===target.taskId);
  const outputLanguage=task?.outputLanguage??value.outputLanguage??(Object.values(value.jobs??{}) as any[]).find(job=>job.id===target.taskId)?.outputLanguage;
  return {ok:true,outputLanguage,receipt:{persisted:true,taskId:target.taskId,kind:target.kind,status:task?.status??'completed',revision:value.revision,resultIds:task?.resultIds??[],annotationId:task?.annotationId??value.annotation?.id,sourceCardId:task?.sourceCardId,nodeId:task?.nodeId,reviewRequired:target.kind==='note',destination:target.kind==='note'?'editor_candidate':target.kind==='reference'?'pdf_annotations_and_pending_cards':target.kind==='research'&&task?.scope.kind==='article'?'pending_cards':target.kind==='pdf_ai'?'pdf_reader':'authorized_board'}};
 }
 for(const [name,description,extra,action] of [
  ['agent_task_open','统一领取已由用户创建的 Agent 任务，并一次返回范围、上下文、阅读计划、语言和回写合同。不创建分析，不扩大范围；已有 running 可恢复，终态不重做。',{},open],
  ['agent_task_complete','按统一合同保存实际 Agent 结果，自动获取全局 revision 并仅重试 revision 冲突；仍执行原工具的引用、来源快照、用户修改和取消校验。返回持久化 receipt，无需例行二次 read。',{result:z.record(z.string(),z.unknown())},complete],
 ]as const)server.registerTool(name,{description,inputSchema:{workspaceId:WorkspaceIdSchema,target:targetSchema,...extra},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async(a:any)=>{try{const value=await (action as any)(a.workspaceId,a.target,a.result);return withAiLanguageResult({content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value},value.task?.outputLanguage??value.outputLanguage??await language.read());}catch(error){return{isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:String(error)}]};}});
}
