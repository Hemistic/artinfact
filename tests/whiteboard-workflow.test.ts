import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WhiteboardStore} from '../src/whiteboard/whiteboard-store.js';
import type {BoardNode} from '../src/whiteboard/whiteboard-domain.js';

async function fixture(t:any){
 const root=await mkdtemp(join(tmpdir(),'node-workflow-')),paths=[join(root,'a.md'),join(root,'b.md')];
 await Promise.all(paths.map(p=>writeFile(p,'# Study\n\nBoth use retrieval.')));
 const store=new WhiteboardStore(join(root,'store'),async()=>paths.map((path,i)=>({id:'paper'+i,name:'Paper '+i,format:'pdf' as const,path,markdownPath:path,category:'document' as const})));
 t.after(()=>rm(root,{recursive:true,force:true}));
 let state=await store.create({title:'Workflow',templateId:'free',expectedRevision:0,requestId:'create'});
 const nodes:BoardNode[]=[0,1].map(i=>({id:'s'+i,title:'Paper '+i,note:'',kind:'note',role:'source',sourceId:'paper'+i,x:i*500,y:0}));
 nodes.push({id:'compare',title:'相同相似',note:'我的要求',kind:'note',x:1200,y:0,workflow:{type:'similarity',prompt:'找出相同点与创新边界'}});
 nodes.push({id:'output',title:'Pages 输出',note:'',kind:'note',x:1800,y:0,workflow:{type:'pages',prompt:'写成研究总结'}});
 state=await store.patch({boardId:state.board!.id,actor:'user',expectedRevision:state.revision,requestId:'nodes',operations:[...nodes.map(node=>({op:'put_node' as const,node})),...['s0','s1'].map(id=>({op:'put_edge' as const,edge:{id,source:id,target:'compare',label:'比较机制'}})),{op:'put_edge',edge:{id:'out',source:'compare',target:'output',label:'总结共同点'}}]});
 return {store,paths,state};
}
test('connections alone do not run; Run scopes inputs and validates real evidence before completing a central node',async t=>{
 const {store,state}=await fixture(t);assert.equal(state.board!.tasks.length,0);
 const queued=await store.requestWorkflow({boardId:state.board!.id,nodeId:'compare',expectedRevision:state.revision,requestId:'run'});
 const task=queued.board!.tasks.at(-1)!;assert.equal(task.kind,'workflow');assert.deepEqual(task.sourceIds,['paper0','paper1']);
 const read=await store.workflowRead(queued.board!.id,task.id);assert.equal(read.node.id,'compare');assert.equal(read.edges.length,2);
 const args={boardId:queued.board!.id,taskId:task.id,expectedRevision:queued.revision,requestId:'result',result:{markdown:'## 相同点\n\n都使用检索。',citations:[{sourceId:'paper0',start:9,end:28,quote:'Both use retrieval.'},{sourceId:'paper1',start:9,end:28,quote:'Both use retrieval.'}]}};
 await assert.rejects(store.applyWorkflow({...args,result:{...args.result,citations:[{...args.result.citations[0],quote:'fabricated'}]}}),/CITATION/);
 const done=await store.applyWorkflow(args);assert.equal(done.board!.tasks.at(-1)!.status,'completed');
 assert.equal(done.board!.board.nodes.find(n=>n.id==='compare')!.note,'我的要求');
 assert.match(done.board!.board.nodes.find(n=>n.id==='compare')!.workflow!.result!.markdown,/都使用检索/);
 const output=await store.requestWorkflow({boardId:done.board!.id,nodeId:'output',expectedRevision:done.revision,requestId:'output'});
 assert.deepEqual(output.board!.tasks.at(-1)!.sourceIds,['paper0','paper1']);
 await assert.rejects(store.applyWorkflow({boardId:output.board!.id,taskId:output.board!.tasks.at(-1)!.id,expectedRevision:output.revision,requestId:'missing-page',result:args.result}),/PAGE_REQUIRED/);
});
test('unfinished dependencies, missing inputs and cycles are rejected before dispatch',async t=>{
 const {store,state}=await fixture(t);
 await assert.rejects(store.requestWorkflow({boardId:state.board!.id,nodeId:'output',expectedRevision:state.revision,requestId:'unready'}),/DEPENDENCY/);
 const cycle=await store.patch({boardId:state.board!.id,actor:'user',expectedRevision:state.revision,requestId:'cycle',operations:[{op:'put_edge',edge:{id:'cycle',source:'output',target:'compare',label:'循环'}}]});
 await assert.rejects(store.requestWorkflow({boardId:cycle.board!.id,nodeId:'compare',expectedRevision:cycle.revision,requestId:'run-cycle'}),/CYCLE/);
});
test('changing an edge invalidates results; moving cards alone is allowed, and source changes also invalidate',async t=>{
 const {store,paths,state}=await fixture(t);let s=await store.requestWorkflow({boardId:state.board!.id,nodeId:'compare',expectedRevision:state.revision,requestId:'run'});
 const id=s.board!.tasks.at(-1)!.id;s=await store.patch({boardId:s.board!.id,actor:'user',expectedRevision:s.revision,requestId:'change-edge',operations:[{op:'put_edge',edge:{...s.board!.board.edges[0],label:'改为比较实验'}}]});
 await assert.rejects(store.applyWorkflow({boardId:s.board!.id,taskId:id,expectedRevision:s.revision,requestId:'stale',result:{markdown:'旧结果',citations:[]}}),/WORKFLOW_CHANGED/);
 s=await store.taskStatus({boardId:s.board!.id,taskId:id,status:'cancelled',expectedRevision:s.revision,requestId:'cancel'});
 s=await store.requestWorkflow({boardId:s.board!.id,nodeId:'compare',expectedRevision:s.revision,requestId:'run-again'});
 const task=s.board!.tasks.at(-1)!;s=await store.patch({boardId:s.board!.id,actor:'user',expectedRevision:s.revision,requestId:'move',operations:[{op:'put_node',node:{...s.board!.board.nodes[0],x:30}}]});
 await writeFile(paths[0],'Changed paper');
 await assert.rejects(store.applyWorkflow({boardId:s.board!.id,taskId:task.id,expectedRevision:s.revision,requestId:'source-stale',result:{markdown:'旧结果',citations:[]}}),/SOURCE_CHANGED/);
});
test('individual findings become reusable cards; a changed upstream result cannot silently reinterpret old findings',async t=>{
 const {store,state}=await fixture(t);let s=await store.requestWorkflow({boardId:state.board!.id,nodeId:'compare',expectedRevision:state.revision,requestId:'run'});
 const task=s.board!.tasks.at(-1)!,citations=[0,1].map(i=>({sourceId:'paper'+i,start:9,end:28,quote:'Both use retrieval.'}));
 s=await store.applyWorkflow({boardId:s.board!.id,taskId:task.id,expectedRevision:s.revision,requestId:'findings',result:{markdown:'共同检索机制',citations,findings:[{title:'共同机制',note:'两者都使用检索。',category:'similarity',basis:'reported',citations}]}});
 const finding=s.board!.board.nodes.find(n=>n.workflowOrigin)!;assert.equal(finding.workflowOrigin!.taskId,task.id);assert.equal(finding.title,'共同机制');
 assert.ok(s.board!.board.edges.some(e=>e.source==='compare'&&e.target===finding.id));
 s=await store.patch({boardId:s.board!.id,actor:'user',expectedRevision:s.revision,requestId:'only-one-finding',operations:[{op:'put_edge',edge:{id:'out',source:finding.id,target:'output',label:'仅总结这个共同点'}}]});
 s=await store.requestWorkflow({boardId:s.board!.id,nodeId:'output',expectedRevision:s.revision,requestId:'output'});assert.ok(s.board!.tasks.at(-1)!.sourceIds.includes('paper0'));
 s=await store.taskStatus({boardId:s.board!.id,taskId:s.board!.tasks.at(-1)!.id,status:'cancelled',expectedRevision:s.revision,requestId:'cancel-output'});
 s=await store.patch({boardId:s.board!.id,actor:'user',expectedRevision:s.revision,requestId:'change-prompt',operations:[{op:'put_node',node:{...s.board!.board.nodes.find(n=>n.id==='compare')!,workflow:{...s.board!.board.nodes.find(n=>n.id==='compare')!.workflow!,prompt:'比较新的问题'}}}]});
 await assert.rejects(store.requestWorkflow({boardId:s.board!.id,nodeId:'output',expectedRevision:s.revision,requestId:'stale-finding'}),/DEPENDENCY_CHANGED/);
});

