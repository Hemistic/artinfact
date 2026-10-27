import type {BoardNode} from './whiteboard-domain.js';
import {compactCard} from './card-presentation.js';
import {markdownHtml,markdownInlineHtml} from './flow-notes.js';
type Source={category?:string;latex?:string};
function heading(node:BoardNode,source?:Source){
 const card=compactCard(node,source);
 // Generated formula titles can contain truncated TeX; the complete formula belongs below the title.
 return card?.type==='formula'?node.title.split(/\\|\$/)[0].replace(/[\s·:：]+$/,'')||'公式':node.title;
}
export function inspectorHeadingHtml(node:BoardNode,source?:Source){return markdownInlineHtml(heading(node,source));}
export function inspectorRelationHtml(node:BoardNode,label:string,suggested=false,source?:Source){
 const card=compactCard(node,source);
 const title='<span class="wb-relation-title">'+markdownInlineHtml((suggested?'Agent 建议 · ':'')+label+' · '+heading(node,source))+'</span>';
 if(card?.type!=='formula')return title;
 const latex=card.latex.replace(/^\s*\$\$?|\$\$?\s*$/g,'').trim();
 return title+'<span class="wb-relation-formula flow-markdown">'+markdownHtml('$$\n'+latex+'\n$$',{resources:false})+'</span>';
}
