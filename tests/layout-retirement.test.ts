import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PdfStateStore} from '../src/server/pdf-store.ts';
import {replacedLayoutIds} from '../src/shared/layout-annotations.ts';

test('the retired standalone detector has no source, binary or worker remaining in the plugin',async()=>{
 for(const path of ['src/server/yolo-layout.ts','src/server/yolo-worker.ts','src/shared/yolo-layout.ts','src/ui/yolo-layout.ts','dist/server/yolo-worker.js','vendor/yolo']){
  await assert.rejects(access(path),{code:'ENOENT'},path);
 }
 assert.equal('replaceYolo' in PdfStateStore.prototype,false);
});

test('removing the detector preserves historical boxes, edited notes and manual annotations in saved workspaces',async()=>{
 const store=new PdfStateStore(await mkdtemp(join(tmpdir(),'layout-retirement-'))),id='a'.repeat(64);
 const annotations=[{id:'legacy',projectOrigin:'layout-yolo',comment:'My research note',position:{pageIndex:0,rects:[[1,2,3,4]]}},{id:'manual',type:'highlight',text:'A saved original quote'}];
 await store.update(id,{annotations});
 await store.update(id,{viewState:{pageIndex:2}});
 assert.deepEqual((await store.read(id)).annotations,annotations);
});

test('applying MinerU boxes preserves edited historical boxes in the reader and storage alike',()=>{
 const current=[{id:'old-auto',projectOrigin:'layout-yolo',dateCreated:'same',dateModified:'same',comment:''},{id:'old-edited',projectOrigin:'layout-yolo',dateCreated:'same',dateModified:'same',comment:'My note'},{id:'json-edited',projectOrigin:'layout-json',dateCreated:'same',dateModified:'new',comment:''},{id:'manual',type:'highlight'}];
 assert.deepEqual(replacedLayoutIds(current,[{id:'new-mineru',projectOrigin:'layout-json'}]),['old-auto']);
});
