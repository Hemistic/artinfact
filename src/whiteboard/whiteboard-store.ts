import {PortableSourceSchema,type PortableBoard} from './board-portable.js';
import {replaceDocumentAssets} from './board-markdown.js';
import {readFileSnapshot,primeFileSnapshot,fileVersion} from '../server/file-snapshot.js';
import { mkdir,readFile,writeFile,unlink,open,stat,link } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import {WorkflowPage,WorkflowResult,WorkflowTemplates,workflowScope} from './workflow.js';
import {pageReference} from '../shared/pages-preview.js';
import { isDeepStrictEqual } from 'node:util';
import {paperPanorama} from './paper-panorama.js';
import { freeFlowPosition,flowNodeSize } from './editable-flow-model.js';
import { renameWithRetry } from '../server/atomic-rename.js';
import {importDocument,importedSources} from './whiteboard-files.js';
import {sourceSegments,sourceCardInstructions,sourceCardId,SourceCardDraft,SourceCardRelation,type CardDraft,type CardRelation,type CardOptions} from './source-cards.js';
import { Templates,BoardSchema,BoardDataSchema,cardContent,type BoardData,type BoardNode,type Actor,type Source,type Operation,type BoardView } from './whiteboard-domain.js';
import {PdfPreprocessDraft,PdfPreprocessResult,PdfPreprocessTask,cachedPreprocessing,preprocessedCard,type PreprocessDraft,type PreprocessInput} from './pdf-preprocessing.js';
import {CardActionId,CardActionResult,cardActions,cardActionInstructions,cardSnapshot,cardAssetIds,retainChartMedia,actionLabels,type CardAction} from './card-actions.js';
import {synchronizeNoteHeading} from '../shared/note-heading.js';
import {BasicPdfRecord,basicCard} from './basic-pdf-cards.js';
import {encloseRegionCards} from './region-layout.js';
import {ResearchTask,ResearchScope,ResearchResult,researchSelection,researchSourceIds,type WorkbenchScope,type WorkbenchTask} from './research-workbench.js';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
// Imported board snapshots retain excerpts, not a local PDF that MinerU can process.
const isLocalPdfDocument=(source:Source)=>source.format==='pdf'&&(source.category??'document')==='document'&&!source.path.startsWith('portable:');
const RecordSchema=BoardDataSchema.extend({past:z.array(BoardDataSchema),future:z.array(BoardDataSchema),archived:z.boolean().optional()});
const PortableSnapshots=z.object({sources:z.array(PortableSourceSchema).default([]),pages:z.array(z.object({nodeId:z.string(),page:WorkflowPage,syncedAt:z.string()})).default([])});
const StateSchema=z.object({portablePages:z.array(z.object({nodeId:z.string(),page:WorkflowPage,syncedAt:z.string()})).default([]),portableSources:z.array(PortableSourceSchema).default([]),version:z.literal(1),revision:z.number().int().nonnegative(),initialized:z.boolean().default(false),sessions:z.array(z.string()).default([]),boards:z.array(RecordSchema),cards:z.array(z.any()),basicPdfCards:z.array(BasicPdfRecord).default([]),preprocessTasks:z.array(PdfPreprocessTask).default([]),preprocessResults:z.array(PdfPreprocessResult).default([]),researchTasks:z.array(ResearchTask).default([]),receipts:z.array(z.object({id:z.string(),fingerprint:z.string(),boardId:z.string().optional()})),events:z.array(z.object({at:z.string(),tool:z.string(),actor:z.string(),boardId:z.string().optional(),requestId:z.string()}))});
type State=z.infer<typeof StateSchema>;
type RecordData=z.infer<typeof RecordSchema>;
type Mutation={expectedRevision:number;requestId:string};
const initial=():State=>({portablePages:[],portableSources:[],version:1,revision:0,initialized:false,sessions:[],boards:[],cards:[],basicPdfCards:[],preprocessTasks:[],preprocessResults:[],researchTasks:[],receipts:[],events:[]});
const data=(b:RecordData):BoardData=>{const {past:_p,future:_f,archived:_a,...v}=b;return structuredClone(v);};
export class WhiteboardStore {
 constructor(readonly root:string,readonly sources:()=>Promise<Source[]>,readonly image?:(source:Source)=>Promise<string|undefined>){ }
 private async allSources(){return [...new Map([...await this.sources(),...await this.portableSources(),...await importedSources(this.root)].map(s=>[s.id,s])).values()];}
 private async portableSnapshots(){try{return await readFileSnapshot(join(this.root,'portable-snapshots.json'),'portable-whiteboard-v1',text=>PortableSnapshots.parse(JSON.parse(text)));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{sources:[],pages:[]};throw Error('导入白板快照读取失败，原文件已保留');}}
 async portableSources():Promise<Source[]>{const [legacy,snapshot]=await Promise.all([this.state(),this.portableSnapshots()]);return [...new Map([...legacy.portableSources,...snapshot.sources].map(s=>[s.id,s])).values()].map(s=>({...s,path:'portable:'+s.id,standard:s.format==='pdf'?true:undefined}));}
 async portablePages(){const [legacy,snapshot]=await Promise.all([this.state(),this.portableSnapshots()]);return structuredClone([...new Map([...legacy.portablePages,...snapshot.pages].map(p=>[p.nodeId,p])).values()]);}
 private async savePortableSnapshots(value:z.infer<typeof PortableSnapshots>){const old=await this.portableSnapshots(),next=PortableSnapshots.parse({sources:[...new Map([...old.sources,...value.sources].map(s=>[s.id,s])).values()],pages:[...new Map([...old.pages,...value.pages].map(p=>[p.nodeId,p])).values()]}),path=join(this.root,'portable-snapshots.json'),temporary=join(this.root,'portable-snapshots.'+randomUUID()+'.tmp'),json=JSON.stringify(next);try{await writeFile(temporary,json,{mode:0o600,flag:'wx'});await renameWithRetry(temporary,path);await primeFileSnapshot(path,'portable-whiteboard-v1',next,Buffer.byteLength(json));}finally{await unlink(temporary).catch(()=>{});}}

