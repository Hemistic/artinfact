import {installNoteDom,editMathSource} from './fixtures/note-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import type {BoardNode} from '../src/whiteboard/whiteboard-domain.js';
import {readFile} from 'node:fs/promises';
test('a study card edits the upper note, preserves highlighted source through folding, and locates only on its source link',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true});
 installNoteDom(dom);
 
 const {studyNoteCard}=await import('../src/whiteboard/study-note-card.js');
 const quote='Original **important** evidence with $y^2$.';
 const node:BoardNode={id:'n',title:'我的研读',note:'## 核心观点\n\n解释 **重点** 与 $x^2$。',kind:'note',role:'note',x:0,y:0,citations:[{sourceId:'pdf',start:0,end:quote.length,quote}],studyNote:{label:'研读',highlights:[{citation:0,text:'important'}]}};
 let located=0;const saves:{title:string;markdown:string}[]=[],folds:boolean[]=[];
 const card=studyNoteCard(node,[{id:'pdf',name:'Self-RAG.pdf'}],{save:async value=>{saves.push(value);},locate:async()=>{located++;},fold:value=>folds.push(value)});
 dom.window.document.body.append(card);await card.ready;
 try{
  const upper=card.querySelector('.wb-study-upper [contenteditable=true]')!;
  assert.ok(upper.querySelector('h2'));assert.ok(upper.querySelector('strong'));
  const source=card.querySelector('.wb-study-source-body .ProseMirror')!;
  const style=document.createElement('style');style.textContent=(await readFile('src/whiteboard/study-note-styles.css.html','utf8')).replace(/<\/?style>/g,'');document.head.append(style);
  assert.equal(parseFloat(getComputedStyle(source).minHeight),0,'short PDF evidence must not inherit the editor minimum height');
  assert.equal(source.getAttribute('contenteditable'),'false');assert.equal(source.querySelector('mark')?.textContent,'important');
  upper.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));assert.equal(located,0);
  await editMathSource(upper.querySelector('.wb-note-math') as HTMLElement,'x^3');await card.flush();
  assert.equal(saves.length,1);assert.match(saves[0].markdown,/x\^3/);assert.equal(source.querySelector('annotation')?.textContent,'y^2');assert.ok(source.textContent?.startsWith('Original important evidence with '));
  const details=card.querySelector('details')!;details.open=false;details.dispatchEvent(new dom.window.Event('toggle'));details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));
  assert.equal(card.querySelector('.wb-study-source-body .ProseMirror'),source);assert.deepEqual(folds.slice(-2),[false,true]);
  (card.querySelector('.wb-study-locate') as HTMLElement).click();await new Promise(resolve=>setImmediate(resolve));assert.equal(located,1);
  assert.equal(node.citations![0].quote,quote);
 }finally{card.remove();await new Promise(resolve=>setImmediate(resolve));dom.window.close();}
});

test('each paragraph of multi-source evidence has its own unambiguous PDF link',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true});installNoteDom(dom);
 const {studyNoteCard}=await import('../src/whiteboard/study-note-card.js');const chosen:number[]=[];
 const card=studyNoteCard({id:'multi',title:'Compare',note:'Analysis',kind:'note',x:0,y:0,citations:[{sourceId:'a',start:0,end:14,quote:'First evidence'},{sourceId:'b',start:0,end:15,quote:'Second evidence'}],studyNote:{label:'证据',highlights:[]}},[{id:'a',name:'A.pdf'},{id:'b',name:'B.pdf'}],{save:async()=>{},locate:async index=>{chosen.push(index);}},{readOnly:true});
 document.body.append(card);await card.ready;
 try{const links=[...card.querySelectorAll<HTMLAnchorElement>('.wb-study-excerpt .wb-study-locate')];assert.equal(links.length,2);assert.equal(card.querySelector('.wb-study-footer .wb-study-locate'),null);links[1].click();await new Promise(resolve=>setImmediate(resolve));links[0].click();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(chosen,[1,0]);}
 finally{card.remove();await new Promise(resolve=>setImmediate(resolve));dom.window.close();}
});
