import katex from 'katex';
import {Marked, Renderer, type TokenizerAndRendererExtension} from 'marked';

const math=(tex:string,displayMode=false)=>katex.renderToString(tex,{output:'htmlAndMathml',displayMode,trust:false,throwOnError:false,strict:'ignore',maxExpand:300,maxSize:10});
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const assetPattern=/!\[([^\]\n]*)\]\(flow-asset:([a-zA-Z0-9_-]+)([ \t]+(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))?\)/g;
export function noteAssetIds(md:string){return [...new Set([...md.matchAll(assetPattern)].map(m=>m[2]))];}
export function portableMarkdown(md:string,paths:Record<string,string>){
 return md.replace(assetPattern,(whole,alt:string,id:string,title:string)=>paths[id]?`![${alt}](${paths[id]}${title??''})`:whole);
}

// Tokenizers run inside Marked, so code fences and code spans retain literal LaTeX.
const formulas:TokenizerAndRendererExtension[]=[{
 name:'flowDisplayMath',level:'block',
 start(src){return src.match(/(?:^|\n) {0,3}(?:\$\$|\\\[)/)?.index;},
 tokenizer(src){
  const match=/^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/.exec(src);
  if(match)return {type:'flowDisplayMath',raw:match[0],text:(match[1]??match[2]).trim()};
 },
 renderer(token){return '<div class="flow-math">'+math(token.text,true)+'</div>\n';},
},{
 name:'flowInlineMath',level:'inline',
 start(src){return src.match(/\$|\\\(/)?.index;},
 tokenizer(src){
  const match=/^(?:\$((?:\\[^\n]|[^\\$\n])+?)\$(?![\d$])|\\\(([^\n]+?)\\\))/.exec(src);
  if(match)return {type:'flowInlineMath',raw:match[0],text:match[1]??match[2]};
 },
 renderer(token){return math(token.text);},
}];

function createMarkdown(resources:boolean){
 const base=new Renderer();
 return new Marked({gfm:true,breaks:true,async:false,extensions:formulas,renderer:{
  // Marked does not sanitize HTML. Preserve the old safe-HTML boundary explicitly.
  html({text}){return /^<\/?(?:sup|sub)>$/.test(text)?text:escape(text);},
  link({href,title,tokens}){
   const text=this.parser.parseInline(tokens);
   if(!resources||!/^(?:https?:\/\/|mailto:|#)/i.test(href))return text;
   return '<a href="'+escape(href)+'"'+(title?' title="'+escape(title)+'"':'')+' target="_blank" rel="noopener noreferrer">'+text+'</a>';
  },
  image({href,title,text}){
   if(!resources)return escape(text);
   const alt=' alt="'+escape(text)+'" loading="lazy"';
   if(/^flow-asset:[a-zA-Z0-9_-]+$/.test(href))return '<img data-asset="'+escape(href.slice(11))+'"'+alt+'>';
   if(!/^(?:https?:\/\/|\.\.?\/)/i.test(href))return escape(text);
   return '<img src="'+escape(href)+'"'+alt+(title?' title="'+escape(title)+'"':'')+' referrerpolicy="no-referrer">';
  },
  table(token){return '<div class="flow-table-wrap">'+base.table.call(this,token)+'</div>\n';},
 }});
}
const fullMarkdown=createMarkdown(true),thumbnailMarkdown=createMarkdown(false);
export function markdownHtml(md:string,options:{resources?:boolean}={}):string{
 return (options.resources===false?thumbnailMarkdown:fullMarkdown).parse(md,{async:false});
}
export function markdownInlineHtml(md:string):string{
 return thumbnailMarkdown.parseInline(md,{async:false});
}
