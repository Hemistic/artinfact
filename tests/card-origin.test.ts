import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {cardOrigin,originElements} from '../src/whiteboard/card-origin.js';
import type {BoardNode} from '../src/whiteboard/whiteboard-domain.js';
const note:BoardNode={id:'note',title:'Note',note:'Body',kind:'note',role:'note',x:0,y:0};
test('board Markdown notes and cloud Pages have different explicit labels',()=>{
 assert.equal(cardOrigin(note,[]).label,'Markdown 笔记');
 const page={title:'Cloud note'};
 const local=cardOrigin(note,[],page);assert.equal(local.label,'Markdown 笔记');assert.equal(local.linkedPages,true);assert.match(local.hint,/保存在当前白板.*Cloud note/);
 const cloud=cardOrigin({...note,role:'source',sourceId:'pages-card:cloud'},[],page);assert.equal(cloud.label,'Pages');assert.equal(cloud.linkedPages,false);assert.match(cloud.hint,/Cloud note/);
 const unlinked=cardOrigin({...note,role:'source',sourceId:'md:local.md'},[{id:'md:local.md',name:'local.md',format:'md',category:'pages'}]);assert.equal(unlinked.label,'Markdown 笔记');
});
test('figures, tables, formulas, annotations and insights preserve PDF identity and page',()=>{
 const doc={id:'pdf',name:'Self-RAG.pdf',category:'document',format:'pdf'};
 for(const [category,label]of [['figure','图片'],['table','表格'],['formula','公式'],['annotation','批注'],['insight','洞察']]){
  const origin=cardOrigin({...note,kind:category==='table'?'image':'note',sourceId:'region'},[doc,{id:'region',name:'Long extracted heading',category,documentId:'pdf',page:5}]);
  assert.equal(origin.label,label);assert.equal(origin.hint,'来源：Self-RAG.pdf · 第 5 页');
 }
});
test('evidence can credit multiple papers and does not expose unknown IDs as invented sources',()=>{
 const evidence={...note,kind:'evidence' as const,citations:[{sourceId:'one',start:0,end:1,quote:'A'},{sourceId:'two',start:0,end:1,quote:'B'}]};
 assert.equal(cardOrigin(evidence,[{id:'one',name:'A.pdf'},{id:'two',name:'B.pdf'}]).hint,'来源：A.pdf、B.pdf');
 assert.match(cardOrigin({...evidence,citations:[{sourceId:'unknown-hash',start:0,end:1,quote:'A'}]},[]).hint,/来源尚未关联/);
});
test('generated Pages and image nodes do not imply a completed output before one exists',()=>{
 const pending=cardOrigin({...note,workflow:{type:'pages',prompt:''}},[]);assert.equal(pending.label,'Pages 输出');assert.match(pending.hint,/待生成/);
 assert.equal(cardOrigin({...note,kind:'image'},[]).label,'图片');
 assert.equal(cardOrigin({...note,presentation:{type:'formula',latex:'x',explanation:'',symbols:[]}},[]).label,'公式');
});
test('origin badges and the bottom hint treat source names as text',()=>{
 const dom=new JSDOM('<article></article>'),origin=cardOrigin(note,[],{title:'<img src=x onerror=alert(1)>'}),parts=originElements(dom.window.document,origin);
 const card=dom.window.document.querySelector('article')!;card.append(parts.header,parts.footer);assert.equal(card.querySelector('img'),null);assert.equal(parts.header.textContent,'Markdown 笔记Pages');assert.equal(parts.footer.tagName,'SMALL');assert.equal(parts.footer.title,origin.hint);dom.window.close();
});
