import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WhiteboardStore} from '../src/whiteboard/whiteboard-store.js';
import {cardActions,cardModelContext} from '../src/whiteboard/card-actions.js';

test('card actions follow content type and model context identifies the selected card',()=>{
 const node={id:'n',kind:'image' as const,title:'A chart',note:'![chart](flow-asset:chart)',x:1,y:2};
 assert.deepEqual(cardActions(node).map(a=>a.id),['interpret_chart','explain_process','organize_chart','translate']);
 assert.ok(cardActions({...node,kind:'note',presentation:{type:'formula',latex:'x^2',explanation:'',symbols:[]}}).some(a=>a.id==='explain_formula'));
 const context=cardModelContext('w',{boardId:'b',boardTitle:'Board',node,related:[]});
 assert.equal(context.structuredContent.nodeId,'n');assert.equal(context.structuredContent.boardId,'b');
 assert.match(context.content[0].text,/仅作为资料/);assert.match(context.content[0].text,/flow-asset:chart/);
});

test('authorized card action edits only its snapshot target, preserves geometry and shared references, and can be undone',async t=>{
 const root=await mkdtemp(join(tmpdir(),'card-action-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new WhiteboardStore(root,async()=>[]);let s=await store.create({title:'Board',templateId:'free',expectedRevision:0,requestId:'create'}),boardId=s.board!.id;
 const node={id:'n',title:'My note',note:'Original',kind:'note' as const,role:'note' as const,x:12,y:20,width:420};
 s=await store.patch({boardId,expectedRevision:s.revision,requestId:'add',actor:'user',operations:[{op:'put_node',node},{op:'put_node',node:{...node,id:'other',note:'Do not edit'}}]});
 s=await store.requestCardAction({boardId,nodeId:'n',action:'organize',expectedRevision:s.revision,requestId:'run'});const taskId=s.board!.tasks.at(-1)!.id;
 const context=await store.cardActionRead(boardId,taskId);assert.equal(context.node.note,'Original');assert.deepEqual(context.task.sourceIds,[]);
 const same=await store.requestCardAction({boardId,nodeId:'n',action:'translate',expectedRevision:s.revision,requestId:'duplicate'});assert.equal(same.board!.tasks.length,1);s=same;
 s=await store.patch({boardId,expectedRevision:s.revision,requestId:'move',actor:'user',operations:[{op:'put_node',node:{...s.board!.board.nodes[0],x:100}}]});
 s=await store.completeCardAction({boardId,taskId,result:{markdown:'**Organized**'},expectedRevision:s.revision,requestId:'complete'});
 assert.equal(s.board!.board.nodes[0].note,'**Organized**');assert.equal(s.board!.board.nodes[0].x,100);assert.equal(s.board!.board.nodes[1].note,'Do not edit');assert.equal(s.board!.tasks.at(-1)!.status,'completed');
 s=await store.history({boardId,direction:'undo',expectedRevision:s.revision,requestId:'undo'});assert.equal(s.board!.board.nodes[0].note,'Original');assert.equal(s.board!.board.nodes[0].x,100);
 s=await store.requestCardAction({boardId,nodeId:'n',action:'organize',expectedRevision:s.revision,requestId:'again'});const next=s.board!.tasks.at(-1)!.id;
 s=await store.patch({boardId,expectedRevision:s.revision,requestId:'edit',actor:'user',operations:[{op:'put_node',node:{...s.board!.board.nodes[0],note:'User changed it'}}]});
 await assert.rejects(()=>store.completeCardAction({boardId,taskId:next,result:{markdown:'stale'},expectedRevision:s.revision,requestId:'stale'}),/CARD_CHANGED/);
 assert.equal((await store.read(boardId)).board!.board.nodes[0].note,'User changed it');
});

test('chart processing keeps original image and source, cancelled tasks reject results',async t=>{
 const root=await mkdtemp(join(tmpdir(),'chart-action-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let text='Figure 1. An actual chart.';const store=new WhiteboardStore(root,async()=>[{id:'figure',name:'Figure',format:'pdf',path:'paper.pdf',category:'figure',caption:'Figure 1. An actual chart.',text}]);
 let s=await store.create({title:'Chart',templateId:'free',expectedRevision:0,requestId:'create'}),boardId=s.board!.id;
 s=await store.patch({boardId,expectedRevision:s.revision,requestId:'add',actor:'user',operations:[{op:'put_node',node:{id:'n',kind:'image',sourceId:'figure',title:'Chart',note:'![Original](flow-asset:original)\n\n'+text,x:0,y:0}}]});
 s=await store.requestCardAction({boardId,nodeId:'n',action:'interpret_chart',expectedRevision:s.revision,requestId:'run'});let taskId=s.board!.tasks.at(-1)!.id;
 s=await store.completeCardAction({boardId,taskId,result:{markdown:'The chart explains the mechanism.'},expectedRevision:s.revision,requestId:'complete'});
 assert.match(s.board!.board.nodes[0].note,/flow-asset:original/);assert.match(s.board!.board.nodes[0].note,/Figure 1/);assert.equal((await store.sourceRead('figure')).text,text);
 s=await store.requestCardAction({boardId,nodeId:'n',action:'interpret_chart',expectedRevision:s.revision,requestId:'run2'});taskId=s.board!.tasks.at(-1)!.id;text='A changed source';
 await assert.rejects(()=>store.completeCardAction({boardId,taskId,result:{markdown:'stale'},expectedRevision:s.revision,requestId:'changed-source'}),/SOURCE_CHANGED/);
 s=await store.taskStatus({boardId,taskId,status:'cancelled',expectedRevision:s.revision,requestId:'cancel'});
 await assert.rejects(()=>store.completeCardAction({boardId,taskId,result:{markdown:'cancelled result'},expectedRevision:s.revision,requestId:'late'}),/TASK_STATE/);
});

test('Pages and workflow cards keep their content and receive connected analysis notes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'page-card-action-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new WhiteboardStore(root,async()=>[{id:'page',cardId:'n',name:'Page',format:'md',path:'',category:'pages',text:'Actual Pages text'}]);
 let s=await store.create({title:'Pages',templateId:'free',expectedRevision:0,requestId:'create'}),boardId=s.board!.id;
 s=await store.patch({boardId,expectedRevision:s.revision,requestId:'add',actor:'user',operations:[{op:'put_node',node:{id:'n',kind:'note',title:'Pages',note:'Local content',x:0,y:0}}]});
 s=await store.requestCardAction({boardId,nodeId:'n',action:'translate',expectedRevision:s.revision,requestId:'run'});const taskId=s.board!.tasks.at(-1)!.id;
 assert.equal((await store.cardActionRead(boardId,taskId)).pageSourceId,'page');
 s=await store.completeCardAction({boardId,taskId,result:{markdown:'页面内容的译文'},expectedRevision:s.revision,requestId:'complete'});
 assert.equal(s.board!.board.nodes[0].note,'Local content');assert.equal(s.board!.board.nodes[1].note,'页面内容的译文');assert.equal(s.board!.board.edges[0].source,'n');
});
