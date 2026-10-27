import type {BoardNode} from './whiteboard-domain.js';
import type {CardPresentation} from './card-presentation-schema.js';
import {markdownHtml} from './flow-notes.js';
export function cardBody(note:string){return note.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,'').trim();}
export function compactCard(node:BoardNode,source?:{category?:string;latex?:string}):CardPresentation|undefined{
 if(node.presentation)return node.presentation;
 if(source?.category==='formula'){
  const latex=source.latex??/^\s*\$\$([\s\S]*?)\$\$/.exec(node.note)?.[1]?.trim();
  if(latex)return {type:'formula',latex,explanation:'',symbols:[]};
 }
 if(node.kind==='evidence'||node.role==='evidence'){
  const statement=cardBody(node.note);if(statement)return {type:'evidence',statement,explanation:''};
 }
}
export function compactCardHtml(card:CardPresentation){
 if(card.type==='evidence')return '<div class="wb-evidence-statement">'+markdownHtml(card.statement)+'</div>'+(card.explanation?'<div class="wb-card-explanation">'+markdownHtml(card.explanation)+'</div>':'');
 const latex=card.latex.replace(/^\s*\$\$?|\$\$?\s*$/g,'').trim();
 return markdownHtml('$$\n'+latex+'\n$$')+(card.explanation?'<div class="wb-card-explanation">'+markdownHtml(card.explanation)+'</div>':'')+(card.symbols.length?'<dl class="wb-formula-symbols">'+card.symbols.map(symbol=>'<div><dt>'+markdownHtml('$'+symbol.latex+'$')+'</dt><dd>'+markdownHtml(symbol.meaning)+'</dd></div>').join('')+'</dl>':'');
}
