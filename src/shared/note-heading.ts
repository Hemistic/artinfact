import {Lexer,type Token,type Tokens} from 'marked';

function inlineText(tokens:Token[]):string{return tokens.map(token=>{
 if('tokens' in token&&token.tokens)return inlineText(token.tokens);
 if(token.type==='html')return '';
 return 'text' in token?String(token.text):token.raw;
}).join('').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,value:string)=>{const code=parseInt(value.startsWith('x')?value.slice(1):value,value.startsWith('x')?16:10);return code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,name:string)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name]!).replace(/\s+/g,' ').trim();}
function heading(markdown:string){let offset=0,first:{token:Tokens.Heading;offset:number}|undefined;
 for(const token of Lexer.lex(markdown)){const start=markdown.indexOf(token.raw,offset);if(start>=0)offset=start;if(token.type==='heading'){const entry={token:token as Tokens.Heading,offset};first??=entry;if(entry.token.depth===1)return entry;}offset+=token.raw.length;}return first;
}
export function synchronizeNoteHeading(title:string,markdown:string,previous?:{title:string;note:string}){
 markdown=markdown.replace(/\r\n?/g,'\n');const current=heading(markdown),renamed=!!previous&&title!==previous.title&&markdown===previous.note.replace(/\r\n?/g,'\n');
 const text=(renamed?title:current?inlineText(current.token.tokens):title).replace(/\s+/g,' ').trim()||title.trim();
 if(!current)return{title:text,markdown:'# '+text.replace(/([\\`*_{}\[\]<>#$!])/g,'\\$1')+'\n\n'+markdown};
 if(renamed||current.token.depth!==1){const body=renamed?text.replace(/([\\`*_{}\[\]<>#$!])/g,'\\$1'):current.token.text;
  const end=current.offset+current.token.raw.replace(/\n+$/,'').length;markdown=markdown.slice(0,current.offset)+'# '+body+markdown.slice(end);}
 return{title:text,markdown};
}
