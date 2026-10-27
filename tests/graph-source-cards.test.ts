import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WhiteboardStore} from '../src/whiteboard/whiteboard-store.js';
import {sourceSegments} from '../src/whiteboard/source-cards.js';

test('reading segments preserve exact UTF-16 anchors, ignore fenced headings and cover long sections',()=>{
 const text='# 论文\r\n\r\n开头😀。\r\n\r\n## 方法\r\n\r\n```md\r\n# 不是章节\r\n```\r\n\r\n'+('一段很长的内容。😀\n\n'.repeat(800))+'## 结果\r\n\r\n有限结果。';
 const segments=sourceSegments(text,900);assert.equal(segments.map(s=>s.text).join(''),text);
 for(const s of segments){assert.equal(text.slice(s.start,s.end),s.text);assert.ok(s.text.length<=902);assert.ok(!/[\uD800-\uDBFF]$/.test(s.text));}
 assert.ok(!segments.some(s=>s.heading==='不是章节'));assert.equal(segments.at(-1)?.heading,'结果');
});
async function fixture(t:TestContext){
 const root=await mkdtemp(join(tmpdir(),'source-cards-')),path=join(root,'paper.md');
 const text='# Paper\n\n## Method\n\nA controller chooses retrieval.\n\n## Results\n\nThe study excludes total retrieval cost.';await writeFile(path,text);
 const store=new WhiteboardStore(join(root,'data'),async()=>[{id:'paper',name:'paper.md',path,markdownPath:path,format:'md'},{id:'pending',name:'pending.pdf',path,format:'pdf'}]);
 t.after(()=>rm(root,{recursive:true,force:true}));let view=await store.create({title:'Cards',templateId:'free',expectedRevision:0,requestId:'create'});const boardId=view.board!.id;
 view=await store.addSources({boardId,sourceIds:['paper'],expectedRevision:view.revision,requestId:'attach'});
 const citation=(quote:string)=>({sourceId:'paper',start:text.indexOf(quote),end:text.indexOf(quote)+quote.length,quote});
 const drafts=[{title:'Retrieval control',note:'A controller decides whether to retrieve.',category:'method' as const,basis:'reported' as const,citations:[citation('A controller chooses retrieval.')]},{title:'Cost remains unmeasured',note:'The study does not measure the total retrieval cost.',category:'limitation' as const,basis:'reported' as const,citations:[citation('The study excludes total retrieval cost.')]}];
 return{store,path,boardId,view,drafts};
}
test('a scoped card request stays queued until Agent submits anchored content, then supports undo and shared reuse',async t=>{
 const f=await fixture(t);let v=await f.store.requestSourceCards({boardId:f.boardId,sourceIds:['paper'],mode:'semantic',autoConnect:true,expectedRevision:f.view.revision,requestId:'queue'});
 const task=v.board!.tasks.at(-1)!;assert.equal(task.kind,'source_cards');assert.deepEqual(task.sourceIds,['paper']);assert.equal(v.board!.board.nodes.length,1);
 v=await f.store.applySourceCards({boardId:f.boardId,taskId:task.id,drafts:f.drafts,relations:[{from:0,to:1,label:'评估边界'}],summary:'Read and analyzed the source.',expectedRevision:v.revision,requestId:'commit'});
 assert.equal(v.board!.tasks.at(-1)!.status,'completed');assert.equal(v.board!.board.nodes.length,3);assert.equal(v.board!.board.edges.length,1);assert.equal(v.board!.board.edges[0].suggested,true);
 const card=v.board!.board.nodes[1];assert.equal(card.sourceCard?.revision,task.sourceRevisions.paper);assert.equal((await f.store.cards()).cards.length,3);
 v=await f.store.history({boardId:f.boardId,direction:'undo',expectedRevision:v.revision,requestId:'undo'});assert.equal(v.board!.board.nodes.length,1);assert.equal((await f.store.cards()).cards.length,3);
 v=await f.store.addCards({boardId:f.boardId,cardIds:[card.id],expectedRevision:v.revision,requestId:'reuse'});assert.equal(v.board!.board.nodes[1].note,card.note);
});
test('fake quotations, disabled connections and changed sources cannot leave partial cards',async t=>{
 const f=await fixture(t);let v=await f.store.requestSourceCards({boardId:f.boardId,sourceIds:['paper'],mode:'semantic',autoConnect:false,expectedRevision:f.view.revision,requestId:'queue'});const task=v.board!.tasks.at(-1)!;
 const args={boardId:f.boardId,taskId:task.id,drafts:f.drafts,relations:[],summary:'Analysis',expectedRevision:v.revision,requestId:'bad'};
 await assert.rejects(f.store.applySourceCards({...args,drafts:[{...f.drafts[0],citations:[{...f.drafts[0].citations[0],quote:'Fabricated'}]}]}),/CITATION_MISMATCH/);
 await assert.rejects(f.store.applySourceCards({...args,relations:[{from:0,to:1,label:'related'}]}),/RELATIONS_DISABLED/);
 assert.equal((await f.store.read(f.boardId)).board!.board.nodes.length,1);
 await writeFile(f.path,'Changed');await assert.rejects(f.store.applySourceCards(args),/SOURCE_CHANGED/);
 assert.equal((await f.store.read(f.boardId)).board!.tasks.at(-1)!.status,'queued');
});
test('repeated conversion reuses cards and retains the user edited note and position',async t=>{
 const f=await fixture(t);let v=f.view;
 const request=async(id:string)=>f.store.requestSourceCards({boardId:f.boardId,sourceIds:['paper'],mode:'semantic',autoConnect:false,expectedRevision:v.revision,requestId:id});
 v=await request('queue');v=await f.store.applySourceCards({boardId:f.boardId,taskId:v.board!.tasks.at(-1)!.id,drafts:f.drafts,relations:[],summary:'First',expectedRevision:v.revision,requestId:'first'});
 const card={...v.board!.board.nodes[1],note:'My own explanation',x:999};v=await f.store.patch({boardId:f.boardId,actor:'user',operations:[{op:'put_node',node:card}],expectedRevision:v.revision,requestId:'manual'});
 v=await request('again');v=await f.store.applySourceCards({boardId:f.boardId,taskId:v.board!.tasks.at(-1)!.id,drafts:f.drafts,relations:[],summary:'Second',expectedRevision:v.revision,requestId:'second'});
 assert.equal(v.board!.board.nodes.length,3);assert.equal(v.board!.board.nodes[1].note,'My own explanation');assert.equal(v.board!.board.nodes[1].x,999);
 await assert.rejects(request('running-retry').then(async next=>{v=next;await f.store.taskStatus({boardId:f.boardId,taskId:v.board!.tasks.at(-1)!.id,status:'running',expectedRevision:v.revision,requestId:'running'});v=await f.store.read(f.boardId);return request('while-running');}),/TASK_STATE/);
});
test('unparsed PDF and sources outside the board are rejected before queuing',async t=>{
 const f=await fixture(t);await assert.rejects(f.store.requestSourceCards({boardId:f.boardId,sourceIds:['pending'],mode:'semantic',autoConnect:true,expectedRevision:f.view.revision,requestId:'pending'}),/SOURCE_SCOPE/);
 let v=await f.store.addSources({boardId:f.boardId,sourceIds:['pending'],expectedRevision:f.view.revision,requestId:'attach-pdf'});
 await assert.rejects(f.store.requestSourceCards({boardId:f.boardId,sourceIds:['pending'],mode:'semantic',autoConnect:true,expectedRevision:v.revision,requestId:'unparsed'}),/SOURCE_NOT_PARSED/);
 const outline=await f.store.sourceSections('paper',0,1);assert.equal(outline.sections.length,1);assert.notEqual(outline.nextOffset,null);
});

