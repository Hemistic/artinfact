import {Lexer,walkTokens} from 'marked';
import type {BoardData,BoardNode} from './whiteboard-domain.js';
import {pageReference} from '../shared/pages-preview.js';

type Page={pageId:string;url:string;title:string;blocks:{kind:string;markdown:string}[]};
export type DocumentSource={id:string;name:string;category?:string;documentId?:string;page?:number;caption?:string;latex?:string};
export type DocumentSection={id:string;title:string;description?:string;nodes:BoardNode[];cyclic:boolean};
const heading=(s:string)=>s.replace(/[\r\n]/g,' ').replace(/([\\`*_{}\[\]<>#!])/g,'\\$1');
const linkText=(s:string)=>s.replace(/[\r\n]/g,' ').replace(/([\[\]\\])/g,'\\$1');
const spatial=(a:BoardNode,b:BoardNode)=>a.y-b.y||a.x-b.x||a.id.localeCompare(b.id);
const language={zh:{contents:'文档结构',unsectioned:'未分区卡片',empty:'此分区尚无卡片。',relations:'卡片关系',related:'关联',evidence:'原文证据',source:'来源',page:'PDF 第',pageEnd:'页',characters:'字符',pages:'引用 Pages',symbols:'公式符号',supplement:'补充笔记',cycle:'此分区包含循环连接，循环部分按画布位置排列。',references:'来源索引'},en:{contents:'Document outline',unsectioned:'Ungrouped cards',empty:'This section has no cards yet.',relations:'Card relationships',related:'Related',evidence:'Source evidence',source:'Source',page:'PDF page',pageEnd:'',characters:'characters',pages:'Referenced Pages',symbols:'Formula symbols',supplement:'Additional notes',cycle:'This section contains circular links; cyclic cards follow their canvas positions.',references:'Source index'}};

// Only execution/input edges prescribe reading order. Context links retain their
// stated meaning without inventing a causal or chronological order.
export function boardDocumentSections(board:BoardData):DocumentSection[]{
 const sections:DocumentSection[]=(board.board.groups??[]).filter(g=>!g.id.startsWith('source-')).map(g=>({id:g.id,title:g.title,description:g.description,nodes:board.board.nodes.filter(n=>n.groupId===g.id),cyclic:false}));
 const known=new Set(sections.map(s=>s.id)),other=board.board.nodes.filter(n=>!n.groupId||!known.has(n.groupId));
 sections.sort((a,b)=>{const ga=board.board.groups!.find(g=>g.id===a.id)!,gb=board.board.groups!.find(g=>g.id===b.id)!;return (ga.bounds?.y??Math.min(...a.nodes.map(n=>n.y),Infinity))-(gb.bounds?.y??Math.min(...b.nodes.map(n=>n.y),Infinity))||(ga.bounds?.x??Math.min(...a.nodes.map(n=>n.x),Infinity))-(gb.bounds?.x??Math.min(...b.nodes.map(n=>n.x),Infinity))||a.id.localeCompare(b.id);});
 if(other.length)sections.push({id:'',title:'',nodes:other,cyclic:false});
 for(const section of sections){
  const ids=new Set(section.nodes.map(n=>n.id)),incoming=new Map(section.nodes.map(n=>[n.id,0])),next=new Map<string,string[]>();
  for(const e of board.board.edges)if(e.kind!=='context'&&ids.has(e.source)&&ids.has(e.target)){incoming.set(e.target,incoming.get(e.target)!+1);const bucket=next.get(e.source)??[];bucket.push(e.target);next.set(e.source,bucket);}
  const nodes=new Map(section.nodes.map(n=>[n.id,n])),ready=section.nodes.filter(n=>!incoming.get(n.id)).sort(spatial),ordered:BoardNode[]=[];
  while(ready.length){const n=ready.shift()!;ordered.push(n);for(const id of next.get(n.id)??[]){incoming.set(id,incoming.get(id)!-1);if(!incoming.get(id)){ready.push(nodes.get(id)!);ready.sort(spatial);}}}
  const seen=new Set(ordered.map(n=>n.id));section.cyclic=seen.size!==section.nodes.length;section.nodes=[...ordered,...section.nodes.filter(n=>!seen.has(n.id)).sort(spatial)];
 }
 return sections;
}

function nestedMarkdown(markdown:string,title:string,depth:number){
 markdown=markdown.replace(/\r\n?/g,'\n');const tokens=Lexer.lex(markdown),first=tokens.find(t=>t.type!=='space'),duplicate=first?.type==='heading'&&first.depth===1&&first.text.replace(/\\([\W_])/g,'$1').trim()===title.trim()?first:undefined;
 const levels=tokens.filter(t=>t.type==='heading'&&t!==duplicate).map(t=>(t as {depth:number}).depth),shift=Math.max(0,depth+1-Math.min(...levels,depth+1)),edits:{start:number;end:number;text:string}[]=[];let cursor=0;
 // Lexer stores reference definitions separately. Edit only heading ranges,
 // keeping gaps, definitions, fenced examples and all other source bytes.
 for(const token of tokens){const start=markdown.indexOf(token.raw,cursor);if(start<0)continue;cursor=start+token.raw.length;if(token.type==='heading')edits.push({start,end:cursor,text:token===duplicate?'':'#'.repeat(Math.min(6,token.depth+shift))+' '+token.text+(token.raw.match(/\n*$/)?.[0]??'')});}
 for(const edit of edits.reverse())markdown=markdown.slice(0,edit.start)+edit.text+markdown.slice(edit.end);return markdown.trim();
}
function noteContent(node:BoardNode){
 let note=node.workflow?.result?.markdown??node.note;const p=node.presentation;
 if(p?.type==='formula'){
  const latex=p.latex.replace(/^\s*\$\$?|\$\$?\s*$/g,'').trim();
  if(![...note.matchAll(/\$\$([\s\S]*?)\$\$/g)].some(m=>m[1].replace(/\s/g,'')===latex.replace(/\s/g,'')))note='$$\n'+latex+'\n$$\n\n'+note;
  if(p.explanation&&!note.includes(p.explanation))note+='\n\n'+p.explanation;
  for(const s of p.symbols)if(!note.includes(s.meaning))note+='\n\n- $'+s.latex+'$：'+s.meaning;
 }else if(p?.type==='evidence')note=[p.statement,p.explanation].filter(text=>text&&!note.includes(text)).concat(note).join('\n\n');
 const asset=node.workflow?.result?.imageAssetId;if(asset&&!note.includes('flow-asset:'+asset))note+='\n\n!['+linkText(node.title)+'](flow-asset:'+asset+')';
 return note;
}
function highlightQuote(quote:string,highlights:string[]){
 const ranges:{start:number;end:number}[]=[];for(const text of highlights){let from=0;while(text&&from<quote.length){const start=quote.indexOf(text,from);if(start<0)break;ranges.push({start,end:start+text.length});from=start+text.length;}}
 ranges.sort((a,b)=>a.start-b.start||b.end-a.end);const merged:typeof ranges=[];for(const r of ranges){const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}
 for(const r of merged.reverse())quote=quote.slice(0,r.start)+'<mark>'+quote.slice(r.start,r.end)+'</mark>'+quote.slice(r.end);return quote;
}
export function boardDocument(board:BoardData,pages:Map<string,Page>=new Map(),options:{sources?:DocumentSource[];language?:'zh'|'en'}={}){
 const words=language[options.language??'zh'],sections=boardDocumentSections(board),nodes=sections.flatMap(s=>s.nodes),anchors=new Map(nodes.map((n,i)=>[n.id,'card-'+(i+1)])),sourceMap=new Map(options.sources?.map(s=>[s.id,s])??[]),parts=['# '+heading(board.title)];
 const sourceLabel=(id:string)=>{const s=sourceMap.get(id),parent=s?.documentId?sourceMap.get(s.documentId):undefined;return (parent?.name??s?.name??id)+(s?.page?' · '+words.page+' '+s.page+' '+words.pageEnd:'');};
 const outline=sections.map((s,i)=>({id:'section-'+(i+1),title:s.title||words.unsectioned,cardCount:s.nodes.length,cyclic:s.cyclic}));
 if(sections.length)parts.push('## '+words.contents+'\n\n'+outline.map((s,i)=>'- ['+linkText(s.title)+'](#'+s.id+')'+sections[i].nodes.map(n=>'\n  - ['+linkText(n.title)+'](#'+anchors.get(n.id)+')').join('')).join('\n'));
 for(const [index,section]of sections.entries()){
  parts.push('<a id="'+outline[index].id+'"></a>\n\n## '+heading(outline[index].title));if(section.description)parts.push(nestedMarkdown(section.description,section.title,2));if(section.cyclic)parts.push('> '+words.cycle);if(!section.nodes.length)parts.push(words.empty);
  for(const node of section.nodes){
   parts.push('<a id="'+anchors.get(node.id)+'"></a>\n\n### '+heading(node.title));
   const note=noteContent(node),page=pages.get(node.id),source=node.sourceId?sourceMap.get(node.sourceId):undefined;
   if(['figure','table'].includes(source?.category??'')){
    const image=/!\[[^\]\n]*\]\((?:flow-asset:[A-Za-z0-9_-]+|https?:\/\/[^\s)]+)\)/g,images=note.match(image)??[],body=note.replace(image,'').trim();parts.push(nestedMarkdown(body,node.title,3));if(source?.caption&&!body.includes(source.caption))parts.push(source.caption);parts.push(images.join('\n\n'));
   }else parts.push(nestedMarkdown(note,node.title,3));
   if(page){parts.push('#### '+words.pages+'\n\n['+linkText(page.title)+']('+pageReference(page.url).url+')');const original=page.blocks.filter(b=>b.kind==='markdown').map(b=>b.markdown).join('\n\n');if(original.trim()!==note.trim())parts.push(nestedMarkdown(original,page.title,4));}
   for(const [i,c]of (node.citations??[]).entries()){
    const quote=highlightQuote(c.quote,node.studyNote?.highlights.filter(h=>h.citation===i).map(h=>h.text)??[]);
    parts.push('#### '+words.evidence+((node.citations?.length??0)>1?' '+(i+1):'')+'\n\n> '+quote.replace(/\n/g,'\n> ')+'\n\n'+words.source+'：'+sourceLabel(c.sourceId)+' · '+words.characters+' '+c.start+'–'+c.end);
   }
   if(node.sourceId&&!node.citations?.some(c=>c.sourceId===node.sourceId))parts.push(words.source+'：'+sourceLabel(node.sourceId));
   if(node.sourceRefs?.length)parts.push(words.source+'：'+node.sourceRefs.map(linkText).join('、'));
  }
 }
 const byId=new Map(nodes.map(n=>[n.id,n])),relations=board.board.edges.flatMap(e=>{const a=byId.get(e.source),b=byId.get(e.target);return a&&b?['- ['+linkText(a.title)+'](#'+anchors.get(a.id)+') → ['+linkText(b.title)+'](#'+anchors.get(b.id)+') — '+linkText(e.label.trim()||words.related)]:[];});
 if(relations.length)parts.push('## '+words.relations+'\n\n'+relations.join('\n'));
 const refs=[...new Set(nodes.flatMap(n=>[...(n.sourceId?[n.sourceId]:[]),...(n.citations??[]).map(c=>c.sourceId)]))],labels=[...new Set(refs.map(sourceLabel))];if(labels.length)parts.push('## '+words.references+'\n\n'+labels.map(name=>'- '+linkText(name)).join('\n'));
 const markdown=parts.filter(p=>p?.trim()).join('\n\n')+'\n';
 return{markdown,outline,counts:{cards:nodes.length,sections:sections.filter(s=>s.id).length,relations:relations.length,citations:nodes.reduce((sum,n)=>sum+(n.citations?.length??0),0),pages:pages.size,images:documentAssetIds(markdown).length}};
}
export function boardMarkdown(board:BoardData,pages:Map<string,Page>=new Map(),options:{sources?:DocumentSource[];language?:'zh'|'en'}={}){return boardDocument(board,pages,options).markdown;}

export function documentAssetIds(markdown:string){const ids=new Set<string>();walkTokens(Lexer.lex(markdown),token=>{if(token.type==='image'){const match=/^flow-asset:([A-Za-z0-9_-]+)$/.exec(token.href);if(match)ids.add(match[1]);}});return [...ids];}
export function replaceDocumentAssets(markdown:string,paths:Map<string,string>){
 const replace=(text:string)=>text.replace(/(`+)[\s\S]*?\1|!\[([^\]\n]*)\]\(flow-asset:([A-Za-z0-9_-]+)([ \t]+(?:"[^"\n]*"|'[^'\n]*'))?\)/g,(whole,code,alt,id,title)=>code||!paths.has(id)?whole:'!['+alt+']('+paths.get(id)+(title??'')+')').replace(/(^ {0,3}\[[^\]\n]+\]:[ \t]*<?)flow-asset:([A-Za-z0-9_-]+)(>?)/gm,(whole,prefix,id,suffix)=>paths.has(id)?prefix+paths.get(id)+suffix:whole);
 let cursor=0;const output:string[]=[];for(const token of Lexer.lex(markdown)){const start=markdown.indexOf(token.raw,cursor);if(start<0)continue;output.push(replace(markdown.slice(cursor,start)),token.type==='code'?token.raw:replace(token.raw));cursor=start+token.raw.length;}output.push(replace(markdown.slice(cursor)));return output.join('');
}
