import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installReaderToolbar} from '../src/ui/reader-toolbar.ts';
import {createPdfEvidenceNavigation} from '../src/ui/pdf-evidence.ts';

test('reader Back returns to graph only while an evidence return is available; ordinary PDF history remains native',()=>{
 const messages:string[]=[],target:any={};installReaderToolbar(target,(type)=>messages.push(type));
 let native=0;const click=target.__codexBackAction(()=>native++);
 assert.equal(target.__codexBackEnabled(false),false);click();assert.equal(native,1);
 target.__codexGraphReturn=true;assert.equal(target.__codexBackEnabled(false),true);click();assert.deepEqual(messages,['codex-reader:graph-back']);assert.equal(native,1);
 target.__codexGraphReturn=false;click();assert.equal(native,2);
});

test('evidence navigation preserves graph during open, returns after saving and recovers on open failure',async()=>{
 const events:string[]=[],evidence={documentId:'a'.repeat(64),title:'Paper',pageIndex:0,quote:'Verbatim quote.',blockId:'b-0',jsonHash:'b'.repeat(64)};
 let fail=false,nav:ReturnType<typeof createPdfEvidenceNavigation>;
 nav=createPdfEvidenceNavigation({} as HTMLElement,{
  call:async(name)=>({structuredContent:{research:name==='pdf_source_locations'?{locations:[evidence]}:{...evidence,position:{pageIndex:0,rects:[[1,2,3,4]]}}}}),
  open:async()=>{assert.equal(nav.preserving,true);events.push('open');if(fail)throw Error('Open failed');},
  navigate:async()=>{events.push('highlight');},notice:()=>{},returnAvailable:available=>events.push('back:'+available),
 });
 const before=async()=>{events.push('park');return async()=>{assert.equal(nav.preserving,true);events.push('restore');};};
 await nav.show('ws',{nodePath:'wiki/test.md'},before);assert.equal(nav.preserving,false);
 await nav.back();assert.ok(events.indexOf('highlight')<events.indexOf('restore'));assert.equal(events.at(-1),'back:false');
 const restored=events.filter(e=>e==='restore').length;await nav.back();assert.equal(events.filter(e=>e==='restore').length,restored);
 fail=true;await assert.rejects(nav.show('ws',{nodePath:'wiki/test.md'},before),/Open failed/);assert.equal(events.filter(e=>e==='restore').length,restored+1);assert.equal(nav.preserving,false);
});
