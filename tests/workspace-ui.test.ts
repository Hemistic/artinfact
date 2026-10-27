import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FolderOpen, X } from 'lucide';
import { PerspectiveBook } from '../src/ui/components/perspective-book.js';
import { uiIcons, iconMarkup } from '../src/ui/icons.js';
import {readFile} from 'node:fs/promises';

test('workspace books render the installed Spell component with its real 3D geometry', () => {
  const html = renderToStaticMarkup(createElement(PerspectiveBook, { size: 'sm', className: 'workspace-book-cover', children: 'Original title' }));
  assert.match(html, /width:150px/);
  assert.match(html, /perspective:900px/);
  assert.match(html, /transform-style:preserve-3d/);
  assert.match(html, /translateZ\(25px\)/);
  assert.match(html, /translateX\(122px\) rotateY\(90deg\)/);
  assert.match(html, /Original title/);
});

test('packaged Spell styles retain book proportions and positioning rather than collapsing to text height',async()=>{
 const css=await readFile('dist/ui/spell.css','utf8');
 for(const property of [/aspect-ratio:\s*49\s*\/\s*60/,/position:\s*absolute/,/perspective:\s*900px/,/transform-style:\s*preserve-3d/,/height:\s*100%/])assert.match(css,property);
 const html=await readFile('dist/ui/pdf.html','utf8');assert.ok(html.includes(css),'the native PDF workspace must embed the complete Spell CSS');
});

test('workspace and reader controls use the library icon geometry and accessible SVG markup', () => {
  assert.deepEqual(uiIcons.folder, FolderOpen);
  assert.deepEqual(uiIcons.close, X);
  for (const name of Object.keys(uiIcons) as (keyof typeof uiIcons)[]) {
    const svg = iconMarkup(name);
    assert.match(svg, /<svg /);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.ok(!/[⚙▤▱⌂×⋯]/.test(svg));
  }
});
