import {installNoteDom,editMathSource} from './fixtures/note-dom.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

test('one live editing surface preserves Markdown, math and changes without a second preview',async()=>{
 const dom=new JSDOM('<!doctype html><div id="editor"></div>',{pretendToBeVisual:true});
 installNoteDom(dom);
 
 const {createNoteSurface}=await import('../src/whiteboard/note-surface.js');
 const host=document.querySelector<HTMLElement>('#editor')!;
 const changes:(()=>string)[]=[];
 const surface=await createNoteSurface(host,'# Heading\n\n**Bold** and $E=mc^2$\n\n$$\na+b=c\n$$\n\n- item\n\n![figure](flow-asset:test-image)',read=>changes.push(read),{'test-image':'data:image/png;base64,AA=='});
 try{
  assert.equal(host.querySelectorAll('[contenteditable="true"]').length,1);
  assert.equal(host.querySelectorAll('textarea').length,0);
  assert.equal(host.querySelectorAll('.katex').length,2);
  assert.match(surface.markdown(),/E=mc\^2/);assert.match(surface.markdown(),/a\+b=c/);
  assert.match(surface.markdown(),/flow-asset:test-image/);
  for(let i=0;i<40&&!host.querySelector('img[src^="data:image/"]');i++)await new Promise(resolve=>setTimeout(resolve,15));
  assert.match(host.querySelector<HTMLImageElement>('img[src^="data:image/"]')!.src,/data:image\/png/);
  const formula=host.querySelector<HTMLElement>('.wb-note-math')!;formula.click();
  await editMathSource(formula,'x^2+y^2');
  assert.match(surface.markdown(),/x\^2\+y\^2/);assert.equal(formula.querySelector('input'),null);assert.ok(formula.querySelector('.katex'));
  assert.equal(typeof changes.at(-1),'function','typing must notify dirtiness without converting the entire document');
  assert.match(changes.at(-1)!(),/x\^2\+y\^2/,'navigation must still read the latest draft synchronously');
  const {noteEditor}=await import('../src/whiteboard/note-editor.js');let saved:{title:string;markdown:string}|undefined;
  const note=noteEditor({title:'Note',markdown:'$a+b$'},async value=>{saved=value;},()=>{});document.body.append(note);
  const commit=note.querySelector('button')!;for(let i=0;i<50&&commit.disabled;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(commit.disabled,false);assert.equal(note.querySelectorAll('[contenteditable="true"]').length,1);assert.equal(note.querySelectorAll('textarea').length,0);
  const math=note.querySelector<HTMLElement>('.wb-note-math')!;await editMathSource(math,'a-b');commit.click();
  await note.flush();assert.match(saved!.markdown,/a-b/);note.remove();await new Promise(resolve=>setTimeout(resolve,20));
  let calls=0;const next=noteEditor({title:'Draft',markdown:'$x$'},async()=>{calls++;},()=>{});document.body.append(next);
  for(let i=0;i<50&&next.querySelector('button')!.disabled;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(next.isDirty(),false);next.querySelector('input')!.value='Changed';
  assert.equal(next.isDirty(),true);await Promise.all([next.flush(),next.flush()]);assert.equal(calls,1);assert.equal(next.isDirty(),false);next.remove();await new Promise(resolve=>setTimeout(resolve,20));
  const {canvasTool}=await import('../src/whiteboard/canvas-toolbar.js');let toolCalls=0,release!:()=>void;const tool=canvasTool('undo','Undo',async()=>{toolCalls++;await new Promise<void>(resolve=>release=resolve);tool.disabled=true;},()=>{});document.body.append(tool);tool.click();tool.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(toolCalls,1);release();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(tool.disabled,true);assert.equal(tool.hasAttribute('aria-busy'),false);
 }finally{await surface.destroy();dom.window.close();}
});