 async fileImport(args:{name:string;base64:string}){return importDocument(this.root,args);}
 async importMarkdown(title:string,markdown:string){
  if(markdown.length>120000)throw Error('NOTE_SIZE: Markdown 超过单卡片 120000 字符上限，原文件未修改');
  const id='import-note-'+hash(markdown),requestId='import-markdown:'+randomUUID();
  for(let attempt=0;attempt<3;attempt++){const state=await this.state();if(!state.cards.some(c=>c.id===id)){try{await this.transaction('whiteboard_import_markdown',{expectedRevision:state.revision,requestId},'import',undefined,s=>{this.publish(s,{id,title:synchronizeNoteHeading(title,markdown).title.slice(0,240),note:markdown,kind:'note',role:'note',x:0,y:0,width:420,height:200,autoHeight:true,createdBy:'import',updatedBy:'import'});},false);}catch(e){if(String(e).includes('REVISION_CONFLICT')&&attempt<2)continue;throw e;}}
   const card=(await this.cards()).cards.find(c=>c.id===id)!;return{id,name:card.title,format:'md',ready:true,note:true};
  }throw Error('STORE_BUSY');
 }
 private sourceReady(input:PreprocessInput){return input.text!==undefined&&!(input.source.category==='document'&&input.source.format==='pdf'&&input.source.standard===false);}
 private async state(){try{return await readFileSnapshot(join(this.root,'whiteboards.json'),'whiteboards-v1',text=>StateSchema.parse(JSON.parse(text)));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return initial();throw new Error('STORE_CORRUPT: 白板数据读取失败，原文件保留');}}
 private find(s:State,id:string){const b=s.boards.find(b=>b.id===id);if(!b)throw new Error('BOARD_NOT_FOUND: 白板不存在');return b;}
 private view(s:State,id?:string):BoardView {const b=s.boards.find(x=>x.id===id);return {revision:s.revision,board:b?data(b):null,canUndo:!!b?.past.length,canRedo:!!b?.future.length,...(b?.archived?{archived:true}:{})};}
 async read(id:string){const s=await this.state();this.find(s,id);return this.view(s,id);}
 async updates(id:string,knownRevision:number,knownPagesRevision=''){const state=await this.state();const board=this.find(state,id);let pagesRevision='';try{pagesRevision=await fileVersion(join(this.root,'..','.pages'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return {revision:state.revision,changed:state.revision!==knownRevision,pagesRevision,pagesChanged:pagesRevision!==knownPagesRevision,...(state.revision!==knownRevision?this.view(state,id):board.archived?{archived:true}:{})};}
 async noteEntries(){const state=await this.state();return state.boards.filter(b=>!b.archived).map(b=>({id:b.id,title:b.title,nodes:b.board.nodes.filter(n=>n.kind==='note'&&(n.role===undefined||n.role==='note')&&(!n.sourceId||n.referenceCard)&&!n.workflow).map(n=>({id:n.id,title:synchronizeNoteHeading(n.title,n.note).title}))}));}
 async list(){const s=await this.state(),summary=(b:RecordData)=>({id:b.id,title:b.title,templateId:b.templateId,nodeCount:b.board.nodes.length});return{revision:s.revision,initialized:s.initialized||s.boards.length>0,boards:s.boards.filter(b=>!b.archived).map(summary),archivedBoards:s.boards.filter(b=>b.archived).map(summary),items:s.boards.map(b=>({...summary(b),archived:!!b.archived}))};}
 async beginSession(sessionId:string){
  if(!sessionId||sessionId.length>180)throw Error('SESSION_ID');
  for(let attempt=0;attempt<5;attempt++){
   const current=await this.state();if(current.sessions.includes(sessionId))return;
   try{await this.transaction('whiteboard_session_begin',{expectedRevision:current.revision,requestId:'session:'+sessionId,sessionId},'user',undefined,s=>{
    // A single host session survives iframe refreshes, graph switches and workspace switches.
    const deleted=new Set(s.boards.filter(b=>b.archived).map(b=>b.id));s.boards=s.boards.filter(b=>!deleted.has(b.id));
    s.receipts=s.receipts.filter(r=>!r.boardId||!deleted.has(r.boardId));s.sessions=[...s.sessions,sessionId].slice(-100);
   },false);return;}catch(e){if(!String(e).includes('REVISION_CONFLICT')||attempt===4)throw e;}
  }
 }
 async cards(){const s=await this.state();return{revision:s.revision,cards:structuredClone(s.cards)};}
 async events(){const s=await this.state();return{revision:s.revision,events:structuredClone(s.events)};}
 private async preprocessInputs(sources?:Source[]):Promise<PreprocessInput[]>{
  const items=await Promise.all((sources??await this.allSources()).map(async source=>{const text=source.text??(source.markdownPath?await readFile(source.markdownPath,'utf8'):undefined);return{source,text,revision:hash(text??''),documentRevision:''};}));
  const documents=new Map(items.filter(i=>(i.source.category??'document')==='document').map(i=>[i.source.id,hash((i.text??'')+'\0'+(i.source.structureRevision??''))]));
  for(const item of items)item.documentRevision=documents.get(item.source.documentId??item.source.id)??'';return items;
 }
 private basicRevision(input:PreprocessInput){const s=input.source;return hash(JSON.stringify([input.revision,s.category,s.page,s.latex,s.caption,s.assetPath,s.parentSourceId,s.references,s.name]));}
 private basicReady(state:State,input:PreprocessInput){return state.basicPdfCards.some(r=>r.sourceId===input.source.id&&r.revision===this.basicRevision(input))&&state.cards.some(c=>c.id==='material-'+input.source.id);}
 async preprocessRead(taskId?:string){
  const [state,inputs]=await Promise.all([this.state(),this.preprocessInputs()]);
  const summary=(t:State['preprocessTasks'][number])=>({id:t.id,documentIds:t.documentIds,status:t.status,message:t.message,total:t.sourceIds.length,completed:t.processedIds.length});
  const documents=inputs.filter(i=>isLocalPdfDocument(i.source)).map(doc=>{const items=inputs.filter(i=>(i.source.documentId??i.source.id)===doc.source.id&&i.source.format==='pdf');const completed=items.filter(i=>this.sourceReady(i)).length;return{id:doc.source.id,name:doc.source.name,ready:!!doc.text?.trim()&&doc.source.standard!==false,total:items.length,completed,basicCompleted:completed,aiCompleted:items.filter(i=>cachedPreprocessing(state.preprocessResults,i)).length};});
  const task=taskId?state.preprocessTasks.find(t=>t.id===taskId):undefined;if(taskId&&!task)throw Error('TASK_NOT_FOUND');
  return{revision:state.revision,documents,tasks:state.preprocessTasks.slice(-10).map(summary),...(task?{task:{...task,...summary(task),remainingIds:task.sourceIds.filter(id=>!task.processedIds.includes(id))}}:{})};
 }
 async preprocessResults(documentId?:string,offset=0,limit=20){const [state,inputs]=await Promise.all([this.state(),this.preprocessInputs()]);if(documentId&&!inputs.some(i=>i.source.id===documentId&&i.source.category==='document'))throw Error('PDF_REQUIRED');const results=inputs.filter(i=>!documentId||(i.source.documentId??i.source.id)===documentId).flatMap(input=>{const result=cachedPreprocessing(state.preprocessResults,input);return result?[{...result,category:input.source.category,documentId:input.source.documentId??input.source.id,page:input.source.page}]:[];});return{revision:state.revision,results:results.slice(offset,offset+limit),total:results.length,nextOffset:offset+limit<results.length?offset+limit:null};}
 async requestPreprocess(args:Mutation&{documentIds:string[];force?:boolean}){
  const ids=[...new Set(args.documentIds)];
  await this.transaction('whiteboard_pdf_preprocess_request',args,'user',undefined,async state=>{
   const inputs=await this.preprocessInputs(),docs=ids.map(id=>inputs.find(i=>i.source.id===id&&isLocalPdfDocument(i.source)));
   if(!ids.length||docs.some(d=>!d))throw Error('PDF_REQUIRED: 请选择当前工作区的 PDF');
   if(docs.some(d=>!d!.text?.trim()||d!.source.standard===false))throw Error('SOURCE_NOT_PARSED: 请先完成本机 MinerU 标准 Markdown 和 JSON 解析');
   const selected=inputs.filter(i=>ids.includes(i.source.documentId??i.source.id)&&i.source.format==='pdf'&&i.text!==undefined);
   // Preparing source cards never grants permission to run semantic analysis.
   for(const task of state.preprocessTasks)if(['queued','running'].includes(task.status)&&task.documentIds.some(id=>ids.includes(id))){task.status='cancelled';task.message='基础卡片改为自动生成；AI 仅在用户主动请求时运行';}
   for(const input of selected){
    if(!args.force&&this.basicReady(state,input))continue;
    const existing=state.cards.find(c=>c.id==='material-'+input.source.id);
    if(!existing||existing.createdBy==='import'&&existing.updatedBy==='import'){
     let imageId:string|undefined;if(['figure','table'].includes(input.source.category??'')||input.source.category==='formula'&&!input.source.latex)imageId=await this.image?.(input.source);
     this.publish(state,basicCard(input,imageId));
    }
    state.basicPdfCards=state.basicPdfCards.filter(r=>r.sourceId!==input.source.id);
    state.basicPdfCards.push({sourceId:input.source.id,revision:this.basicRevision(input),updatedAt:new Date().toISOString()});
   }
  },false);
  return {...await this.preprocessRead(),mode:'basic' as const,message:'基础卡片已自动生成；未启动 Agent'};
 }
 async preprocessStatus(args:Mutation&{taskId:string;status:'running'|'failed'|'cancelled';message?:string}){
  await this.transaction('whiteboard_pdf_preprocess_status',args,args.status==='cancelled'?'user':'agent',undefined,state=>{const task=state.preprocessTasks.find(t=>t.id===args.taskId);if(!task||!['queued','running'].includes(task.status))throw Error('TASK_STATE');task.status=args.status;task.message=args.message??args.status;},false);return this.preprocessRead(args.taskId);
 }
 async syncInsightCards(documentId:string){
  const inputs=(await this.preprocessInputs()).filter(i=>i.source.documentId===documentId&&i.source.category==='insight');
  for(let attempt=0;attempt<3;attempt++){const current=await this.state();try{return await this.transaction('whiteboard_insight_cards',{expectedRevision:current.revision,requestId:randomUUID()},'import',undefined,state=>{for(const input of inputs){const existing=state.cards.find(c=>c.id==='material-'+input.source.id);if(!existing||existing.createdBy==='import'&&existing.updatedBy==='import')this.publish(state,basicCard(input));}},false);}catch(e){if(!String(e).includes('REVISION_CONFLICT')||attempt===2)throw e;}}
 }
 async applyPreprocess(args:Mutation&{taskId:string;drafts:PreprocessDraft[];summary:string}){
  await this.transaction('whiteboard_pdf_preprocess_apply',args,'agent',undefined,async state=>{
   const task=state.preprocessTasks.find(t=>t.id===args.taskId);if(!task||!['queued','running'].includes(task.status))throw Error('TASK_STATE: 预处理已结束或取消');
   const inputs=await this.preprocessInputs(),byId=new Map(inputs.map(i=>[i.source.id,i]));
   for(const id of Object.keys(task.sourceRevisions)){const input=byId.get(id);if(!input||input.revision!==task.sourceRevisions[id]||input.documentRevision!==task.documentRevisions[input.source.documentId??input.source.id])throw Error('SOURCE_CHANGED: 资料已改变，请重新预处理');}
   const drafts=z.array(PdfPreprocessDraft).min(1).max(50).parse(args.drafts);if(new Set(drafts.map(d=>d.sourceId)).size!==drafts.length)throw Error('DUPLICATE_SOURCE');
   for(const draft of drafts){const input=byId.get(draft.sourceId);if(!input||!task.sourceIds.includes(draft.sourceId))throw Error('SOURCE_SCOPE');if(input.source.category==='formula'&&draft.presentation?.type!=='formula')throw Error('FORMULA_PRESENTATION: 公式需要 LaTeX、说明和符号定义');
    for(const citation of draft.citations){const target=byId.get(citation.sourceId);if(!target||!task.sourceRevisions[citation.sourceId]||(target.source.documentId??target.source.id)!==(input.source.documentId??input.source.id))throw Error('CITATION_SCOPE');if(citation.end<=citation.start||citation.end>(target.text?.length??0)||target.text?.slice(citation.start,citation.end)!==citation.quote)throw Error('CITATION_MISMATCH');}
   }
   for(const draft of drafts){const input=byId.get(draft.sourceId)!,result={...draft,revision:input.revision,documentRevision:input.documentRevision,taskId:task.id,updatedAt:new Date().toISOString()};state.preprocessResults=state.preprocessResults.filter(r=>r.sourceId!==draft.sourceId);state.preprocessResults.push(result);if(!task.processedIds.includes(draft.sourceId))task.processedIds.push(draft.sourceId);
    const card=preprocessedCard(input.source,result),existing=state.cards.find(n=>n.id===card.id);if(!existing||existing.updatedBy==='agent')this.publish(state,card);
   }
   task.status=task.processedIds.length===task.sourceIds.length?'completed':'running';task.message=args.summary;
  },false);return this.preprocessRead(args.taskId);
 }
 async importGraphCards(args:Mutation&{nodes:BoardNode[]}){return this.transaction('whiteboard_graph_cards',args,'agent',undefined,state=>{for(const node of args.nodes){const existing=state.cards.find(c=>c.id===node.id);if(existing?.updatedBy==='user')continue;this.publish(state,node);}},false);}
 private async transaction<T extends Mutation>(tool:string,args:T,actor:Actor,boardId:string|undefined,fn:(s:State)=>Promise<string|void>|string|void,history=true){
  await mkdir(this.root,{recursive:true});const path=join(this.root,'.whiteboard.lock');let lock;const until=Date.now()+10000;
  while(!lock){try{lock=await open(path,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,at:Date.now()}));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;try{const value=await readFile(path,'utf8'),mtime=(await stat(path)).mtimeMs;let stale=false;try{const owner=JSON.parse(value);try{process.kill(owner.pid,0);}catch(e){stale=(e as NodeJS.ErrnoException).code==='ESRCH';}}catch{stale=Date.now()-mtime>30000;}if(stale&&(await readFile(path,'utf8'))===value&&(await stat(path)).mtimeMs===mtime){await unlink(path);continue;}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(Date.now()>until)throw new Error('STORE_BUSY: 白板正在保存，请重试');await new Promise(r=>setTimeout(r,30));}}
  try{
   const s=structuredClone(await this.state()),fingerprint=hash(JSON.stringify([tool,args])),receipt=s.receipts.find(r=>r.id===args.requestId);
   if(receipt){if(receipt.fingerprint!==fingerprint)throw new Error('REQUEST_ID: 同一请求编号不能用于不同操作');return this.view(s,receipt.boardId);}
   if(s.revision!==args.expectedRevision)throw new Error('REVISION_CONFLICT: 白板已更新，请重新读取；当前版本 '+s.revision);
   const b=boardId?this.find(s,boardId):undefined;if(b?.archived&&tool!=='whiteboard_archive')throw new Error('BOARD_ARCHIVED: 白板已删除，请先恢复');if(b&&history){b.past.push(data(b));b.past=b.past.slice(-40);b.future=[];}
   s.initialized ||= s.boards.length>0;
   const resultId=await fn(s)??boardId;s.initialized ||= s.boards.length>0;
   for(const b of s.boards){for(const group of b.board.groups??[]){if(group.id.startsWith('source-'))continue;const bounds=encloseRegionCards(b.board.nodes.filter(n=>n.groupId===group.id).map(n=>({x:n.x,y:n.y,width:n.width??420,height:n.height??200})));if(bounds)group.bounds=bounds;}BoardSchema.parse(b.board);}
   s.revision++;s.receipts.push({id:args.requestId,fingerprint,boardId:resultId});s.receipts=s.receipts.slice(-300);
   s.events.push({at:new Date().toISOString(),tool,actor,boardId:resultId,requestId:args.requestId});s.events=s.events.slice(-400);
   const temporary=join(this.root,'whiteboards.'+randomUUID()+'.tmp');try{const validated=StateSchema.parse(s),json=JSON.stringify(validated),path=join(this.root,'whiteboards.json');await writeFile(temporary,json,{mode:0o600});await renameWithRetry(temporary,path);await primeFileSnapshot(path,'whiteboards-v1',validated,Buffer.byteLength(json));}finally{await unlink(temporary).catch(()=>{});}
   return this.view(s,resultId);
  }finally{await lock.close();await unlink(path);}
 }
 async restorePortable(args:Mutation&{package:PortableBoard;assetIds:Record<string,string>}){
  return this.transaction('whiteboard_package_import',args,'import',undefined,async s=>{
   const snapshots:z.infer<typeof PortableSnapshots>={sources:[...s.portableSources],pages:[...s.portablePages]};
   const input=args.package,board=structuredClone(input.board),id=randomUUID(),nodes=new Map(board.board.nodes.map(n=>[n.id,randomUUID()])),groups=new Map((board.board.groups??[]).map(g=>[g.id,(g.id.startsWith('source-')?'source-':'')+randomUUID()])),sources=new Map(input.sources.map(source=>[source.id,'portable-'+hash(id+source.id)])),images=new Map(Object.entries(args.assetIds).map(([a,b])=>[a,'flow-asset:'+b]));
   const sourceId=(value:string)=>sources.get(value)??value,remapPage=(page:z.infer<typeof WorkflowPage>)=>({...page,blocks:page.blocks.map(block=>({...block,...(block.kind==='markdown'?{markdown:replaceDocumentAssets(block.markdown,images)}:{})}))});
   for(const node of board.board.nodes){const original=node.id;node.id=nodes.get(original)!;if(node.groupId)node.groupId=groups.get(node.groupId);if(node.sourceId)node.sourceId=sourceId(node.sourceId);delete node.sourcePath;node.note=replaceDocumentAssets(node.note,images);for(const c of node.citations??[])c.sourceId=sourceId(c.sourceId);if(node.workflowOrigin){const mapped=nodes.get(node.workflowOrigin.nodeId);if(mapped)node.workflowOrigin.nodeId=mapped;else delete node.workflowOrigin;}
    if(node.workflow?.result){const result=node.workflow.result;if(result.page)result.page=remapPage(result.page);result.markdown=replaceDocumentAssets(result.markdown,images);if(result.imageAssetId)result.imageAssetId=args.assetIds[result.imageAssetId]??result.imageAssetId;for(const c of result.citations)c.sourceId=sourceId(c.sourceId);for(const finding of result.findings??[])for(const c of finding.citations)c.sourceId=sourceId(c.sourceId);}
    const page=input.pages.find(p=>p.nodeId===original);if(page)snapshots.pages.push({nodeId:node.id,page:remapPage(page.page),syncedAt:page.syncedAt??new Date().toISOString()});
    this.publish(s,node);
   }
   for(const group of board.board.groups??[])group.id=groups.get(group.id)!;
   for(const edge of board.board.edges){edge.id=randomUUID();edge.source=nodes.get(edge.source)!;edge.target=nodes.get(edge.target)!;}
   for(const source of input.sources)snapshots.sources.push({...source,text:replaceDocumentAssets(source.text,images),id:sourceId(source.id),...(source.documentId?{documentId:sourceId(source.documentId)}:{}),...(source.parentSourceId?{parentSourceId:sourceId(source.parentSourceId)}:{}),...(source.cardId?{cardId:nodes.get(source.cardId)}:{}),...(source.assetId?{assetId:args.assetIds[source.assetId]??source.assetId}:{})});
   board.id=id;board.title=input.title;board.sourceIds=board.sourceIds.map(sourceId);board.tasks=[];await this.savePortableSnapshots(snapshots);s.boards.push({...board,past:[],future:[]});return id;
  });
 }
 async create(args:Mutation&{title:string;templateId:BoardData['templateId']}){return this.transaction('whiteboard_create',args,'user',undefined,s=>{const id=randomUUID();s.boards.push({id,title:args.title,templateId:args.templateId,sourceIds:[],board:{version:1,nodes:[],edges:[],groups:[]},tasks:[],past:[],future:[]});return id;});}
 async archive(args:Mutation&{boardId:string;archived:boolean}){return this.transaction('whiteboard_archive',args,'user',args.boardId,s=>{const b=this.find(s,args.boardId);b.archived=args.archived;if(args.archived)for(const t of s.researchTasks)if(t.scope.kind!=='article'&&t.scope.boardId===b.id&&['queued','running'].includes(t.status)){t.status='cancelled';t.message='白板已删除';}if(args.archived)for(const task of b.tasks)if(task.status==='queued'||task.status==='running'){task.status='cancelled';task.message='白板已删除，任务已取消';}},false);}
 async createPanorama(args:Mutation&{sourceId:string}){return this.transaction('whiteboard_paper_panorama',args,'user',undefined,async s=>{const sources=await this.allSources(),board=paperPanorama(sources,args.sourceId,s.cards),id=randomUUID(),source=sources.find(v=>v.id===args.sourceId)!;for(const node of board.nodes)this.publish(s,node);s.boards.push({id,title:(source.name+' · 论文全景').slice(0,160),templateId:'free',sourceIds:board.nodes.map(n=>n.sourceId!),board,tasks:[],past:[],future:[]});return id;});}
 async importBoard(args:Mutation&{title:string;board:unknown;legacyKey:string;sourceIds?:string[]}){return this.transaction('whiteboard_import',args,'import',undefined,s=>{const id='legacy-'+hash(args.legacyKey).slice(0,24);if(s.boards.some(b=>b.id===id))return id;const board=BoardSchema.parse(args.board);for(const n of board.nodes){n.createdBy??='import';n.updatedBy??='import';this.publish(s,n);}s.boards.push({id,title:args.title,templateId:'free',sourceIds:args.sourceIds??[],board,tasks:[],past:[],future:[]});return id;});}
 private publish(s:State,node:BoardNode){const content=cardContent(node),i=s.cards.findIndex(c=>c.id===node.id);if(i<0)s.cards.push(content);else s.cards[i]=content;for(const b of s.boards){const n=b.board.nodes.find(n=>n.id===node.id);if(n){for(const key of Object.keys(cardContent(n)))delete (n as unknown as Record<string,unknown>)[key];Object.assign(n,content);}}}
 private patchState(s:State,b:RecordData,operations:Operation[],actor:Actor){
  for(const o of operations){
   if(o.op==='put_node'){
    const previous=s.cards.find(n=>n.id===o.node.id);
    let candidate=o.node;
    if(candidate.kind==='note'&&(candidate.role===undefined||candidate.role==='note')&&!candidate.workflow&&(!candidate.sourceId||candidate.referenceCard)&&(!previous||candidate.title!==previous.title||candidate.note!==previous.note)){const canonical=synchronizeNoteHeading(candidate.title,candidate.note,previous);candidate={...candidate,title:canonical.title,note:canonical.markdown};}
    const content={...cardContent(candidate),createdBy:previous?.createdBy??actor,updatedBy:previous?.updatedBy??actor};
    const same=previous&&Object.keys({...previous,...content}).every(key=>JSON.stringify(previous[key])===JSON.stringify((content as Record<string,unknown>)[key]));
    const firstPresentation=!!previous&&!previous.presentation&&!!content.presentation&&Object.keys({...previous,...content}).filter(key=>key!=='presentation').every(key=>isDeepStrictEqual(previous[key],(content as Record<string,unknown>)[key]));
    if(actor==='agent'&&previous?.updatedBy==='user'&&!same&&!firstPresentation)throw new Error('MANUAL_CONTENT: 用户笔记不能被 Agent 覆盖，请新建关联笔记');
    const node={...candidate,createdBy:previous?.createdBy??actor,updatedBy:same||firstPresentation?previous.updatedBy:actor};const index=b.board.nodes.findIndex(n=>n.id===node.id);if(index<0)b.board.nodes.push(node);else b.board.nodes[index]=node;this.publish(s,node);
   }else if(o.op==='remove_node'){if(actor==='agent'&&s.cards.find(n=>n.id===o.id)?.updatedBy==='user')throw new Error('MANUAL_CONTENT: 用户节点不能由 Agent 自动移除');b.board.nodes=b.board.nodes.filter(n=>n.id!==o.id);b.board.edges=b.board.edges.filter(e=>e.source!==o.id&&e.target!==o.id);}
   else if(o.op==='put_edge'){const i=b.board.edges.findIndex(e=>e.id===o.edge.id);if(i<0)b.board.edges.push(o.edge);else b.board.edges[i]=o.edge;}
   else if(o.op==='remove_edge')b.board.edges=b.board.edges.filter(e=>e.id!==o.id);
   else if(o.op==='put_group'){b.board.groups??=[];const i=b.board.groups.findIndex(g=>g.id===o.group.id);if(i<0)b.board.groups.push(o.group);else b.board.groups[i]=o.group;}
   else if(o.op==='remove_group'){b.board.groups=b.board.groups?.filter(g=>g.id!==o.id);for(const n of b.board.nodes)if(n.groupId===o.id)delete n.groupId;}
   else if(o.op==='rename')b.title=o.title;
  }
 }
 async patch(args:Mutation&{boardId:string;operations:Operation[];actor:Actor;refineGeometry?:boolean}){return this.transaction('whiteboard_patch',args,args.actor,args.boardId,async s=>{const b=this.find(s,args.boardId);if(args.refineGeometry)for(const op of args.operations){if(op.op!=='put_node')throw new Error('GEOMETRY_ONLY');const old=b.board.nodes.find(n=>n.id===op.node.id);if(!old||old.groupId!==op.node.groupId||!isDeepStrictEqual(cardContent(old),cardContent(op.node)))throw new Error('GEOMETRY_ONLY: 自动高度修正不能改变内容或成员');}
  for(const op of args.operations)if(op.op==='put_node'&&op.node.studyNote){
   const old=b.board.nodes.find(n=>n.id===op.node.id);
   if(!old?.studyNote||!isDeepStrictEqual(old.citations,op.node.citations))for(const citation of op.node.citations??[]){const source=await this.sourceRead(citation.sourceId,citation.start,citation.end-citation.start);if(citation.end<=citation.start||source.text!==citation.quote)throw Error('CITATION_MISMATCH: 研读原文必须与 MinerU Markdown 一致');}
   if(op.node.studyNote.highlights.some(h=>!op.node.citations?.[h.citation]?.quote.includes(h.text)))throw Error('STUDY_HIGHLIGHT: 高亮不在原文摘录中');
  }
  this.patchState(s,b,args.operations,args.actor);},!args.refineGeometry);}
 async addCards(args:Mutation&{boardId:string;cardIds:string[]}){return this.transaction('whiteboard_add_cards',args,'user',args.boardId,s=>{const b=this.find(s,args.boardId);for(const id of args.cardIds){if(b.board.nodes.some(n=>n.id===id))continue;const c=s.cards.find(c=>c.id===id);if(!c)throw new Error('CARD_NOT_FOUND');const node={...c,x:60+b.board.nodes.length%3*510,y:80+Math.floor(b.board.nodes.length/3)*420,width:420,height:200,autoHeight:true};Object.assign(node,freeFlowPosition(b.board,node,node.id,flowNodeSize(node)));b.board.nodes.push(node);}});}
 async sourceRead(sourceId:string,offset=0,limit=20000){const source=(await this.allSources()).find(s=>s.id===sourceId);if(!source)throw new Error('SOURCE_NOT_FOUND');if(!source.markdownPath&&source.text===undefined)throw new Error('SOURCE_NOT_PARSED: 先在 Workspace 完成 PDF 转 Markdown');const text=source.text??await readFile(source.markdownPath!,'utf8');if(offset>text.length)throw new Error('SOURCE_RANGE');return{sourceId,name:source.name,revision:hash(text),offset,text:text.slice(offset,offset+limit),totalCharacters:text.length,nextOffset:offset+limit<text.length?offset+limit:null,category:source.category,documentId:source.documentId,annotationId:source.annotationId,page:source.page,assetId:source.assetId};}
 async referenceRead(sourceId:string,offset=0,limit=12){const source=(await this.allSources()).find(s=>s.id===sourceId);if(source?.category!=='reference'||!source.bibliography)throw Error('REFERENCE_NOT_FOUND');const b=source.bibliography;return {sourceId,revision:hash(JSON.stringify(b)),documentId:source.documentId,name:source.name,raw:b.raw,number:b.number,authorKey:b.authorKey,year:b.year,doi:b.doi,url:b.url,entry:b.entry,occurrences:b.occurrences.slice(offset,offset+limit),offset,totalOccurrences:b.occurrences.length,nextOffset:offset+limit<b.occurrences.length?offset+limit:null};}
 async sourceList(){const [inputs,state]=await Promise.all([this.preprocessInputs(),this.state()]);return{sources:inputs.map(input=>{const s=input.source,cached=cachedPreprocessing(state.preprocessResults,input);return{id:s.id,name:s.name,format:s.format,category:s.category??'document',documentId:s.documentId,page:s.page,annotationId:s.annotationId,assetId:s.assetId,cardId:s.cardId,parentSourceId:s.parentSourceId,caption:s.caption,latex:s.latex,preview:input.text?.slice(0,2000),referenceCount:s.bibliography?.occurrences.length,processed:!!cached,basicReady:this.sourceReady(input),analysisReady:!!cached,ready:this.sourceReady(input),...(input.text!==undefined?{revision:input.revision}:{})};})};}
 async sourceSections(sourceId:string,offset=0,limit=8){
  const source=(await this.allSources()).find(s=>s.id===sourceId);if(!source)throw new Error('SOURCE_NOT_FOUND');if(!source.markdownPath&&source.text===undefined)throw new Error('SOURCE_NOT_PARSED: 请先在 Workspace 解析 PDF');
  const text=source.text??await readFile(source.markdownPath!,'utf8'),sections=sourceSegments(text);
  if(offset>sections.length)throw new Error('SOURCE_RANGE');
  return{sourceId,name:source.name,format:source.format,revision:hash(text),totalCharacters:text.length,totalSections:sections.length,offset,sections:sections.slice(offset,offset+limit),nextOffset:offset+limit<sections.length?offset+limit:null,locationKind:source.format==='pdf'?'parsed-markdown':'markdown'};
 }
 async requestSourceCards(args:Mutation&{boardId:string;sourceIds:string[];mode:CardOptions['mode'];autoConnect:boolean;question?:string}){
  return this.transaction('whiteboard_request_source_cards',args,'user',args.boardId,async s=>{
   const b=this.find(s,args.boardId);if(b.tasks.some(t=>t.status==='running'))throw new Error('TASK_STATE: 请先完成或取消当前分析');
   const ids=[...new Set(args.sourceIds)];if(!ids.length||ids.some(id=>!b.sourceIds.includes(id)))throw new Error('SOURCE_SCOPE: 先将选定信源添加到本白板');
   const sourceRevisions:Record<string,string>={};for(const id of ids){const raw=await this.sourceRead(id,0,1);if(!raw.totalCharacters)throw new Error('SOURCE_EMPTY: 信源正文为空');sourceRevisions[id]=raw.revision;}
   const options={mode:args.mode,autoConnect:args.autoConnect,question:args.question??''};
   const previous=b.tasks.find(t=>t.status==='queued'&&t.kind==='source_cards'&&isDeepStrictEqual(t.sourceIds,ids)&&isDeepStrictEqual(t.sourceCards,options)&&isDeepStrictEqual(t.sourceRevisions,sourceRevisions));
   if(previous)return;
   b.tasks.push({id:randomUUID(),kind:'source_cards',status:'queued',sourceIds:ids,sourceRevisions,sourceCards:options,instructions:sourceCardInstructions(options),message:'等待 Agent 阅读所选信源并拆成卡片',createdAt:new Date().toISOString()});
  });
 }
 async applySourceCards(args:Mutation&{boardId:string;taskId:string;drafts:CardDraft[];relations:CardRelation[];summary:string}){
  return this.transaction('whiteboard_apply_source_cards',args,'agent',args.boardId,async s=>{
   const b=this.find(s,args.boardId),task=b.tasks.find(t=>t.id===args.taskId);if(!task||task.kind!=='source_cards'||!['queued','running'].includes(task.status))throw new Error('TASK_STATE: 拆分任务已结束或取消');
   const drafts=z.array(SourceCardDraft).min(1).max(100).parse(args.drafts),relations=z.array(SourceCardRelation).max(200).parse(args.relations);
   if(!task.sourceCards?.autoConnect&&relations.length)throw new Error('RELATIONS_DISABLED: 用户选择了自行组织');
   for(const id of task.sourceIds)if((await this.sourceRead(id,0,1)).revision!==task.sourceRevisions[id])throw new Error('SOURCE_CHANGED: 请重新读取并拆分');
   for(const draft of drafts)for(const c of draft.citations){if(!task.sourceIds.includes(c.sourceId))throw new Error('CITATION_SCOPE');const raw=await this.sourceRead(c.sourceId,c.start,c.end-c.start);if(c.end<=c.start||c.end>raw.totalCharacters||raw.text!==c.quote)throw new Error('CITATION_MISMATCH: 引句必须原样对应信源');}
   if(relations.some(r=>r.from>=drafts.length||r.to>=drafts.length||r.from===r.to))throw new Error('RELATION_RANGE');
   const ids:string[]=[],operations:Operation[]=[];let added=0,reused=0;
   const roles:Record<CardDraft['category'],BoardNode['role']>={section:'evidence',concept:'note',claim:'contribution',method:'contribution',experiment:'evidence',result:'result',limitation:'limitation',question:'note'};
   for(const draft of drafts){
    const sourceId=draft.citations[0].sourceId,revision=task.sourceRevisions[sourceId],id=sourceCardId(draft,revision);ids.push(id);
    if(b.board.nodes.some(n=>n.id===id)){reused++;continue;}
    const saved=s.cards.find(c=>c.id===id),anchor=b.board.nodes.find(n=>n.role==='source'&&n.sourceId===sourceId);
    const node:BoardNode={id,title:draft.title,note:draft.note,...(draft.presentation?{presentation:draft.presentation}:{}),kind:draft.basis==='inference'?'inference':draft.category==='method'?'method':'note',role:roles[draft.category],basis:draft.basis,sourceId,citations:draft.citations,sourceCard:{revision,category:draft.category,taskId:task.id},x:(anchor?.x??0)+560+(added%3)*520,y:(anchor?.y??0)+Math.floor(added/3)*400,width:440,height:340,autoHeight:true,...saved};
    Object.assign(node,freeFlowPosition(b.board,node,id,flowNodeSize(node)));b.board.nodes.push(node);operations.push({op:'put_node',node});added++;if(saved)reused++;
   }
   for(const r of relations){const source=ids[r.from],target=ids[r.to];if(source===target||b.board.edges.some(e=>e.source===source&&e.target===target))continue;const edge={id:'suggested-'+hash(JSON.stringify([source,target])).slice(0,28),source,target,label:r.label,suggested:true,sourceSide:'right' as const,targetSide:'left' as const};b.board.edges.push(edge);operations.push({op:'put_edge',edge});}
   this.patchState(s,b,operations,'agent');task.status='completed';task.message=args.summary+'\n'+added+' 张卡片放入白板，'+reused+' 张复用；'+operations.filter(o=>o.op==='put_edge').length+' 条建议连接。';
  });
 }
 private async queue(b:RecordData,instructions?:string){const sourceRevisions:Record<string,string>={};for(const id of b.sourceIds){sourceRevisions[id]=(await this.sourceRead(id,0,1)).revision;}const previous=b.tasks.find(t=>t.status==='queued');if(previous&&!instructions){previous.sourceIds=[...b.sourceIds];previous.sourceRevisions=sourceRevisions;return;}b.tasks.push({id:randomUUID(),status:'queued',sourceIds:[...b.sourceIds],sourceRevisions,instructions:instructions??Templates.find(t=>t.id===b.templateId)!.instructions,message:'等待 Agent 读取信源并分析',createdAt:new Date().toISOString()});}
 async addSources(args:Mutation&{boardId:string;sourceIds:string[];position?:{x:number;y:number}}){return this.transaction('whiteboard_add_sources',args,'user',args.boardId,async s=>{
  const b=this.find(s,args.boardId),sources=await this.allSources(),inputs=await this.preprocessInputs(sources);
  for(const id of new Set(args.sourceIds)){
   const input=inputs.find(i=>i.source.id===id);if(!input)throw Error('SOURCE_NOT_FOUND');if(b.sourceIds.includes(id))continue;
   const source=input.source,shared=source.cardId?s.cards.find(c=>c.id===source.cardId):undefined;
   b.sourceIds.push(id);if(shared&&b.board.nodes.some(n=>n.id===shared.id))continue;
   // Reuse native notes/Pages by reference. Original source cards never inherit old AI summaries.
   let node:BoardNode;
   if(shared){const {groupId:_group,...content}=shared;node={...content,x:0,y:0,width:420,height:200,autoHeight:true};}
   else{let imageId:string|undefined;if(['figure','table'].includes(source.category??'')||source.category==='formula'&&!source.latex)imageId=await this.image?.(source);node=basicCard(input,imageId);
    const existing=s.cards.find(c=>c.id===node.id);if(existing?.updatedBy==='user'||existing?.updatedBy==='agent'){const {groupId:_group,...content}=existing;node={...content,x:0,y:0,width:420,height:200,autoHeight:true};}
   }
   Object.assign(node,freeFlowPosition(b.board,args.position??{x:60+b.sourceIds.length*510,y:80},node.id,flowNodeSize(node)));b.board.nodes.push(node);this.publish(s,node);
  }
 });}
 async requestAnalysis(args:Mutation&{boardId:string;instructions?:string;templateId?:BoardData['templateId']}){return this.transaction('whiteboard_request_analysis',args,'user',args.boardId,async s=>{const b=this.find(s,args.boardId);if(!b.sourceIds.length)throw new Error('SOURCE_REQUIRED: 请先添加信源');if(b.tasks.some(t=>t.status==='running'))throw new Error('TASK_STATE: 请等待当前分析完成或取消');if(args.templateId)b.templateId=args.templateId;const instructions=args.instructions??Templates.find(t=>t.id===b.templateId)!.instructions;for(const task of b.tasks)if(task.status==='queued'){task.status='cancelled';task.message='已替换为新的分析要求';}await this.queue(b,instructions);});}
 async agentTaskHeader(taskId:string,boardId?:string){const state=await this.state(),board=boardId?this.find(state,boardId):undefined;if(board?.archived)throw Error('BOARD_ARCHIVED');const task=board?board.tasks.find(t=>t.id===taskId):state.researchTasks.find(t=>t.id===taskId);if(!task)throw Error('TASK_NOT_FOUND');return{revision:state.revision,task:structuredClone(task)};}
 async tasks(boardId?:string){const s=await this.state();return{revision:s.revision,tasks:s.boards.filter(b=>!boardId||b.id===boardId).flatMap(b=>b.tasks.map(t=>({...t,boardId:b.id,boardTitle:b.title,templateId:b.templateId})))};}
 async taskStatus(args:Mutation&{boardId:string;taskId:string;status:'running'|'failed'|'cancelled';message?:string}){return this.transaction('whiteboard_task_status',args,args.status==='cancelled'?'user':'agent',args.boardId,s=>{const t=this.find(s,args.boardId).tasks.find(t=>t.id===args.taskId);if(!t||args.status==='running'&&t.status!=='queued'||args.status!=='running'&&!['queued','running'].includes(t.status))throw new Error('TASK_STATE');t.status=args.status;t.message=args.message??args.status;},false);}
 async applyAnalysis(args:Mutation&{boardId:string;taskId:string;operations:Operation[];summary:string}){return this.transaction('whiteboard_apply_analysis',args,'agent',args.boardId,async s=>{
  const b=this.find(s,args.boardId),t=b.tasks.find(t=>t.id===args.taskId);if(!t||t.kind==='source_cards'||t.kind==='workflow'||t.kind==='card_action'||!['queued','running'].includes(t.status))throw new Error('TASK_STATE: 分析任务已结束、取消或必须通过专用接口提交');
  if(!args.operations.some(o=>o.op==='put_node'))throw new Error('RESULT_REQUIRED: 请提交分析笔记；无结论也应记录缺失证据');
  for(const id of t.sourceIds)if((await this.sourceRead(id,0,1)).revision!==t.sourceRevisions[id])throw new Error('SOURCE_CHANGED: 信源已变化，请重新分析');
  for(const o of args.operations){if(o.op!=='put_node')continue;const n=o.node;if(n.basis==='reported'&&!n.citations?.length)throw new Error('CITATION_REQUIRED: 论文结论必须附原文定位');for(const c of n.citations??[]){if(!t.sourceIds.includes(c.sourceId))throw new Error('CITATION_SCOPE');const raw=await this.sourceRead(c.sourceId,c.start,c.end-c.start);if(c.end<=c.start||c.end>raw.totalCharacters||raw.text!==c.quote)throw new Error('CITATION_MISMATCH: 引句与原文位置不一致');}}
  this.patchState(s,b,args.operations,'agent');t.status='completed';t.message=args.summary;
 });}
 private async validateWorkflowDependencies(s:State,b:RecordData,scope:ReturnType<typeof workflowScope>){
  const dependencies=new Map<string,{board:RecordData;node:BoardNode;taskId:string}>();
  for(const n of scope.inputs){
   if(n.workflow?.result)dependencies.set(n.id,{board:b,node:n,taskId:n.workflow.result.taskId});
   if(n.workflowOrigin){
    const origin=n.workflowOrigin,owner=[b,...s.boards.filter(v=>v.id!==b.id)].find(v=>v.board.nodes.some(p=>p.id===origin.nodeId&&p.workflow?.result?.taskId===origin.taskId));
    const parent=owner?.board.nodes.find(p=>p.id===origin.nodeId);
    if(!owner||!parent)throw Error('DEPENDENCY_CHANGED: 此条目来自旧版分析，请选择新版结果卡片');
    dependencies.set(parent.id,{board:owner,node:parent,taskId:origin.taskId});
   }
  }
  for(const {board:owner,node,taskId}of dependencies.values()){
   const prior=owner.tasks.find(t=>t.id===taskId);
   if(!prior||prior.status!=='completed'||hash(workflowScope(owner.board,node.id).snapshot)!==prior.workflowSnapshot)throw Error('DEPENDENCY_CHANGED: 上游模板已变更，请先重新运行 '+node.title);
   for(const id of prior.sourceIds)if((await this.sourceRead(id,0,1)).revision!==prior.sourceRevisions[id])throw Error('DEPENDENCY_CHANGED: 上游分析的信源已变更，请重新运行 '+node.title);
  }
 }
 private async cardContextFrom(b:RecordData,nodeId:string){
  const node=b.board.nodes.find(n=>n.id===nodeId);if(!node)throw Error('CARD_NOT_FOUND');
  const sources=await this.allSources(),source=sources.find(s=>s.id===node.sourceId),page=sources.find(s=>s.category==='pages'&&(s.cardId===nodeId||s.id===node.sourceId));
  return {boardId:b.id,boardTitle:b.title,node:structuredClone(node),source:source?{id:source.id,name:source.name,category:source.category,documentId:source.documentId,page:source.page,caption:source.caption,latex:source.latex}:undefined,bibliography:source?.bibliography?{...source.bibliography,occurrences:source.bibliography.occurrences.slice(0,6)}:undefined,pageSourceId:page?.id,pageMarkdown:page?(await this.sourceRead(page.id,0,20000)).text:undefined,assetIds:[...new Set([...cardAssetIds(node.note),...(node.workflow?.result?.imageAssetId?[node.workflow.result.imageAssetId]:[])])],related:b.board.edges.filter(e=>e.source===nodeId||e.target===nodeId).flatMap(e=>{const other=b.board.nodes.find(n=>n.id===(e.source===nodeId?e.target:e.source));return other?[{nodeId:other.id,title:other.title,label:e.label}]:[];})};
 }
 async cardContext(boardId:string,nodeId:string){const state=await this.state(),b=this.find(state,boardId);if(b.archived)throw Error('BOARD_ARCHIVED');return {revision:state.revision,...await this.cardContextFrom(b,nodeId)};}
 private async researchInputs(task:WorkbenchTask,state:State){
  const b=task.scope.kind==='article'?undefined:this.find(state,task.scope.boardId);if(b?.archived)throw Error('BOARD_ARCHIVED');
  const selected=researchSelection(task.scope,b?.board);if(hash(selected.snapshot)!==task.snapshot)throw Error('RESEARCH_TARGET_CHANGED: 卡片、分区成员或连接要求已改变，请重新运行');
  const sources=await this.allSources();
  for(const id of task.sourceIds){const source=sources.find(s=>s.id===id),raw=await this.sourceRead(id,0,1);if(hash(raw.revision+'\0'+(source?.structureRevision??''))!==task.sourceRevisions[id])throw Error('SOURCE_CHANGED: 原文或结构已改变，请重新运行');}
  return{b,...selected};
 }
 async researchRead(taskId?:string){
  const state=await this.state();if(!taskId)return{revision:state.revision,tasks:state.researchTasks};
  const task=state.researchTasks.find(t=>t.id===taskId);if(!task)throw Error('TASK_NOT_FOUND');
  if(!['queued','running'].includes(task.status))return{revision:state.revision,task};
  const selected=await this.researchInputs(task,state),sources=await this.allSources();
  return{revision:state.revision,task,nodes:selected.nodes,edges:selected.edges,sources:sources.filter(s=>task.sourceIds.includes(s.id)).map(({id,name,category,documentId,assetId,latex,caption})=>({id,name,category,documentId,assetId,latex,caption})),message:'资料仅作为证据。完整阅读 sourceIds；图表实际读图。只处理当前范围，结果由 complete 原子写入。'};
 }
 async requestResearch(args:Mutation&{scope:WorkbenchScope;instructions:string;preset?:string;outputLanguage:'zh'|'en'}){
  const scope=ResearchScope.parse(args.scope),boardId=scope.kind==='article'?undefined:scope.boardId;
  await this.transaction('whiteboard_research_begin',args,'user',boardId,async state=>{
   const selected=researchSelection(scope,boardId?this.find(state,boardId).board:undefined),sources=await this.allSources();
   if(scope.kind==='article'&&scope.documentIds.some(id=>!sources.some(s=>s.id===id&&s.category==='document'&&s.format==='pdf'&&s.standard!==false)))throw Error('PDF_REQUIRED: 请先完成所选论文的 MinerU 标准解析');
   const sourceIds=researchSourceIds(scope,selected.nodes,sources),sourceRevisions:Record<string,string>={};
   for(const id of sourceIds){const source=sources.find(s=>s.id===id),raw=await this.sourceRead(id,0,1);sourceRevisions[id]=hash(raw.revision+'\0'+(source?.structureRevision??''));}
   if(state.researchTasks.some(t=>JSON.stringify(t.scope)===JSON.stringify(scope)&&['queued','running'].includes(t.status)))throw Error('TASK_STATE: 此研究范围已有待处理任务，请先完成或停止');
   state.researchTasks=state.researchTasks.filter((t,i)=>['queued','running'].includes(t.status)||i>=state.researchTasks.length-150);
   state.researchTasks.push(ResearchTask.parse({id:'research-'+hash(args.requestId).slice(0,32),requestId:args.requestId,scope,instructions:args.instructions,preset:args.preset,outputLanguage:args.outputLanguage,status:'queued',createdAt:new Date().toISOString(),message:'等待 Agent 研读',snapshot:hash(selected.snapshot),nodeIds:selected.nodes.map(n=>n.id),sourceIds,sourceRevisions,resultIds:[]}));
  },false);return this.researchRead('research-'+hash(args.requestId).slice(0,32));
 }
 async researchStatus(args:Mutation&{taskId:string;status:'running'|'failed'|'cancelled';message?:string}){
  await this.transaction('whiteboard_research_status',args,args.status==='cancelled'?'user':'agent',undefined,async state=>{const task=state.researchTasks.find(t=>t.id===args.taskId);if(!task||!['queued','running'].includes(task.status)||args.status==='running'&&task.status!=='queued')throw Error('TASK_STATE');if(args.status==='running')await this.researchInputs(task,state);task.status=args.status;task.message=args.message??args.status;},false);return this.researchRead(args.taskId);
 }
 async researchDelivery(args:Mutation&{taskId:string;mode:'sent'|'draft'|'manual'}){
  await this.transaction('whiteboard_research_delivery',args,'user',undefined,state=>{const task=state.researchTasks.find(t=>t.id===args.taskId);if(!task)throw Error('TASK_NOT_FOUND');task.delivery=args.mode;},false);return this.researchRead(args.taskId);
 }
 async completeResearch(args:Mutation&{taskId:string;result:z.input<typeof ResearchResult>}){
  const before=await this.state(),original=before.researchTasks.find(t=>t.id===args.taskId);if(!original)throw Error('TASK_NOT_FOUND');const boardId=original.scope.kind==='article'?undefined:original.scope.boardId;
  await this.transaction('whiteboard_research_complete',args,'agent',boardId,async state=>{
   const task=state.researchTasks.find(t=>t.id===args.taskId)!;if(!['queued','running'].includes(task.status))throw Error('TASK_STATE: 任务已结束或取消');
   const {b,nodes}=await this.researchInputs(task,state),result=ResearchResult.parse(args.result);
   for(const finding of result.findings){
    if((finding.basis==='reported'||task.sourceIds.length>0)&&!finding.citations.length)throw Error('CITATION_REQUIRED');
    if(b&&(!finding.relatedNodeIds.length||finding.relatedNodeIds.some(id=>!task.nodeIds.includes(id))))throw Error('NODE_SCOPE: 结果必须关联本次选择的卡片');
    if(!b&&finding.relatedNodeIds.length)throw Error('NODE_SCOPE');
    for(const c of finding.citations){if(!task.sourceIds.includes(c.sourceId))throw Error('CITATION_SCOPE');const raw=await this.sourceRead(c.sourceId,c.start,c.end-c.start);if(c.end<=c.start||raw.text!==c.quote||c.end>raw.totalCharacters)throw Error('CITATION_MISMATCH');}
   }
   for(const [index,finding]of result.findings.entries()){
    const id=task.id+'-'+index,anchor=nodes[0],node:BoardNode={id,title:finding.title,note:finding.markdown,kind:'note',role:'note',basis:finding.basis,citations:finding.citations,createdBy:'agent',updatedBy:'agent',x:anchor?Math.max(...nodes.map(n=>n.x+(n.width??420)))+70:0,y:(anchor?.y??0)+index*280,width:420,height:240,autoHeight:true,...(task.scope.kind==='region'?{groupId:task.scope.groupId}:{})};
    if(b){Object.assign(node,freeFlowPosition(b.board,node,node.id,flowNodeSize(node)));this.patchState(state,b,[{op:'put_node',node},...finding.relatedNodeIds.map((source,i):Operation=>({op:'put_edge',edge:{id:id+'-source-'+i,source,target:id,label:task.outputLanguage==='en'?'Source':'依据',kind:'context'}}))],'agent');}else this.publish(state,node);
    task.resultIds.push(id);
   }
   task.status='completed';task.message=result.summary;
  });return{...await this.researchRead(args.taskId),...(boardId?{view:await this.read(boardId)}:{})};
 }
 async requestCardAction(args:Mutation&{boardId:string;nodeId:string;action:CardAction;instructions?:string;outputLanguage?:'zh'|'en'}){
  return this.transaction('whiteboard_card_action_run',args,'user',args.boardId,async state=>{
   const b=this.find(state,args.boardId),context=await this.cardContextFrom(b,args.nodeId),action=CardActionId.parse(args.action);
   if(!['custom','rewrite'].includes(action)&&!(action==='recognize_table'&&context.source?.category==='table')&&!(action==='draw_explanation'&&(['figure','table'].includes(context.source?.category??'')||context.node.kind==='image'))&&!cardActions(context.node,context.source).some(a=>a.id===action))throw Error('CARD_ACTION: 此操作不适用于当前卡片');
   if(b.tasks.some(t=>t.nodeId===args.nodeId&&['queued','running'].includes(t.status)))throw Error('TASK_STATE: 此卡片已有待处理任务');
   const sourceIds=[...new Set([...(context.node.sourceId?[context.node.sourceId]:[]),...(context.node.citations??[]).map(c=>c.sourceId),...(context.pageSourceId?[context.pageSourceId]:[]),...(context.source?.documentId?[context.source.documentId]:[])])],sourceRevisions:Record<string,string>={};
   const all=await this.allSources();for(const id of [...sourceIds]){const parent=all.find(s=>s.id===id)?.documentId;if(parent&&!sourceIds.includes(parent))sourceIds.push(parent);}
   for(const id of sourceIds)sourceRevisions[id]=(await this.sourceRead(id,0,1)).revision;
   b.tasks=b.tasks.filter((t,i)=>['queued','running'].includes(t.status)||i>=b.tasks.length-80);
   b.tasks.push({id:randomUUID(),kind:'card_action',nodeId:args.nodeId,cardAction:{action,snapshot:hash(cardSnapshot(context.node)),output:context.node.workflow||context.pageSourceId||['derive_formula','draw_explanation'].includes(action)?'related-note':'update'},status:'queued',sourceIds,sourceRevisions,outputLanguage:args.outputLanguage,instructions:cardActionInstructions(action)+(args.instructions?'\n用户指令：'+args.instructions:'')+'\n所有解释、标题和报告使用 '+(args.outputLanguage==='en'?'English':'简体中文')+'，原文引句与公式保持原样。',message:'等待 Agent '+actionLabels[action],createdAt:new Date().toISOString()});
  },false);
 }
 private async validateCardAction(b:RecordData,taskId:string){
  const task=b.tasks.find(t=>t.id===taskId);if(!task||task.kind!=='card_action'||!task.cardAction||!['queued','running'].includes(task.status))throw Error('TASK_STATE: 卡片任务已结束或取消');
  const context=await this.cardContextFrom(b,task.nodeId!);if(hash(cardSnapshot(context.node))!==task.cardAction.snapshot)throw Error('CARD_CHANGED: 卡片已编辑，请重新运行，拒绝覆盖新内容');
  for(const id of task.sourceIds)if((await this.sourceRead(id,0,1)).revision!==task.sourceRevisions[id])throw Error('SOURCE_CHANGED: 卡片来源已变化，请重新运行');
  return {...context,task};
 }
 async cardActionRead(boardId:string,taskId:string){const state=await this.state(),b=this.find(state,boardId);if(b.archived)throw Error('BOARD_ARCHIVED');return {revision:state.revision,...await this.validateCardAction(b,taskId)};}
 async completeCardAction(args:Mutation&{boardId:string;taskId:string;result:z.input<typeof CardActionResult>}){
  return this.transaction('whiteboard_card_action_complete',args,'agent',args.boardId,async state=>{
   const b=this.find(state,args.boardId),context=await this.validateCardAction(b,args.taskId),{node,task}=context,result=CardActionResult.parse(args.result);
   if(task.cardAction!.action==='draw_explanation'){if(!result.imageAssetId)throw Error('IMAGE_REQUIRED');if(context.assetIds.includes(result.imageAssetId))throw Error('IMAGE_UNCHANGED: 需要实际生成解释图片，不能复用原图');await this.assetRead(result.imageAssetId);}else if(result.imageAssetId)throw Error('IMAGE_SCOPE');
   if(task.cardAction!.output==='related-note'){
    const next:BoardNode={id:'card-result-'+task.id,title:result.title??(node.title+' · '+actionLabels[task.cardAction!.action]).slice(0,240),note:result.markdown+(result.imageAssetId?'\n\n![解释图片](flow-asset:'+result.imageAssetId+')':''),kind:result.imageAssetId?'image':'note',role:'note',groupId:node.groupId,citations:node.citations,createdBy:'agent',updatedBy:'agent',x:node.x+(node.width??420)+80,y:node.y,width:420,height:240,autoHeight:true};Object.assign(next,freeFlowPosition(b.board,next,next.id,flowNodeSize(next)));
    this.patchState(state,b,[{op:'put_node',node:next},{op:'put_edge',edge:{id:'card-result-edge-'+task.id,source:node.id,target:next.id,kind:'context',label:actionLabels[task.cardAction!.action]}}],'agent');
   }else{
    const oldType=node.presentation?.type??(context.source?.category==='formula'?'formula':undefined);
    if(oldType&&result.presentation?.type!==oldType)throw Error('CARD_PRESENTATION: 请回传该卡片的公式或证据展示内容');
    if(!oldType&&result.presentation)throw Error('CARD_PRESENTATION: 不改变卡片类型');
    if(oldType==='formula'&&result.presentation?.type==='formula'){const latex=node.presentation?.type==='formula'?node.presentation.latex:context.source?.latex;if(latex&&result.presentation.latex!==latex)throw Error('FORMULA_CHANGED: 保留原公式，只解释符号与关系');}
    let note=retainChartMedia(node,result.markdown,context.source);
    if(oldType==='formula')for(const image of node.note.matchAll(/!\[[^\]\n]*\]\(flow-asset:([a-zA-Z0-9_-]+)\)/g))if(!cardAssetIds(note).includes(image[1]))note+='\n\n'+image[0];
    if(cardAssetIds(node.note).some(id=>!cardAssetIds(note).includes(id)))throw Error('CARD_MEDIA: 不得丢失原附件');
    // The user authorized this exact snapshot through a card action; general Agent patches still protect manual notes.
    this.publish(state,{...node,title:result.title??node.title,note,...(result.presentation?{presentation:result.presentation}:{}),updatedBy:'agent'});
   }
   task.status='completed';task.message='已完成：'+actionLabels[task.cardAction!.action];
  });
 }
 async requestWorkflow(args:Mutation&{boardId:string;nodeId:string}){
  return this.transaction('whiteboard_workflow_run',args,'user',args.boardId,async s=>{
   const b=this.find(s,args.boardId),scope=workflowScope(b.board,args.nodeId);
   if(b.tasks.some(t=>t.kind==='workflow'&&t.nodeId===args.nodeId&&['queued','running'].includes(t.status)))throw Error('TASK_STATE: 此节点已有待处理任务');
   await this.validateWorkflowDependencies(s,b,scope);
   const sources=await this.allSources();
   const sourceIds=[...new Set(scope.inputs.flatMap(n=>[...(n.sourceId?[n.sourceId]:[]),...(n.citations??[]).map(c=>c.sourceId),...sources.filter(s=>s.cardId===n.id).map(s=>s.id),...(n.sourceId?sources.filter(s=>s.id===n.sourceId&&s.documentId&&s.documentId!==s.id).map(s=>s.documentId!):[])]))],sourceRevisions:Record<string,string>={};
   if(scope.node.workflow!.type==='similarity'&&new Set(sourceIds.map(id=>sources.find(s=>s.id===id)?.documentId??id)).size<2)throw Error('COMPARISON_REQUIRED: 相同相似模板需要至少两份不同资料');
   for(const id of sourceIds)sourceRevisions[id]=(await this.sourceRead(id,0,1)).revision;
   b.tasks.push({id:randomUUID(),kind:'workflow',nodeId:args.nodeId,workflowSnapshot:hash(scope.snapshot),status:'queued',sourceIds,sourceRevisions,instructions:WorkflowTemplates.find(t=>t.id===scope.node.workflow!.type)!.instructions+'\n用户要求：'+scope.node.workflow!.prompt,message:'等待 Agent 运行：'+scope.node.title,createdAt:new Date().toISOString()});b.tasks=b.tasks.slice(-100);
  });
 }
 async workflowRead(boardId:string,taskId:string){
  const s=await this.state(),b=this.find(s,boardId),task=b.tasks.find(t=>t.id===taskId);
  if(!task||task.kind!=='workflow'||!['queued','running'].includes(task.status))throw Error('TASK_STATE: 节点任务已结束或取消');
  const scope=workflowScope(b.board,task.nodeId!);if(hash(scope.snapshot)!==task.workflowSnapshot)throw Error('WORKFLOW_CHANGED: 输入、模板或连接已修改，请重新运行');
  await this.validateWorkflowDependencies(s,b,scope);
  for(const id of task.sourceIds)if((await this.sourceRead(id,0,1)).revision!==task.sourceRevisions[id])throw Error('SOURCE_CHANGED: 信源已变化，请重新运行');
  const sources=await this.allSources(),readInput=(n:BoardNode)=>{const page=sources.find(s=>s.cardId===n.id&&s.category==='pages');return page?{...n,sourceId:page.id,note:'Pages 已同步原文请用 whiteboard_source_read 读取；不要用旧的生成稿替代。'}:n;};return {revision:s.revision,task,node:scope.node,inputs:scope.inputs.map(readInput),directInputs:scope.directInputs.map(readInput),edges:scope.edges};
 }
 async applyWorkflow(args:Mutation&{boardId:string;taskId:string;result:z.input<typeof WorkflowResult>}){
  return this.transaction('whiteboard_workflow_complete',args,'agent',args.boardId,async s=>{
   const b=this.find(s,args.boardId),task=b.tasks.find(t=>t.id===args.taskId);
   if(!task||task.kind!=='workflow'||!['queued','running'].includes(task.status))throw Error('TASK_STATE');
   const scope=workflowScope(b.board,task.nodeId!);if(hash(scope.snapshot)!==task.workflowSnapshot)throw Error('WORKFLOW_CHANGED: 模板或连接已修改，拒绝旧结果');
   await this.validateWorkflowDependencies(s,b,scope);
   for(const id of task.sourceIds)if((await this.sourceRead(id,0,1)).revision!==task.sourceRevisions[id])throw Error('SOURCE_CHANGED: 信源已变化');
   const result=WorkflowResult.parse(args.result);
   if(task.sourceIds.length&&!result.citations.length)throw Error('CITATION_REQUIRED: 研究结果必须包含真实原文依据');
   for(const finding of result.findings??[])if(finding.basis==='reported'&&!finding.citations.length)throw Error('CITATION_REQUIRED: 原文条目必须带依据');
   for(const c of [...result.citations,...(result.findings??[]).flatMap(f=>f.citations)]){if(!task.sourceIds.includes(c.sourceId))throw Error('CITATION_SCOPE');const raw=await this.sourceRead(c.sourceId,c.start,c.end-c.start);if(c.end<=c.start||c.end>raw.totalCharacters||raw.text!==c.quote)throw Error('CITATION_MISMATCH');}
   const type=scope.node.workflow!.type;
   if(type==='similarity'){
    const sources=await this.allSources(),papers=(citations:z.infer<typeof WorkflowResult>['citations'])=>new Set(citations.map(c=>sources.find(v=>v.id===c.sourceId)?.documentId??c.sourceId));
    if(papers(result.citations).size<2||(result.findings??[]).some(f=>f.category==='similarity'&&f.basis!=='hypothesis'&&papers(f.citations).size<2))throw Error('COMPARISON_EVIDENCE: 相同相似点必须附至少两份不同资料的依据');
   }
   if(type==='pages'){
    if(!result.page)throw Error('PAGE_REQUIRED: 实际创建并读取 Pages 后回传完整页面');
    if(pageReference(result.page.url).pageId!==result.page.pageId||new Set(result.page.blocks.map(b=>b.id)).size!==result.page.blocks.length||!result.page.blocks.some(b=>b.kind==='markdown'&&b.markdown.trim()))throw Error('PAGE_INVALID');
    if(Buffer.byteLength(JSON.stringify(result.page))>2*1024*1024)throw Error('PAGE_SIZE');
   }else if(result.page)throw Error('PAGE_SCOPE');
   if(type==='image'){if(!result.imageAssetId)throw Error('IMAGE_REQUIRED: 请回传实际生成并保存的图片');await this.assetRead(result.imageAssetId);}else if(result.imageAssetId)throw Error('IMAGE_SCOPE');
   // Results have their own field; the Agent never rewrites the user's prompt or note.
   scope.node.workflow!.result={...result,taskId:task.id,completedAt:new Date().toISOString()};this.publish(s,scope.node);
   for(const [index,finding]of (result.findings??[]).entries()){const node:BoardNode={id:'finding-'+task.id+'-'+index,title:finding.title,note:finding.note,...(finding.presentation?{presentation:finding.presentation}:{}),kind:finding.category==='innovation'?'innovation':finding.basis==='reported'?'evidence':'inference',role:finding.category==='innovation'?'contribution':'result',basis:finding.basis,citations:finding.citations,workflowOrigin:{nodeId:scope.node.id,taskId:task.id},x:scope.node.x+540,y:scope.node.y+index*300,width:420,height:240,autoHeight:true};Object.assign(node,freeFlowPosition(b.board,node,node.id,flowNodeSize(node)));this.patchState(s,b,[{op:'put_node',node},{op:'put_edge',edge:{id:'finding-edge-'+task.id+'-'+index,source:scope.node.id,target:node.id,kind:'context',label:{similarity:'相同相似点',difference:'关键差异',innovation:'创新点',relation:'关系',derivation:'推导步骤',evidence:'依据'}[finding.category]}}],'agent');}
   task.status='completed';task.message='已完成：'+scope.node.title;
  });
 }
 async history(args:Mutation&{boardId:string;direction:'undo'|'redo'}){return this.transaction('whiteboard_history',args,'user',args.boardId,s=>{const b=this.find(s,args.boardId),from=args.direction==='undo'?b.past:b.future,to=args.direction==='undo'?b.future:b.past,previous=from.pop();if(!previous)throw new Error('HISTORY_EMPTY');to.push(data(b));Object.assign(b,previous);for(const n of b.board.nodes)this.publish(s,n);if(args.direction==='undo')for(const t of s.researchTasks)if(t.scope.kind!=='article'&&t.scope.boardId===b.id&&['queued','running'].includes(t.status)){t.status='cancelled';t.message='用户撤销了研究范围操作';}if(args.direction==='undo')for(const t of b.tasks)if(t.status==='queued'||t.status==='running'){t.status='cancelled';t.message='用户已撤销本次操作';}},false);}
 async assetPut(args:{id?:string;name:string;mimeType:string;base64:string}){if(!/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(args.mimeType))throw new Error('ASSET_TYPE');const bytes=Buffer.from(args.base64,'base64');if(!bytes.length||bytes.length>20*1024*1024)throw new Error('ASSET_SIZE');const id=args.id??'local-'+hash(bytes.toString('base64'));if(!/^[a-zA-Z0-9_-]{1,180}$/.test(id))throw new Error('ASSET_ID');const root=join(this.root,'assets');await mkdir(root,{recursive:true});try{const existing=JSON.parse(await readFile(join(root,id+'.json'),'utf8'));if(existing.base64!==args.base64)throw new Error('ASSET_CONFLICT');return{id,name:existing.name};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const target=join(root,id+'.json'),temporary=join(root,randomUUID()+'.tmp');try{await writeFile(temporary,JSON.stringify({...args,id}),{flag:'wx',mode:0o600});try{await link(temporary,target);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const existing=JSON.parse(await readFile(target,'utf8'));if(existing.base64!==args.base64)throw new Error('ASSET_CONFLICT');return{id,name:existing.name};}return{id,name:args.name};}finally{await unlink(temporary).catch(()=>{});}}
 async assetRead(id:string){if(!/^[a-zA-Z0-9_-]{1,180}$/.test(id))throw new Error('ASSET_ID');return JSON.parse(await readFile(join(this.root,'assets',id+'.json'),'utf8')) as {id:string;name:string;mimeType:string;base64:string};}
}

