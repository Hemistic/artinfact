import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installNoteDom,editMathSource} from './fixtures/note-dom.js';

test('reader note saves do not remount Milkdown, reset the caret surface or overwrite newer typing',async()=>{
 const dom=new JSDOM('<!doctype html><div id="reader"></div>',{pretendToBeVisual:true});
 installNoteDom(dom);
 for(const key of ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame','addEventListener','removeEventListener','dispatchEvent'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key].bind(dom.window),configurable:true});
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const react=await import('react'),{createRoot}=await import('react-dom/client'),{installReaderWorkspace}=await import('../src/ui/reader-workspace.js');
 const calls:any[]=[],win=dom.window as any,workspace=installReaderWorkspace(win,(_type,payload)=>calls.push(payload));
 const snapshot={name:'Research',active:'pdf',openIds:['pdf'],documents:[],busy:false,activeNote:{nodeId:'note',title:'Note',markdown:'$a+b$',revision:'r1'}};
 workspace.update(snapshot);const root=createRoot(document.getElementById('reader')!);
 try{
  await react.act(async()=>root.render(win.__codexPdfPanel(react,{view:'pdfs'})));
  for(let i=0;i<60&&!document.querySelector('.wb-note-math');i++)await react.act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  const surface=document.querySelector('[contenteditable=true]')!,formula=document.querySelector<HTMLElement>('.wb-note-math')!;assert.ok(surface);assert.ok(formula);assert.equal(document.querySelectorAll('textarea').length,0);
  await react.act(async()=>editMathSource(formula,'x^2'));
  assert.equal(calls.at(-1).action,'note-dirty');assert.equal(calls.at(-1).markdown,undefined);const first=workspace.flush()!;assert.match(first.markdown,/x\^2/);assert.equal(first.revision,'r1');
  await react.act(async()=>workspace.update({...snapshot,noteSaveStatus:'saving',activeNote:{...snapshot.activeNote,markdown:'$a+b$',revision:'r2'}}));
  assert.equal(document.querySelector('[contenteditable=true]'),surface);assert.equal(formula.querySelector('.wb-note-math-source')!.textContent,'x^2');assert.equal(formula.querySelector('input'),null);
  await react.act(async()=>editMathSource(formula,'y^2'));
  const latest=workspace.flush()!;assert.match(latest.markdown,/y\^2/);assert.equal(latest.revision,'r2');assert.equal(workspace.flush(),undefined);
  await react.act(async()=>workspace.update({...snapshot,activeNote:{nodeId:'second',title:'Second',markdown:'Second note',revision:'s1'}}));
  for(let i=0;i<60&&!document.querySelector('.ProseMirror')?.textContent?.includes('Second');i++)await react.act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  assert.notEqual(document.querySelector('[contenteditable=true]'),surface);assert.match(document.querySelector('.ProseMirror')!.textContent!,/Second note/);
 }finally{await react.act(async()=>root.unmount());dom.window.close();}
});
