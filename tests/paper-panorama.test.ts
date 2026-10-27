import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pdfPaperSources} from '../src/server/whiteboard-source-catalog.js';
import {WhiteboardStore} from '../src/whiteboard/whiteboard-store.js';
import {workflowScope} from '../src/whiteboard/workflow.js';
import {connectionIntent} from '../src/whiteboard/connection-drag.js';

const doc={id:'paper',name:'Study.pdf',format:'pdf' as const,path:'D:/Study.pdf',text:'# Study\n\n# Method\nSee Figure 1.\n\n# Results\nResults.'};
const tree={root:{id:'root',type:'document',title:'Study',children:[
 {id:'method',type:'section',title:'Method',meta:{blockIndex:0,pageIndex:0},children:[
  {id:'body',type:'text',text:'See Figure 1.',meta:{blockIndex:1,pageIndex:0}},
  {id:'eq',type:'equation',text:'E=mc^2',meta:{blockIndex:2,pageIndex:0}},
  {id:'sub',type:'section',title:'Implementation',meta:{blockIndex:3,pageIndex:1},children:[]}]},
 {id:'results',type:'section',title:'Results',meta:{blockIndex:4,pageIndex:1},children:[
  {id:'fig',type:'image',text:'Figure 1: overview',meta:{blockIndex:5,pageIndex:1}}]}]}};
const annotations=[{id:'fig',layoutKind:'figure',text:'Figure 1: overview',layoutBlockIndices:[5],position:{pageIndex:1}},
 {id:'eq',layoutKind:'equation',text:'Equation 1',layoutBlockIndices:[2],position:{pageIndex:0}},
 {id:'note',text:'Unlocated note',position:{pageIndex:1}},
 {id:'insight',aiInsightKind:'method',comment:'Method insight',aiInsightSourceBlockIndex:1}];
test('paper catalog follows nested sections and real block ownership; explicit references cross sections without guessing ambiguous pages',()=>{
 const sources=pdfPaperSources(doc,annotations,[{},{},{text:'E=mc^2'}],tree);
 const method=sources.find(s=>s.category==='section'&&s.name==='Method')!,sub=sources.find(s=>s.name==='Implementation')!,results=sources.find(s=>s.name==='Results')!;
 const figure=sources.find(s=>s.annotationId==='fig')!,formula=sources.find(s=>s.annotationId==='eq')!;
 assert.equal(sub.parentSourceId,method.id);assert.equal(figure.parentSourceId,results.id);assert.equal(formula.parentSourceId,method.id);
 assert.equal(formula.latex,'E=mc^2');assert.equal(sources.find(s=>s.annotationId==='insight')!.parentSourceId,method.id);
 assert.equal(sources.find(s=>s.annotationId==='note')!.parentSourceId,doc.id);
 assert.ok(method.references?.some(r=>r.sourceId===figure.id));assert.ok(!results.references?.length);
 assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);
});
test('panorama places every existing paper item in a new board, keeps notes on reuse, and containment does not expand a workflow input',async t=>{
 const root=await mkdtemp(join(tmpdir(),'paper-panorama-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const sources=pdfPaperSources(doc,annotations,[{},{},{text:'E=mc^2'}],tree),store=new WhiteboardStore(root,async()=>sources);
 let state=await store.createPanorama({sourceId:doc.id,expectedRevision:0,requestId:'panorama'});
 assert.equal(state.board!.tasks.length,0);assert.equal(state.board!.board.nodes.length,sources.length);
 assert.ok(state.board!.board.edges.every(e=>e.kind==='context'));assert.equal(state.board!.sourceIds.length,sources.length);
 const formula=state.board!.board.nodes.find(n=>n.sourceId===sources.find(s=>s.annotationId==='eq')!.id)!;
 assert.match(formula.note,/\$\$\nE=mc\^2\n\$\$/);assert.doesNotMatch(formula.note,/\$\$\n.*Equation/);
 state=await store.patch({boardId:state.board!.id,expectedRevision:state.revision,requestId:'my-note',actor:'user',operations:[{op:'put_node',node:{...formula,note:'My handwritten derivation'}}]});
 const next=await store.createPanorama({sourceId:doc.id,expectedRevision:state.revision,requestId:'panorama-again'});
 assert.notEqual(next.board!.id,state.board!.id);assert.equal(next.board!.board.nodes.find(n=>n.id===formula.id)!.note,'My handwritten derivation');
 const board=structuredClone(next.board!.board);board.nodes.push({id:'derive',title:'Derive',note:'',kind:'note',x:3000,y:0,workflow:{type:'formula',prompt:''}});
 board.edges.push({id:'input',source:formula.id,target:'derive',label:'Explain'});
 assert.deepEqual(workflowScope(board,'derive').inputs.map(n=>n.id),[formula.id]);
 for(const [i,a]of board.nodes.entries())for(const b of board.nodes.slice(i+1))assert.ok(a.x+(a.width??420)<=b.x||b.x+(b.width??420)<=a.x||a.y+(a.height??240)<=b.y||b.y+(b.height??240)<=a.y);
});
test('fallback chapter cards use actual Markdown headings, never lose items, and circuit connections reject feedback loops',()=>{
 const sources=pdfPaperSources(doc,annotations,[]);assert.ok(sources.some(s=>s.category==='section'&&s.name==='Method'));
 assert.equal(sources.filter(s=>s.annotationId).length,annotations.length);
 const b={nodes:[{id:'a'},{id:'b'},{id:'c'}],edges:[{source:'a',target:'b'},{source:'b',target:'c'}]};
 assert.equal(connectionIntent(b,'c','a','right'),undefined);assert.ok(connectionIntent(b,'a','c','right'));
});
test('structure-only figures and equations become cards even before layout annotations exist',()=>{
 const sources=pdfPaperSources(doc,[],[],tree);
 assert.equal(sources.filter(s=>s.category==='figure').length,1);
 assert.equal(sources.find(s=>s.category==='formula')!.latex,'E=mc^2');
 assert.ok(sources.find(s=>s.name==='Method')!.references?.length);
});
test('explicit Roman-numbered tables are connected from prose, not from their own caption',()=>{
 const value={root:{id:'root',type:'document',children:[{id:'s',type:'section',title:'Evaluation',children:[{id:'p',type:'text',text:'Compare Table II for accuracy.'}]},{id:'t',type:'table',text:'TABLE II Accuracy',meta:{blockIndex:9}}]}};
 const sources=pdfPaperSources(doc,[],[],value),table=sources.find(s=>s.category==='table')!;
 assert.ok(sources.find(s=>s.name==='Evaluation')!.references?.some(r=>r.sourceId===table.id));
});
