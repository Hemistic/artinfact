export type EvidenceBlock={id:string;pageIndex:number;text:string;bbox:number[];outsideBboxText?:string};
export type EvidenceDocument={documentId:string;title:string;jsonHash:string;markdown:string;blocks:EvidenceBlock[]};
export type PdfEvidence={documentId:string;title:string;blockId:string;pageIndex:number;quote:string;jsonHash:string};
export type PdfEvidencePosition={pageIndex:number;rects:number[][]};
export const evidenceText=(text:string)=>text.replace(/<\/?(?:strong|b|u|em|i|sup|sub|span|p|br|table|thead|tbody|tr|th|td)\b[^>]*>/gi,'').normalize('NFKC').replace(/\u00ad/g,'').replace(/\s+/gu,'');
export const evidenceLink=(documentId:string,blockId:string,quote:string)=>`[PDF 原句](artinfact-pdf://${documentId}/${blockId}?quote=${encodeURIComponent(quote).replace(/\(/g,'%28').replace(/\)/g,'%29')})`;

// A graph description is not evidence. Only verbatim source excerpts may locate a sentence.
export function evidenceCandidates(markdown:string,documents:EvidenceDocument[]):PdfEvidence[]{
 const result=new Map<string,PdfEvidence>();
 const add=(quote:string,documentId?:string,blockId?:string)=>{
  quote=quote.trim();const needle=evidenceText(quote);if(needle.length<12||quote.length>2000)return;
  for(const doc of documents){if(documentId&&doc.documentId!==documentId||!evidenceText(doc.markdown).includes(needle))continue;
   for(const block of doc.blocks){if(blockId&&block.id!==blockId||!evidenceText(block.text).includes(needle))continue;
    const value={documentId:doc.documentId,title:doc.title,blockId:block.id,pageIndex:block.pageIndex,quote,jsonHash:doc.jsonHash};
    result.set(JSON.stringify([value.documentId,value.blockId,needle]),value);
   }
  }
 };
 const anchors=[...markdown.matchAll(/artinfact-pdf:\/\/([a-f0-9]{64})\/(b-\d+)\?quote=/g)];
 for(const anchor of anchors){
  // encodeURIComponent leaves parentheses intact; preserve complete legacy scientific quotes.
  let end=anchor.index!+anchor[0].length,depth=0;
  for(;end<markdown.length;end++){const c=markdown[end];if(/[\s<>]/.test(c))break;if(c==='(')depth++;else if(c===')'){if(!depth)break;depth--;}}
  if(depth)continue;
  try{add(decodeURIComponent(markdown.slice(anchor.index!+anchor[0].length,end)),anchor[1],anchor[2]);}catch{/* Invalid links have no locatable evidence. */}
 }
 if(anchors.length)return [...result.values()].slice(0,40);
 let quoted:string[]=[],hasQuote=false;const flush=()=>{if(quoted.length){
  const excerpt=quoted.join('\n');add(excerpt);
  // A source-card citation may contain table HTML and several captions. Locate its verified sentences separately.
  for(const paragraph of excerpt.split(/\n\s*\n/))for(const sentence of paragraph.match(/[^.!?。！？\n]+[.!?。！？](?:["”’])?/gu)??[])add(sentence);
 }quoted=[];};
 for(const line of markdown.split(/\r?\n/)){if(/^\s*>/.test(line)){hasQuote=true;quoted.push(line.replace(/^\s*>\s?/,''));}else flush();}flush();
 if(hasQuote)return [...result.values()].slice(0,40);
 // Older Wiki pages often keep unquoted English source sentences next to translated analysis.
 for(const paragraph of markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').split(/\n\s*\n/)){
  if(/^\s*[>#`]|artinfact-pdf:\/\//.test(paragraph))continue;
  for(const sentence of paragraph.match(/[^.!?。！？\n]+[.!?。！？](?:["”’])?/gu)??[])add(sentence.replace(/^\s*[-*]\s+/,''));
 }
 return [...result.values()].slice(0,40);
}

export function mineruEvidenceBlocks(raw:any):EvidenceBlock[]{
 const entries:any[]=Array.isArray(raw)?raw:Array.isArray(raw?.content_list)?raw.content_list:[];
 if(!entries.length)for(const [pageIndex,page] of (raw?.pdf_info??raw?.pages??[]).entries())for(const block of page.preproc_blocks??page.blocks??[])entries.push({...block,page_idx:page.page_idx??pageIndex});
 const text=(v:any):string=>typeof v==='string'?v:Array.isArray(v)?v.map(text).join(' '):v&&typeof v==='object'?text(v.text??v.table_body??v.content??v.lines??v.spans??''):'';
 return entries.flatMap((v,i)=>{const pageIndex=v.page_idx??v.pageIndex,bbox=v.bbox,body=text(v);
  // MinerU table/image boxes cover the asset, while captions and footnotes can sit outside it.
  const outsideBboxText=[v.table_caption,v.table_footnote,v.image_caption,v.image_footnote].map(text).filter(Boolean).join('\n\n');
  const content=[...new Set([body,outsideBboxText].filter(Boolean))].join('\n\n');
  return Number.isInteger(pageIndex)&&pageIndex>=0&&Array.isArray(bbox)&&bbox.length===4&&bbox.every(Number.isFinite)&&bbox[2]>bbox[0]&&bbox[3]>bbox[1]&&content&&!/equation|header|footer/.test(v.type??'')&&(!/image/.test(v.type??'')||outsideBboxText)?[{id:'b-'+i,pageIndex,text:content,bbox,...(outsideBboxText?{outsideBboxText}:{})}]:[];
 });
}
