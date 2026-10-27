import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownHtml} from '../src/whiteboard/flow-notes.js';
import {pagesExcerptHtml} from '../src/shared/pages-thumbnail.js';

test('Markdown handles nested lists, reference links, task lists and GFM tables',()=>{
 const html=markdownHtml('## **Research**\n\n- Parent\n  - Child with **bold *nested***\n\n- [x] Done\n- [ ] Pending\n\n| Name | Value |\n| :--- | ---: |\n| a\\|b | ~~old~~ |\n\n[paper][ref]\n\n[ref]: https://example.org/paper "Paper"');
 assert.match(html,/<li>(?:<p>)?Parent(?:<\/p>)?\s*<ul>/);
 assert.match(html,/<strong>bold <em>nested<\/em><\/strong>/);
 assert.match(html,/<input[^>]*checked[^>]*disabled/);
 assert.match(html,/<div class="flow-table-wrap"><table>/);
 assert.match(html,/<td[^>]*>a\|b<\/td>/);
 assert.match(html,/<del>old<\/del>/);
 assert.match(html,/<a href="https:\/\/example.org\/paper"/);
});

test('KaTeX handles inline, multiline display and aligned formulas without touching code',()=>{
 const html=markdownHtml('Inside **$x_i^2$**.\n\n$$\n\\begin{aligned}\na &= b+c \\\\\nd &= e\n\\end{aligned}\n$$\n\n~~~latex\n$x$ and $$y$$\n~~~\n\n`$z$`');
 assert.match(html,/<strong><span class="katex">/);
 assert.match(html,/class="flow-math"/);
 assert.match(html,/katex-display/);
 assert.match(html,/<mtable/);
 assert.match(html,/<code class="language-latex">\$x\$ and \$\$y\$\$/);
 assert.match(html,/<code>\$z\$<\/code>/);
 assert.doesNotMatch(html,/katex-error/);
 assert.doesNotMatch(markdownHtml('Price \\$5 and \\$10.'),/class="katex"/);
});

test('Markdown retains flow attachments and escaped image attributes',()=>{
 const html=markdownHtml('![local][asset]\n\n[asset]: flow-asset:figure-1\n\n![Remote](https://example.org/image.png "caption")');
 assert.match(html,/data-asset="figure-1"/);
 assert.match(html,/src="https:\/\/example.org\/image.png"/);
 assert.match(html,/referrerpolicy="no-referrer"/);
 assert.doesNotMatch(markdownHtml('![x](https://example.org/a.png "x\" onerror=evil")'),/<[^>]*\sonerror=/);
});

test('Markdown cannot emit executable HTML, unsafe protocols or trusted KaTeX commands',()=>{
 const html=markdownHtml('<img src=x onerror=evil>\n\n[bad](javascript:alert%281%29) [entity](jav&#x61;script:evil) ![bad](data:image/svg+xml,evil)\n\n$\\href{javascript:evil}{x}$\n\nAuthor<sup>1</sup>');
 assert.doesNotMatch(html,/<img|href="javascript:|src="data:|<[^>]*\sonerror=/);
 assert.match(html,/&lt;img/);
 assert.match(html,/<sup>1<\/sup>/);
});

test('Pages thumbnails flatten all resource syntax, including references and autolinks',()=>{
 const html=pagesExcerptHtml('**Note**\n\n![image][img] [paper][link] <https://example.org>\n\n[img]: https://example.org/image.png\n[link]: https://example.org\n\n$x^2$');
 assert.doesNotMatch(html,/<img|<a\s|data-asset=/);
 assert.match(html,/<strong>Note<\/strong>/);
 assert.match(html,/image/);assert.match(html,/paper/);assert.match(html,/class="katex"/);
});

test('KaTeX supports bracket delimiters, reports invalid formulas locally and stays isolated between renders',()=>{
 const html=markdownHtml('\\(x^2\\)\n\n\\[\n\\frac{1}{2}\n\\]\n\n$\\notARealCommand$');
 assert.match(html,/katex-display/);assert.match(html,/<mfrac>/);
 assert.doesNotThrow(()=>markdownHtml('$\\frac{$'));
 assert.doesNotMatch(markdownHtml('Unclosed $x\n\n```\n$$x$$\n```'),/class="katex"/);
 assert.match(markdownHtml('**Another render**'),/<strong>Another render<\/strong>/);
});
