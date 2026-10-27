import {markdownHtml} from '../whiteboard/flow-notes.js';
import type {PageBlock} from './pages-preview.js';
// Card summaries are derived from the authorized snapshot, never substituted for it.
export function pagesExcerpt(blocks:PageBlock[]):string {
 const text=blocks.filter(b=>b.kind==='markdown').map(b=>b.markdown).join('\n\n').replace(/\r\n?/g,'\n');
 const lines:string[]=[];let length=0,nonempty=0;
 for(const line of text.split('\n')){if(nonempty>=8||length>=880)break;const part=line.slice(0,880-length);lines.push(part);length+=part.length+1;if(part.trim())nonempty++;}
 let result=lines.join('\n').trim();if((result.match(/^```/gm)?.length??0)%2)result+='\n```';return result;
}
export function pagesExcerptHtml(markdown:string):string {
 // Thumbnails do not load remote or local media and do not navigate nested links.
 return markdownHtml(markdown,{resources:false});
}
