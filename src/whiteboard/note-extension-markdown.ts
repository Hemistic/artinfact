/*! Delimiter resolver adapted from micromark-extension-gfm-strikethrough.
(The MIT License)

Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/
import type {Extension,Token,Tokenizer,Resolver,State} from 'micromark-util-types';
import {classifyCharacter} from 'micromark-util-classify-character';
import {resolveAll} from 'micromark-util-resolve-all';
import {splice} from 'micromark-util-chunked';
import type {Processor} from 'unified';
import {unified} from 'unified';
import remarkParse from 'remark-parse';

// Delimiter resolution follows micromark's GFM strikethrough algorithm (MIT,
// Titus Wormer). Keeping it in the tokenizer preserves escapes and code spans.
function delimiter(name:string,marker:string):Extension{
 const code=marker.charCodeAt(0),temporary=(name+'Temporary') as Token['type'],sequence=(name+'Sequence') as Token['type'];
 const resolve:Resolver=(events,context)=>{
  for(let i=0;i<events.length;i++)if(events[i][0]==='enter'&&events[i][1].type===temporary&&events[i][1]._close){
   for(let j=i-1;j>=0;j--)if(events[j][0]==='exit'&&events[j][1].type===temporary&&events[j][1]._open){
    const open=events[j][1],close=events[i][1];open.type=close.type=sequence;
    const token:Token={type:name as Token['type'],start:{...open.start},end:{...close.end}};
    const middle=resolveAll(context.parser.constructs.insideSpan.null??[],events.slice(j+1,i),context);
    const next:typeof events=[['enter',token,context],['enter',open,context],['exit',open,context],...middle,['enter',close,context],['exit',close,context],['exit',token,context]];
    splice(events,j-1,i-j+3,next);i=j+next.length-2;break;
   }
  }
  for(const event of events)if(event[1].type===temporary)event[1].type='data';
  return events;
 };
 const tokenize:Tokenizer=function(effects,ok,nok){
  const previous=this.previous;let count=0;
  const more:State=current=>{if(current===code){if(count===marker.length)return nok(current);effects.consume(current);count++;return more;}
   if(count!==marker.length)return nok(current);const token=effects.exit(temporary),before=classifyCharacter(previous),after=classifyCharacter(current);
   token._open=after!==1;token._close=before!==1;return ok(current);
  };
  return current=>{if(previous===code&&this.events.at(-1)?.[1].type!=='characterEscape')return nok(current);effects.enter(temporary);return more(current);};
 };
 const construct={name,tokenize,resolveAll:resolve};
 return{text:{[code]:construct},insideSpan:{null:[construct]},attentionMarkers:{null:[code]}};
}

function wikiSyntax():Extension{
 const tokenize:Tokenizer=function(effects,ok,nok){let size=0,closing=false,escaped=false;
  const body:State=code=>{if(code===null||code<0||size++>500)return nok(code);if(escaped){escaped=false;effects.consume(code);return body;}if(code===92){escaped=true;effects.consume(code);return body;}if(code===93){effects.consume(code);if(closing){effects.exit('noteWiki' as Token['type']);return ok;}closing=true;return body;}closing=false;effects.consume(code);return body;};
  return code=>{effects.enter('noteWiki' as Token['type']);effects.consume(code);return code=>{if(code!==91)return nok(code);effects.consume(code);return body;};};
 };
 return{text:{91:{name:'noteWiki',tokenize}}};
}
export function splitWiki(value:string){
 const parts=value.split(/(?<!\\)\|/),unescape=(v:string)=>v.replace(/\\([\\|\[\]])/g,'$1').trim();
 return{target:unescape(parts.shift()??''),label:unescape(parts.join('|'))};
}
const linkParser=unified().use(remarkParse).use(remarkNoteExtensions);
const targetCache=new Map<string,string[]>();
export function noteWikiTargets(markdown:string){
 const cached=targetCache.get(markdown);if(cached)return cached;const targets:string[]=[];
 const walk=(node:any)=>{if(node.type==='noteWiki')targets.push(node.target);for(const child of node.children??[])walk(child);};walk(linkParser.parse(markdown));
 targetCache.set(markdown,targets);if(targetCache.size>100)targetCache.delete(targetCache.keys().next().value!);return targets;
}
const escapeWiki=(value:string)=>value.replace(/[\\|\[\]]/g,'\\$&');

// Unified extension APIs allow application-specific mdast node types.
export function remarkNoteExtensions(this:Processor){
 const data=this.data() as Record<string,any>;
 const append=(key:string,value:unknown)=>(data[key]??=[]).push(value);
 const marks=[['noteHighlight','=='],['noteSub','~'],['noteSup','^']] as const;
 for(const [name,marker]of marks){
  append('micromarkExtensions',delimiter(name,marker));
  append('fromMarkdownExtensions',{enter:{[name]:function(this:any,token:Token){this.enter({type:name,children:[]},token);}},exit:{[name]:function(this:any,token:Token){this.exit(token);}}});
  append('toMarkdownExtensions',{handlers:{[name]:(node:any,_:unknown,state:any,info:any)=>marker+state.containerPhrasing(node,{...info,before:marker,after:marker})+marker},unsafe:[{character:marker[0],inConstruct:'phrasing'}]});
 }
 append('micromarkExtensions',wikiSyntax());
 append('fromMarkdownExtensions',{enter:{noteWiki:function(this:any,token:Token){const value=this.sliceSerialize(token).slice(2,-2);this.enter({type:'noteWiki',...splitWiki(value)},token);}},exit:{noteWiki:function(this:any,token:Token){this.exit(token);}}});
 append('toMarkdownExtensions',{handlers:{noteWiki:(node:any)=>'[['+escapeWiki(node.target)+(node.label?'|'+escapeWiki(node.label):'')+']]',noteToc:()=>'[TOC]',noteMermaid:(node:any)=>{const fence='`'.repeat(Math.max(3,...Array.from(String(node.value).matchAll(/`+/g),m=>m[0].length+1)));return fence+'mermaid\n'+node.value+'\n'+fence;}},unsafe:[{character:'[',inConstruct:'phrasing'}]});
 return(tree:any,file:any)=>{
  const visit=(node:any)=>{if(!node.children)return;node.children=node.children.map((child:any)=>{
   if(child.type==='paragraph'&&child.children?.length===1&&child.children[0].type==='text'&&/^\[toc\]$/i.test(String(file.value).slice(child.position?.start.offset,child.position?.end.offset)))return{type:'noteToc'};
   if(child.type==='code'&&child.lang?.toLowerCase()==='mermaid')return{type:'noteMermaid',value:child.value};
   visit(child);return child;
  });};visit(tree);
 };
}
