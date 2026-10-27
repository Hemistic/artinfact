import test from 'node:test';import assert from 'node:assert/strict';
import {pdfReferenceSources} from '../src/server/pdf-bibliography.js';
import {sourceTree} from '../src/whiteboard/source-tree.js';
const doc={id:'a'.repeat(64),name:'Paper.pdf',format:'pdf' as const,path:'paper.pdf',standard:true};
const block=(text:string,page_idx:number,type='text')=>({text,page_idx,type,bbox:[10,20,900,100]});
test('numbered bibliography assets preserve MD ranges, JSON positions, and each separate citation occurrence',()=>{
 const text='# Method\n\nWe compare the method [1, 2].\n\nAnother result follows [1].\n\n# References\n\n[1] Smith, J. 2020. First paper.\n\n[2] Jones, A. 2021. Second paper.\n\n# Appendix\n\nNot a reference.';
 const blocks=[block('Method',0),block('We compare the method [1, 2].',0),block('Another result follows [1].',1),block('References',2),block('[1] Smith, J. 2020. First paper.',2,'ref_text'),block('[2] Jones, A. 2021. Second paper.',2,'ref_text')];
 const sources=pdfReferenceSources({...doc,text},blocks);assert.equal(sources.length,2);
 const ref=sources[0].bibliography!;assert.equal(ref.number,'1');assert.equal(ref.entry.pageIndex,2);assert.equal(ref.occurrences.length,2);assert.equal(ref.occurrences[1].pageIndex,1);
 for(const location of [ref.entry,...ref.occurrences]){assert.equal(text.slice(location.start!,location.end),location.quote);assert.ok(location.blockIds.length);}
 const tree=sourceTree([{...doc,ready:true,category:'document'},...sources.map(s=>({...s,ready:true}))]);assert.equal(tree[0].folders.find(f=>f.id==='reference')?.items.length,2);
 assert.equal(pdfReferenceSources({...doc,text},blocks)[0].id,sources[0].id);
});
test('author-year references link exact citation styles, while same-author same-year matches remain ambiguous',()=>{
 const raw='Akari Asai, Zeqiu Wu. 2023. First work.',other='Akari Asai, Alex Doe. 2023. Another work.';
 const text='# Study\n\nThe approach uses reflection (Asai et al., 2023).\n\n# References\n\n'+raw+'\n\n'+other;
 const sources=pdfReferenceSources({...doc,text},[block('The approach uses reflection (Asai et al., 2023).',0),block('References',1),block(raw,1,'reference'),block(other,1,'reference')]);
 assert.equal(sources.length,2);for(const source of sources){assert.equal(source.bibliography!.occurrences[0].match,'ambiguous');assert.equal(source.bibliography!.occurrences[0].candidateCount,2);}
 const unique=pdfReferenceSources({...doc,text:text.replace('\n\n'+other,'')},[block('The approach uses reflection (Asai et al., 2023).',0),block('References',1),block(raw,1,'reference')]);
 assert.equal(unique[0].bibliography!.occurrences[0].match,'matched');
});
test('unmapped reference entries stay available without fabricated PDF locations or ordinary numbered lists',()=>{
 const text='# Steps\n\n[1] First step.\n\n# References\n\n[1] Smith, J. 2020. Actual work.';
 const sources=pdfReferenceSources({...doc,text},[block('First step.',0)]);assert.equal(sources.length,1);assert.equal(sources[0].bibliography!.entry.pageIndex,undefined);assert.deepEqual(sources[0].bibliography!.entry.blockIds,[]);
 assert.equal(pdfReferenceSources({...doc,text:'# Tasks\n\n[1] Do something'},[block('[1] Do something',0)]).length,0);
});
test('real MinerU Markdown links align with JSON plain text without using Markdown syntax as the PDF quote',()=>{
 const raw='Akari Asai, Zeqiu Wu. 2024. [Self-RAG: Learning to retrieve](https://openreview.net/forum?id=paper). ICLR 2024.';
 const text='# Study\n\nWe use the method (Asai et al., 2024).\n\n# References\n\n'+raw;
 const sources=pdfReferenceSources({...doc,text},[block('We use the method (Asai et al., 2024).',0),block(raw.replace('[Self-RAG: Learning to retrieve](https://openreview.net/forum?id=paper)','Self-RAG: Learning to retrieve'),1,'ref_text')]);
 assert.equal(sources[0].bibliography!.entry.match,'matched');const entry=sources[0].bibliography!.entry;assert.equal(text.slice(entry.start!,entry.end),entry.quote);assert.ok(!entry.quote.includes(']('));assert.equal(sources[0].bibliography!.url,'https://openreview.net/forum?id=paper');
});
test('the bibliography entry cannot bind to identical wording in a body paragraph',()=>{
 const raw='Smith 2020 Research';const sources=pdfReferenceSources({...doc,text:'# Text\n\n'+raw+'\n\n# References\n\n'+raw},[block(raw,0),block(raw,1,'ref_text')]);assert.deepEqual(sources[0].bibliography!.entry.blockIds,['b-1']);
});
test('reference display titles contain readable link labels rather than raw Markdown URLs',()=>{
 const raw='Akari Asai. 2024. [Self-RAG: Learning to retrieve](https://example.com/paper).';const source=pdfReferenceSources({...doc,text:'# References\n\n'+raw},[block('Akari Asai. 2024. Self-RAG: Learning to retrieve.',0,'ref_text')])[0];assert.equal(source.name,'Self-RAG: Learning to retrieve');assert.equal(source.bibliography!.raw,raw);
});
test('citation location selects its actual sentence while retaining the whole paragraph as reading context',()=>{
 const paragraph='Earlier methods require retrieval. Self-RAG (Asai et al., 2024) selectively retrieves knowledge. Other methods compare different conditions.';
 const raw='Akari Asai, Zeqiu Wu. 2024. Actual work.';const text='# Methods\n\n'+paragraph+'\n\n# References\n\n'+raw;
 const reference=pdfReferenceSources({...doc,text},[block(paragraph,0),block(raw,1,'ref_text')])[0].bibliography!;assert.equal(reference.occurrences[0].quote,'Self-RAG (Asai et al., 2024) selectively retrieves knowledge.');assert.equal(reference.occurrences[0].context,paragraph);assert.equal(text.slice(reference.occurrences[0].start!,reference.occurrences[0].end),reference.occurrences[0].quote);
});

test('a partial JSON match without the actual citation cannot become the citation location',()=>{
 const paragraph='**Advanced RAG.** (1) Other work. (2) Self-RAG (Asai et al., 2024) uses reflection tokens.';
 const raw='Akari Asai. 2024. Actual work.';const text='# Methods\n\n'+paragraph+'\n\n# References\n\n'+raw;
 const reference=pdfReferenceSources({...doc,text},[block('Advanced RAG.',0),block(raw,1,'ref_text')])[0].bibliography!;
 assert.equal(reference.occurrences.length,1);assert.equal(reference.occurrences[0].match,'unlocated');assert.equal(reference.occurrences[0].quote,'');assert.deepEqual(reference.occurrences[0].blockIds,[]);assert.equal(reference.occurrences[0].pageIndex,undefined);assert.equal(reference.occurrences[0].context,paragraph);
});
