import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTree,sourceLabel} from '../src/whiteboard/source-tree.js';
const paper={id:'a',name:'Study.pdf',format:'pdf',ready:true};
const assets=[paper,{id:'b',name:'Study.pdf',format:'pdf',ready:true},
 {id:'a-fig',name:'Study.pdf · Figure 1',format:'pdf',ready:true,documentId:'a',category:'figure',caption:'Figure 1. Complete diagram'},
 {id:'b-table',name:'Study.pdf · Table 2',format:'pdf',ready:true,documentId:'b',category:'table'},
 {id:'a-note',name:'Study.pdf · Important note',format:'pdf',ready:true,documentId:'a',category:'annotation'}];
test('paper roots and category folders preserve distinct identities and empty categories',()=>{
 const roots=sourceTree(assets);
 assert.equal(roots.length,2);assert.deepEqual(roots.map(r=>r.id),['a','b']);
 assert.deepEqual(roots[0].folders.find(f=>f.id==='figure')?.items.map(i=>i.id),['a-fig']);
 assert.deepEqual(roots[1].folders.find(f=>f.id==='table')?.items.map(i=>i.id),['b-table']);
 assert.equal(roots[0].folders.find(f=>f.id==='formula')?.items.length,0);
 assert.deepEqual(roots[0].folders.find(f=>f.id==='document')?.items.map(i=>i.id),['a']);
 assert.equal(roots[0].count,3);assert.equal(roots[1].count,2);
});
test('search finds captions and folder labels while keeping the matching paper ancestor',()=>{
 const found=sourceTree(assets,'Complete diagram');
 assert.equal(found.length,1);assert.equal(found[0].id,'a');assert.equal(found[0].count,3);
 assert.deepEqual(found[0].folders.flatMap(f=>f.items).map(i=>i.id),['a-fig']);
 assert.deepEqual(sourceTree(assets,'批注').flatMap(r=>r.folders.flatMap(f=>f.items)).map(i=>i.id),['a-note']);
 assert.equal(sourceTree(assets,'Study.pdf').length,2);
 assert.deepEqual(sourceTree(assets,'nothing'),[]);
});
test('missing document parents and Pages stay separate rather than attaching to another paper',()=>{
 const roots=sourceTree([...assets,{id:'orphan',name:'Old.pdf · Formula',format:'pdf',ready:true,documentId:'missing',category:'formula'},
 {id:'page',name:'Research note',format:'md',ready:true,category:'pages'}]);
 assert.equal(roots.find(r=>r.id==='missing')?.folders.find(f=>f.id==='formula')?.items[0].id,'orphan');
 assert.equal(roots.find(r=>r.id==='pages')?.folders[0].items[0].id,'page');
 assert.equal(sourceLabel(assets[2],paper.name),'Figure 1. Complete diagram');
 assert.equal(sourceLabel(assets[3],paper.name),'Table 2');
});
