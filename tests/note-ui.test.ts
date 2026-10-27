import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {editorViewCtx} from '@milkdown/core';
import {TextSelection} from '@milkdown/prose/state';
import {noteUiStyles} from '../scripts/note-ui-css.mjs';

test('note themes provide visible native text selection colors in light and dark mode',async()=>{
 const css=await noteUiStyles();
 const light=css.match(/\.wb-note-surface\s*\{([^}]+)\}/)?.[1]??'';
 const dark=css.match(/\[data-theme=dark\] \.wb-note-surface,\s*\.theme-dark \.wb-note-surface\s*\{([^}]+)\}/)?.[1]??'';
 for(const theme of [light,dark]){
  assert.match(theme,/--crepe-color-selected:\s*#[0-9a-f]+/i,'Crepe selection must have a real background color');
  assert.match(theme,/--wb-note-selection-text:\s*#[0-9a-f]+/i,'selected text must stay readable');
 }
 assert.notEqual(light.match(/--crepe-color-selected:\s*([^;]+)/)?.[1],dark.match(/--crepe-color-selected:\s*([^;]+)/)?.[1]);
 assert.match(css,/ProseMirror:not\(\.ProseMirror-hideselection\) \*::selection/,'nested bold and link text need native selection painting');
});

test('Milkdown uses a selection toolbar and slash menu with a native caret, without a permanent top bar',async()=>{
 const dom=new JSDOM('<!doctype html><div id="note"></div><div id="source"></div>',{pretendToBeVisual:true});
 for(const key of ['window','document','navigator','HTMLElement','Element','SVGElement','Node','MutationObserver','CustomEvent'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
 for(const key of ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame','addEventListener','removeEventListener','dispatchEvent'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key].bind(dom.window),configurable:true});
 dom.window.Range.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,right:20,top:0,bottom:20,width:20,height:20,toJSON(){}} as DOMRect);
 dom.window.Range.prototype.getClientRects=()=>[] as any;
 dom.window.scrollBy=()=>{};
 const css=document.createElement('style');css.textContent=await noteUiStyles();document.head.append(css);
 const {createNoteSurface}=await import('../src/whiteboard/note-surface.js');
 let changes=0;const host=document.getElementById('note')!,surface=await createNoteSurface(host,'alpha beta',()=>changes++);
 let source:Awaited<ReturnType<typeof createNoteSurface>>|undefined;
 const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
 try{
  assert.ok(!host.querySelector('.milkdown-top-bar'),'narrow notes must not have a permanent formatting bar');
  assert.ok(!host.querySelector('.ProseMirror.virtual-cursor-enabled'),'native caret must remain visible');
  const editor=(surface as any).editor,view=editor.action((ctx:any)=>ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,1,6)));view.focus();await pause();
  const bold=host.querySelector('.milkdown-toolbar [data-note-command="bold"]')!.closest('button')!;
  assert.ok(['none','rgba(0, 0, 0, 0)'].includes(dom.window.getComputedStyle(bold.querySelector('svg')!).fill),'Lucide stroke icons must not inherit Crepe solid fills');
  bold.click();
  assert.match(surface.markdown(),/\*\*alpha\*\*/);assert.ok(changes>0);
  await pause();assert.equal(host.querySelector('.milkdown-toolbar')!.getAttribute('data-show'),'true');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,6)));view.focus();await pause();assert.equal(host.querySelectorAll('.milkdown-toolbar[data-show=true]').length,0,'caret editing must not display the selection toolbar');
  assert.ok(!host.querySelector('.wb-note-focus-toolbar'));
  view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,view.state.schema.nodes.paragraph.create()));view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,1)));view.focus();await pause();assert.equal(host.querySelectorAll('.milkdown-toolbar[data-show=true]').length,0,'empty notes must keep the selection toolbar hidden');
  view.dom.blur();await pause();assert.equal(host.querySelectorAll('.milkdown-toolbar[data-show=true]').length,0,'leaving the editor must hide formatting tools');
  view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,view.state.schema.nodes.paragraph.create(null,view.state.schema.text('/'))));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,2)));view.focus();await new Promise(resolve=>setTimeout(resolve,350));
  const menu=host.querySelector('.milkdown-slash-menu')!;assert.ok(menu);assert.equal(menu.getAttribute('data-show'),'true');
  const heading=[...menu.querySelectorAll<HTMLElement>('li[data-index]')].find(item=>item.textContent?.includes('标题 2'));assert.ok(heading);
  heading.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true,cancelable:true}));heading.dispatchEvent(new dom.window.MouseEvent('pointerup',{bubbles:true,cancelable:true}));await pause();
  assert.equal(view.state.doc.firstChild.type.name,'heading');assert.equal(view.state.doc.firstChild.attrs.level,2);
  source=await createNoteSurface(document.getElementById('source')!,'Evidence.',()=>{throw Error('Readonly source changed');},{},{readOnly:true});
  assert.equal(document.querySelector('#source [contenteditable]')?.getAttribute('contenteditable'),'false');
  assert.equal(document.querySelector('#source .milkdown-top-bar'),null);
 }finally{await surface.destroy();await source?.destroy();dom.window.close();}
});
