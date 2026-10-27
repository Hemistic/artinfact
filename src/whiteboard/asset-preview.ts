import {markdownHtml} from './flow-notes.js';
import {cardBody} from './card-presentation.js';
import {compactCardHtml} from './card-presentation.js';
import type {CardPresentation} from './card-presentation-schema.js';
export function assetPreviewHtml(source:{category?:string;latex?:string;preview?:string;caption?:string;presentation?:CardPresentation}){
 if(source.presentation&&source.category!=='figure'&&source.category!=='table')return compactCardHtml(source.presentation);
 if(source.category==='formula'&&source.latex)return markdownHtml('$$\n'+source.latex+'\n$$');
 if(source.category==='figure'||source.category==='table')return '';
 return source.preview?markdownHtml(cardBody(source.preview)):'';
}
export function assetImageUrl(image:{available?:boolean;mimeType?:string;base64?:string}){
 if(!image.available)return;
 if(!/^image\/(png|jpeg|webp)$/.test(image.mimeType??'')||!image.base64||image.base64.length>28*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64))throw Error('图片预览格式无效');
 return 'data:'+image.mimeType+';base64,'+image.base64;
}
export function mcpAssetImageUrl(result:{structuredContent?:{available?:boolean;id?:string};content?:{type:string;mimeType?:string;data?:string;text?:string}[]}){
 if(!result.structuredContent?.available)return;
 const image=result.content?.find(item=>item.type==='image');
 if(!image)throw Error('图片附件缺失');
 return assetImageUrl({available:true,mimeType:image.mimeType,base64:image.data});
}
