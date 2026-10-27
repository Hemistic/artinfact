import {createHash,randomUUID} from 'node:crypto';
import type {WorkspaceRuntime} from './workspace-runtime.js';
import {WorkspaceWhiteboards} from './whiteboard-service.js';
import type {BoardNode} from '../whiteboard/whiteboard-domain.js';
import {WhiteboardPages} from './whiteboard-pages.js';
import {PagesPreviewStore} from './pages-preview.js';
import {synchronizeNoteHeading} from '../shared/note-heading.js';
const revision=(n:BoardNode)=>createHash('sha256').update(JSON.stringify([n.title,n.note])).digest('hex');
const isNote=(n:BoardNode)=>n.kind==='note'&&(n.role===undefined||n.role==='note')&&(!n.sourceId||n.referenceCard)&&!n.workflow;
export class WhiteboardNotes {
 private graph:WorkspaceWhiteboards;
 constructor(private runtime:WorkspaceRuntime){this.graph=new WorkspaceWhiteboards(runtime);}
 async list(workspaceId:string){
  const store=await this.graph.store(workspaceId),catalog=await store.noteEntries(),entries=new Map<string,{nodeId:string;title:string;boards:{id:string;title:string}[]}>();
  for(const board of catalog){for(const n of board.nodes){const entry=entries.get(n.id)??{nodeId:n.id,title:n.title,boards:[]};entry.boards.push({id:board.id,title:board.title});entries.set(n.id,entry);}}
  return{entries:[...entries.values()]};
 }
 async read(workspaceId:string,nodeId:string){
  const entry=(await this.list(workspaceId)).entries.find(n=>n.nodeId===nodeId);if(!entry)throw Error('NOTE_NOT_FOUND: 笔记不在当前工作区白板中');
  const view=await(await this.graph.store(workspaceId)).read(entry.boards[0].id),node=view.board!.board.nodes.find(n=>n.id===nodeId)!;
  const pages=new WhiteboardPages(this.runtime),target=await pages.target(workspaceId,entry.boards[0].id,nodeId),cache=(await new PagesPreviewStore(pages.source).read(workspaceId,target.name)).cache;
  const canonical=synchronizeNoteHeading(node.title,node.note);
  return{nodeId,boardId:entry.boards[0].id,...canonical,revision:revision(node),needsTitleSync:canonical.title!==node.title||canonical.markdown!==node.note,boards:entry.boards,...(cache?{page:{pageId:cache.pageId,title:cache.title,url:cache.url,markdown:cache.blocks.filter(b=>b.kind==='markdown').map(b=>b.markdown).join('\n\n')}}:{})};
 }
 async create(workspaceId:string,input:{title:string;markdown?:string;boardId?:string;legacyId?:string}){
  const store=await this.graph.store(workspaceId);let boardId=input.boardId;
  if(!boardId){const catalog=await store.list();boardId=catalog.boards[0]?.id;if(!boardId){const created=await store.create({title:'阅读笔记',templateId:'free',expectedRevision:catalog.revision,requestId:randomUUID()});boardId=created.board!.id;}}
  const view=await store.read(boardId);if(view.archived)throw Error('BOARD_ARCHIVED');
  const nodes=view.board!.board.nodes,node:BoardNode={id:input.legacyId??randomUUID(),title:input.title,note:input.markdown??'',kind:'note',role:'note',x:60,y:nodes.length?Math.max(...nodes.map(n=>n.y+(n.height??240)))+60:80,width:420,height:240,autoHeight:true};
  await store.patch({boardId,expectedRevision:view.revision,requestId:randomUUID(),actor:'user',operations:[{op:'put_node',node}]});return this.read(workspaceId,node.id);
 }
 async importLegacy(workspaceId:string,name:string){
  const nodeId='legacy-note-'+createHash('sha256').update(name).digest('hex');
  if((await this.list(workspaceId)).entries.some(n=>n.nodeId===nodeId))return this.read(workspaceId,nodeId);
  const original=await this.runtime.library.readNote(workspaceId,name);
  return this.create(workspaceId,{title:name.replace(/\.md$/i,''),markdown:original.text,legacyId:nodeId});
 }
 async write(workspaceId:string,input:{nodeId:string;title:string;markdown:string;revision:string;boardId?:string}){
  const store=await this.graph.store(workspaceId);
  for(let attempt=0;attempt<3;attempt++){
   const note=await this.read(workspaceId,input.nodeId),boardId=input.boardId??note.boardId;if(!note.boards.some(b=>b.id===boardId))throw Error('NOTE_NOT_FOUND');const view=await store.read(boardId),node=view.board!.board.nodes.find(n=>n.id===input.nodeId);
   if(!node||revision(node)!==input.revision)throw Error('NOTE_CHANGED: 笔记已在其他位置更新，请重新打开后编辑');
   try{const saved=await store.patch({boardId,expectedRevision:view.revision,requestId:randomUUID(),actor:'user',operations:[{op:'put_node',node:{...node,title:input.title,note:input.markdown}}]});return {...await this.read(workspaceId,input.nodeId),boardRevision:saved.revision,canUndo:saved.canUndo,canRedo:saved.canRedo};}
   catch(e){if(attempt===2||!String(e).includes('REVISION_CONFLICT'))throw e;}
  }
  throw Error('NOTE_BUSY');
 }
}
