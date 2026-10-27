import test from 'node:test';
import assert from 'node:assert/strict';
import {assetPreviewHtml,assetImageUrl,mcpAssetImageUrl} from '../src/whiteboard/asset-preview.js';
test('asset previews render source formulas and Markdown without exposing frontmatter',()=>{
 assert.match(assetPreviewHtml({category:'formula',latex:'E=mc^2'}),/katex-html/);
 const html=assetPreviewHtml({category:'annotation',preview:'---\ntype: entity\n---\n**An observation** and $x^2$.'});
 assert.match(html,/<strong>An observation<\/strong>/);assert.match(html,/katex/);assert.doesNotMatch(html,/type: entity/);
 assert.equal(assetPreviewHtml({category:'figure',caption:'Figure 1'}),'');
 const processed=assetPreviewHtml({category:'formula',presentation:{type:'formula',latex:'E=mc^2',explanation:'Agent explanation',symbols:[{latex:'E',meaning:'Energy'}]}});assert.match(processed,/Agent explanation/);assert.match(processed,/Energy/);assert.match(processed,/katex-html/);
});
test('asset image previews accept actual raster output and reject missing or executable media',()=>{
 assert.equal(assetImageUrl({available:true,mimeType:'image/png',base64:'YWJj'}),'data:image/png;base64,YWJj');
 assert.equal(assetImageUrl({available:false}),undefined);
 assert.throws(()=>assetImageUrl({available:true,mimeType:'image/svg+xml',base64:'YWJj'}));
 assert.throws(()=>assetImageUrl({available:true,mimeType:'image/png',base64:'<script>'}));
});
test('source image preview reads the MCP image block instead of metadata-only structuredContent',()=>{
 assert.equal(mcpAssetImageUrl({structuredContent:{available:true,id:'saved-image'},content:[{type:'image',mimeType:'image/png',data:'YWJj'}]}),'data:image/png;base64,YWJj');
 assert.equal(mcpAssetImageUrl({structuredContent:{available:false},content:[{type:'text',text:'No source image'}]}),undefined);
 assert.throws(()=>mcpAssetImageUrl({structuredContent:{available:true},content:[]}));
});