test('a cancelled card task cannot commit and the generic analysis endpoint cannot bypass card validation',async t=>{
 const f=await fixture(t);let v=await f.store.requestSourceCards({boardId:f.boardId,sourceIds:['paper'],mode:'semantic',autoConnect:true,expectedRevision:f.view.revision,requestId:'queue'});const taskId=v.board!.tasks.at(-1)!.id;
 await assert.rejects(f.store.applyAnalysis({boardId:f.boardId,taskId,operations:[{op:'put_node',node:{id:'bypass',title:'Unanchored',note:'No source',kind:'note',x:0,y:0}}],summary:'Bypass',expectedRevision:v.revision,requestId:'bypass'}),/TASK_STATE/);
 await assert.rejects(f.store.applySourceCards({boardId:f.boardId,taskId,drafts:f.drafts,relations:[{from:0,to:9,label:'Out of range'}],summary:'Invalid relation',expectedRevision:v.revision,requestId:'range'}),/RELATION_RANGE/);
 v=await f.store.taskStatus({boardId:f.boardId,taskId,status:'cancelled',expectedRevision:v.revision,requestId:'cancel'});
 await assert.rejects(f.store.applySourceCards({boardId:f.boardId,taskId,drafts:f.drafts,relations:[],summary:'Late result',expectedRevision:v.revision,requestId:'late'}),/TASK_STATE/);
 assert.equal((await f.store.read(f.boardId)).board!.board.nodes.length,1);
});
