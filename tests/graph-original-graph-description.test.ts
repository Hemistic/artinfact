import test from 'node:test';
import assert from 'node:assert/strict';
import {graphDescription} from '../src/whiteboard/graph-description.js';
test('graph details use source paragraphs and keep metadata and citations separate',()=>{
 const page='---\nworkspaceId: secret\ntype: source\n---\n# Title\n\n## 阅读核心\n\n作者把检索判断纳入生成过程。\n\n证据支持与相关性分开评价。\n\n## 来源\n\n[[wiki/sources/paper|PDF]]';
 assert.equal(graphDescription(page),'作者把检索判断纳入生成过程。\n\n证据支持与相关性分开评价。');
 assert.equal(graphDescription('# Empty\n\n- [[source]]'),'');
});
test('graph details show readable evidence without internal URLs or document identifiers',()=>{
 const id='a'.repeat(64);
 const quote='Retrieval improves factual accuracy.';
 assert.equal(graphDescription(`# Concept\n\n> ${quote}\n\n[PDF 原句](artinfact-pdf://${id}/b-0?quote=${encodeURIComponent(quote)})`),quote);
 assert.equal(graphDescription('# Concept\n\n[PDF 原句](artinfact-pdf://broken/b-0?quote=%ZZ)'),'');
});
