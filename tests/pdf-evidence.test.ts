import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidenceCandidates, evidenceLink, mineruEvidenceBlocks, type EvidenceDocument} from '../src/shared/pdf-evidence.ts';

const quote='Retrieval improves factual accuracy.';
const docs:EvidenceDocument[]=[{documentId:'a'.repeat(64),title:'Paper A',jsonHash:'1',markdown:quote,blocks:[{id:'b-0',pageIndex:2,text:'Introduction. '+quote+' Another sentence.',bbox:[10,10,900,200]}]}];
test('quoted node evidence takes precedence over longer background paragraphs and requires JSON blocks',()=>{
 assert.equal(evidenceCandidates('> '+quote+'\n\nIntroduction. '+quote+' Another sentence.',docs).length,1);
 assert.equal(evidenceCandidates('> '+quote,[{...docs[0],blocks:[]}]).length,0);
 assert.equal(evidenceCandidates('> An unmatched explicit quote.\n\n'+quote,docs).length,0,'Never jump to a different background sentence');
});
test('standard JSON table excerpts and inline HTML styling preserve the exact original quote',()=>{
 const full='Removing ISSUP hurts performance.';
 const blocks=mineruEvidenceBlocks([{type:'table',page_idx:3,bbox:[10,10,900,200],table_body:'<table><tr><td>'+full+'</td></tr></table>'}]);
 const source={...docs[0],markdown:'Removing <strong><u>ISSUP</u></strong> hurts performance.',blocks};
 const choices=evidenceCandidates('> '+full,[source]);assert.equal(choices.length,1);assert.equal(choices[0].blockId,'b-0');assert.equal(choices[0].pageIndex,3);assert.equal(choices[0].quote,full);
});
test('graph evidence keeps the exact sentence, document, JSON block and PDF page',()=>{
 const result=evidenceCandidates('> '+quote,docs);
 assert.equal(result.length,1);assert.equal(result[0].quote,quote);assert.equal(result[0].pageIndex,2);assert.equal(result[0].blockId,'b-0');
 assert.equal(evidenceCandidates('> Retrieval does not improve factual accuracy.',docs).length,0);
});
test('explicit graph anchors disambiguate papers and reject wrong block or fabricated quote',()=>{
 const both=[...docs,{...docs[0],documentId:'b'.repeat(64),title:'Paper B'}];
 assert.equal(evidenceCandidates('> '+quote,both).length,2);
 assert.equal(evidenceCandidates(evidenceLink(docs[0].documentId,'b-0',quote),both).length,1);
 assert.equal(evidenceCandidates(evidenceLink(docs[0].documentId,'b-9',quote),both).length,0);
 assert.equal(evidenceCandidates(evidenceLink(docs[0].documentId,'b-0','A fabricated statement.'),both).length,0);
});
test('only actual Markdown and JSON evidence match; normalize wraps, avoid partial-prefix and generic word matches',()=>{
 assert.equal(evidenceCandidates('> Retrieval improves\n> factual accuracy.',docs).length,1);
 assert.equal(evidenceCandidates('> '+quote,[{...docs[0],markdown:'Different source.'}]).length,0);
 assert.equal(evidenceCandidates('> '+quote+' Fabricated ending.',docs).length,0);
 assert.equal(evidenceCandidates('# Retrieval\nA translated abstract with no verbatim quote.',docs).length,0);
});
test('parentheses in a complete sentence never truncate the PDF evidence quote',()=>{
 const full='Large language models (LLMs) use evidence (including nested (PDF) citations) to answer.';
 const source={...docs[0],markdown:full,blocks:[{...docs[0].blocks[0],text:full}]};
 assert.equal(evidenceCandidates(evidenceLink(source.documentId,'b-0',full),[source])[0]?.quote,full);
 const older=`[PDF 原句](artinfact-pdf://${source.documentId}/b-0?quote=${encodeURIComponent(full)})`;
 assert.equal(evidenceCandidates(older,[source])[0]?.quote,full);
 assert.equal(evidenceCandidates(`[PDF 原句](artinfact-pdf://${source.documentId}/b-0?quote=%ZZ)\n\n> ${full}`,[source]).length,0);
});
