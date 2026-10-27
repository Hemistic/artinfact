import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {inspectorLayout,loadInspectorPage} from '../src/whiteboard/inspector-layout.js';
test('inspector separates the full reading area from a compact bottom toolbar',()=>{
 const dom=new JSDOM('<aside></aside>');const panel=dom.window.document.querySelector('aside')!;
 const view=inspectorLayout(panel),body=dom.window.document.createElement('article'),action=dom.window.document.createElement('button');view.content.append(body);view.actions.append(action);
 assert.equal(panel.children[0],view.content);assert.equal(panel.children[1],view.actions);assert.equal(view.actions.getAttribute('role'),'toolbar');assert.equal(view.content.contains(action),false);dom.window.close();
});
test('Pages detail renders all paragraphs and ignores late results after selection changes',async()=>{
 const dom=new JSDOM('<article></article>');const preview=dom.window.document.querySelector('article')!;let current=true,resolve!:(x:any)=>void;
 const body=Array.from({length:30},(_,i)=>'Paragraph '+i).join('\n\n');
 await loadInspectorPage(preview,async()=>({markdown:body}),()=>current);
 assert.match(preview.textContent!,/Paragraph 29/);
 const stale=loadInspectorPage(preview,()=>new Promise(r=>resolve=r),()=>current);current=false;preview.textContent='New selection';resolve({markdown:'Old selection'});await stale;assert.equal(preview.textContent,'New selection');dom.window.close();
});
test('Pages detail reports missing or failed snapshots without disguising a summary as full text',async()=>{
 const dom=new JSDOM('<article></article>');const preview=dom.window.document.querySelector('article')!;
 await loadInspectorPage(preview,async()=>({}),()=>true);assert.match(preview.textContent!,/完整正文尚未同步/);
 await loadInspectorPage(preview,async()=>{throw Error('Transport closed');},()=>true);assert.match(preview.textContent!,/Transport closed/);dom.window.close();
});
