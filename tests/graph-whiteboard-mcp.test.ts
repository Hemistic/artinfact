import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WhiteboardStore } from '../src/whiteboard/whiteboard-store.js';
import {registerWhiteboardTools} from '../src/whiteboard/whiteboard-mcp.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

async function fixture(t: TestContext,html?:string) {
  const root=await mkdtemp(join(tmpdir(),'artinfact-board-'));
  const md=join(root,'paper.md');await writeFile(md,'# Paper\n\nA shared controller selects two strategies.\n\nThe limited evaluation excludes retrieval cost.');
  const store=new WhiteboardStore(join(root,'data'),async()=>[{id:'paper',name:'paper.md',format:'md' as const,path:md,markdownPath:md}]);
  const server=registerWhiteboardTools(new McpServer({name:'test',version:'1'}),async id=>{if(id!=='default')throw Error('WORKSPACE_SCOPE');return store;}),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);
  t.after(async()=>{await client.close();await server.close();await rm(root,{recursive:true,force:true});});
  const call=async(name:string,args:Record<string,unknown>={})=>{
    const r=await client.callTool({name,arguments:{...args,workspaceId:'default'}});const text=(r.content as {type:string;text?:string}[]).find(c=>c.type==='text')?.text??'{}';
    if(r.isError)throw new Error(text);return JSON.parse(text);
  };
  return {call,store,md,client};
}
test('all board commands are discoverable through actual MCP; templates contain instructions, no invented findings',async t=>{
  const {call,client}=await fixture(t);const templates=await call('whiteboard_templates');
  const tools=(await client.listTools()).tools.map(t=>t.name);for(const name of ['whiteboard_create','whiteboard_patch','whiteboard_history','whiteboard_add_sources','whiteboard_apply_analysis','whiteboard_asset_put'])assert.ok(tools.includes(name));
  assert.equal(templates.templates.length,4);assert.ok(templates.templates.every((x:{instructions:string})=>typeof x.instructions==='string'));
  const created=await call('whiteboard_create',{title:'Research',templateId:'contribution',requestId:'create-1',expectedRevision:0});
  assert.equal(created.board.board.nodes.length,0);
  const retry=await call('whiteboard_create',{title:'Research',templateId:'contribution',requestId:'create-1',expectedRevision:0});
  assert.equal(retry.board.id,created.board.id);assert.equal((await call('whiteboard_list')).boards.length,1);
  await assert.rejects(call('whiteboard_create',{title:'Different',templateId:'free',requestId:'create-1',expectedRevision:0}),/REQUEST_ID/);
});

