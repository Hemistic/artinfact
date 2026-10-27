import {createHash} from 'node:crypto';
import type {Source} from '../whiteboard/whiteboard-domain.js';
import {sourceSegments} from '../whiteboard/source-cards.js';
import {pdfReferenceSources} from './pdf-bibliography.js';
const key=(text:string)=>createHash('sha256').update(text).digest('hex');
const text=(value:unknown):string=>typeof value==='string'?value:Array.isArray(value)?value.map(text).join('\n'):'';
export function pdfSourceItems(document:Source,annotations:{id:string;[key:string]:unknown}[],blocks:any[]=[]):Source[]{
 return annotations.filter(a=>a.projectOrigin!=='reference-contribution'||a.comment!==a.referenceContributionOriginalComment||typeof a.referenceStudyCardId!=='string'||!/^reference-study:[0-9a-f-]{36}$/.test(a.referenceStudyCardId)).map(a=>{
  const category:Source['category']=a.layoutKind==='figure'?'figure':a.layoutKind==='table'?'table':a.layoutKind==='equation'?'formula':a.aiInsightKind?'insight':'annotation';
  const label={figure:'图片',table:'表格',formula:'公式',insight:'洞察',annotation:'批注'}[category];
  const indices=Array.isArray(a.layoutBlockIndices)?a.layoutBlockIndices:[];
  const body=indices.flatMap(i=>typeof i==='number'&&blocks[i]?[...new Set([text(blocks[i].text),text(blocks[i].table_body),text(blocks[i].image_caption),text(blocks[i].table_caption)].filter(Boolean))]:[]).join('\n\n');
  const caption=['figure','table'].includes(category)?indices.map(i=>typeof i==='number'?text(blocks[i]?.[category==='figure'?'image_caption':'table_caption']):'').filter(Boolean).join('\n\n')||text(a.text)||text(a.comment):undefined;
  const comment=a.projectOrigin==='reference-contribution'&&a.comment===a.referenceContributionOriginalComment?text(a.referenceContributionMarkdown):text(a.comment);
  const content=[body,text(a.text),comment].filter(Boolean).filter((v,i,all)=>all.indexOf(v)===i).join('\n\n');
  const pageIndex=(a.position as {pageIndex?:number}|undefined)?.pageIndex;
  return {id:'pdf-item:'+key(document.id+':'+a.id),name:document.name+' · '+label+' '+(typeof pageIndex==='number'?'第 '+(pageIndex+1)+' 页':'')+' · '+(text(a.text)||text(a.comment)||a.id).slice(0,70),format:'pdf',path:document.path,documentId:document.id,annotationId:a.id,category,caption,page:typeof pageIndex==='number'?pageIndex+1:undefined,text:content||'（只有区域坐标，需读取原 PDF 图像，不可把空区域当作已识别正文。）'};
 });
}

