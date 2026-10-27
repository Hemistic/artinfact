import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {createMediaStore,validateImage} from '../src/whiteboard/flow-media.js';
test('export packages real image bytes and Markdown that resolves the attachment path',async()=>{
  const dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAZsYj9QAAAABJRU5ErkJggg==';
  const figure={id:'paper-test',name:'chart.png',dataUrl,paper:'CRAG',page:4,caption:'Figure 2',sourcePath:'wiki/source.md'};
  const media=createMediaStore([figure]),node={id:'n1',title:'阅读判断',note:'## 对照\n![图](flow-asset:paper-test)',kind:'note' as const,x:48,y:96};
  const blob=await media.exportZip([node],{version:1,nodes:[node],edges:[]}),files=unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(files['assets/paper-test.png'].length>20);
  const note=strFromU8(files['notes/阅读判断-n1.md']);assert.ok(note.includes('![图](../assets/paper-test.png)'));assert.ok(note.includes('CRAG · Figure 2 · PDF 第 4 页'));
  assert.equal(JSON.parse(strFromU8(files['flow.json'])).nodes[0].note,'## 对照\n![图](assets/paper-test.png)');
});
test('missing attachments abort the archive instead of silently exporting broken notes',async()=>{
  const media=createMediaStore([]);await assert.rejects(media.exportZip([{id:'n',title:'a',note:'![图](flow-asset:missing)',kind:'note',x:0,y:0}]),/图片缺失/);
});
test('local image validation excludes non-images and oversized attachments',()=>{
  assert.doesNotThrow(()=>validateImage({type:'image/png',size:1000}));assert.throws(()=>validateImage({type:'text/html',size:10}));assert.throws(()=>validateImage({type:'image/jpeg',size:21*1024*1024}));
});