test('actual MCP removes connected cards atomically, undoes them, and archives or restores boards',async t=>{
 const {call,client}=await fixture(t);assert.ok((await client.listTools()).tools.some(t=>t.name==='whiteboard_archive'));
 let s=await call('whiteboard_create',{title:'Delete test',templateId:'free',requestId:'create',expectedRevision:0});const boardId=s.board.id;
 s=await call('whiteboard_patch',{boardId,actor:'user',requestId:'nodes',expectedRevision:s.revision,operations:[...['a','b'].map(id=>({op:'put_node',node:{id,title:id,note:'original',kind:'note',x:0,y:0}})),{op:'put_edge',edge:{id:'line',source:'a',target:'b',label:'Editable'}}]});
 s=await call('whiteboard_patch',{boardId,actor:'user',requestId:'delete',expectedRevision:s.revision,operations:[{op:'remove_node',id:'a'}]});
 assert.equal(s.board.board.nodes.length,1);assert.equal(s.board.board.edges.length,0);
 s=await call('whiteboard_history',{boardId,direction:'undo',requestId:'undo',expectedRevision:s.revision});assert.equal(s.board.board.edges[0].label,'Editable');
 s=await call('whiteboard_archive',{boardId,archived:true,requestId:'archive',expectedRevision:s.revision});assert.equal((await call('whiteboard_list')).boards.length,0);
 const deleted=await call('whiteboard_list');assert.equal(deleted.items[0].id,boardId);assert.equal(deleted.items[0].archived,true);
 await assert.rejects(call('whiteboard_patch',{boardId,actor:'user',requestId:'blocked',expectedRevision:s.revision,operations:[{op:'remove_node',id:'a'}]}),/BOARD_ARCHIVED/);
 s=await call('whiteboard_archive',{boardId,archived:false,requestId:'restore',expectedRevision:s.revision});assert.equal(s.board.board.nodes.length,2);
});
test('Agent can move an unchanged manual card but cannot change its content; geometry does not change authorship',async t=>{
 const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Board',templateId:'free',requestId:'c',expectedRevision:0});
 const node={id:'manual',title:'My reasoning',note:'Protected text',kind:'note',x:0,y:0,width:420,height:180};
 s=await call('whiteboard_patch',{boardId:s.board.id,actor:'user',operations:[{op:'put_node',node}],requestId:'n',expectedRevision:s.revision});
 s=await call('whiteboard_patch',{boardId:s.board.id,actor:'agent',operations:[{op:'put_node',node:{...s.board.board.nodes[0],x:600}}],requestId:'move',expectedRevision:s.revision});
 assert.equal(s.board.board.nodes[0].updatedBy,'user');assert.equal(s.board.board.nodes[0].x,600);
 await assert.rejects(call('whiteboard_patch',{boardId:s.board.id,actor:'agent',operations:[{op:'put_node',node:{...s.board.board.nodes[0],note:'Overwrite'}}],requestId:'bad',expectedRevision:s.revision}),/MANUAL_CONTENT/);
});
test('empty results cannot complete an analysis and changed source invalidates an atomic commit',async t=>{
 const {call,md}=await fixture(t);let s=await call('whiteboard_create',{title:'Board',templateId:'contribution',requestId:'c',expectedRevision:0});
 s=await call('whiteboard_add_sources',{boardId:s.board.id,sourceIds:['paper'],requestId:'s',expectedRevision:s.revision});
 const args={boardId:s.board.id,taskId:s.board.tasks[0].id,summary:'Analysis',requestId:'a',expectedRevision:s.revision};
 await assert.rejects(call('whiteboard_apply_analysis',{...args,operations:[]}),/small|RESULT|at least|minimum/i);
 await writeFile(md,'Changed source');
 await assert.rejects(call('whiteboard_apply_analysis',{...args,operations:[{op:'put_node',node:{id:'new',title:'Inference',note:'No quotation',basis:'inference',kind:'inference',x:600,y:0}}]}),/SOURCE_CHANGED/);
 assert.equal((await call('whiteboard_read',{boardId:s.board.id})).board.tasks[0].status,'queued');
});
test('switching a template updates queued instructions and image writes survive restart',async t=>{
 const {call,store}=await fixture(t);let s=await call('whiteboard_create',{title:'Board',templateId:'contribution',requestId:'c',expectedRevision:0});
 s=await call('whiteboard_add_sources',{boardId:s.board.id,sourceIds:['paper'],requestId:'s',expectedRevision:s.revision});
 const previous=s.board.tasks[0].instructions;
 s=await call('whiteboard_request_analysis',{boardId:s.board.id,templateId:'hypothesis',requestId:'template',expectedRevision:s.revision});
 const queued=s.board.tasks.find((task:{status:string})=>task.status==='queued');assert.notEqual(queued.instructions,previous);assert.match(queued.instructions,/验证/);assert.equal(s.board.tasks[0].status,'cancelled');
 const args={name:'pixel.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
 const [one,two]=await Promise.all([call('whiteboard_asset_put',args),call('whiteboard_asset_put',args)]);assert.equal(one.id,two.id);
 const reloaded=new WhiteboardStore(store.root,store.sources);assert.equal((await reloaded.assetRead(one.id)).base64,args.base64);
});
test('source attachment queues one scoped task and supports source paging without accepting arbitrary paths',async t=>{
  const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Reading',templateId:'contribution',requestId:'c',expectedRevision:0});
  s=await call('whiteboard_add_sources',{boardId:s.board.id,sourceIds:['paper'],requestId:'attach',expectedRevision:s.revision});
  assert.equal(s.board.board.nodes.length,1);assert.equal(s.board.tasks.length,1);assert.deepEqual(s.board.tasks[0].sourceIds,['paper']);
  const read=await call('whiteboard_source_read',{sourceId:'paper',offset:9,limit:48});assert.equal(read.text,'A shared controller selects two strategies.\n\nThe');
  await assert.rejects(call('whiteboard_source_read',{sourceId:'../secret'}),/SOURCE/);
});
test('local PDF and Markdown imports use actual MCP, deduplicate and remain readable after restart',async t=>{
 const {call,store}=await fixture(t);const markdown='# Imported\n\nEvidence 原文。';
 const imported=await call('whiteboard_file_import',{name:'我的论文.md',base64:Buffer.from(markdown).toString('base64')});
 const retry=await call('whiteboard_file_import',{name:'另一个名字.md',base64:Buffer.from(markdown).toString('base64')});assert.equal(retry.id,imported.id);
 const reloaded=new WhiteboardStore(store.root,store.sources);assert.equal((await reloaded.sourceRead(imported.id)).text,markdown);
 assert.ok((await call('whiteboard_sources')).sources.some((s:any)=>s.id===imported.id&&s.ready));
 let s=await call('whiteboard_create',{title:'Import interaction',templateId:'free',requestId:'import-create',expectedRevision:0});
 s=await call('whiteboard_add_sources',{boardId:s.board.id,sourceIds:[imported.id],position:{x:-300,y:520},requestId:'import-attach',expectedRevision:s.revision});
 assert.equal(s.board.board.nodes[0].x,-300);assert.equal(s.board.board.nodes[0].y,520);
 const pdf=await call('whiteboard_file_import',{name:'paper.pdf',base64:Buffer.from('%PDF-1.7\n%%EOF').toString('base64')});assert.equal(pdf.ready,false);
 await assert.rejects(call('whiteboard_source_read',{sourceId:pdf.id}),/NOT_PARSED/);
 await assert.rejects(call('whiteboard_file_import',{name:'attack.exe',base64:'eA=='}),/FILE_TYPE/);
 await assert.rejects(call('whiteboard_file_import',{name:'fake.pdf',base64:'eA=='}),/PDF/);
 await assert.rejects(call('whiteboard_file_import',{name:'bad.md',base64:'/w=='}),/UTF8/);
});
test('drag connection sides persist through real MCP and undo restores the prior relationships',async t=>{
 const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Connections',templateId:'free',requestId:'ports-create',expectedRevision:0});
 s=await call('whiteboard_patch',{boardId:s.board.id,actor:'user',requestId:'ports-nodes',expectedRevision:s.revision,operations:['a','b'].map((id,i)=>({op:'put_node',node:{id,title:id,note:'',kind:'note',x:i*600,y:0}}))});
 s=await call('whiteboard_patch',{boardId:s.board.id,actor:'user',requestId:'ports-edge',expectedRevision:s.revision,operations:[{op:'put_edge',edge:{id:'edge',source:'a',target:'b',label:'关联',sourceSide:'bottom',targetSide:'top'}}]});
 assert.equal((await call('whiteboard_read',{boardId:s.board.id})).board.board.edges[0].targetSide,'top');
 s=await call('whiteboard_history',{boardId:s.board.id,direction:'undo',requestId:'ports-undo',expectedRevision:s.revision});assert.equal(s.board.board.edges.length,0);
});
test('adding the same source to another board preserves its edited shared note',async t=>{
 const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'One',templateId:'free',requestId:'c',expectedRevision:0});
 const first=s.board.id;s=await call('whiteboard_add_sources',{boardId:first,sourceIds:['paper'],requestId:'s',expectedRevision:s.revision});
 s=await call('whiteboard_patch',{boardId:first,actor:'user',operations:[{op:'put_node',node:{...s.board.board.nodes[0],note:'My source annotation'}}],requestId:'edit',expectedRevision:s.revision});
 s=await call('whiteboard_create',{title:'Two',templateId:'free',requestId:'two',expectedRevision:s.revision});
 s=await call('whiteboard_add_sources',{boardId:s.board.id,sourceIds:['paper'],requestId:'s2',expectedRevision:s.revision});
 assert.equal(s.board.board.nodes[0].note,'My source annotation');assert.equal((await call('whiteboard_read',{boardId:first})).board.board.nodes[0].note,'My source annotation');
});
test('measured geometry refines an edit without adding an extra undo step or allowing content changes',async t=>{
 const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Board',templateId:'free',requestId:'c',expectedRevision:0});
 const node={id:'n',title:'Note',note:'Original',kind:'note',x:0,y:0,height:200};
 s=await call('whiteboard_patch',{boardId:s.board.id,actor:'user',operations:[{op:'put_node',node}],requestId:'n',expectedRevision:s.revision});
 s=await call('whiteboard_patch',{boardId:s.board.id,actor:'user',operations:[{op:'put_node',node:{...s.board.board.nodes[0],note:'Longer text'}}],requestId:'edit',expectedRevision:s.revision});
 s=await call('whiteboard_patch',{boardId:s.board.id,actor:'user',refineGeometry:true,operations:[{op:'put_node',node:{...s.board.board.nodes[0],height:700}}],requestId:'measure',expectedRevision:s.revision});
 await assert.rejects(call('whiteboard_patch',{boardId:s.board.id,actor:'user',refineGeometry:true,operations:[{op:'put_node',node:{...s.board.board.nodes[0],note:'Sneaky edit'}}],requestId:'bad',expectedRevision:s.revision}),/GEOMETRY/);
 s=await call('whiteboard_history',{boardId:s.board.id,direction:'undo',requestId:'undo',expectedRevision:s.revision});assert.equal(s.board.board.nodes[0].note,'Original');assert.equal(s.board.board.nodes[0].height,200);
});
test('analysis adds nonlinear branches with exact source anchors; hallucinated quotations roll back the whole batch',async t=>{
  const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Reading',templateId:'contribution',requestId:'c',expectedRevision:0});
  s=await call('whiteboard_add_sources',{boardId:s.board.id,sourceIds:['paper'],requestId:'a',expectedRevision:s.revision});
  const quote='A shared controller selects two strategies.',citation={sourceId:'paper',start:9,end:9+quote.length,quote};
  const node=(id:string)=>({id,title:id,note:quote,kind:'method',x:id==='A'?520:1040,y:0,width:420,height:180,autoHeight:true,basis:'reported',citations:[citation]});
  const args={boardId:s.board.id,taskId:s.board.tasks[0].id,requestId:'analysis',expectedRevision:s.revision,summary:'Two branches',operations:[{op:'put_node',node:node('A')},{op:'put_node',node:node('B')},{op:'put_edge',edge:{id:'shared',source:'A',target:'B',label:'共同控制器'}}]};
  await assert.rejects(call('whiteboard_apply_analysis',{...args,operations:[...args.operations,{op:'put_node',node:{...node('bad'),citations:[{...citation,quote:'fake'}]}}]}),/CITATION/);
  assert.equal((await call('whiteboard_read',{boardId:s.board.id})).board.board.nodes.length,1);
  s=await call('whiteboard_apply_analysis',args);assert.equal(s.board.board.nodes.length,3);assert.equal(s.board.tasks[0].status,'completed');
  assert.equal(s.board.board.edges.length,1);assert.equal(s.board.board.nodes[1].createdBy,'agent');
});
test('optimistic concurrency rejects stale writes; manual notes are protected from agent overwrites; undo restores the batch',async t=>{
  const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Notes',templateId:'free',requestId:'c',expectedRevision:0});const boardId=s.board.id;
  const node={id:'mine',title:'My thought',note:'Original',kind:'note',x:0,y:0,width:420,height:180};
  s=await call('whiteboard_patch',{boardId,requestId:'note',expectedRevision:s.revision,actor:'user',operations:[{op:'put_node',node}]});
  await assert.rejects(call('whiteboard_patch',{boardId,requestId:'stale',expectedRevision:1,actor:'user',operations:[{op:'remove_node',id:'mine'}]}),/REVISION_CONFLICT/);
  await assert.rejects(call('whiteboard_patch',{boardId,requestId:'overwrite',expectedRevision:s.revision,actor:'agent',operations:[{op:'put_node',node:{...node,note:'Overwritten'}}]}),/MANUAL_CONTENT/);
  s=await call('whiteboard_history',{boardId,requestId:'undo',expectedRevision:s.revision,direction:'undo'});assert.equal(s.board.board.nodes.length,0);
  s=await call('whiteboard_history',{boardId,requestId:'redo',expectedRevision:s.revision,direction:'redo'});assert.equal(s.board.board.nodes[0].note,'Original');
});
test('card reuse shares content but keeps independent geometry; board removal does not delete notes',async t=>{
  const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'One',templateId:'free',requestId:'1',expectedRevision:0});const one=s.board.id;
  s=await call('whiteboard_patch',{boardId:one,requestId:'n',expectedRevision:s.revision,actor:'user',operations:[{op:'put_node',node:{id:'shared',title:'Idea',note:'Text',kind:'note',x:100,y:200,width:420,height:180}}]});
  s=await call('whiteboard_create',{title:'Two',templateId:'free',requestId:'2',expectedRevision:s.revision});const two=s.board.id;
  s=await call('whiteboard_add_cards',{boardId:two,cardIds:['shared'],requestId:'reuse',expectedRevision:s.revision});
  s=await call('whiteboard_patch',{boardId:two,requestId:'edit',expectedRevision:s.revision,actor:'user',operations:[{op:'put_node',node:{...s.board.board.nodes[0],note:'Revised',x:900}}]});
  const first=(await call('whiteboard_read',{boardId:one})).board.board.nodes[0];assert.equal(first.note,'Revised');assert.equal(first.x,100);
  s=await call('whiteboard_patch',{boardId:two,requestId:'remove',expectedRevision:s.revision,actor:'user',operations:[{op:'remove_node',id:'shared'}]});
  assert.equal((await call('whiteboard_cards')).cards[0].note,'Revised');assert.equal((await call('whiteboard_read',{boardId:one})).board.board.nodes.length,1);
});