test('selecting one finding composes only that card, with provenance still validated after source or prompt changes',async t=>{
 const {store,state,paths}=await fixture(t);let s=await store.requestWorkflow({boardId:state.board!.id,nodeId:'compare',expectedRevision:state.revision,requestId:'run'});
 const citations=[0,1].map(i=>({sourceId:'paper'+i,start:9,end:28,quote:'Both use retrieval.'}));
 s=await store.applyWorkflow({boardId:s.board!.id,taskId:s.board!.tasks.at(-1)!.id,expectedRevision:s.revision,requestId:'analysis',result:{markdown:'Full comparison includes an unrelated discussion.',citations,findings:[{title:'Selected similarity',note:'Both use retrieval.',category:'similarity',basis:'reported',citations},{title:'Unselected issue',note:'Do not include this discussion.',category:'difference',basis:'inference',citations}]}});
 const selected=s.board!.board.nodes.find(n=>n.title==='Selected similarity')!;
 s=await store.patch({boardId:s.board!.id,actor:'user',expectedRevision:s.revision,requestId:'select',operations:[{op:'put_edge',edge:{id:'out',source:selected.id,target:'output',label:'只总结共同检索机制'}}]});
 const provenance=s.board!.board.edges.find(e=>e.source==='compare'&&e.target===selected.id)!;
 assert.equal(provenance.kind,'context');
 // Legacy boards stored the provenance edge as an input. It must not broaden composition.
 s=await store.patch({boardId:s.board!.id,actor:'user',expectedRevision:s.revision,requestId:'legacy',operations:[{op:'put_edge',edge:{...provenance,kind:'input'}}]});
 s=await store.requestWorkflow({boardId:s.board!.id,nodeId:'output',expectedRevision:s.revision,requestId:'output'});
 const taskId=s.board!.tasks.at(-1)!.id,read=await store.workflowRead(s.board!.id,taskId);
 assert.deepEqual(read.inputs.map(n=>n.id),[selected.id]);
 assert.deepEqual(read.directInputs.map(n=>n.id),[selected.id]);
 assert.deepEqual(read.edges.map(e=>e.label),['只总结共同检索机制']);
 assert.ok(!JSON.stringify(read.inputs).includes('unrelated discussion'));
 s=await store.taskStatus({boardId:s.board!.id,taskId,status:'cancelled',expectedRevision:s.revision,requestId:'cancel'});
 await writeFile(paths[0],'Source updated');
 await assert.rejects(store.requestWorkflow({boardId:s.board!.id,nodeId:'output',expectedRevision:s.revision,requestId:'source-stale'}),/DEPENDENCY_CHANGED/);
});

