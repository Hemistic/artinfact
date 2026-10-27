import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {JSDOM} from 'jsdom';

const source=await readFile('src/whiteboard/note-editor.ts','utf8');
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const wait=()=>new Promise(resolve=>setTimeout(resolve,45));
async function mount(save:(value:any)=>Promise<void>,close=()=>{}){
 const dom=new JSDOM('<!doctype html><body></body>'),edits:((text:string)=>void)[]=[];
 const code=ts.transpileModule(source.replace(/^import[^\n]+\n/gm,'').replace('export function','function')+'\nnoteEditor;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const factory=runInNewContext(code,{document:dom.window.document,MutationObserver:dom.window.MutationObserver,setTimeout,clearTimeout,createNoteSurface:async(host:HTMLElement,initial:string,onChange:(text:string)=>void)=>{let text=initial;host.setAttribute('contenteditable','true');edits.push(value=>{text=value;onChange(value);});return {markdown:()=>text,destroy:async()=>{}};}});
 const editor=factory({title:'Note',markdown:'Original'},save,close,{autoSaveMs:20});dom.window.document.body.append(editor);await tick();
 return {dom,editor,edit:edits[0],dispose(){editor.remove();dom.window.close();}};
}
test('opening a note provides one live editor and saves typing without a save click',async()=>{
 const writes:any[]=[],view=await mount(async value=>{writes.push(value);});
 try{assert.equal(view.editor.querySelectorAll('[contenteditable=true]').length,1);view.edit('**Live** $x^2$');await wait();assert.equal(writes.length,1);assert.equal(writes[0].markdown,'**Live** $x^2$');assert.equal(view.editor.isDirty(),false);assert.match(view.editor.textContent,/已保存/);}finally{view.dispose();}
});
test('typing remains enabled while saving and flush includes newer edits',async()=>{
 let release!:()=>void;const writes:any[]=[],view=await mount(async value=>{writes.push(value);if(writes.length===1)await new Promise<void>(resolve=>release=resolve);});
 try{view.edit('First');const flushing=view.editor.flush();await tick();assert.ok(!view.editor.inert);view.edit('Latest');release();await flushing;assert.deepEqual(writes.map(v=>v.markdown),['First','Latest']);assert.equal(view.editor.isDirty(),false);}finally{view.dispose();}
});
test('failed automatic saving retains the draft and close waits for a successful retry',async()=>{
 let fail=true,closed=false;const writes:any[]=[],view=await mount(async value=>{if(fail)throw Error('offline');writes.push(value);},()=>closed=true);
 try{view.edit('Keep me');await wait();assert.equal(view.editor.isDirty(),true);assert.match(view.editor.textContent,/尚未保存/);const close=view.editor.querySelector('[data-action=close]') as HTMLButtonElement;assert.ok(close);close.click();await tick();assert.equal(closed,false);fail=false;close.click();await wait();assert.equal(closed,true);assert.equal(writes[0].markdown,'Keep me');}finally{view.dispose();}
});
