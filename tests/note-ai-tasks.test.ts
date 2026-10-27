import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorkspaceLibrary} from '../src/server/workspaces.js';import {WorkspaceRuntime} from '../src/server/workspace-runtime.js';import {PdfStateStore} from '../src/server/pdf-store.js';import {WhiteboardNotes} from '../src/server/whiteboard-notes.js';import {NoteAiTasks} from '../src/server/note-ai-tasks.js';
test('MCP note rewrites return a review result without changing the saved note, and are scoped, immutable and cancellable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'note-ai-'));const library=new WorkspaceLibrary(()=>root),runtime=new WorkspaceRuntime(library,new PdfStateStore(join(root,'legacy')));await library.list();const notes=new WhiteboardNotes(runtime),tasks=new NoteAiTasks(runtime);
 try{const note=await notes.create('default',{title:'Note',markdown:'Original.'}),request=await tasks.begin('default',{nodeId:note.nodeId,document:'Original.',selection:'Original.',instruction:'润色'});
  assert.equal((await tasks.read('default',request.id,true)).selection,'Original.');assert.equal((await tasks.read('default',request.id,false)).document,undefined);
  await tasks.complete('default',request.id,'Improved.');assert.equal((await tasks.read('default',request.id,false)).markdown,'Improved.');assert.equal((await notes.read('default',note.nodeId)).markdown,'Original.');
  await tasks.complete('default',request.id,'Improved.');await assert.rejects(tasks.complete('default',request.id,'Different.'),/RESULT_CONFLICT/);
  const foreign=await library.create('Other');await assert.rejects(tasks.read(foreign.id,request.id,true),/NOT_FOUND/);await assert.rejects(tasks.read('default','../outside',true));
  const cancelled=await tasks.begin('default',{nodeId:note.nodeId,document:'Original.',selection:'Original.',instruction:'改写'});await tasks.cancel('default',cancelled.id);assert.equal((await tasks.read('default',cancelled.id,false)).status,'cancelled');await assert.rejects(tasks.complete('default',cancelled.id,'Late.'),/CANCELLED/);
 }finally{await runtime.close();await rm(root,{recursive:true,force:true});}
});