test('a selected finding can be reused on another board; changed origin requirements reject a queued output',async t=>{
 const {store,state}=await fixture(t);let original=await store.requestWorkflow({boardId:state.board!.id,nodeId:'compare',expectedRevision:state.revision,requestId:'run'});
 const citations=[0,1].map(i=>({sourceId:'paper'+i,start:9,end:28,quote:'Both use retrieval.'}));
 original=await store.applyWorkflow({boardId:original.board!.id,taskId:original.board!.tasks.at(-1)!.id,expectedRevision:original.revision,requestId:'done',result:{markdown:'Both use retrieval.',citations,findings:[{title:'Reusable similarity',note:'Both use retrieval.',category:'similarity',basis:'reported',citations}]}});
 const finding=original.board!.board.nodes.find(n=>n.workflowOrigin)!;
 let next=await store.create({title:'Compose selected cards',templateId:'free',expectedRevision:original.revision,requestId:'next'});
 next=await store.addCards({boardId:next.board!.id,cardIds:[finding.id],expectedRevision:next.revision,requestId:'reuse'});
 next=await store.patch({boardId:next.board!.id,actor:'user',expectedRevision:next.revision,requestId:'output',operations:[{op:'put_node',node:{id:'pages-new',title:'Pages',kind:'note',note:'',x:700,y:0,workflow:{type:'pages',prompt:'Only the selected finding'}}},{op:'put_edge',edge:{id:'selected',source:finding.id,target:'pages-new',label:'仅总结这张卡'}}]});
 next=await store.requestWorkflow({boardId:next.board!.id,nodeId:'pages-new',expectedRevision:next.revision,requestId:'queue-output'});
 const taskId=next.board!.tasks.at(-1)!.id;assert.deepEqual((await store.workflowRead(next.board!.id,taskId)).directInputs.map(n=>n.id),[finding.id]);
 const changed=await store.patch({boardId:original.board!.id,actor:'user',expectedRevision:next.revision,requestId:'change-origin',operations:[{op:'put_node',node:{...original.board!.board.nodes.find(n=>n.id==='compare')!,workflow:{...original.board!.board.nodes.find(n=>n.id==='compare')!.workflow!,prompt:'A different question'}}}]});
 await assert.rejects(store.workflowRead(next.board!.id,taskId),/DEPENDENCY_CHANGED/);
 await assert.rejects(store.applyWorkflow({boardId:next.board!.id,taskId,expectedRevision:changed.revision,requestId:'stale-output',result:{markdown:'Old output',citations}}),/DEPENDENCY_CHANGED/);
});

test('reported cross-paper similarities require evidence from both papers rather than one citation',async t=>{
 const {store,state}=await fixture(t),s=await store.requestWorkflow({boardId:state.board!.id,nodeId:'compare',expectedRevision:state.revision,requestId:'run'});
 const citations=[0,1].map(i=>({sourceId:'paper'+i,start:9,end:28,quote:'Both use retrieval.'}));
 await assert.rejects(store.applyWorkflow({boardId:s.board!.id,taskId:s.board!.tasks.at(-1)!.id,expectedRevision:s.revision,requestId:'one-sided',result:{markdown:'Both use retrieval.',citations,findings:[{title:'Both methods',note:'Both use retrieval.',category:'similarity',basis:'reported',citations:[citations[0]]}]}}),/COMPARISON_EVIDENCE/);
 assert.equal((await store.read(s.board!.id)).board!.tasks.at(-1)!.status,'queued');
});
