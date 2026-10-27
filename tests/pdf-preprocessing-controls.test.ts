import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {preparePdfResearch,preprocessingData,cancelPdfPreprocessing} from '../src/shared/pdf-research-request.js';
import {graphProcessingState} from '../src/shared/workspace-menu.js';

class Element{
 children:Element[]=[];textContent='';className='';type='';checked=false;disabled=false;hidden=false;open=false;innerHTML='';attributes:Record<string,string>={};
 style:Record<string,string>={};ownerDocument={defaultView:{innerHeight:829}};expandedHeight=450;
 get scrollHeight(){return this.parts.get('.preprocess-options')?.hidden===false?this.expandedHeight:220;}
 onclick?:()=>unknown;onclose?:()=>void;onchange?:()=>void;
 parts=new Map<string,Element>();
 append(...items:Element[]){this.children.push(...items);}replaceChildren(...items:Element[]){this.children=items;}
 setAttribute(key:string,value:string){this.attributes[key]=value;}
 querySelector(selector:string){if(!this.parts.has(selector))this.parts.set(selector,new Element());return this.parts.get(selector)!;}
 close(){this.open=false;this.onclose?.();}
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
const view=(name='A')=>({structuredContent:{revision:1,documents:[{id:name,name,ready:true,total:1,completed:0}],tasks:[]}});
async function harness(call:(name:string,args:Record<string,unknown>)=>Promise<any>,send?:()=>Promise<{mode:'sent'}>){
 const source=await readFile('src/ui/pdf-preprocessing.ts','utf8'),root=new Element(),sent:string[]=[],notices:{message:string;error?:boolean}[]=[];
 const code=ts.transpileModule(source.slice(source.indexOf('export function installPdfPreprocessing')).replace('export function','function')+'\ninstallPdfPreprocessing(root,hooks);',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const scope={root,hooks:{call,send:async(text:string)=>{sent.push(text);return send?await send():{mode:'sent'};},notice:(message:string,error?:boolean)=>notices.push({message,error})},document:{createElement:()=>new Element()},setControlIcon(){},showDropdown:(dialog:Element)=>{dialog.style.top='400px';dialog.style.maxHeight='421px';dialog.open=true;},preparePdfResearch,preprocessingData,cancelPdfPreprocessing,graphProcessingState,AbortController,crypto,setTimeout:()=>1,clearTimeout(){}};
 const controls=runInNewContext(code,scope);const dialog=root.children[0],button=(action:string)=>dialog.querySelector('[data-action="'+action+'"]');
 return{controls,dialog,button,sent,notices};
}
test('expanded preprocessing actions stay above the native composer and collapse back to the anchor',async()=>{
 const h=await harness(async name=>name==='pdf_workspace_graph_status'?{_meta:{}}:view());
 await h.controls.show('ws');assert.equal(h.dialog.style.top,'400px');h.button('preprocess').onclick?.();
 const height=h.dialog.scrollHeight+2,top=parseFloat(h.dialog.style.top),maxHeight=parseFloat(h.dialog.style.maxHeight);
 assert.ok(maxHeight>=height,'the one-PDF options and Start button should fit without outer scrolling');
 assert.ok(top+height<766,'the menu must end above the native floating composer');
 h.button('preprocess').onclick?.();assert.equal(h.dialog.style.top,'400px');
});
test('long preprocessing menus remain scrollable above the composer in a short viewport',async()=>{
 const h=await harness(async name=>name==='pdf_workspace_graph_status'?{_meta:{}}:view());
 h.dialog.ownerDocument.defaultView.innerHeight=480;h.dialog.expandedHeight=1000;
 await h.controls.show('ws');h.button('preprocess').onclick?.();
 const top=parseFloat(h.dialog.style.top),maxHeight=parseFloat(h.dialog.style.maxHeight);
 assert.ok(top>=8);assert.ok(maxHeight>0&&maxHeight<h.dialog.scrollHeight);
 assert.ok(top+maxHeight<=384,'the visible scrolling area must leave room for the composer');
});
test('refresh stays single flight and cannot race the initial workspace read',async()=>{
 let reads=0;const first=deferred<any>();
 const h=await harness(async name=>name==='whiteboard_pdf_preprocess_read'?(++reads,first.promise):{_meta:{}});
 const showing=h.controls.show('ws');h.button('refresh').onclick?.();h.button('refresh').onclick?.();
 await tick();assert.equal(reads,1);assert.equal(h.button('refresh').disabled,true);
 first.resolve(view());await showing;assert.equal(h.button('refresh').disabled,false);
 const refreshing=h.button('refresh').onclick?.();h.button('refresh').onclick?.();await refreshing;await tick();assert.equal(reads,2);
});
test('stopping twice during task creation cancels once and never sends an Agent prompt',async()=>{
 const request=deferred<any>();let creating=false,task:{id:string;status:string}|undefined,cancels=0;
 const h=await harness(async name=>{
  if(name==='pdf_workspace_graph_status')return{_meta:{}};
  if(name==='whiteboard_pdf_preprocess_request'){creating=true;return request.promise;}
  if(name==='whiteboard_pdf_preprocess_status'){cancels++;task!.status='cancelled';}
  return{structuredContent:{...view().structuredContent,tasks:task?[task]:[],task}};
 });
 await h.controls.show('ws');h.button('start').onclick?.();await tick();assert.equal(creating,true);
 h.button('cancel').onclick?.();h.button('cancel').onclick?.();await tick();assert.equal(h.button('cancel').disabled,true);assert.equal(h.button('graph').disabled,true);
 task={id:'created',status:'queued'};request.resolve({structuredContent:{...view().structuredContent,tasks:[task],task}});
 await tick();await tick();await tick();assert.equal(cancels,1);assert.deepEqual(h.sent,[]);assert.equal(h.button('graph').disabled,false);assert.equal(h.notices.some(n=>n.error),false);
});
test('closing then opening another workspace rejects the old response and keeps the new selection',async()=>{
 const old=deferred<any>();const h=await harness(async(name,args)=>name==='pdf_workspace_graph_status'?{_meta:{}}:args.workspaceId==='old'?old.promise:view('B'));
 const showing=h.controls.show('old');h.dialog.close();await h.controls.show('new');old.resolve(view('A'));await showing;
 const list=h.dialog.querySelector('.preprocess-documents');assert.equal(list.children[0].children[1].children[0].textContent,'B');assert.equal(h.button('graph').disabled,false);
});
test('stopping a newly created task does not also cancel another task that appears during cleanup',async()=>{
 const request=deferred<any>(),cancelled:string[]=[];let task:{id:string;status:string}|undefined;
 const h=await harness(async(name,args)=>{
  if(name==='pdf_workspace_graph_status')return{_meta:{}};
  if(name==='whiteboard_pdf_preprocess_request')return request.promise;
  if(name==='whiteboard_pdf_preprocess_status'){cancelled.push(args.taskId as string);if(args.taskId==='created')task!.status='cancelled';}
  const other=task?.status==='cancelled'?{id:'other',status:'queued'}:undefined;
  return{structuredContent:{...view().structuredContent,tasks:[...(other?[other]:[]),...(task?[task]:[])],task:args.taskId==='created'?task:undefined}};
 });
 await h.controls.show('ws');h.button('start').onclick?.();await tick();h.button('cancel').onclick?.();
 task={id:'created',status:'queued'};request.resolve({structuredContent:{...view().structuredContent,tasks:[task],task}});
 await tick();await tick();await tick();assert.deepEqual(cancelled,['created']);
});
test('handoff cannot claim cancellation after the Agent message has already started sending',async()=>{
 const delivery=deferred<{mode:'sent'}>();let cancellations=0;
 const h=await harness(async name=>{
  if(name==='pdf_workspace_graph_status')return{_meta:{}};
  if(name==='whiteboard_pdf_preprocess_status')cancellations++;
  return view();
 },()=>delivery.promise);
 await h.controls.show('ws');h.button('graph').onclick?.();await tick();assert.equal(h.sent.length,1);
 assert.equal(h.button('cancel').disabled,true);h.button('cancel').onclick?.();await tick();
 assert.doesNotMatch(h.dialog.querySelector('[role=status]').textContent,/已停止/);
 delivery.resolve({mode:'sent'});await tick();await tick();assert.equal(cancellations,0);assert.equal(h.button('cancel').hidden,true);
 assert.match(h.dialog.querySelector('[role=status]').textContent,/已交给 Agent/);
});
test('a terminal task detail cannot hide the active task chosen for the next stop action',async()=>{
 const cancelled:string[]=[],active={id:'active',status:'running'};
 const h=await harness(async(name,args)=>{
  if(name==='pdf_workspace_graph_status')return{_meta:{}};
  if(name==='whiteboard_pdf_preprocess_status'){cancelled.push(args.taskId as string);active.status='cancelled';}
  return{structuredContent:{...view().structuredContent,tasks:[active],task:args.taskId==='active'?active:{id:'old',status:'cancelled'}}};
 });
 await h.controls.show('ws');h.button('cancel').onclick?.();await tick();await tick();assert.deepEqual(cancelled,['active']);
});
