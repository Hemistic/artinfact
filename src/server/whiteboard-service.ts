import {readFileSnapshot,readTextSnapshot} from './file-snapshot.js';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import type {WorkspaceRuntime} from './workspace-runtime.js';
import {ResearchWiki} from './research-wiki.js';
import {WhiteboardStore} from '../whiteboard/whiteboard-store.js';
import type {Source,Board,BoardNode} from '../whiteboard/whiteboard-domain.js';
import {pdfPaperSources} from './whiteboard-source-catalog.js';
import {PagesPreviewStore} from './pages-preview.js';
import type {GraphData} from '../shared/wiki-graph-view.js';

export class WorkspaceWhiteboards {
 private stores=new Map<string,WhiteboardStore>();
 private sourceReads=new Map<string,Promise<Source[]>>();
 private paperCatalogs=new Map<string,{document:Source;revision:number;blocks:any[];tree:unknown;items:Source[];bytes:number}>();
 private catalogBytes=0;
 private paperSources(document:Source,revision:number,annotations:{id:string;[key:string]:unknown}[],blocks:any[],tree:any){
  const key=document.path+'\0'+document.id,old=this.paperCatalogs.get(key);
  if(old&&old.revision===revision&&old.blocks===blocks&&old.tree===tree&&old.document.name===document.name&&old.document.text===document.text&&old.document.standard===document.standard&&old.document.markdownPath===document.markdownPath){this.paperCatalogs.delete(key);this.paperCatalogs.set(key,old);return old.items;}
  const items=pdfPaperSources(document,annotations,blocks,tree),bytes=Buffer.byteLength(JSON.stringify(items));
  if(old){this.catalogBytes-=old.bytes;this.paperCatalogs.delete(key);}
  if(bytes<=16*1024*1024){this.paperCatalogs.set(key,{document,revision,blocks,tree,items,bytes});this.catalogBytes+=bytes;while(this.catalogBytes>16*1024*1024||this.paperCatalogs.size>12){const first=this.paperCatalogs.keys().next().value!;this.catalogBytes-=this.paperCatalogs.get(first)!.bytes;this.paperCatalogs.delete(first);}}
  return items;
 }
 constructor(private runtime:WorkspaceRuntime){}
 async sources(id:string):Promise<Source[]>{
  let task=this.sourceReads.get(id);if(!task){task=this.readSources(id);this.sourceReads.set(id,task);}
  try{return structuredClone(await task);}finally{if(this.sourceReads.get(id)===task)this.sourceReads.delete(id);}
 }
 private async readSources(id:string):Promise<Source[]>{
  const workspace=await this.runtime.library.get(id),service=(await this.runtime.scope(id)).mineru,sources:Source[]=[];
  for(const doc of workspace.documents){let markdownPath:string|undefined,standard=false;try{const result=await service.result(doc.id);markdownPath=join(result.directory,'document-mineru.md');standard=result.format!=='markdown-only';}catch(e){if((e as Error).message!=='请先完成 MinerU 转换')throw e;}
   const source:Source={id:doc.id,name:doc.title||doc.name,format:'pdf',path:doc.sourcePath,markdownPath,documentId:doc.id,category:'document',standard};
   const state=await this.runtime.library.stateStore(id).read(doc.id);let blocks:any[]=[];if(markdownPath){try{const parsed=await readFileSnapshot(join(markdownPath,'..','document-mineru.json'),'mineru-structure',text=>({raw:JSON.parse(text),revision:createHash('sha256').update(text).digest('hex')}));source.structureRevision=parsed.revision;if(Array.isArray(parsed.raw))blocks=parsed.raw;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;source.standard=false;}}
   let tree; if(markdownPath){try{tree=await readFileSnapshot(join(markdownPath,'..','tree.json'),'mineru-tree',text=>JSON.parse(text));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}source.text=await readTextSnapshot(markdownPath);}sources.push(...this.paperSources(source,state.revision,state.annotations,blocks,tree));
  }
  for(const note of workspace.notes){const original=await this.runtime.library.readNote(id,note.name),path=join(workspace.rootDir,'notes',note.name);const cache=(await new PagesPreviewStore(this.runtime.library).read(id,note.name)).cache;sources.push({id:'md:'+note.name,name:cache?.title??note.name,format:'md',path,markdownPath:path,category:cache?'pages':'markdown',text:cache?cache.blocks.filter(b=>b.kind==='markdown').map(b=>b.markdown).join('\n\n'):original.text});}
  const cards=(await(await this.store(id)).cards()).cards as import('../whiteboard/whiteboard-domain.js').BoardNode[];
  const snapshotStore=new PagesPreviewStore({get:async()=>workspace,readNote:async(_id,name)=>{const node=cards.find(n=>'graph-card:'+createHash('sha256').update(n.id).digest('hex')===name);if(!node)throw Error('Pages 卡片缺失');const value='# '+node.title+'\n\n'+(node.workflow?.result?.markdown??node.note);return{name,text:value,revision:createHash('sha256').update(value).digest('hex')};}});
  for(const node of cards){if(node.kind==='image'||node.role==='source'||node.workflow&&node.workflow.type!=='pages')continue;const key='graph-card:'+createHash('sha256').update(node.id).digest('hex'),preview=await snapshotStore.read(id,key),page=preview.cache??node.workflow?.result?.page;if(!page){if(node.kind==='note'&&!node.sourceId&&!node.sourcePath&&!node.workflow&&!node.presentation&&!node.sourceCard&&!node.workflowOrigin&&(!node.role||node.role==='note'))sources.push({id:'note-card:'+createHash('sha256').update(node.id).digest('hex'),cardId:node.id,name:node.title,format:'md',path:key,category:'markdown',text:node.note});continue;}sources.push({id:'pages-card:'+createHash('sha256').update(node.id).digest('hex'),cardId:node.id,name:page.title,format:'md',path:key,category:'pages',text:page.blocks.filter(b=>b.kind==='markdown').map(b=>b.markdown).join('\n\n')});}
  return [...sources,...await(await this.store(id)).portableSources()];
 }
 async sourceImage(id:string,sourceId:string){
  const source=(await this.sources(id)).find(s=>s.id===sourceId);if(!source?.documentId||!['figure','table','formula'].includes(source.category??''))throw Error('SOURCE_IMAGE: 请选取当前工作区的图表/公式卡片');
  return this.imageForSource(id,source);
 }
 private async imageForSource(id:string,source:Source):Promise<{available:boolean;id?:string;mimeType?:string;base64?:string}>{
  if(source.path.startsWith('portable:')){if(!source.assetId)return{available:false};const asset=await(await this.store(id)).assetRead(source.assetId);return{available:true,id:asset.id,mimeType:asset.mimeType,base64:asset.base64};}
  if(!source.documentId)throw Error('SOURCE_IMAGE: 缺少 PDF 来源');
  const annotation=(await this.runtime.library.stateStore(id).read(source.documentId)).annotations.find(a=>a.id===source.annotationId);
  const asset=annotation?.layoutAssetPath??source.assetPath;if(typeof asset!=='string'||!/^images\/[A-Za-z0-9._ /-]+\.(png|jpe?g|webp)$/i.test(asset))return {available:false};
  const result=await (await this.runtime.scope(id)).mineru.result(source.documentId),root=await realpath(join(result.directory,'images')),path=await realpath(join(result.directory,asset)),rel=relative(root,path);if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw Error('SOURCE_IMAGE_BOUNDARY');
  if((await stat(path)).size>20*1024*1024)throw Error('SOURCE_IMAGE_SIZE');const bytes=await readFile(path),mimeType=/\.png$/i.test(asset)?'image/png':/\.webp$/i.test(asset)?'image/webp':'image/jpeg';
  const saved=await(await this.store(id)).assetPut({name:source.name,mimeType,base64:bytes.toString('base64')});return {available:true,id:saved.id,mimeType,base64:bytes.toString('base64')};
 }
 async store(id:string){const workspace=await this.runtime.library.get(id),root=join(workspace.rootDir,'knowledge-map');let store=this.stores.get(root);if(!store){store=new WhiteboardStore(root,()=>this.sources(id),async source=>(await this.imageForSource(id,source)).id);this.stores.set(root,store);}return store;}
 async requirePreprocessed(id:string,documentIds:string[]){const status=await(await this.store(id)).preprocessRead();for(const docId of documentIds){const doc=status.documents.find(d=>d.id===docId);if(!doc?.ready||doc.completed!==doc.total)throw Error('PREPROCESS_REQUIRED: PDF 基础资料卡片尚未准备：'+(doc?.name??docId));}}
 async syncGraphCards(id:string,graph:GraphData){
  const wiki=new ResearchWiki(this.runtime.library,this.runtime),nodes:BoardNode[]=[];
  for(const node of graph.nodes){if(!node.relativePath||!node.relativePath.startsWith('wiki/')||['source','missing','meta','raw'].includes(node.type))continue;
   const page=await wiki.read(id,node.relativePath);nodes.push({id:'wiki:'+node.id,title:(node.title||node.label).slice(0,240),note:page.text.slice(0,120000),kind:node.type==='question'?'question':'note',role:'note',sourceRefs:[node.relativePath],createdBy:'agent',updatedBy:'agent',x:0,y:0,width:420,height:240,autoHeight:true});
  }
  const store=await this.store(id),requestId='graph-cards-'+randomUUID();for(let attempt=0;attempt<3;attempt++){try{const view=await store.importGraphCards({nodes,expectedRevision:(await store.list()).revision,requestId});return{revision:view.revision,graphCards:nodes.length,pdfCards:(await store.cards()).cards.filter(c=>c.sourceId).length};}catch(e){if(!String(e).includes('REVISION_CONFLICT')||attempt===2)throw e;}}
 }
 async migrate(id:string){
  const store=await this.store(id),existing=await store.list();if(existing.initialized||existing.boards.length||existing.archivedBoards.length)return {migrated:false};
  const workspace=await this.runtime.library.get(id),wiki=new ResearchWiki(this.runtime.library,this.runtime);
  try{await readFile(join(workspace.rootDir,'claude-obsidian-graph-vault','wiki-graph.json'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {migrated:false};throw e;}
  const graph=await wiki.graph(id,false) as GraphData;if(!graph.nodes.some(n=>n.type!=='meta'&&n.status!=='seed'))return {migrated:false};
  if(graph.nodes.length>1000)throw Error('旧图谱超过 1000 个节点，请先选择需要迁移的内容');
  const nodes:Board['nodes']=[];
  for(const [i,n] of graph.nodes.entries()){
   let note=n.label;if(n.relativePath&&n.type!=='missing')note=(await wiki.read(id,n.relativePath)).text;
   nodes.push({id:'wiki:'+n.id,title:(n.title||n.label).slice(0,240),note:note.slice(0,120000),kind:n.type==='question'?'question':n.type==='source'?'evidence':'note',role:n.type==='source'?'source':'note',x:i%4*540,y:Math.floor(i/4)*380,width:420,height:240,autoHeight:true,sourcePath:n.document?.originalPdf,sourceRefs:n.relativePath?[n.relativePath]:[],createdBy:'import',updatedBy:'import'});
  }
  const ids=new Set(nodes.map(n=>n.id)),edges=graph.edges.filter(e=>ids.has('wiki:'+e.source)&&ids.has('wiki:'+e.target)&&e.source!==e.target).slice(0,4000).map(e=>({id:'wiki:'+e.id,source:'wiki:'+e.source,target:'wiki:'+e.target,label:e.relation.slice(0,120)||'关联'}));
  await store.importBoard({title:'已有 Wiki 图谱',legacyKey:'workspace-wiki:'+id,board:{version:1,nodes,edges},expectedRevision:existing.revision,requestId:'wiki-migration:'+id});return {migrated:true,nodes:nodes.length,edges:edges.length};
 }
}
