import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownHtml, noteAssetIds, portableMarkdown } from '../src/whiteboard/flow-notes.js';

test('Milkdown image captions preserve the asset link for hydration and Markdown export',()=>{
 const markdown='![1.00](flow-asset:image-1 "图题")';assert.deepEqual(noteAssetIds(markdown),['image-1']);assert.equal(portableMarkdown(markdown,{'image-1':'assets/image-1.png'}),'![1.00](assets/image-1.png "图题")');
});
test('Markdown renders headings, emphasis, lists, blockquotes, code and image references', () => {
  const html=markdownHtml('# 判断\n\n**支持度**与*相关性*\n\n- 条件一\n- 条件二\n\n> 原文\n\n```ts\na < b\n```\n\n![架构](flow-asset:paper-crag-fig2)');
  for(const fragment of ['<h1>判断</h1>','<strong>支持度</strong>','<em>相关性</em>','<ul>','<blockquote>','a &lt; b','data-asset="paper-crag-fig2"']) assert.ok(html.includes(fragment),fragment);
});
test('raw HTML and unsafe link or image schemes cannot execute', () => {
  const html=markdownHtml('<script>alert(1)</script>\n\n[click](javascript:alert)\n\n![x](data:text/html,evil)\n\n![ok](flow-asset:safe)');
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('src="data:text/html'));
});
test('portable notes retain Markdown and rewrite only image references into attachments', () => {
  const md='我的分析\n![图](flow-asset:paper-one)\n![本地](flow-asset:local-two)\n`flow-asset:paper-one`';
  assert.deepEqual(noteAssetIds(md),['paper-one','local-two']);
  assert.equal(portableMarkdown(md,{'paper-one':'assets/paper-one.png','local-two':'assets/local-two.jpg'}),'我的分析\n![图](assets/paper-one.png)\n![本地](assets/local-two.jpg)\n`flow-asset:paper-one`');
});
