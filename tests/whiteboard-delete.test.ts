import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WhiteboardStore} from '../src/whiteboard/whiteboard-store.js';
import {canvasDeletion} from '../src/whiteboard/canvas-deletion.js';
test('deleted boards expire at the next plugin session, while switching views keeps undo available',async t=>{
 const root=await mkdtemp(join(tmpdir(),'board-session-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new WhiteboardStore(root,async()=>[]);await store.beginSession('session-a');
 let view=await store.create({title:'Keep',templateId:'free',expectedRevision:(await store.list()).revision,requestId:'keep'});const keep=view.board!.id;
 view=await store.create({title:'Delete',templateId:'free',expectedRevision:view.revision,requestId:'create'});const id=view.board!.id;
 view=await store.patch({boardId:id,actor:'user',requestId:'note',expectedRevision:view.revision,operations:[{op:'put_node',node:{id:'shared-note',title:'Note',note:'Preserved',kind:'note',x:0,y:0}}]});
 view=await store.archive({boardId:id,archived:true,expectedRevision:view.revision,requestId:'delete'});
 const reopened=new WhiteboardStore(root,async()=>[]);await reopened.beginSession('session-a');assert.equal((await reopened.list()).archivedBoards.length,1);assert.equal((await reopened.list()).revision,view.revision);
 await reopened.beginSession('session-b');const list=await reopened.list();assert.equal(list.archivedBoards.length,0);assert.deepEqual(list.boards.map(b=>b.id),[keep]);assert.equal(list.initialized,true);
 await assert.rejects(reopened.read(id),/BOARD_NOT_FOUND/);await assert.rejects(reopened.archive({boardId:id,archived:false,expectedRevision:list.revision,requestId:'too-late'}),/BOARD_NOT_FOUND/);assert.ok((await reopened.cards()).cards.some(c=>c.id==='shared-note'));
 await reopened.beginSession('session-b');assert.equal((await reopened.list()).revision,list.revision);
});
test('old deleted boards without a session marker are cleared on first updated-plugin launch',async t=>{
 const root=await mkdtemp(join(tmpdir(),'board-old-session-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new WhiteboardStore(root,async()=>[]);
 const view=await store.create({title:'Old deleted',templateId:'free',expectedRevision:0,requestId:'create'});await store.archive({boardId:view.board!.id,archived:true,expectedRevision:view.revision,requestId:'delete'});
 await store.beginSession('new-plugin');const list=await store.list();assert.equal(list.items.length,0);assert.equal(list.initialized,true);
});

test('deletion follows selection and never consumes text editing, IME or modal keys',()=>{
 const intent={key:'Delete',selected:'a',selectedEdge:'',selection:['a','b'],editing:false,modal:false,composing:false,repeat:false};
 assert.deepEqual(canvasDeletion(intent),[{op:'remove_node',id:'a'},{op:'remove_node',id:'b'}]);
 assert.deepEqual(canvasDeletion({...intent,key:'Backspace',selection:[],selectedEdge:'edge'}),[{op:'remove_edge',id:'edge'}]);
 for(const flag of ['editing','modal','composing','repeat'])assert.deepEqual(canvasDeletion({...intent,[flag]:true}),[]);
 assert.deepEqual(canvasDeletion({...intent,key:'Escape'}),[]);
});

test('board deletion is recoverable, persists, preserves cards, and rejects stale writes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'board-delete-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new WhiteboardStore(root,async()=>[]);
 let state=await store.create({title:'Board A',templateId:'free',expectedRevision:0,requestId:'create'}),id=state.board!.id;
 state=await store.patch({boardId:id,actor:'user',expectedRevision:state.revision,requestId:'nodes',operations:[{op:'put_node',node:{id:'a',title:'A',note:'保留笔记',kind:'note',x:0,y:0}}]});
 const args={boardId:id,archived:true,expectedRevision:state.revision,requestId:'delete'};
 state=await store.archive(args);
 assert.equal((await store.read(id)).archived,true);
 assert.equal((await store.list()).boards.length,0);
 assert.equal((await store.list()).archivedBoards[0].id,id);
 assert.equal((await store.cards()).cards.length,1);
 assert.equal((await store.archive(args)).revision,state.revision);
 await assert.rejects(store.archive({...args,requestId:'stale'}),/REVISION_CONFLICT/);
 const reopened=new WhiteboardStore(root,async()=>[]);
 state=await reopened.archive({boardId:id,archived:false,expectedRevision:state.revision,requestId:'restore'});
 assert.notEqual(state.archived,true);
 assert.equal((await reopened.list()).boards[0].id,id);
 assert.equal(state.board!.board.nodes[0].note,'保留笔记');
});
