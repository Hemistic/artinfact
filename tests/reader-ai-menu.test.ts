import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installMineruToolbar} from '../src/ui/mineru-toolbar.js';

test('ring menu keeps conversion and layout actions; settings move to the right toolbar; AI actions belong to the native Outline sidebar',()=>{
 const calls:object[]=[];
 const doc:any={activeElement:null,addEventListener(){},getElementById(){return {getBoundingClientRect:()=>({left:8,right:36,bottom:32})};}};
 const createElement=()=>({ownerDocument:doc,children:[] as any[],dataset:{},style:{},classList:{add(){}},append(child:any){this.children.push(child);},remove(){},replaceChildren(){this.children=[];},setAttribute(){},querySelector(){return null;}});
 doc.createElement=createElement;doc.body=createElement();
 const target:any={document:doc,innerWidth:800,innerHeight:600,addEventListener(){}};
 installMineruToolbar(target,(type,payload)=>calls.push({type,payload}));
 const react:any={createElement:(type:any,props:any,...children:any[])=>typeof type==='function'?type():({type,props,children}),useState:(value:any)=>[value,()=>{}],useEffect(){}};
 const button=target.__codexAnalysisButton(react);button.props.onClick();
 const menu=doc.body.children[0],actions=menu.children.filter((item:any)=>item.dataset.action);
 assert.deepEqual(actions.map((item:any)=>item.dataset.action),['convert','layout']);
 actions.find((item:any)=>item.dataset.action==='layout').onclick();
 assert.deepEqual(calls,[{type:'codex-reader:analysis-action',payload:{action:'layout',anchor:{left:8,right:36,bottom:32}}}]);
});
