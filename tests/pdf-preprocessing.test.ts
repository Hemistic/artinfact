import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {WhiteboardStore} from '../src/whiteboard/whiteboard-store.js';
import {registerWhiteboardTools} from '../src/whiteboard/whiteboard-mcp.js';
import type {Source} from '../src/whiteboard/whiteboard-domain.js';
async function fixture(t:TestContext){
 const root=await mkdtemp(join(tmpdir(),'aif-preprocess-'));
 const sources:Source[]=[{id:'pdf-a',name:'Paper A',format:'pdf',category:'document',documentId:'pdf-a',path:'original.pdf',text:'A controller chooses a strategy. Equation: E=mc^2.'},{id:'formula-a',name:'Equation 1',format:'pdf',category:'formula',documentId:'pdf-a',path:'original.pdf',text:'E=mc^2',latex:'E=mc^2'},{id:'figure-a',name:'Figure 1',format:'pdf',category:'figure',documentId:'pdf-a',path:'original.pdf',text:'Figure 1: controller choices.',caption:'Figure 1: controller choices.'},{id:'pdf-b',name:'Paper B',format:'pdf',category:'document',documentId:'pdf-b',path:'other.pdf'}];
 const store=new WhiteboardStore(root,async()=>sources),server=registerWhiteboardTools(new McpServer({name:'test',version:'1'}),async id=>{if(id!=='default')throw Error('WORKSPACE_SCOPE');return store;}),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 t.after(async()=>{await client.close();await server.close();await rm(root,{recursive:true,force:true});});
 let seq=0;const call=async(name:string,args:Record<string,unknown>={})=>{const r=await client.callTool({name,arguments:{workspaceId:'default',...args}}),value=(r.content as {type:string;text?:string}[]).find(c=>c.type==='text')?.text??'{}';if(r.isError)throw Error(value);return JSON.parse(value);};
 const mutate=async(name:string,args:Record<string,unknown>)=>call(name,{...(await call('whiteboard_list')),expectedRevision:(await call('whiteboard_list')).revision,requestId:'mutation-'+(++seq),...args});
 const draft=(id:string)=>({sourceId:id,title:'AI: '+id,note:'Agent explanation of '+id,citations:[{sourceId:id,start:0,end:sources.find(s=>s.id===id)!.text!.length,quote:sources.find(s=>s.id===id)!.text!}],...(id==='formula-a'?{presentation:{type:'formula',latex:'E=mc^2',explanation:'An energy relation.',symbols:[{latex:'E',meaning:'Energy'}]}}:{})});
 return {root,store,sources,call,mutate,draft};
}
test('PDF preprocessing is workspace-scoped, incremental and reused across whiteboards without replacing original text',async t=>{
 const {root,sources,call,mutate,draft}=await fixture(t);
 let data=await call('whiteboard_pdf_preprocess_read');assert.equal(data.documents.length,2);assert.equal(data.documents[1].ready,false);
 data=await mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-a']});const taskId=data.task.id;
 assert.equal(data.task.total,3);assert.equal((await call('whiteboard_list')).boards.length,0);
 const retry=await mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-a']});assert.equal(retry.task.id,taskId);
 await mutate('whiteboard_pdf_preprocess_status',{taskId,status:'running'});
 data=await mutate('whiteboard_pdf_preprocess_apply',{taskId,drafts:[draft('formula-a')],summary:'Processed equation'});
 assert.equal(data.task.completed,1);assert.equal(data.task.status,'running');
 data=await mutate('whiteboard_pdf_preprocess_apply',{taskId,drafts:[draft('pdf-a'),draft('figure-a')],summary:'Processed all selected PDF data'});assert.equal(data.task.completed,3);assert.equal(data.task.status,'completed');
 assert.equal((await call('whiteboard_source_read',{sourceId:'formula-a'})).text,'E=mc^2');
 const catalog=await call('whiteboard_sources');assert.equal(catalog.sources.find((s:any)=>s.id==='formula-a').processed,true);assert.equal(catalog.sources.find((s:any)=>s.id==='formula-a').presentation.type,'formula');
 const page=await call('whiteboard_pdf_preprocess_results',{documentId:'pdf-a',offset:0,limit:1});assert.equal(page.total,3);assert.equal(page.results.length,1);assert.equal(page.nextOffset,1);
 const restarted=new WhiteboardStore(root,async()=>sources);assert.equal((await restarted.preprocessRead()).documents[0].completed,3);
 for(const title of ['Board one','Board two']){const board=await mutate('whiteboard_create',{title,templateId:'free'}),added=await mutate('whiteboard_add_sources',{boardId:board.board.id,sourceIds:['formula-a']});assert.equal(added.board.board.nodes[0].presentation.type,'formula');assert.equal(added.board.board.nodes[0].note,draft('formula-a').note);}
 const cached=await mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-a']});assert.equal(cached.task,undefined);
 sources[0].text+=' Revised parent document.';assert.equal((await call('whiteboard_pdf_preprocess_read')).documents[0].completed,0);
 const changed=await mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-a']});assert.equal(changed.task.total,3);
});
test('refreshing shared preprocessing and graph cards preserves user notes and whiteboard geometry',async t=>{
 const {store,call,mutate,draft}=await fixture(t);let data=await mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-a']});await mutate('whiteboard_pdf_preprocess_apply',{taskId:data.task.id,drafts:['pdf-a','formula-a','figure-a'].map(draft),summary:'Prepared'});
 const created=await mutate('whiteboard_create',{title:'Manual work',templateId:'free'}),boardId=created.board.id,added=await mutate('whiteboard_add_sources',{boardId,sourceIds:['formula-a']});const original=added.board.board.nodes[0],manual={...original,note:'My own explanation',x:123,y:456};
 await mutate('whiteboard_patch',{boardId,actor:'user',operations:[{op:'put_node',node:manual}]});
 data=await mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-a'],force:true});await mutate('whiteboard_pdf_preprocess_apply',{taskId:data.task.id,drafts:['pdf-a','formula-a','figure-a'].map(id=>({...draft(id),note:'Updated Agent explanation'})),summary:'Refreshed'});
 const current=(await call('whiteboard_read',{boardId})).board.board.nodes[0];assert.equal(current.note,'My own explanation');assert.equal(current.x,123);assert.equal(current.y,456);
 await store.importGraphCards({nodes:[{...manual,note:'Graph rewrite'}],expectedRevision:(await store.list()).revision,requestId:'graph-sync'});assert.equal((await call('whiteboard_read',{boardId})).board.board.nodes[0].note,'My own explanation');
});
test('preprocessing rejects unparsed PDFs, invalid citations, stale sources and results for cancelled tasks',async t=>{
 const {sources,call,mutate,draft}=await fixture(t);
 await assert.rejects(mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-b']}),/SOURCE_NOT_PARSED/);
 const requested=await mutate('whiteboard_pdf_preprocess_request',{documentIds:['pdf-a']}),taskId=requested.task.id;
 await assert.rejects(mutate('whiteboard_pdf_preprocess_apply',{taskId,drafts:[{...draft('formula-a'),presentation:undefined}],summary:'Missing formula'}),/FORMULA_PRESENTATION/);
 await assert.rejects(mutate('whiteboard_pdf_preprocess_apply',{taskId,drafts:[{...draft('formula-a'),citations:[{sourceId:'formula-a',start:0,end:6,quote:'invent'}]}],summary:'Wrong quote'}),/CITATION_MISMATCH/);
 assert.equal((await call('whiteboard_pdf_preprocess_read',{taskId})).task.completed,0);
 sources[0].text+=' Changed.';await assert.rejects(mutate('whiteboard_pdf_preprocess_apply',{taskId,drafts:[draft('formula-a')],summary:'Stale'}),/SOURCE_CHANGED/);
 await mutate('whiteboard_pdf_preprocess_status',{taskId,status:'cancelled'});
 await assert.rejects(mutate('whiteboard_pdf_preprocess_apply',{taskId,drafts:[draft('formula-a')],summary:'Late result'}),/TASK_STATE/);
});
