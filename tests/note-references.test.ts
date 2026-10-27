import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {editorViewCtx} from '@milkdown/core';
import {TextSelection} from '@milkdown/prose/state';

test('typing @ filters actual workspace references, inserts a portable link, and does not trigger for email addresses',async()=>{
 const dom=new JSDOM('<!doctype html><div id="editor"></div>',{pretendToBeVisual:true});
 for(const key of ['window','document','navigator','HTMLElement','Element','SVGElement','Node','MutationObserver','CustomEvent'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
 for(const key of ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame','addEventListener','removeEventListener','dispatchEvent'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key].bind(dom.window),configurable:true});
 dom.window.scrollBy=()=>{};dom.window.Range.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,right:30,top:0,bottom:20,width:30,height:20,toJSON(){}} as DOMRect);dom.window.Range.prototype.getClientRects=()=>[] as any;
 const {createNoteSurface}=await import('../src/whiteboard/note-surface.js');
 const surface=await createNoteSurface(document.getElementById('editor')!,'',()=>{},{},{references:()=>[{id:'pdf-id',label:'Self-RAG.pdf',kind:'pdf'},{id:'note-id',label:'我的研读笔记',kind:'note'},{id:'pages-id',label:'Pages 摘要',kind:'pages'}]});
 const view=surface.editor.action(ctx=>ctx.get(editorViewCtx));
 const set=(text:string)=>{view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,view.state.schema.nodes.paragraph.create(null,text?view.state.schema.text(text):undefined)));view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,text.length+1)));view.focus();};
 const wait=()=>new Promise(resolve=>setTimeout(resolve,160));
 try{
  set('@Self');await wait();const menu=document.querySelector('.wb-note-references')!;assert.equal(menu.getAttribute('data-show'),'true',JSON.stringify({menu:menu.outerHTML,doc:view.state.doc.toJSON(),selection:view.state.selection.toJSON()}));assert.equal(menu.querySelectorAll('button').length,1);assert.equal(menu.querySelector('button')?.dataset.referenceId,'pdf-id');
  const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});view.dom.dispatchEvent(event);assert.ok(event.defaultPrevented);assert.match(surface.markdown(),/\[Self-RAG.pdf\]\(#artinfact-ref\/pdf\/pdf-id\)/);
  set('someone@example.org');await wait();assert.notEqual(menu.getAttribute('data-show'),'true');
  set('@');await wait();assert.equal(menu.querySelectorAll('button').length,3);view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(menu.getAttribute('data-show'),'false');
  set('');set('@');await wait();view.dispatch(view.state.tr.insertText('Pages'));view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.match(surface.markdown(),/\[Pages 摘要\]\(#artinfact-ref\/pages\/pages-id\)/);assert.ok(!surface.markdown().includes('PagesPages'));
 }finally{await surface.destroy();dom.window.close();}
});
