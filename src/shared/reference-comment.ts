import {Lexer,type Token,type Tokens} from 'marked';

// Zotero's annotation editor consumes text with only b/i/sub/sup markers.
// It does not consume HTML paragraphs, headings or lists. Keep Markdown intact
// in referenceContributionMarkdown and adapt only the native comment field.
const literal=(text:string)=>text.replace(/[<>]/g,c=>c==='<'?'＜':'＞');
function inline(tokens:Token[],depth=0):string{
 if(depth>32)return tokens.map(t=>literal(t.raw)).join('');
 return tokens.map(token=>{switch(token.type){
  case 'strong':return '<b>'+inline((token as Tokens.Strong).tokens,depth+1)+'</b>';
  case 'em':return '<i>'+inline((token as Tokens.Em).tokens,depth+1)+'</i>';
  case 'link':return inline((token as Tokens.Link).tokens,depth+1);
  case 'del':return inline((token as Tokens.Del).tokens,depth+1);
  case 'text':{const text=token as Tokens.Text;return text.tokens?inline(text.tokens,depth+1):literal(text.text);}
  case 'escape':case 'codespan':case 'html':return literal(String(token.text??''));
  case 'image':return literal((token as Tokens.Image).text);
  case 'br':return '\n';
  default:return literal(token.raw);
 }}).join('');
}
function blocks(tokens:Token[],depth=0):string{
 if(depth>32)return tokens.map(t=>literal(t.raw)).join('');
 return tokens.map(token=>{switch(token.type){
  case 'heading':return '<b>'+inline((token as Tokens.Heading).tokens)+'</b>\n\n';
  case 'paragraph':return inline((token as Tokens.Paragraph).tokens)+'\n\n';
  case 'text':{const text=token as Tokens.Text;return (text.tokens?inline(text.tokens):literal(text.text))+'\n';}
  case 'list':{const list=token as Tokens.List;return list.items.map((item,i)=>{
   const prefix=item.task?(item.checked?'☑ ':'☐ '):list.ordered?String(Number(list.start)+i)+'. ':'• ';
   return prefix+blocks(item.tokens,depth+1).trim().replace(/\n/g,'\n   ');
  }).join('\n')+'\n\n';}
  case 'blockquote':return blocks((token as Tokens.Blockquote).tokens,depth+1).trim().split('\n').map(line=>'│ '+line).join('\n')+'\n\n';
  case 'table':{const table=token as Tokens.Table;return [table.header,...table.rows].map(row=>row.map(cell=>inline(cell.tokens)).join(' | ')).join('\n')+'\n\n';}
  case 'code':case 'html':return literal(String(token.text??''))+'\n\n';
  case 'hr':return '────────\n\n';
  case 'space':case 'def':return '';
  default:return inline([token])+'\n';
 }}).join('');
}
export function referenceNativeComment(title:string,markdown:string,source:string,language:'zh'|'en'='zh'){
 return '<b>'+literal(title.replace(/[\r\n]/g,' '))+'</b>\n\n'+blocks(Lexer.lex(markdown,{gfm:true})).trim()+'\n\n'+(language==='en'?'Source: ':'来源：')+literal(source);
}
