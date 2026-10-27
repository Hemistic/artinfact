import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePdfResearch,cancelPdfPreprocessing} from '../src/shared/pdf-research-request.js';
test('one graph request includes every PDF and asks the same Agent to preprocess, build graph and populate shared cards',async()=>{
 const called:string[]=[];const result=await preparePdfResearch(async(name,args)=>{called.push(name);if(name==='whiteboard_pdf_preprocess_read')return{structuredContent:{revision:4,documents:[{id:'a',ready:true},{id:'b',ready:true}]}};assert.deepEqual(args.documentIds,['a','b']);return{structuredContent:{task:{id:'task'}}};},'ws',{graph:true});
 assert.deepEqual(called,['whiteboard_pdf_preprocess_read','whiteboard_pdf_preprocess_request']);assert.match(result.prompt!,/whiteboard_pdf_preprocess_apply/);assert.match(result.prompt!,/wiki_graph_build 必须包含 documentIds=\["a","b"\]/);assert.match(result.prompt!,/不创建或重排任何白板/);
});
test('missing PDFs are parsed in the local pipeline before the Agent is dispatched, without dropping documents',async()=>{
 let parsed=false;const called:string[]=[];
 const result=await preparePdfResearch(async(name,args)=>{called.push(name);if(name==='whiteboard_pdf_preprocess_read')return{structuredContent:{revision:0,documents:[{id:'a',ready:true},{id:'b',ready:parsed}]}};if(name==='pdf_workspace_mineru_status')return{_meta:{mineruWorkspaceStatus:{workspaceId:'ws',statuses:[]}}};if(name==='pdf_workspace_mineru_batch'){assert.deepEqual(args.documentIds,['b']);parsed=true;return{_meta:{}};}return{structuredContent:{task:{id:'job'}}};},'ws',{graph:true,pause:async()=>{}});
 assert.deepEqual(result.documentIds,['a','b']);assert.ok(called.indexOf('pdf_workspace_mineru_batch')<called.indexOf('whiteboard_pdf_preprocess_request'));
});
test('valid cached preprocessing does not send another AI request unless graph generation is requested',async()=>{
 const result=await preparePdfResearch(async(name)=>({structuredContent:name==='whiteboard_pdf_preprocess_read'?{revision:0,documents:[{id:'a',ready:true}]}:{documents:[]}}),'ws');assert.equal(result.prompt,undefined);
});
test('a failed reparse of a ready PDF does not stop other missing PDFs from joining the research',async()=>{
 let parsed=false,submitted:string[]=[];
 const result=await preparePdfResearch(async(name,args)=>{
  if(name==='whiteboard_pdf_preprocess_read')return{structuredContent:{revision:0,documents:[{id:'cached',ready:true},{id:'missing',ready:parsed}]}};
  if(name==='pdf_workspace_mineru_status')return{_meta:{mineruWorkspaceStatus:{workspaceId:'ws',statuses:[{documentId:'cached',engine:'local',phase:'failed',error:'Old reparse failed'}]}}};
  if(name==='pdf_workspace_mineru_batch'){submitted=args.documentIds as string[];parsed=true;return{};}
  return{structuredContent:{task:{id:'job'}}};
 },'ws',{graph:true,pause:async()=>{}});
 assert.deepEqual(submitted,['missing']);assert.deepEqual(result.documentIds,['cached','missing']);assert.match(result.prompt!,/job/);
});
test('cancelling during the first read prevents any later parse or task submission',async()=>{
 const controller=new AbortController(),called:string[]=[];
 await assert.rejects(preparePdfResearch(async name=>{
  called.push(name);controller.abort();return{structuredContent:{revision:0,documents:[{id:'a',ready:false}]}};
 },'ws',{signal:controller.signal}),/已停止/);
 assert.deepEqual(called,['whiteboard_pdf_preprocess_read']);
});
test('cancelling while a task is being created clears that task using a fresh revision',async()=>{
 const controller=new AbortController(),called:string[]=[],cancelled:string[]=[];
 const result=()=>({structuredContent:{revision:6,documents:[{id:'a',ready:true}],tasks:[{id:'other',status:'queued'},{id:'created',status:'queued'}],task:{id:'created',status:'queued'}}});
 await assert.rejects(preparePdfResearch(async(name,args)=>{
  called.push(name);
  if(name==='whiteboard_pdf_preprocess_request'){controller.abort();return result();}
  if(name==='whiteboard_pdf_preprocess_status'){assert.equal(args.expectedRevision,6);cancelled.push(args.taskId as string);return{structuredContent:{revision:7,task:{id:'created',status:'cancelled'}}};}
  if(args.taskId)assert.equal(args.taskId,'created');
  return result();
 },'ws',{signal:controller.signal}),/已停止/);
 assert.deepEqual(cancelled,['created']);
 assert.deepEqual(called,['whiteboard_pdf_preprocess_read','whiteboard_pdf_preprocess_request','whiteboard_pdf_preprocess_read','whiteboard_pdf_preprocess_status']);
});
test('cancellation rereads the same task after a concurrent write instead of leaving it queued',async()=>{
 let reads=0,writes=0;
 const result=await cancelPdfPreprocessing(async(name,args)=>{
  assert.equal(args.taskId,'created');
  if(name==='whiteboard_pdf_preprocess_read')return{structuredContent:{revision:++reads,task:{id:'created',status:'queued'}}};
  assert.equal(args.expectedRevision,reads);if(++writes===1)return{isError:true,content:[{type:'text',text:'REVISION_CONFLICT: Agent updated another card'}]};
  return{structuredContent:{revision:reads+1,task:{id:'created',status:'cancelled'}}};
 },'ws','created');
 assert.equal(writes,2);assert.equal(result.task.status,'cancelled');
});
test('a task completed by the Agent during cancellation is kept without a second status write',async()=>{
 let reads=0,writes=0;
 const result=await cancelPdfPreprocessing(async name=>{
  if(name==='whiteboard_pdf_preprocess_read')return{structuredContent:{revision:++reads,task:{id:'created',status:reads===1?'running':'completed'}}};
  writes++;return{isError:true,content:[{type:'text',text:'TASK_STATE'}]};
 },'ws','created');
 assert.equal(writes,1);assert.equal(result.task.status,'completed');
});
