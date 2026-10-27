import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {canvasTools} from '../src/whiteboard/canvas-toolbar.js';

for(const file of ['src/whiteboard/network.ts','src/ui/wiki-graph.ts'])test(file+': selecting a node shows details and context without opening a PDF',async()=>{
 const source=await readFile(file,'utf8'),start=source.indexOf('function select(id:'),end=source.indexOf('function renderDetail(',start);
 const node={id:'wiki/entities/evidence.md',relativePath:'wiki/entities/evidence.md',type:'entity'},messages:{type:string;payload:unknown}[]=[],details:unknown[]=[];
 const code=ts.transpileModule(source.slice(start,end)+"\nselect('wiki/entities/evidence.md');",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{nodeMap:new Map([[node.id,node]]),selected:'',local:false,document:{querySelector:()=>({classList:{remove(){}}})},el:()=>({setAttribute(){}}),update(){},renderDetail:(n:unknown)=>details.push(n),renderList(){},adjacency:new Map(),post:(type:string,payload:unknown)=>messages.push({type,payload}),revealSelectedGraphNode(){},schedule(){},positionMap:new Map()});
 assert.deepEqual(details,[node]);
 assert.deepEqual(messages.map(m=>m.type),['notebookmr:graph-concept-query']);
});

test('a Pages-linked whiteboard card click opens its inspector instead of navigating',async()=>{
 const source=await readFile('src/whiteboard/mcp-whiteboard-view.ts','utf8'),start=source.indexOf('card.onclick=e=>'),end=source.indexOf(';card.onkeydown=',start);
 const inspected:string[]=[],opened:string[]=[],card:{onclick?:(event:unknown)=>void}={};
 const code=ts.transpileModule(source.slice(start,end)+';', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{card,suppressClick:false,selection:new Set(),n:{id:'linked-page'},page:{pageId:'existing'},visual:undefined,compact:undefined,active:'board',choose:(id:string)=>inspected.push(id),openPagesCard:()=>opened.push('Pages')});
 card.onclick!({target:{closest:()=>null},shiftKey:false});
 assert.deepEqual(inspected,['linked-page']);assert.deepEqual(opened,[]);
});

test('graph toolbar whiteboard button opens whiteboard management',async()=>{
 const source=await readFile('src/whiteboard/graph-canvas.ts','utf8'),start=source.indexOf('const controls=createCanvasToolbar('),end=source.indexOf('\n controls.library.',start);
 const actions:string[]=[];
 const code=ts.transpileModule(source.slice(start,end)+'\ncontrols.library();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{toolbar:{},createCanvasToolbar:(_container:unknown,hooks:unknown)=>hooks,boardAction:(tool:string)=>()=>actions.push(tool),error(){},catalog:{classList:{toggle(){actions.push('old-catalog');},contains(){return false;}}},sync(){}});
 assert.deepEqual(actions,['library']);
});
test('graph toolbar initializes with the actual current set of controls',async()=>{
 const source=await readFile('src/whiteboard/graph-canvas.ts','utf8'),start=source.indexOf("for(const tool of ['note'"),end=source.indexOf(';',start);
 const controls=Object.fromEntries(canvasTools.map(({id})=>[id,{dataset:{tip:id}}]));
 const code=ts.transpileModule(source.slice(start,end+1),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 assert.doesNotThrow(()=>runInNewContext(code,{controls}));
});
