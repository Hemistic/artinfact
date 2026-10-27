import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectorHeadingHtml,inspectorRelationHtml} from '../src/whiteboard/inspector-content.js';
import type {BoardNode} from '../src/whiteboard/whiteboard-domain.js';
const formula:BoardNode={id:'formula',kind:'note',title:'Self-RAG.pdf · 公式 第 5 页 · \\max_{x}...',note:'',x:0,y:0,presentation:{type:'formula',latex:'E=mc^2',explanation:'能量关系',symbols:[]}};
test('related formula uses complete structured LaTeX instead of its truncated title',()=>{
 const html=inspectorRelationHtml(formula,'关联');
 assert.match(html,/katex-display/);assert.match(html,/<annotation encoding="application\/x-tex">E=mc\^2<\/annotation>/);
 assert.ok(!html.includes('\\max'));assert.ok(html.includes('第 5 页'));assert.ok(html.includes('关联'));
});
test('headings and ordinary relations render inline math without introducing interactive resources',()=>{
 const note={...formula,presentation:undefined,title:'**笔记** $E=mc^2$ [链接](https://example.com) <img src=x onerror=alert(1)>'};
 for(const html of [inspectorHeadingHtml(note),inspectorRelationHtml(note,'**对比**')]){
  assert.match(html,/class="katex"/);assert.match(html,/<strong>笔记<\/strong>/);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<a '));
 }
});
test('a formula from source metadata renders when presentation is not yet provided',()=>{
 const html=inspectorRelationHtml({...formula,presentation:undefined},'解释',false,{category:'formula',latex:'\\frac{a}{b}'});
 assert.match(html,/katex-display/);assert.ok(!html.includes('\\max'));assert.match(html,/application\/x-tex/);
});
