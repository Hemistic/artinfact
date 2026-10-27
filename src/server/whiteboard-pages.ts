import {ExportMedia} from './export-media.js';
import {createHash} from 'node:crypto';
import type {WorkspaceRuntime} from './workspace-runtime.js';
import {WorkspaceWhiteboards} from './whiteboard-service.js';
import {PagesPreviewStore,type PagesNoteSource} from './pages-preview.js';
import {pagesThumbnail} from '../shared/pages-preview.js';
import type {BoardNode} from '../whiteboard/whiteboard-domain.js';
import {boardDocument,documentAssetIds,replaceDocumentAssets} from '../whiteboard/board-markdown.js';
import {UiLanguageStore} from './ui-language.js';
import {mkdir,mkdtemp,writeFile,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const key=(id:string)=>'graph-card:'+hash(id);
export class WhiteboardPages {
 readonly source:PagesNoteSource;
 private graph:WorkspaceWhiteboards;
 private pages:PagesPreviewStore;
 constructor(private runtime:WorkspaceRuntime){
  this.graph=new WorkspaceWhiteboards(runtime);
  this.source={get:id=>runtime.library.get(id),readNote:async(id,name)=>{
   if(/^board-export:[a-f0-9]{64}:[a-f0-9]{64}$/.test(name)){
    const entry=(await(await this.graph.store(id)).list()).boards.find(b=>name.startsWith('board-export:'+hash(b.id)+':'));
    if(!entry)throw Error('白板不在当前工作区');const output=await this.export(id,entry.id,false);
    if(output.name!==name)throw Error('白板已更改，请重新导出');return{name,text:output.markdown,revision:hash(output.markdown),title:entry.title};
   }
   if(!/^graph-card:[a-f0-9]{64}$/.test(name))return runtime.library.readNote(id,name);
   const cards=(await(await this.graph.store(id)).cards()).cards as BoardNode[],node=cards.find(n=>key(n.id)===name);
   if(!node)throw Error('卡片不在当前工作区');
   const text='# '+node.title+'\n\n'+(node.workflow?.result?.markdown??node.note);return {name,text,revision:hash(text),title:node.title};
  }};
  this.pages=new PagesPreviewStore(this.source);
 }
 async documentContext(workspaceId:string,boardId:string){
  const store=await this.graph.store(workspaceId),view=await store.read(boardId);if(view.archived)throw Error('白板已删除');
  const originalBoard=view.board!,board=structuredClone(originalBoard),pages=new Map(),importedPages=await store.portablePages();
  for(const entry of (await this.list(workspaceId,boardId)).entries){if(entry.error)throw Error('Pages 缓存无法读取：'+entry.error);const cache=(await this.pages.read(workspaceId,entry.name)).cache;const page=cache??importedPages.find(p=>p.nodeId===entry.nodeId)?.page??board.board.nodes.find(n=>n.id===entry.nodeId)?.workflow?.result?.page;if(page)pages.set(entry.nodeId,page);}
  const sourceNeeded=board.board.nodes.some(n=>n.sourceId||n.citations?.length),sources=sourceNeeded?await this.graph.sources(workspaceId):[],language=await new UiLanguageStore(this.runtime.legacyStore.root).read();
  const media=new ExportMedia(sources);for(const node of board.board.nodes){const source=sources.find(s=>s.id===node.sourceId)??sources.find(s=>s.cardId===node.id);node.note=await media.markdown(node.note,source);if(node.workflow?.result)node.workflow.result.markdown=await media.markdown(node.workflow.result.markdown,source);const page=pages.get(node.id);if(page){const saved=structuredClone(page);for(const block of saved.blocks)if(block.kind==='markdown')block.markdown=await media.markdown(block.markdown,source);pages.set(node.id,saved);}}
  return{board,originalBoard,pages,sources,language,media};
 }
 async export(workspaceId:string,boardId:string,embedAssets=true,retry=0):Promise<{name:string;title:string;markdown:string;outline:ReturnType<typeof boardDocument>['outline'];counts:ReturnType<typeof boardDocument>['counts'];assets:{id:string;name:string;mimeType:string;bytes:number}[]}>{
  const store=await this.graph.store(workspaceId),{board,originalBoard,pages,sources,language,media}=await this.documentContext(workspaceId,boardId);
  const document=boardDocument(board,pages,{sources,language}),images=new Map<string,string>(),assets:{id:string;name:string;mimeType:string;bytes:number}[]=[];
  for(const id of documentAssetIds(document.markdown)){
   let asset;try{asset=media.assets.get(id)??await store.assetRead(id);}catch{throw Error('导出图片无法读取：'+id+'；白板内容已保留');}
   assets.push({id,name:asset.name,mimeType:asset.mimeType,bytes:Buffer.byteLength(asset.base64,'base64')});if(embedAssets)images.set(id,'data:'+asset.mimeType+';base64,'+asset.base64);
  }
  const latest=await store.read(boardId);if(latest.archived)throw Error('白板已删除');
  if(JSON.stringify([latest.board?.title,latest.board?.board])!==JSON.stringify([originalBoard.title,originalBoard.board])){
   // Initial card measurements can settle while media is read. Rebuild the entire snapshot,
   // with a bounded retry, so neither geometry nor content from different versions is mixed.
   if(retry<2)return this.export(workspaceId,boardId,embedAssets,retry+1);
   throw Error('白板在组装时已更改，请重新导出');
  }
  return{name:'board-export:'+hash(boardId)+':'+hash(document.markdown),title:board.title,markdown:embedAssets?replaceDocumentAssets(document.markdown,images):document.markdown,outline:document.outline,counts:document.counts,assets};
 }
 async saveMarkdown(workspaceId:string,boardId:string,name:string){
  const document=await this.export(workspaceId,boardId,true);if(document.name!==name)throw Error('白板已更改，请刷新结构后重新导出');
  const base=await realpath(this.runtime.library.baseDirectory()),directory=join(base,'exports',workspaceId);await mkdir(directory,{recursive:true});const canonical=await realpath(directory),rel=relative(base,canonical);if(rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw Error('导出目录超出资料库边界');
  const target=await mkdtemp(join(canonical,'whiteboard-')),title=document.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'whiteboard',path=join(target,title+'.md'),bytes=Buffer.from(document.markdown,'utf8');await writeFile(path,bytes,{flag:'wx',mode:0o600});const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');if(digest(await readFile(path))!==digest(bytes))throw Error('Markdown 文件写入后校验失败');
  return{name:document.name,title:document.title,path,bytes:bytes.length,sha256:digest(bytes),counts:document.counts};
 }
 async exportAssets(workspaceId:string,name:string){
  if(!/^board-export:[a-f0-9]{64}:[a-f0-9]{64}$/.test(name))throw Error('白板导出快照无效');
  const store=await this.graph.store(workspaceId),entry=(await store.list()).boards.find(b=>name.startsWith('board-export:'+hash(b.id)+':'));if(!entry)throw Error('白板不在当前工作区');
  const document=await this.export(workspaceId,entry.id,false);if(document.name!==name)throw Error('白板已更改，请重新导出');if(!document.assets.length)return{name,assets:[]};
  const context=await this.documentContext(workspaceId,entry.id),directory=await mkdtemp(join(tmpdir(),'artinfact-board-export-')),assets=[];
  for(const item of document.assets){const asset=context.media.assets.get(item.id)??await store.assetRead(item.id),bytes=Buffer.from(asset.base64,'base64'),ext=asset.mimeType==='image/jpeg'?'jpg':asset.mimeType.split('/')[1];if(!/^(png|jpg|webp|gif|avif|bmp)$/.test(ext))throw Error('导出图片格式无效');const path=join(directory,hash(item.id)+'.'+ext);await writeFile(path,bytes,{flag:'wx',mode:0o600});assets.push({...item,path,sha256:createHash('sha256').update(bytes).digest('hex')});}
  return{name,assets};
 }
 private name(node:BoardNode){if(node.role==='source'&&node.sourceId?.startsWith('pages-card:'))return 'graph-card:'+node.sourceId.slice(11);return node.role==='source'&&node.sourceId?.startsWith('md:')?node.sourceId.slice(3):key(node.id);}
 async list(workspaceId:string,boardId:string){
  const board=(await(await this.graph.store(workspaceId)).read(boardId)).board!;
  const workspace=await this.runtime.library.get(workspaceId),nodes=new Map(board.board.nodes.map(n=>[key(n.id),n]));
  const snapshots=new PagesPreviewStore({get:async()=>workspace,readNote:async(id,name)=>{const node=nodes.get(name);if(!node)return this.source.readNote(id,name);const text='# '+node.title+'\n\n'+(node.workflow?.result?.markdown??node.note);return {name,text,revision:hash(text),title:node.title};}});
  const entries=await Promise.all(board.board.nodes.filter(n=>n.kind!=='image'&&(!n.workflow||n.workflow.type==='pages')&&!(n.role==='source'&&!n.sourceId?.startsWith('md:')&&!n.sourceId?.startsWith('pages-card:'))).map(async n=>{
   const name=this.name(n);try{const preview=await snapshots.read(workspaceId,name),result=n.workflow?.result;const page=result?.page;return {nodeId:n.id,name,card:pagesThumbnail(preview.cache?preview:page?{...preview,cache:{...page,sourceRevision:'workflow',syncedAt:result!.completedAt}}:preview)};}
   catch(e){return {nodeId:n.id,name,error:e instanceof Error?e.message:String(e)};}
  }));
  for(const snapshot of await(await this.graph.store(workspaceId)).portablePages()){if(!board.board.nodes.some(n=>n.id===snapshot.nodeId))continue;const index=entries.findIndex(e=>e.nodeId===snapshot.nodeId);if(index>=0&&entries[index].card)continue;const name=key(snapshot.nodeId),entry={nodeId:snapshot.nodeId,name,card:pagesThumbnail({version:1,name,localChanged:false,cache:{...snapshot.page,syncedAt:snapshot.syncedAt,sourceRevision:'portable'}})};if(index>=0)entries[index]=entry;else entries.push(entry);}
  return {entries};
 }
 async target(workspaceId:string,boardId:string,nodeId?:string,sourceId?:string,includeContent=false){
  const imported=nodeId?(await(await this.graph.store(workspaceId)).portablePages()).find(p=>p.nodeId===nodeId):undefined;
  if(imported){const board=(await(await this.graph.store(workspaceId)).read(boardId)).board!;if(!board.board.nodes.some(n=>n.id===nodeId))throw Error('卡片不在当前白板');const name=key(nodeId!),card=pagesThumbnail({version:1,name,localChanged:false,cache:{...imported.page,syncedAt:imported.syncedAt,sourceRevision:'portable'}});return{name,card,...(includeContent?{markdown:imported.page.blocks.filter(b=>b.kind==='markdown').map(b=>b.markdown).join('\n\n')}:{})};}
  let name:string;
  if(sourceId){if(sourceId.startsWith('pages-card:')){name='graph-card:'+sourceId.slice(11);await this.source.readNote(workspaceId,name);}else{if(!sourceId.startsWith('md:'))throw Error('该信源不是 Markdown');name=sourceId.slice(3);await this.runtime.library.readNote(workspaceId,name);}}
  else{const board=(await(await this.graph.store(workspaceId)).read(boardId)).board!,node=board.board.nodes.find(n=>n.id===nodeId);if(!node)throw Error('卡片不在当前白板');if(node.kind==='image'||(node.workflow&&node.workflow.type!=='pages')||(node.role==='source'&&!node.sourceId?.startsWith('md:')&&!node.sourceId?.startsWith('pages-card:')))throw Error('请打开原始 PDF 或图像');name=this.name(node);}
  const preview=await this.pages.read(workspaceId,name);const node=nodeId?(await(await this.graph.store(workspaceId)).read(boardId)).board!.board.nodes.find(n=>n.id===nodeId):undefined,result=node?.workflow?.result,page=result?.page;
  const snapshot=preview.cache?preview:page?{...preview,cache:{...page,sourceRevision:'workflow',syncedAt:result!.completedAt}}:preview;
  return {name,card:pagesThumbnail(snapshot),...(includeContent&&snapshot.cache?{markdown:snapshot.cache.blocks.filter(b=>b.kind==='markdown').map(b=>b.markdown).join('\n\n')}:{})};
 }
}
