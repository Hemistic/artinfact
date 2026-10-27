import {readFile,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative,isAbsolute,basename,extname} from 'node:path';
import {markdownImageLinks,rewriteMarkdownImages} from '../whiteboard/markdown-image-links.js';
import type {Source} from '../whiteboard/whiteboard-domain.js';
export type ExportImage={id:string;name:string;mimeType:string;base64:string};
export class ExportMedia{
 readonly assets=new Map<string,ExportImage>();private files=new Map<string,ExportImage>();
 constructor(private sources:Source[]){}
 private add(name:string,mimeType:string,bytes:Buffer){if(!bytes.length||bytes.length>20*1024*1024)throw Error('导出图片为空或超过 20 MB：'+name);const base64=bytes.toString('base64'),id='local-'+createHash('sha256').update(base64).digest('hex'),asset={id,name,mimeType,base64};this.assets.set(id,asset);return asset;}
 async markdown(markdown:string,source?:Source){
  const replacements=new Map<string,string>();for(const href of markdownImageLinks(markdown)){
   if(/^flow-asset:|^https?:\/\//i.test(href))continue;
   const data=/^data:(image\/(?:png|jpeg|webp|gif|avif|bmp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(href);if(data){const asset=this.add('embedded-image',data[1],Buffer.from(data[2],'base64'));replacements.set(href,'flow-asset:'+asset.id);continue;}
   if(/^[A-Za-z][A-Za-z0-9+.-]*:|^\/\//.test(href))continue;
   const parent=source?.documentId?this.sources.find(s=>s.id===source.documentId):undefined,origin=source?.markdownPath??parent?.markdownPath??(source?.format==='md'&&isAbsolute(source.path)?source.path:undefined);
   if(!origin)throw Error('导出图片缺少可定位来源：'+href);
   let decoded:string;try{decoded=decodeURIComponent(href.split(/[?#]/)[0]);}catch{throw Error('导出图片地址无效：'+href);}
   if(isAbsolute(decoded)||/^[A-Za-z]:|\\/.test(decoded))throw Error('导出图片必须使用来源内的相对路径：'+href);
   const root=await realpath(dirname(origin));let file:string;try{file=await realpath(resolve(root,decoded));}catch{throw Error('导出图片缺失：'+(source?.name??'')+' · '+href);}
   const rel=relative(root,file);if(rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw Error('导出图片超出来源目录：'+href);
   let asset=this.files.get(file);if(!asset){const mimeType=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.bmp':'image/bmp'} as Record<string,string>)[extname(file).toLowerCase()];if(!mimeType)throw Error('导出图片格式不支持：'+href);if((await stat(file)).size>20*1024*1024)throw Error('导出图片超过 20 MB：'+href);asset=this.add(basename(file),mimeType,await readFile(file));this.files.set(file,asset);}
   replacements.set(href,'flow-asset:'+asset.id);
  }
  return rewriteMarkdownImages(markdown,replacements);
 }
}
