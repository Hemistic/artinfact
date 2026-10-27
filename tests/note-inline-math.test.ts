import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {editorViewCtx} from '@milkdown/core';
import {TextSelection} from '@milkdown/prose/state';
import {installNoteDom} from './fixtures/note-dom.js';

test('typing math renders inline and edits through the native document without an input popup',async()=>{
 const dom=new JSDOM('<!doctype html><div id="note"></div>',{pretendToBeVisual:true});installNoteDom(dom);
 const {createNoteSurface}=await import('../src/whiteboard/note-surface.js');
 const host=document.querySelector<HTMLElement>('#note')!,surface=await createNoteSurface(host,'Before ',()=>{});
 const view=surface.editor.action(ctx=>ctx.get(editorViewCtx));
 const type=(text:string)=>{for(const char of text){const {from,to}=view.state.selection;let handled=false;view.someProp('handleTextInput',handler=>{if(handler(view,from,to,char,()=>view.state.tr.insertText(char,from,to)))handled=true;return handled;});if(!handled)view.dispatch(view.state.tr.insertText(char));}};
 try{
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,view.state.doc.content.size-1)));view.focus();type(' $x^2$');
  const formula=host.querySelector<HTMLElement>('.wb-note-math')!;assert.ok(formula?.querySelector('.katex'));
  formula.click();assert.equal(host.querySelector('input[aria-label="编辑公式"]'),null,'math edits must use the document caret');
  assert.equal(view.state.selection.$from.parent.type.name,'note_math_inline');
  const start=view.state.selection.$from.start();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,start,start+3)));type('x^3');
  assert.equal(formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent,'x^3');assert.match(surface.markdown(),/Before \$x\^3\$/);
  assert.equal(formula.querySelector('.wb-note-math-source')?.textContent,'x^3');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,view.state.doc.content.size-1)));type(' after');assert.match(surface.markdown(),/\$x\^3\$ after/);
  assert.equal(formula.getAttribute('data-math-active'),null);
  const block=view.state.schema.nodes.note_math_block.create(null,view.state.schema.text('a+b=c'));view.dispatch(view.state.tr.insert(view.state.doc.content.size,block));
  const blockDom=host.querySelector<HTMLElement>('.wb-note-math-block')!;blockDom.click();assert.equal(view.state.selection.$from.parent.type.name,'note_math_block');type('+d');
  assert.equal(blockDom.querySelector('annotation')?.textContent,'a+b=c+d');assert.match(surface.markdown(),/a\+b=c\+d/);
  const key=(name:string)=>{let handled=false;view.someProp('handleKeyDown',handler=>{if(handler(view,new dom.window.KeyboardEvent('keydown',{key:name})))handled=true;return handled;});return handled;};
  assert.equal(key('Enter'),true);assert.equal(view.state.selection.$from.parent.type.name,'paragraph');type('Following block');assert.match(surface.markdown(),/Following block/);
  const {undo}=await import('@milkdown/prose/history');assert.equal(undo(view.state,view.dispatch),true);assert.ok(host.querySelector('.katex'));
 }finally{await surface.destroy();dom.window.close();}
});
