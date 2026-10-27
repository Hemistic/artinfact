import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pagesThumbnail} from '../src/shared/pages-preview.js';
import {pagesExcerptHtml} from '../src/shared/pages-thumbnail.js';
test('Pages thumbnails use cloud title and bounded ordinary Markdown, excluding instruction blocks and active media',()=>{
 const state:any={version:1,name:'local.md',localChanged:false,cache:{pageId:'page_'+'a'.repeat(32),url:'https://chatgpt.com/space/page_'+'a'.repeat(32),title:'Cloud title',syncedAt:'2026-10-06',blocks:[{kind:'agent_instructions',markdown:'PRIVATE INSTRUCTIONS'},{kind:'markdown',markdown:'# Heading\n\n**Evidence** and `code`\n\n- First\n- Second\n\n'+ 'tail '.repeat(900)}]}};
 const card=pagesThumbnail(state)!;assert.equal(card.title,'Cloud title');assert.ok(card.excerpt!.length<=900);assert.ok(!card.excerpt!.includes('PRIVATE INSTRUCTIONS'));assert.match(pagesExcerptHtml(card.excerpt!),/<strong>Evidence<\/strong>/);
 const html=pagesExcerptHtml('![secret](https://example.com/a.png)\n\n[x](https://example.com)\n<script>alert(1)</script>');assert.ok(!/<img|<a |<script/.test(html));assert.match(html,/&lt;script/);
 assert.equal(pagesThumbnail({...state,cache:undefined}),undefined);
});
