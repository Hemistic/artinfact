import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
test('one plugin session is reused across board refresh, graph mode and workspace changes',async()=>{
 const source=await readFile('src/ui/whiteboard-panel.ts','utf8'),start=source.indexOf(' async function showGraph('),end=source.indexOf('\n section.querySelector',start);
 const code=ts.transpileModule('const sessionId=crypto.randomUUID();'+source.slice(start,end)+'\nshowGraph;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const calls:any[]=[],section={hidden:true,querySelector:(selector:string)=>selector==='.graph-stage'?{replaceChildren(){}}:{}};
 const context:any={crypto:{randomUUID:()=>String(Math.random())},hooks:{suspend:async()=>{},call:async(name:string,args:any)=>{calls.push({name,...args});return {_meta:{whiteboard:{html:'<html lang="en">',generatedAt:''}}};}},cardContextEpoch:0,epoch:0,workspaceId:'',token:'',selectedNode:'',queryButton:{disabled:false},section,root:{classList:{add(){}}},setMode(){},status:{},document:{createElement:()=>({setAttribute(){}}),documentElement:{dataset:{theme:'light'}}},clearTimeout(){},setTimeout(){},frame:undefined,graphVersion:'',graphTimer:undefined};
 context.uiLanguage=()=> 'en';
 const show=runInNewContext(code,context);await show('one',false,'editor');assert.match(context.frame.srcdoc,/data-ui-language="en"/);await show('one',false,'constellation');await show('two',false,'editor');
 assert.equal(new Set(calls.map(c=>c.sessionId)).size,1);assert.ok(calls[0].sessionId);assert.deepEqual(calls.map(c=>c.workspaceId),['one','one','two']);
});
