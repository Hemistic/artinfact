import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('late reader image renders cannot update removed layout boxes or create phantom annotations',async()=>{
 for(const [path,indent] of [['vendor/zotero-reader/source/reader/src/common/annotation-manager.js','\t'],['vendor/zotero-reader/runtime/reader-local.html','  ']]){
  const text=await readFile(path,'utf8'),start=text.indexOf(indent+'updateAnnotations(annotations) {'),end=text.indexOf('\n'+indent+'}',start);
  assert.ok(start>=0&&end>start);
  const update=new Function('return ({'+text.slice(start,end+indent.length+2)+'}).updateAnnotations;')();
  let saved=0;
  const manager={_getAnnotationByID:()=>undefined,_applyImageChange:()=>saved++};
  assert.doesNotThrow(()=>update.call(manager,[{id:'removed-box',image:'data:image/png;base64,old'}]));
  assert.equal(saved,0);
  assert.throws(()=>update.call(manager,[{id:'missing',comment:'edit'}]),/missing annotation/);
  update.call({...manager,_getAnnotationByID:()=>({readOnly:true})},[{id:'current',image:'data:image/png;base64,current'}]);
  assert.equal(saved,1,'A current read-only image box can still receive its rendered thumbnail');
 }
});
