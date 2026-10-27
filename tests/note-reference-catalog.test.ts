import test from 'node:test';
import assert from 'node:assert/strict';
import {noteReferenceCatalog} from '../src/whiteboard/note-reference-catalog.js';
import type {BoardNode} from '../src/whiteboard/whiteboard-domain.js';
test('note references contain workspace documents, editable notes and Pages without duplicates or chart assets',()=>{
 const nodes=[{id:'current',kind:'note',role:'note',title:'Current',note:'',x:0,y:0},{id:'other',kind:'note',role:'note',title:'Other',note:'',x:0,y:0},{id:'formula',kind:'note',role:'source',sourceId:'pdf',title:'Formula',note:'',x:0,y:0}] as BoardNode[];
 const refs=noteReferenceCatalog([{id:'pdf',name:'Paper.pdf',format:'pdf',category:'document'},{id:'figure',name:'Figure',format:'pdf',category:'figure',documentId:'pdf'},{id:'page',name:'Page',format:'markdown',category:'pages'}],nodes,'current',[{id:'page',label:'Page'}]);
 assert.deepEqual(refs.map(({id,kind})=>({id,kind})),[{id:'pdf',kind:'pdf'},{id:'page',kind:'pages'},{id:'other',kind:'note'}]);
});
