import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {installWhiteboardPanel} from '../src/ui/whiteboard-panel.js';
test('authenticated card context keeps the latest selection and clears it on leaving the board',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://test.invalid'});Object.defineProperty(globalThis,'window',{value:dom.window,configurable:true});Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
 const contexts:any[]=[],reads=new Map<string,(value:any)=>void>(),pending:Promise<any>[]=[];
 const panel=installWhiteboardPanel(document.querySelector('main')!,{suspend:async()=>{},home:async()=>{},call:async(name,args)=>name==='pdf_workspace_whiteboard_view'?{_meta:{whiteboard:{html:'<html lang="en"><body></body></html>'}}}:new Promise(resolve=>reads.set(args.nodeId as string,resolve)),context:async value=>{contexts.push(value);},run:fn=>{pending.push(fn());},send:async()=>({mode:'sent'}),preprocess:async()=>{},generate:async()=>{},evidence:async()=>{},open:async()=>{},openPage:async()=>{},managePage:async()=>{}});
 try{
  await panel.showGraph('default',false,'editor');const frame=document.querySelector('iframe')!,token=/data-whiteboard-token="([^"]+)"/.exec(frame.srcdoc)![1];
  const emit=(nodeId:string,valid=true)=>window.dispatchEvent(new dom.window.MessageEvent('message',{source:frame.contentWindow,data:{type:'artinfact:whiteboard-context',token:valid?token:'bad',id:nodeId,payload:{boardId:'b',nodeId}}}));
  emit('bad',false);assert.equal(reads.size,0);emit('first');emit('second');
  const result=(id:string)=>({structuredContent:{boardId:'b',boardTitle:'B',node:{id,kind:'note',title:id,note:'Body',x:0,y:0},related:[]}});
  reads.get('second')!(result('second'));await new Promise(r=>setImmediate(r));reads.get('first')!(result('first'));await new Promise(r=>setImmediate(r));
  assert.equal(contexts.length,1);assert.equal(contexts[0].structuredContent.nodeId,'second');
  panel.hideGraph();await Promise.all(pending);assert.deepEqual(contexts.at(-1),{content:[],structuredContent:{}});
 }finally{panel.hideGraph();dom.window.close();}
});
