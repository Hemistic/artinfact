import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BoardSchema} from '../src/whiteboard/whiteboard-domain.js';
import {WhiteboardStore} from '../src/whiteboard/whiteboard-store.js';
const original='Original important evidence.\n\nMore context.';
const node={id:'study',title:'我的研读',note:'## 我的理解\n\n可编辑的 **Markdown**。',kind:'note' as const,role:'note' as const,x:50,y:80,citations:[{sourceId:'pdf',start:0,end:original.length,quote:original}],studyNote:{label:'研读' as const,highlights:[{citation:0,text:'important evidence'}]}};
test('a study note preserves editable Markdown and source evidence as separate content',()=>{
 const board=BoardSchema.parse({version:1,nodes:[node],edges:[]});
 assert.deepEqual(board.nodes[0].studyNote,node.studyNote);
 assert.equal(board.nodes[0].citations![0].quote,original);
 assert.equal(BoardSchema.safeParse({version:1,nodes:[{...node,studyNote:{label:'研读',highlights:[{citation:1,text:'invented'}]}}],edges:[]}).success,false);
});
test('MCP study notes require exact source excerpts and do not replace evidence when the upper note changes',async()=>{
 const base=resolve('.preview-data/study-note-tests');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'study-note-'));
 try{
  const store=new WhiteboardStore(root,async()=>[{id:'pdf',name:'paper.pdf',format:'pdf',path:'paper.pdf',text:original,standard:true}]);
  let view=await store.create({title:'研读样例',templateId:'free',expectedRevision:0,requestId:randomUUID()});
  const write=(value:typeof node)=>store.patch({boardId:view.board!.id,expectedRevision:view.revision,requestId:randomUUID(),actor:'user',operations:[{op:'put_node',node:value}]});
  await assert.rejects(write({...node,citations:[{sourceId:'pdf',start:0,end:original.length,quote:'Invented original'}]}),/CITATION_MISMATCH/);
  await assert.rejects(write({...node,studyNote:{label:'研读',highlights:[{citation:0,text:'invented'}]}}),/STUDY_HIGHLIGHT/);
  view=await write(node);
  view=await write({...node,note:'## 修改后的理解\n\n仍然引用相同原文。'});
  assert.equal(view.board!.board.nodes[0].note,'## 修改后的理解\n\n仍然引用相同原文。');
  assert.deepEqual(view.board!.board.nodes[0].citations,node.citations);
  assert.deepEqual(view.board!.board.nodes[0].studyNote,node.studyNote);
 }finally{assert.ok(root.startsWith(base+sep));await rm(root,{recursive:true,force:true});}
});
