import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewSession,workflowDraft,boardViewChanged} from '../src/whiteboard/view-session.js';
import type {BoardNode,BoardView} from '../src/whiteboard/whiteboard-domain.js';

test('an old board response cannot commit after switching, hiding, or starting a mutation',async()=>{
 const session=createViewSession();const first=session.capture('a');
 let release!:()=>void;const response=new Promise<void>(resolve=>{release=resolve;});let applied=false;
 const poll=response.then(()=>{if(session.matches(first,'a'))applied=true;});
 session.invalidate();const second=session.capture('b');release();await poll;
 assert.equal(applied,false);assert.equal(session.matches(second,'b'),true);
 assert.equal(session.matches(second,'a'),false);session.invalidate();assert.equal(session.matches(second,'b'),false);
});

test('task-only changes refresh Run and Cancel controls but another board revision does not',()=>{
 const previous:BoardView={revision:1,canUndo:false,canRedo:false,board:{id:'a',title:'A',templateId:'free',sourceIds:[],board:{version:1,nodes:[],edges:[]},tasks:[{id:'task',status:'queued',sourceIds:[],sourceRevisions:{},instructions:'Read',message:'Queued',createdAt:'2026-10-10'}]}};
 const next=structuredClone(previous);next.revision=2;next.board!.tasks[0].status='running';
 assert.equal(boardViewChanged(previous,next),true);
 assert.equal(boardViewChanged(previous,{...previous,revision:3}),false);
 assert.equal(boardViewChanged(previous,{...previous,canUndo:true}),true);
});

test('workflow edits preserve the node and workflow fields; unchanged or missing nodes have no draft',()=>{
 const node:BoardNode={id:'n',kind:'note',title:'Analysis',note:'source',x:10,y:20,workflow:{type:'similarity',prompt:'Before'}};
 const draft=workflowDraft(node,'After');assert.ok(draft);assert.equal(draft.workflow?.prompt,'After');
 assert.equal(draft.x,10);assert.equal(node.workflow?.prompt,'Before');
 assert.equal(workflowDraft(node,'Before'),undefined);assert.equal(workflowDraft(undefined,'After'),undefined);
 assert.equal(workflowDraft({...node,workflow:undefined},'After'),undefined);
});
