import test from 'node:test';
import assert from 'node:assert/strict';
import {findCitationRects,referenceActionPrompt} from '../src/shared/pdf-citations.js';
import {pdfReferenceSources} from '../src/server/pdf-bibliography.js';
const chars=(text:string,y=100)=>[...text].map((c,i)=>({c,rect:[i*5,y,i*5+5,y+10],inlineRect:[i*5,y,i*5+5,y+10],lineBreakAfter:i===text.length-1}));
test('citation rectangles support short numbered markers and author-year text without highlighting an equation number',()=>{
 const data=[...chars('We use [1, 2] as evidence.'),...chars('Equation [1, 2] is unrelated.',50)];
 assert.deepEqual(findCitationRects(data,'[1, 2]',[0,90,180,120]),[[35,100,65,110]]);
 assert.deepEqual(findCitationRects(chars('Smith et al., 2024'), 'Smith et al., 2024'), [[0,100,90,110]]);
 assert.deepEqual(findCitationRects(data,'[1, 2]'),[]);
 assert.deepEqual(findCitationRects(chars('[12]'),'[1]'),[]);
});
test('reference parsing retains each literal marker and exact Markdown offset, including grouped references',()=>{
 const paragraph='We compare [1, 2]. Smith et al. (2024) describe another approach.';
 const raw='John Smith, Jane Doe. 2024. Study.';
 const text='# Text\n\n'+paragraph+'\n\n# References\n\n[1] '+raw+'\n\n[2] John Jones, Jane Wu. 2023. Other work.';
 const source=pdfReferenceSources({id:'a'.repeat(64),name:'Paper',format:'pdf',path:'paper.pdf',text,standard:true},[{type:'text',text:paragraph,page_idx:0,bbox:[0,0,900,900]},{type:'ref_text',text:'[1] '+raw,page_idx:1,bbox:[0,0,900,900]},{type:'ref_text',text:'[2] John Jones, Jane Wu. 2023. Other work.',page_idx:1,bbox:[0,0,900,900]}])[0];
 assert.equal(source.bibliography!.occurrences.length,2);
 for(const occurrence of source.bibliography!.occurrences){const marker=occurrence.marker!;assert.equal(text.slice(marker.start,marker.end),marker.text);}
 assert.equal(source.bibliography!.occurrences[0].marker!.text,'[1, 2]');
 assert.equal(source.bibliography!.occurrences[1].marker!.text,'Smith et al. (2024)');
});
test('fixed prompts summarize the cited paper itself and return a PDF sidebar annotation through MCP',()=>{
 const prompt=referenceActionPrompt({workspaceId:'ws',documentId:'d',id:'task',action:'summarize'});
 assert.match(prompt,/被引论文/);assert.match(prompt,/pdf_reference_action_read/);assert.match(prompt,/pdf_reference_paper_read/);assert.match(prompt,/pdf_reference_action_complete/);assert.match(prompt,/批注/);assert.match(prompt,/不是.*引用.*观点/);
 const download=referenceActionPrompt({workspaceId:'ws',documentId:'d',id:'task',action:'download'});assert.match(download,/pdf_reference_paper_prepare/);assert.match(download,/workspace/);assert.match(download,/作者/);
});
test('double-bracket reference ranges bind every article in the range to one literal marker',()=>{
 const paragraph='We compare the methods [1]–[3].';const rows=['[1] John Smith, Jane Doe. 2024. First paper.','[2] John Jones, Jane Wu. 2023. Second paper.','[3] John Lee, Jane Chen. 2022. Third paper.'];
 const text='# Study\n\n'+paragraph+'\n\n# References\n\n'+rows.join('\n\n'),sources=pdfReferenceSources({id:'b'.repeat(64),name:'Paper',format:'pdf',path:'paper.pdf',text,standard:true},[{type:'text',text:paragraph,page_idx:0,bbox:[0,0,900,900]},...rows.map(text=>({type:'ref_text',text,page_idx:1,bbox:[0,0,900,900]}))]);assert.equal(sources.length,3);for(const source of sources){assert.equal(source.bibliography!.occurrences.length,1);assert.equal(source.bibliography!.occurrences[0].marker!.text,'[1]–[3]');}
});
