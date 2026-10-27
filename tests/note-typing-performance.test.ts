import {installNoteDom} from './fixtures/note-dom.js';
import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {editorViewCtx} from '@milkdown/core';
test('a 100 KB note renders 50 successive edits without serializing the whole Markdown during input',async t=>{
 const dom=new JSDOM('<!doctype html><div id="note"></div>',{pretendToBeVisual:true});installNoteDom(dom);
 const {Editor}=await import('@milkdown/core'),{createNoteSurface}=await import('../src/whiteboard/note-surface.js'),prototype=Editor.prototype as any,action=prototype.action;let conversions=0,changes=0;prototype.action=function(...args:any[]){conversions++;return action.apply(this,args);};
 const markdown='$x$\n\n'+Array.from({length:100},(_,i)=>'Paragraph '+i+' '+'content '.repeat(130)).join('\n\n'),surface=await createNoteSurface(document.getElementById('note')!,markdown,()=>{changes++;});
 try{const view=surface.editor.action(ctx=>ctx.get(editorViewCtx));conversions=0;const formula=document.querySelector<HTMLElement>('.wb-note-math')!;formula.click();const start=performance.now();for(let i=0;i<50;i++){const from=view.state.selection.$from.start();view.dispatch(view.state.tr.insertText('x_'+i,from,from+view.state.selection.$from.parent.content.size));}const elapsed=performance.now()-start;assert.equal(conversions,0);assert.equal(changes,50);assert.match(surface.markdown(),/x_49/);t.diagnostic(JSON.stringify({characters:markdown.length,edits:50,wholeDocumentConversionsDuringInput:0,inputMs:Math.round(elapsed)}));}
 finally{prototype.action=action;await surface.destroy();dom.window.close();}
});
