import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {installNoteDom,editMathSource} from './fixtures/note-dom.js';

test('production localized study cards load in English and Chinese, edit math and preserve source highlights',async t=>{
 const {uiLanguagePlugin}=await import('../scripts/ui-language.mjs' as string);
 const preview=resolve('.preview-data');await mkdir(preview,{recursive:true});const tmp=await mkdtemp(join(preview,'study-language-'));
 t.after(async()=>{assert.equal(resolve(tmp,'..'),preview);await rm(tmp,{recursive:true,force:true});});
 const file=join(tmp,'card.mjs');await build({entryPoints:['src/whiteboard/study-note-card.ts'],outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[uiLanguagePlugin()],logLevel:'silent'});
 const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true});installNoteDom(dom);
 try{const {studyNoteCard}=await import(pathToFileURL(file).href);
  for(const language of ['en','zh']){document.documentElement.dataset.uiLanguage=language;const saved:any[]=[],quote='Original **important** source with $y^2$.';
   const card=studyNoteCard({id:language,title:'User title',note:'## User analysis\n\n$x^2$',kind:'note',x:0,y:0,citations:[{sourceId:'pdf',start:0,end:quote.length,quote}],studyNote:{label:'User label',highlights:[{citation:0,text:'important'}]}},[{id:'pdf',name:'Paper.pdf'}],{save:async(value:any)=>{saved.push(value);},locate:async()=>{}});
   document.body.append(card);await card.ready;
   assert.equal(card.querySelector('input')!.hidden,true);assert.equal(card.querySelector('[data-action=close]')!.hidden,true);
   const upper=card.querySelector('.wb-study-upper [contenteditable=true]')!;assert.ok(upper.querySelector('h2'));assert.equal(card.querySelector('.wb-study-source-body mark')!.textContent,'important');assert.equal(card.querySelector('.wb-study-error'),null);
   await editMathSource(upper.querySelector('.wb-note-math') as HTMLElement,'x^3');await card.flush();assert.match(saved[0].markdown,/x\^3/);assert.equal(saved[0].title,'User title');assert.equal(card.querySelector('.wb-study-source-body annotation')!.textContent,'y^2');
   card.remove();await new Promise(resolve=>setImmediate(resolve));
  }
 }finally{dom.window.close();}
});
