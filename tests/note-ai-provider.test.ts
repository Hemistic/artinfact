import test from 'node:test';import assert from 'node:assert/strict';import {createNoteAiProvider} from '../src/whiteboard/note-ai-provider.js';
test('the editor sends a scoped Agent prompt then receives its rewrite through MCP, and a failed send cancels the task',async()=>{
 const calls:any[]=[],prompts:string[]=[],signal=new AbortController().signal,context={document:'Doc',selection:'Text',instruction:'Improve'};
 const transport={call:async(name:string,args:any)=>{calls.push({name,args});return name.endsWith('begin')?{id:'request'}:{status:'completed',markdown:'Improved'};},send:async(text:string)=>{prompts.push(text);return{mode:'sent'};}};
 const chunks=[];for await(const chunk of createNoteAiProvider('workspace','note',transport,1)(context,signal))chunks.push(chunk);assert.deepEqual(chunks,['Improved']);assert.match(prompts[0],/whiteboard_note_ai_complete/);assert.match(prompts[0],/workspaceId=workspace/);assert.equal(calls[1].args.includeContext,false);
 await assert.rejects(async()=>{for await(const _ of createNoteAiProvider('workspace','note',{...transport,send:async()=>({mode:'draft'})},1)(context,signal)){}},/未发送/);assert.equal(calls.at(-1).name,'whiteboard_note_ai_cancel');
});
