import {z} from 'zod';
import type {BoardNode} from './whiteboard-domain.js';
import type {PreprocessInput} from './pdf-preprocessing.js';
export const BasicPdfRecord=z.object({sourceId:z.string(),revision:z.string(),updatedAt:z.string()});
export function basicCard(input:PreprocessInput,imageId?:string):BoardNode{
 const source=input.source,category=source.category??'document',raw=input.text??'',latex=source.latex?.replace(/^\s*\$\$?|\$\$?\s*$/g,'').trim();
 const caption=source.caption??source.name,image=imageId?'![原图](flow-asset:'+imageId+')':'';
 let note=['figure','table'].includes(category)?[image,caption].filter(Boolean).join('\n\n'):category==='formula'&&latex?'$$\n'+latex+'\n$$':raw.slice(0,120000);
 if(!note)note=category==='section'?'# '+source.name:'原文内容尚未提取';
 const quote=raw.trim()&&!raw.startsWith('（只有区域坐标')?raw.slice(0,Math.min(16000,raw.length)):'';
 // Raw materials have independent IDs so preparing them never replaces prior AI/user notes.
 return {id:'material-'+source.id,title:source.name.slice(0,240),note,sourceId:source.id,kind:'note',role:'source',x:0,y:0,width:420,height:200,autoHeight:true,createdBy:'import',updatedBy:'import',
  ...(category==='reference'?{referenceCard:true}:{}),...(latex?{presentation:{type:'formula',latex,explanation:'',symbols:[]}}:{}),
  ...(quote?{citations:[{sourceId:source.id,start:0,end:quote.length,quote}]}:{})};
}
