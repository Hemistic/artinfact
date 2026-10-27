import {installNoteDom} from './fixtures/note-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

test('source Markdown uses a readonly Milkdown surface with evidence highlights and inert formulas',async()=>{
 const dom=new JSDOM('<!doctype html><div id="source"></div>',{pretendToBeVisual:true});
 installNoteDom(dom);
 
 const {createNoteSurface}=await import('../src/whiteboard/note-surface.js');
 const markdown='Original **important** evidence.\n\n$$\nx^2\n$$';let changes=0;
 const surface=await createNoteSurface(document.getElementById('source')!,markdown,()=>changes++,{}, {readOnly:true,label:'PDF 原文证据',highlights:['important evidence']});
 try{
  const source=document.querySelector('.ProseMirror')!;
  assert.equal(source.getAttribute('contenteditable'),'false');
  assert.equal(source.getAttribute('aria-label'),'PDF 原文证据');
  assert.equal(source.getAttribute('aria-readonly'),'true');
  assert.equal([...source.querySelectorAll('mark')].map(n=>n.textContent).join(''),'important evidence');
  (source.querySelector('.wb-note-math') as HTMLElement).click();
  assert.equal(source.querySelector('input'),null);
  assert.equal(changes,0);
  assert.equal(surface.markdown(),markdown);
 }finally{await surface.destroy();dom.window.close();}
});
