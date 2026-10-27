import test from 'node:test';
import assert from 'node:assert/strict';
import {readerNoteReferences} from '../src/ui/reader-note-references.js';
test('reader references use real PDF IDs, other board notes and the linked Pages page',()=>{
 const refs=readerNoteReferences({name:'workspace',active:'pdf',openIds:[],busy:false,documents:[{id:'pdf',name:'Paper.pdf'},{id:'md:old.md',name:'Legacy note'}],notes:[{nodeId:'current',title:'Current',boards:[]},{nodeId:'other',title:'Other',boards:[]}],activeNote:{nodeId:'current',title:'Current',markdown:'',revision:'r',page:{pageId:'page',title:'Linked Page',markdown:''}}});
 assert.deepEqual(refs.map(ref=>[ref.kind,ref.id]),[['pdf','pdf'],['note','other'],['pages','page']]);
});
