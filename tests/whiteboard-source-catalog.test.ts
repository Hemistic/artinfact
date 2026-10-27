import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfSourceItems} from '../src/server/whiteboard-source-catalog.js';
test('PDF child items preserve document identity, table body, equation and separate annotation/insight cards',()=>{
 const doc={id:'paper',name:'Study.pdf',format:'pdf' as const,path:'D:/Study.pdf'};
 const items=pdfSourceItems(doc,[{id:'table',layoutKind:'table',layoutBlockIndices:[0],position:{pageIndex:2},text:'Table 1'},{id:'formula',layoutKind:'equation',comment:'E=mc^2'},{id:'highlight',text:'Selected evidence',comment:'My note'},{id:'insight',aiInsightKind:'innovation',comment:'A possible innovation'},{id:'figure',layoutKind:'figure'}],[{table_body:'| Metric | Value |\n|---|---|\n| Accuracy | 90% |'}]);
 assert.deepEqual(items.map(i=>i.category),['table','formula','annotation','insight','figure']);
 assert.equal(items[0].documentId,'paper');assert.equal(items[0].page,3);assert.match(items[0].text!,/Accuracy/);assert.match(items[1].text!,/E=mc/);assert.equal(new Set(items.map(i=>i.id)).size,5);
 assert.deepEqual(pdfSourceItems(doc,[{id:'table'}]).map(i=>i.id),[items[0].id]);
});
test('visual sources expose full captions separately from table HTML and summaries',()=>{
 const caption='Table 1. '+('Detailed experimental conditions. '.repeat(20));
 const items=pdfSourceItems({id:'doc',name:'Paper.pdf',format:'pdf',path:'paper.pdf'},[
  {id:'t',layoutKind:'table',layoutBlockIndices:[0],text:'Table 1'},
  {id:'f',layoutKind:'figure',layoutBlockIndices:[1],text:'Figure 2'},
 ],[{table_body:'<table><tr><td>Values</td></tr></table>',table_caption:[caption]},{image_caption:['Figure 2. Full diagram caption.']}]);
 assert.equal(items[0].caption,caption);assert.equal(items[1].caption,'Figure 2. Full diagram caption.');
 assert.match(items[0].text!,/<table>/);
});
