import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {installNoteDom} from './fixtures/note-dom.js';import {commandsCtx,editorViewCtx} from '@milkdown/core';import {TextSelection} from '@milkdown/prose/state';import {diffPluginKey,acceptAllDiffsCmd} from '@milkdown/plugin-diff';
test('Milkdown shows seven selection tools and reviews Agent output before autosaving the accepted rewrite',async()=>{
 const dom=new JSDOM('<!doctype html><div id="note"></div>',{pretendToBeVisual:true});installNoteDom(dom);const {runAICmd}=await import('@milkdown/crepe/feature/ai');const {createNoteSurface}=await import('../src/whiteboard/note-surface.js');let changes=0,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),surface=await createNoteSurface(document.getElementById('note')!,'Original tail',()=>changes++,{},{aiProvider:async function*(context){assert.equal(context.selection.trim(),'Original');await gate;yield 'Revised';}}),view=surface.editor.action(ctx=>ctx.get(editorViewCtx));
 const wait=async(check:()=>boolean)=>{for(let i=0;i<160;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('AI editor timed out');};
 try{view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,1,9)));view.focus();await wait(()=>document.querySelector('.milkdown-toolbar')?.getAttribute('data-show')==='true');
  assert.equal(document.querySelectorAll('.milkdown-toolbar button').length,7);assert.ok(document.querySelector('.milkdown-toolbar [aria-label="AI 改写"]'));assert.ok(!document.querySelector('.milkdown-top-bar'));
  document.querySelector<HTMLButtonElement>('.milkdown-toolbar [aria-label="AI 改写"]')!.click();await wait(()=>document.querySelector('.milkdown-ai-instruction')?.getAttribute('data-show')==='true');assert.match(document.querySelector('.milkdown-ai-instruction')!.textContent!,/学术润色/);
  assert.ok(surface.editor.action(ctx=>ctx.get(commandsCtx).call(runAICmd.key,{instruction:'改写'})));assert.match(surface.markdown(),/Original tail/);release();await wait(()=>!!diffPluginKey.getState(view.state)?.active);
  assert.equal(changes,0,'pending AI output must not trigger note autosave');assert.match(surface.markdown(),/Original tail/);
  surface.editor.action(ctx=>ctx.get(commandsCtx).call(acceptAllDiffsCmd.key));await wait(()=>!diffPluginKey.getState(view.state)?.active&&changes>0);assert.match(surface.markdown(),/Revised.*tail/);assert.ok(changes>0);
 }finally{await surface.destroy();dom.window.close();}
});
