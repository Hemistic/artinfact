import {Lexer,walkTokens} from 'marked';
export function markdownImageLinks(markdown:string){const links=new Set<string>();walkTokens(Lexer.lex(markdown),token=>{if(token.type==='image')links.add(token.href);});return [...links];}
export function rewriteMarkdownImages(markdown:string,links:Map<string,string>){
 if(!links.size)return markdown;const tokens=Lexer.lex(markdown),protectedRanges:{start:number;end:number}[]=[],images=new Map<string,string>();let cursor=0;
 for(const token of tokens){const start=markdown.indexOf(token.raw,cursor);if(start<0)continue;cursor=start+token.raw.length;if(token.type==='code')protectedRanges.push({start,end:cursor});}
 walkTokens(tokens,token=>{if(token.type==='codespan'){let from=0;while(from<markdown.length){const start=markdown.indexOf(token.raw,from);if(start<0)break;protectedRanges.push({start,end:start+token.raw.length});from=start+token.raw.length;}}else if(token.type==='image'&&links.has(token.href))images.set(token.raw,'!['+token.text.replace(/([\\\[\]])/g,'\\$1')+']('+links.get(token.href)+(token.title?' "'+token.title.replace(/"/g,'&quot;')+'"':'')+')');});
 const edits:{start:number;end:number;text:string}[]=[];for(const [raw,text]of images){let from=0;while(from<markdown.length){const start=markdown.indexOf(raw,from);if(start<0)break;const end=start+raw.length;if(!protectedRanges.some(r=>start<r.end&&end>r.start))edits.push({start,end,text});from=end;}}
 edits.sort((a,b)=>b.start-a.start);let boundary=markdown.length;for(const edit of edits){if(edit.end>boundary)continue;markdown=markdown.slice(0,edit.start)+edit.text+markdown.slice(edit.end);boundary=edit.start;}return markdown;
}
