import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownHtml} from '../src/whiteboard/flow-notes.js';
test('formula cards render inline and display LaTeX as local MathML without executing untrusted HTML',()=>{
 const html=markdownHtml('变量 $x^2$。\n\n$$\n\\frac{a}{b}=c\n$$');assert.match(html,/<math/);assert.match(html,/<mfrac>/);assert.doesNotMatch(html,/\$\$/);
 assert.doesNotMatch(markdownHtml('`$x$`'),/<math/);
 assert.doesNotMatch(markdownHtml('$\\href{javascript:alert(1)}{x}$'),/href="javascript:/);
 assert.match(html,/class="katex-html"/);assert.match(html,/class="katex-mathml"/);
 assert.match(markdownHtml('Paragraph\n$$\nx^2\n$$\n\nEnd'),/flow-math/);
 assert.match(markdownHtml('$$x+\\text{cost \\$}$$'),/katex-html/);
 assert.match(markdownHtml('Author<sup>1</sup>'),/<sup>1<\/sup>/);
 assert.doesNotMatch(markdownHtml('<sup onclick="alert(1)">1</sup>'),/<sup onclick/);
});
