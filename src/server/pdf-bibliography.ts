import {createHash} from 'node:crypto';
import {evidenceText,mineruEvidenceBlocks} from '../shared/pdf-evidence.js';
import {extractCitationNumbers} from '../shared/pdf-references.js';
import type {ReferenceLocation,BibliographyEntry} from '../shared/bibliography.js';
import type {Source} from '../whiteboard/whiteboard-domain.js';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const cache=new Map<string,{sources:Source[];size:number}>();let cachedChars=0;
const heading=/^\s{0,3}#{1,6}\s+(?:\d+[.\s]*)?(?:references|bibliography|参考文献|引用文献)\s*#*\s*$/im;
const canonical=(text:string)=>evidenceText(text.replace(/\[([^\]]+)\]\([^\n)]+\)/g,'$1')).replace(/[*_`]/g,'');
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function pdfReferenceSources(document:Source,rawBlocks:any[]):Source[]{
 if(document.standard===false||!document.text||!rawBlocks.length)return [];
 const text=document.text,key=hash(document.id+'\0'+text+'\0'+(document.structureRevision??JSON.stringify(rawBlocks)));
 const saved=cache.get(key);if(saved){cache.delete(key);cache.set(key,saved);return saved.sources;}
 const evidence=mineruEvidenceBlocks(rawBlocks).map(b=>({...b,canonical:canonical(b.text)}));
 const referenceBlocks=new Set<string>();let inReferences=false;
 for(const [index,b]of rawBlocks.entries()){if(/^(?:references|bibliography|参考文献|引用文献)$/i.test(String(b.text??'').trim())){inReferences=true;continue;}if(inReferences&&b.text_level)inReferences=false;if(inReferences||/^(?:ref_text|reference|bibliography)$/.test(b.type??''))referenceBlocks.add('b-'+index);}
 const start=heading.exec(text);let from=start?start.index+start[0].length:-1,to=text.length;
 if(from>=0){const next=/^\s{0,3}#{1,6}\s+\S/gm;next.lastIndex=from;const value=next.exec(text);if(value)to=value.index;}
 const entries:{raw:string;start?:number;end?:number}[]=[];
 const add=(value:string,offset?:number)=>{const body=value.trim();if(body.length<16||body.length>16000)return;const leading=value.indexOf(body);if(entries.some(e=>canonical(e.raw)===canonical(body)))return;entries.push({raw:body,...(offset===undefined?{}:{start:offset+leading,end:offset+leading+body.length})});};
 if(from>=0){
  const body=text.slice(from,to),numbered=[...body.matchAll(/^\s*(?:\[\d+\]|\d+[.)])\s+/gm)];
  if(numbered.length>=2)for(const [i,m]of numbered.entries())add(body.slice(m.index!,numbered[i+1]?.index??body.length),from+m.index!);
  else for(const p of body.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g))add(p[0],from+p.index!);
 }
 if(!entries.length){
  let inside=false;
  for(const b of rawBlocks){const body=typeof b.text==='string'?b.text:'';
   if(/^(?:references|bibliography|参考文献|引用文献)$/i.test(body.trim())){inside=true;continue;}
   if(inside&&b.text_level)inside=false;
   if(!/^(?:ref_text|reference|bibliography)$/.test(b.type??'')&&!inside)continue;
   const index=text.indexOf(body);add(body,index>=0?index:undefined);
  }
 }
 const location=(value:string,offset?:number,entry=false,citation?:string):ReferenceLocation=>{
  const needle=canonical(value),matches=evidence.filter(b=>(!referenceBlocks.size||referenceBlocks.has(b.id)===entry)&&(b.canonical.includes(needle)||needle.includes(b.canonical)));
  const containsCitation=(fragment:string)=>!citation||canonical(fragment).includes(canonical(citation));
  let quote=value.trim().slice(0,1800),quoteOffset=value.indexOf(quote);
  if(!containsCitation(quote)||!matches.some(b=>evidenceText(b.text).includes(evidenceText(quote)))){
   const pieces:{text:string;offset:number}[]=[];let cursor=0;
   for(const link of value.matchAll(/\[([^\]]+)\]\([^\n)]+\)/g)){pieces.push({text:value.slice(cursor,link.index),offset:cursor},{text:link[1],offset:link.index!+1});cursor=link.index!+link[0].length;}pieces.push({text:value.slice(cursor),offset:cursor});
   const fragments=pieces.flatMap(p=>[...p.text.matchAll(/[^*_`<>]+/g)].map(m=>({text:m[0].trim().slice(0,1800),offset:p.offset+m.index!+m[0].indexOf(m[0].trim())}))).sort((a,b)=>b.text.length-a.text.length);
   const best=fragments.find(p=>p.text.length>=12&&containsCitation(p.text)&&matches.some(b=>evidenceText(b.text).includes(evidenceText(p.text))));
   if(best){quote=best.text;quoteOffset=best.offset;}else quote='';
  }
  const verified=quote?matches.filter(b=>evidenceText(b.text).includes(evidenceText(quote))):[];
  return {quote,context:value.slice(0,8000),blockIds:verified.map(b=>b.id),...(verified.length===1?{pageIndex:verified[0].pageIndex}:{}),...(offset!==undefined&&quote?{start:offset+quoteOffset,end:offset+quoteOffset+quote.length}:{}),match:verified.length&&offset!==undefined?'matched':'unlocated'};
 };
 const bibliography=entries.slice(0,1000).map(entry=>{
  const number=/^(?:\[(\d+)\]|(\d+)[.)])\s+/.exec(entry.raw),body=entry.raw.replace(/^(?:\[\d+\]|\d+[.)])\s+/,''),year=/\b((?:19|20)\d{2}[a-z]?)\b/.exec(body)?.[1];
  const authorKey=body.split(',')[0].replace(/\b(?:19|20)\d{2}.*$/,'').split(/\s+/).map(w=>w.replace(/[.:;]+$/,'')).filter(w=>/^[\p{L}’'-]{2,}$/u.test(w)).at(-1);
  const doi=/\b10\.\d{4,9}\/[^\s<>]+/i.exec(body)?.[0].replace(/[.,;]+$/,'');
  const url=/\[[^\]]+\]\((https?:\/\/[^\n)]+)\)/i.exec(body)?.[1]??/https?:\/\/[^\s<>]+/i.exec(body)?.[0].replace(/[.,;]+$/,'');
  const title=[...body.matchAll(/\[([^\]]+)\]\([^\n)]+\)/g)].map(m=>m[1]).find(label=>!/^https?:|^10\.\d+\//i.test(label))?.replace(/[*_`]/g,'').trim();
  return {raw:entry.raw,title,number:number?.[1]??number?.[2],authorKey,year,doi,url,entry:location(entry.raw,entry.start,true),occurrences:[]} satisfies BibliographyEntry;
 });
 const byNumber=new Map(bibliography.filter(b=>b.number).map(b=>[b.number!,b]));
 const authorYears=new Map<string,BibliographyEntry[]>();for(const b of bibliography)if(b.authorKey&&b.year){const k=b.authorKey.toLowerCase()+':'+b.year;authorYears.set(k,[...(authorYears.get(k)??[]),b]);}
 const paragraph=(offset:number)=>{const begin=text.lastIndexOf('\n\n',offset)+2,end=text.indexOf('\n\n',offset);const a=Math.max(0,begin===1?0:begin),z=end<0?text.length:end;return {value:text.slice(a,z),offset:a};};
 const attach=(refs:BibliographyEntry[],offset:number,citation:string)=>{
  if(from>=0&&offset>=from&&offset<to)return;
  const citationEnd=offset+citation.length;let markerStart=offset,markerText=citation;
  if(!citation.startsWith('[')){if(text[offset-1]==='('&&!citation.includes('(')){markerStart--;markerText='('+markerText;}if(text[citationEnd]===')')markerText+=')';}
  const p=paragraph(offset),relative=offset-p.offset;let begin=0,end=p.value.length;
  for(const boundary of p.value.matchAll(/[.!?。！？](?:["”’])?(?=\s+[*_`]*[A-Z\p{Script=Han}]|$)/gu)){const stop=boundary.index!+boundary[0].length;if(relative<stop){end=stop;break;}begin=stop;}
  const loc=location(p.value.slice(begin,end),p.offset+begin,false,citation);loc.context=p.value.slice(0,8000);loc.marker={text:markerText,start:markerStart,end:markerStart+markerText.length};if(refs.length>1){loc.match='ambiguous';loc.candidateCount=refs.length;}
  for(const ref of refs)if(ref.occurrences.length<200&&!ref.occurrences.some(v=>v.context===loc.context&&v.start===loc.start))ref.occurrences.push({...loc});
 };
 for(const marker of text.matchAll(/\[\s*\d+\s*\]\s*[-–—]\s*\[\s*\d+\s*\]|\[\s*\d+(?:\s*[-–—,，;；]\s*\d+)*\s*\]/g))for(const number of extractCitationNumbers(marker[0])){const ref=byNumber.get(number);if(ref)attach([ref],marker.index!,marker[0]);}
 for(const refs of authorYears.values()){
  const ref=refs[0],pattern=new RegExp('(?<![\\p{L}])'+escape(ref.authorKey!)+'(?:\\s+et\\s+al\\.?)?(?:\\s*,\\s*|\\s*\\(\\s*|\\s+)'+escape(ref.year!)+'(?![\\da-z])','gu');
  for(const marker of text.matchAll(pattern))attach(refs,marker.index!,marker[0]);
 }
 const sources:Source[]=bibliography.map(b=>({id:'pdf-reference:'+hash(document.id+':'+(b.number??canonical(b.raw))),name:((b.number?'['+b.number+'] ':'')+(b.title??b.raw.replace(/\[([^\]]+)\]\([^\n)]+\)/g,'$1').slice(0,180))).slice(0,240),format:'pdf',category:'reference',path:document.path,documentId:document.id,parentSourceId:document.id,text:b.raw,page:b.entry.pageIndex===undefined?undefined:b.entry.pageIndex+1,bibliography:b}));
 const size=sources.reduce((n,s)=>n+(s.text?.length??0)+(s.bibliography?.entry.context.length??0)+(s.bibliography?.occurrences.reduce((a,l)=>a+l.context.length+l.quote.length,0)??0),0);
 if(size<=16*1024*1024){cache.set(key,{sources,size});cachedChars+=size;while(cache.size>24||cachedChars>16*1024*1024){const first=cache.keys().next().value!;cachedChars-=cache.get(first)!.size;cache.delete(first);}}return sources;
}
