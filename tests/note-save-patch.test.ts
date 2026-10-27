import test from 'node:test';import assert from 'node:assert/strict';
import {applySavedNote} from '../src/whiteboard/note-save-patch.js';
import {readFile} from 'node:fs/promises';import {runInNewContext} from 'node:vm';import ts from 'typescript';
test('saving a note updates only its card and history metadata without replacing the canvas model',()=>{
 const note:any={id:'n',note:'Old',title:'Old',x:10,y:20},other:any={id:'other',title:'Other',note:'Untouched',x:30,y:40},view:any={revision:3,board:{id:'board',board:{nodes:[note,other],edges:[{id:'e'}]}},canUndo:false,canRedo:true};
 const result=applySavedNote(view,'board',{nodeId:'n',markdown:'Latest',title:'New',boardRevision:4,canUndo:true,canRedo:false});assert.equal(result,note);assert.equal(view.board.board.nodes[1],other);assert.equal(view.revision,4);assert.equal(view.canUndo,true);assert.equal(view.canRedo,false);assert.equal(note.note,'Latest');assert.equal(note.x,10);
 assert.equal(applySavedNote(view,'other-board',{nodeId:'n',markdown:'Stale',title:'Old',boardRevision:5}),undefined);assert.equal(applySavedNote(view,'board',{nodeId:'n',markdown:'Stale',title:'Old',boardRevision:2}),undefined);assert.equal(note.note,'Latest');
});
test('undoing back to saved text clears the dirty indicator without submitting a redundant write',async()=>{
 const source=await readFile('src/ui/workspace-shell.ts','utf8'),start=source.indexOf('  function stageNoteDraft('),code=source.slice(start,source.indexOf('\n  async function hydrateNote(',start));let writes=0,renders=0;
 const context:any={activeNote:{nodeId:'n',title:'Note',markdown:'Saved',revision:'r'},workspaceId:'w',readerDirty:true,noteSaveStatus:'dirty',noteSaveError:'',readerDrafts:{pending:()=>false,stage:()=>writes++},renderTabs:()=>renders++};
 runInNewContext(ts.transpileModule(code+'\nstageNoteDraft("n",{title:"Note",markdown:"Saved",revision:"r"});',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);assert.equal(writes,0);assert.equal(context.readerDirty,false);assert.equal(context.noteSaveStatus,'saved');assert.equal(renders,1);
});