type TreeNode={id:string;type:string;title?:string;text?:string;meta?:Record<string,any>;children?:TreeNode[]};
export function pdfPaperSources(document:Source,annotations:{id:string;[key:string]:unknown}[],blocks:any[]=[],tree?:{root:TreeNode}):Source[]{
 const doc:Source={...document,category:'document',documentId:document.id},items=pdfSourceItems(doc,annotations,blocks),sections:Source[]=[];
 const leaves:{node:TreeNode;owner:string}[]=[],sectionById=new Map<string,Source>(),annotationById=new Map(annotations.map(a=>[a.id,a]));
 const byBlock=new Map<number,string>(),byAnnotation=new Map<string,string>(),pageOwners=new Map<number,Set<string>>(),treeFormulas=new Map<number,string>();
 const sectionKey=(id:string)=>'pdf-section:'+key(doc.id+':'+id);
 const indices=(node:TreeNode):number[]=>[node.meta?.blockIndex,...(node.meta?.blockIndices??[]),...(node.meta?.layoutBlockIndices??[])].filter(i=>Number.isInteger(i));
 const walk=(node:TreeNode,parent=doc.id)=>{
  let owner=parent;
  if(node.type==='section'||node.type==='references'){
   owner=sectionKey(node.id);const title=node.title||'未命名章节';
   sections.push({id:owner,name:title.slice(0,240),format:'pdf',path:doc.path,documentId:doc.id,category:'section',parentSourceId:parent,text:'# '+title,page:Number.isInteger(node.meta?.pageIndex)?node.meta!.pageIndex+1:undefined});
  }
  if(node.type==='section'||node.type==='references')sectionById.set(owner,sections[sections.length-1]);
  for(const i of indices(node)){byBlock.set(i,owner);if(node.type==='equation'&&node.text)treeFormulas.set(i,node.text);}
  if(node.meta?.annotationId)byAnnotation.set(node.meta.annotationId,owner);
  if(Number.isInteger(node.meta?.pageIndex)){const page=node.meta!.pageIndex+1;if(!pageOwners.has(page))pageOwners.set(page,new Set());pageOwners.get(page)!.add(owner);}
  const section=sectionById.get(owner);if(section&&node.type!=='section'&&node.type!=='references'&&!['image','table','equation'].includes(node.type))section.text+='\n\n'+(node.text||'');
  if(['image','table','equation'].includes(node.type))leaves.push({node,owner});
  for(const child of node.children??[])walk(child,owner);
 };
 if(tree?.root)walk(tree.root);
 if(!sections.length&&doc.text){
  const trail:(Source&{depth:number})[]=[];
  for(const segment of sourceSegments(doc.text,Math.max(1,doc.text.length))){
   const level=segment.headingTrail.length;if(!level)continue;
   while(trail.length&&trail.at(-1)!.depth>=level)trail.pop();
   const source:Source={id:sectionKey('md-'+segment.start),name:segment.heading.slice(0,240),format:'pdf',path:doc.path,documentId:doc.id,category:'section',parentSourceId:trail.at(-1)?.id??doc.id,text:segment.text};
   // Heading depth stays local; no synthetic PDF page mapping is introduced.
   sections.push(source);trail.push({...source,depth:level});
   for(const [index,block]of blocks.entries()){const body=text(block.text);if(body&&segment.text.includes(body))byBlock.set(index,source.id);}
  }
 }
 for(const item of items){
  const annotation=annotationById.get(item.annotationId!)!,blockIndices=[...(Array.isArray(annotation.layoutBlockIndices)?annotation.layoutBlockIndices as number[]:[]),...(Number.isInteger(annotation.aiInsightSourceBlockIndex)?[annotation.aiInsightSourceBlockIndex as number]:[])];
  const owners=new Set(blockIndices.map(i=>byBlock.get(i)).filter(Boolean));
  item.parentSourceId=byAnnotation.get(item.annotationId!)??(owners.size===1?[...owners][0]:undefined);
  if(!item.parentSourceId&&item.page){const candidates=pageOwners.get(item.page);if(candidates?.size===1)item.parentSourceId=[...candidates][0];}
  item.parentSourceId??=doc.id;
  if(item.category==='formula')item.latex=blockIndices.map(i=>treeFormulas.get(i)||text(blocks[i]?.text)).find(Boolean)||text(annotation.comment)||text(annotation.text);
 }
 const itemByAnnotation=new Map<string,Source>(),itemByBlock=new Map<number,Source>(),itemOrder=new Map(items.map((item,index)=>[item,index]));for(const item of items){if(item.annotationId&&!itemByAnnotation.has(item.annotationId))itemByAnnotation.set(item.annotationId,item);const annotation=annotationById.get(item.annotationId!);for(const index of Array.isArray(annotation?.layoutBlockIndices)?annotation.layoutBlockIndices:[])if(typeof index==='number'&&!itemByBlock.has(index))itemByBlock.set(index,item);}
 for(const {node,owner}of leaves){const blockIds=indices(node),existing=[itemByAnnotation.get(node.meta?.annotationId),...blockIds.map(id=>itemByBlock.get(id))].filter((item):item is Source=>!!item).sort((a,b)=>itemOrder.get(a)!-itemOrder.get(b)!)[0];if(existing){if(existing.category==='formula'&&node.text)existing.latex=node.text;if(['figure','table'].includes(existing.category??'')&&text(node.meta?.caption))existing.caption=text(node.meta?.caption);continue;}const category=node.type==='image'?'figure':node.type==='table'?'table':'formula';items.push({id:'pdf-structure:'+key(doc.id+':'+node.id),name:(doc.name+' · '+(node.title||node.text||node.type)).slice(0,240),format:'pdf',path:doc.path,documentId:doc.id,category,parentSourceId:owner,text:[...new Set([node.text,node.meta?.html].filter(Boolean))].join('\n\n'),page:Number.isInteger(node.meta?.pageIndex)?node.meta!.pageIndex+1:undefined,...(category==='formula'?{latex:node.text}:{}),assetPath:node.meta?.imagePath,caption:category!=='formula'?text(node.meta?.caption)||node.text||node.title:undefined});}
 const all=[doc,...sections,...items];
 for(const section of sections){section.references=[];for(const item of items){
  if(!['figure','table','formula'].includes(item.category??''))continue;
  const a=annotationById.get(item.annotationId!),caption=text(a?.text)||text(a?.comment)||item.text||'',type=item.category==='figure'?'(?:Figure|Fig\\.?|图)':item.category==='table'?'(?:Table|表)':'(?:Equation|Eq\\.?|公式)';
  const number=new RegExp('^\\s*'+type+'\\s*[（(]?(\\d+|[IVXLCDM]+)(?![A-Za-z\\d])','i').exec(caption)?.[1];
  if(number&&new RegExp('(?:^|[^A-Za-z])'+type+'\\s*[（(]?'+number+'(?:[）)]|(?=[^A-Za-z\\d]|$))','i').test(section.text??''))section.references.push({sourceId:item.id,label:'正文引用 · '+caption.slice(0,70)});
 }}
 return [...all,...pdfReferenceSources(doc,blocks)];
}
