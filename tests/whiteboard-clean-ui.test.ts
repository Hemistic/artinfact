import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
import {cardUiState,inspectorRelations} from '../src/whiteboard/card-ui.js';
import {createCanvasToolbar,canvasTools} from '../src/whiteboard/canvas-toolbar.js';
import {workflowInputView} from '../src/whiteboard/workflow-input-view.js';
import type {BoardNode} from '../src/whiteboard/whiteboard-domain.js';

const note:BoardNode={id:'n',title:'Note',kind:'note',note:'Actual content',x:0,y:0};
test('a rejected duplicate connection exits linking mode and refreshes the toolbar and inspector',async()=>{
 const source=await readFile('src/whiteboard/mcp-whiteboard-view.ts','utf8'),start=source.indexOf('async function choose('),end=source.indexOf('\n function readPromptDraft',start);
 let synced=0,inspected=0;const scope={inlineStudy:'',flushDraft:async()=>{},selection:new Set(),root:{focus(){},clientWidth:1280},linkingMode:true,connecting:'a',selected:'',selectedEdge:'',board:()=>({nodes:[]}),connectionIntent:()=>undefined,syncChrome:()=>synced++,showInspector:()=>inspected++,renderCanvas(){},notice(){}};
 const code=ts.transpileModule(source.slice(start,end)+'\nchoose("b");',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 await runInNewContext(code,scope);assert.equal(scope.linkingMode,false);assert.equal(scope.connecting,'');assert.equal(synced,1);assert.equal(inspected,1);
});
test('content cards have no redundant action row or unlinked Pages status',()=>{
 assert.deepEqual(cardUiState(note,false).actions,[]);
 assert.deepEqual(cardUiState(note,true).actions,['pages']);
 assert.equal(cardUiState({...note,basis:'inference'},false).basisLabel,'推断');
});
test('one run state is shared by card and inspector; cancelled or failed tasks can retry',()=>{
 const node={...note,workflow:{type:'formula' as const,prompt:''}};
 assert.deepEqual(cardUiState(node,false,{status:'running',message:'Active'}).run,{label:'运行中',disabled:true});
 assert.deepEqual(cardUiState(node,false,{status:'queued',message:'Queued'}).run,{label:'等待 Agent',disabled:true});
 const failed=cardUiState(node,false,{status:'failed',message:'Network failure'});
 assert.equal(failed.run?.disabled,false);assert.equal(failed.error,'Network failure');assert.deepEqual(failed.actions,['run']);
 assert.equal(cardUiState(node,false,{status:'cancelled',message:'Cancelled'}).run?.disabled,false);
});
test('workflow inspector does not list incoming inputs a second time; outgoing and source relations remain',()=>{
 const edges=[{id:'input',source:'a',target:'n',label:'Compare'},{id:'context',source:'b',target:'n',label:'Source',kind:'context' as const},{id:'output',source:'n',target:'c',label:'Output'}];
 assert.deepEqual(inspectorRelations({...note,workflow:{type:'formula',prompt:''}},edges).map(e=>e.id),['context','output']);
 assert.deepEqual(inspectorRelations(note,edges).map(e=>e.id),['input','context','output']);
});

class Element{
 children:Element[]=[];className='';textContent='';dataset:Record<string,string>={};attributes:Record<string,string>={};type='';innerHTML='';
 setAttribute(k:string,v:string){this.attributes[k]=v;}append(...items:Element[]){this.children.push(...items);}classList={add:()=>{}};
}
test('toolbar exposes core controls once while keeping secondary command handlers available',t=>{
 const old=globalThis.document,dom=new JSDOM('<main></main>');t.after(()=>{globalThis.document=old;dom.window.close();});globalThis.document=dom.window.document;
 const toolbar=document.createElement('div'),actions=Object.fromEntries([...canvasTools.map(t=>[t.id,()=>{}]),['board',()=>{}]]) as any;
 const controls=createCanvasToolbar(toolbar,actions,()=>{});
 const visible=[...toolbar.querySelectorAll('button')].map(c=>c.getAttribute('aria-label'));
 assert.deepEqual(visible,['添加资料','白板','建立连接','撤销','重做','更多操作']);
 assert.ok(controls.note);assert.ok(controls.agent);
});
test('workflow keeps inputs visible and places lengthy template instructions in closed details',t=>{
 const old=globalThis.document;t.after(()=>{globalThis.document=old;});globalThis.document={createElement:()=>new Element()} as any;
 const node={...note,workflow:{type:'formula' as const,prompt:''}};
 const view=workflowInputView({version:1,nodes:[node],edges:[]},node,()=>{}) as unknown as Element;
 assert.equal(view.children.filter(c=>c.textContent.startsWith('连接资料后')).length,0);
 const details=view.children.find(c=>c.children.some(x=>x.textContent==='模板说明'));assert.ok(details);
 assert.ok(details.children.some(c=>c.textContent.startsWith('连接资料后')));
});
