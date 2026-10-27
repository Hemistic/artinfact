import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutPreviewAnnotation} from '../src/shared/layout-annotations.js';
import {normalizeMineruMiddle} from '../src/server/mineru-local.js';

test('saved automatic equation comments are hidden without mutating stored LaTeX or image',()=>{
 const original={id:'formula',projectOrigin:'layout-json',layoutKind:'equation',comment:'x^2=y',layoutOriginalComment:'x^2=y',image:'data:image/png;base64,test'};
 const visible=layoutPreviewAnnotation(original);
 assert.equal(visible.comment,'');assert.equal(visible.image,original.image);assert.equal(original.comment,'x^2=y');
 assert.equal(layoutPreviewAnnotation({...original,comment:'My explanation'}).comment,'My explanation');
 assert.equal(layoutPreviewAnnotation({...original,layoutKind:'table'}).comment,'x^2=y');
 assert.equal(layoutPreviewAnnotation({...original,projectOrigin:'manual'}).comment,'x^2=y');
});

test('new equation annotations omit raw LaTeX in comments while structure JSON retains it',()=>{
 const raw={schema:'docvortex.middle',schema_version:'2.0',is_full_document:true,pages:[{page_idx:0,blocks:[{type:'equation',index:0,bbox:[.1,.1,.9,.3],content:'E=mc^2'}]}]};
 const result=normalizeMineruMiddle(raw,[{width:612,height:792}],'a'.repeat(64),'/result.json');
 assert.equal(result.annotations[0].comment,'');assert.equal(result.annotations[0].layoutOriginalComment,'');assert.equal(result.annotations[0].text,'');
 assert.equal(result.contentList[0].text,'E=mc^2');assert.equal(result.contentList[0].text_format,'latex');
});