test('Agent can add a first compact presentation without editing a manual note; subsequent manual presentation is protected',async t=>{
 const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Compact',templateId:'free',requestId:'create-compact',expectedRevision:0});const boardId=s.board.id;
 const note={id:'formula',title:'Original title',note:'Original note',kind:'note',x:10,y:20};
 s=await call('whiteboard_patch',{boardId,expectedRevision:s.revision,requestId:'manual-compact',actor:'user',operations:[{op:'put_node',node:note}]});
 const presentation={type:'formula',latex:'E=mc^2',explanation:'Energy.',symbols:[{latex:'m',meaning:'Mass.'}]};
 s=await call('whiteboard_patch',{boardId,expectedRevision:s.revision,requestId:'agent-compact',actor:'agent',operations:[{op:'put_node',node:{...s.board.board.nodes[0],presentation}}]});
 const n=(await call('whiteboard_read',{boardId})).board.board.nodes[0];assert.equal(n.note,'Original note');assert.deepEqual(n.presentation,presentation);assert.equal(n.updatedBy,'user');
 await assert.rejects(call('whiteboard_patch',{boardId,expectedRevision:s.revision,requestId:'agent-overwrite',actor:'agent',operations:[{op:'put_node',node:{...n,presentation:{...presentation,explanation:'Changed'}}}]}),/MANUAL_CONTENT/);
 await assert.rejects(call('whiteboard_patch',{boardId,expectedRevision:s.revision,requestId:'agent-overwrite-note',actor:'agent',operations:[{op:'put_node',node:{...n,note:'Changed'}}]}),/MANUAL_CONTENT/);
});
test('cancelled tasks reject late results; task claim prevents two agents processing the same job',async t=>{
  const {call}=await fixture(t);let s=await call('whiteboard_create',{title:'Reading',templateId:'contribution',requestId:'c',expectedRevision:0});
  s=await call('whiteboard_add_sources',{boardId:s.board.id,sourceIds:['paper'],requestId:'a',expectedRevision:s.revision});const taskId=s.board.tasks[0].id,boardId=s.board.id;
  s=await call('whiteboard_task_status',{boardId,taskId,status:'running',requestId:'claim',expectedRevision:s.revision});
  await assert.rejects(call('whiteboard_task_status',{boardId,taskId,status:'running',requestId:'claim2',expectedRevision:s.revision}),/TASK_STATE/);
  s=await call('whiteboard_task_status',{boardId,taskId,status:'cancelled',requestId:'cancel',expectedRevision:s.revision});
  await assert.rejects(call('whiteboard_apply_analysis',{boardId,taskId,requestId:'late',expectedRevision:s.revision,summary:'late',operations:[]}),/TASK_STATE/);
});

test("workspace isolation rejects a board tool outside its configured source",async t=>{const {client}=await fixture(t);const r=await client.callTool({name:"whiteboard_list",arguments:{workspaceId:"ws-0123456789abcdef"}});assert.equal(r.isError,true);});
