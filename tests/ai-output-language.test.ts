import test from'node:test';import assert from'node:assert/strict';
import{aiOutputPolicy,withAiOutputLanguage,withAiLanguageResult}from'../src/shared/ai-output-language.js';
import{fullReadingNote}from'../src/shared/reference-reading.js';
test('AI output language is explicit, keeps source quotes and allows requested translation targets to override the default',()=>{
 const source='请阅读论文。原文 JSON: {"text":"原文必须保留"}';const prompt=withAiOutputLanguage(source,'en');assert.ok(prompt.includes(source));assert.match(prompt,/outputLanguage=en/);assert.match(prompt,/explicit translation target/i);assert.match(withAiOutputLanguage(source,'zh'),/outputLanguage=zh/);assert.equal(aiOutputPolicy('en').outputLanguage,'en');
 const original={content:[{type:'text' as const,text:'{"quote":"原文必须保留"}'}],structuredContent:{quote:'原文必须保留'}};const result=withAiLanguageResult(original,'en');assert.equal(result.content[0].text,original.content[0].text);assert.equal(result.structuredContent.quote,'原文必须保留');assert.equal(result.structuredContent.languagePolicy.outputLanguage,'en');assert.equal(original.content.length,1);
});
test('English full-reading cards localize generated headings while retaining verbatim evidence',()=>{
 const note=fullReadingNote('Summary',[{section:'Method',comment:'Evidence explanation',start:0,end:24,quote:'原文 quote stays unchanged.'}],'https://example.com/paper','en');assert.match(note,/## Source annotations/);assert.match(note,/Paper source/);assert.match(note,/原文 quote stays unchanged/);assert.doesNotMatch(note,/原文批注|论文来源/);
});
