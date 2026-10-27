import {markdownHtml} from './flow-notes.js';
type VisualNode={kind:string;title:string;note:string;sourceCard?:{category:string};workflow?:{result?:{imageAssetId?:string;markdown:string}}};
export type VisualSource={category?:string;caption?:string};
export type VisualCard={title:string;caption:string;images:string[];notes:string;kind?:'image'|'table'};
const imagePattern=/!\[[^\]\n]*\]\((?:flow-asset:[a-zA-Z0-9_-]+|https?:\/\/[^\s)]+)\)/g;
export function sourceImageNote(note:string,id:string,category:string){
 if(!['figure','table','formula'].includes(category)||[...note.matchAll(imagePattern)].length)return note;
 const image='![区域图片](flow-asset:'+id+')';
 return category==='formula'?note+'\n\n'+image:image+'\n\n'+note;
}
export function visualCard(node:VisualNode,source?:VisualSource):VisualCard|null{
 const category=source?.category??node.sourceCard?.category;
 if(category==='formula'||!(['figure','table'].includes(category??'')||node.kind==='image'||node.workflow?.result?.imageAssetId))return null;
 const note=node.workflow?.result?(node.workflow.result.imageAssetId?'![生成图片](flow-asset:'+node.workflow.result.imageAssetId+')\n\n':'')+node.workflow.result.markdown:node.note;
 const images=[...new Set([...note.matchAll(imagePattern)].map(m=>m[0]))];
 const body=note.replace(imagePattern,'').trim();
 const inferred=body.split(/\n\s*\n/).find(p=>/^\s*(?:Fig(?:ure)?\.?|Table|图|表)\s*(?:\d+|[IVXLCDM]+)(?![A-Za-z])/i.test(p));
 const caption=(source?.caption||inferred||(category==='figure'?'图题尚未提取':category==='table'?'表题尚未提取':node.title)).trim();
 const numbered=/^\s*((?:Fig(?:ure)?\.?|Table|图|表)\s*(?:\d+|[IVXLCDM]+))(?![A-Za-z\d])/i.exec(caption)?.[1];
 // Display-only separation: the persisted note, original table body and citations stay intact.
 const summary=images.length?body.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi,''):body;
 const notes=summary.split(caption).join('').split('\n').filter(line=>!(['figure','table'].includes(category??'')&&(/^\s*PDF\s*第\s*\d+\s*页\s*$/.test(line)||/^\s*正文已准备[，,]\s*可供\s*Agent\s*分析[。.]?\s*$/.test(line)))).join('\n').trim();
 const table=category==='table'||category!=='figure'&&/^\s*(?:Table|表)\s*(?:\d+|[IVXLCDM]+)(?![A-Za-z])/i.test(caption);
 return {kind:table?'table':'image',title:numbered??(table?'表格':'图片'),caption,images,notes};
}
export function visualCardHtml(card:VisualCard){
 return '<figure class="wb-visual-figure"><figcaption class="flow-markdown">'+(card.notes?'<div class="wb-visual-summary">'+markdownHtml(card.notes)+'</div>':'')+'<div class="wb-visual-caption">'+markdownHtml(card.caption)+'</div></figcaption>'+(card.images.length?card.images.map(md=>'<div class="wb-visual-image">'+markdownHtml(md)+'</div>').join(''):'<div class="wb-visual-missing">图片尚未加载</div>')+'</figure>';
}
export function visualResize(start:{width:number;imageHeight?:number;aspectRatio?:number;inset?:number},delta:{x:number;y:number},zoom:number){
 const scale=Number.isFinite(zoom)&&zoom>0?zoom:1;
 if(start.aspectRatio&&Number.isFinite(start.aspectRatio)&&start.aspectRatio>0){
  const ratio=start.aspectRatio,inset=start.inset??40,dx=delta.x/scale,dy=delta.y/scale*ratio;
  const width=Math.max(220,Math.min(1400,Math.round(start.width+(Math.abs(dx)>=Math.abs(dy)?dx:dy))));
  return {width,imageHeight:Math.max(120,Math.min(1600,Math.round((width-inset)/ratio)))};
 }
 return {width:Math.max(220,Math.min(1400,Math.round(start.width+delta.x/scale))),imageHeight:Math.max(32,Math.min(1600,Math.round((start.imageHeight??360)+delta.y/scale)))};
}
