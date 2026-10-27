import { zipSync, strToU8 } from 'fflate';
import { noteAssetIds, portableMarkdown } from './flow-notes.js';
import type { FlowBoard, FlowNode } from './editable-flow-model.js';
import {openImageViewer} from './image-viewer.js';
export type PaperFigure={id:string;name:string;paper:string;page:number;caption:string;dataUrl:string;sourcePath:string};
export type Media={id:string;name:string;blob:Blob};
const rasterTypes=new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp']);
export function validateImage(file:{type:string;size:number}) {
  if(!rasterTypes.has(file.type))throw new Error('请选择 PNG、JPG、WebP、GIF 等图片文件');
  if(file.size>20*1024*1024)throw new Error('图片超过 20 MB，请先缩小后再添加');
}
export function createMediaStore(figures:PaperFigure[]) {
  let database:Promise<IDBDatabase>|undefined;
  const urls=new Map<string,string>();
  const open=()=>database??=new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('artinfact-reading-flow-media',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('浏览器图片存储不可用，请检查本地存储权限'));
  });
  async function get(id:string):Promise<Media|undefined>{
    const figure=figures.find(f=>f.id===id);if(figure)return{id,name:figure.name,blob:await(await fetch(figure.dataUrl)).blob()};
    if(!id.startsWith('local-'))return;
    const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction('images').objectStore('images').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  }
  async function put(file:File):Promise<Media>{
    validateImage(file);const media={id:'local-'+crypto.randomUUID(),name:file.name,blob:file};const db=await open();
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(media);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('图片保存失败，请检查浏览器存储空间'));tx.onabort=()=>reject(new Error('图片未保存，请重试'));});return media;
  }
  async function url(id:string){
    if(urls.has(id))return urls.get(id);const media=await get(id);if(!media)return;
    const result=URL.createObjectURL(media.blob);urls.set(id,result);return result;
  }
  async function hydrate(container:HTMLElement){
    await Promise.all([...container.querySelectorAll<HTMLImageElement>('img[data-asset]')].map(async img=>{
      try{const value=await url(img.dataset.asset!);if(value){img.src=value;
        if(container.classList.contains('flow-note-preview')){const figure=figures.find(f=>f.id===img.dataset.asset),caption=document.createElement('small');caption.className='flow-image-source';caption.textContent=figure?figure.paper+' · '+figure.caption+' · PDF 第 '+figure.page+' 页':'本地图片 · '+img.alt;img.after(caption);if(figure){const source=document.createElement('button');source.type='button';source.className='flow-image-source-link';source.textContent='回查论文';source.onclick=()=>dispatchEvent(new CustomEvent('artinfact:read-research',{detail:figure.sourcePath}));caption.append(source);}}
        img.onclick=event=>{event.stopPropagation();openImageViewer(value,img.alt);};}else{img.replaceWith(document.createTextNode('图片不可用：'+img.alt));}}
      catch{img.replaceWith(document.createTextNode('图片读取失败：'+img.alt));}
    }));
  }
  async function exportZip(nodes:FlowNode[],board?:FlowBoard){
    const files:Record<string,Uint8Array>={},paths:Record<string,string>={};
    for(const id of [...new Set(nodes.flatMap(n=>noteAssetIds(n.note)))]){
      const media=await get(id);if(!media)throw new Error('图片缺失，无法完整导出：'+id);
      const ext=media.blob.type==='image/jpeg'?'jpg':media.blob.type.split('/')[1]||'png';const path='assets/'+id+'.'+ext;paths[id]=path;files[path]=new Uint8Array(await media.blob.arrayBuffer());
    }
    for(const n of nodes){
      const path='notes/'+n.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70)+'-'+n.id.slice(0,8)+'.md';
      const citations=noteAssetIds(n.note).flatMap(id=>{const f=figures.find(f=>f.id===id);return f?[`- ${f.paper} · ${f.caption} · PDF 第 ${f.page} 页`]:[];});
      files[path]=strToU8('# '+n.title+'\n\n'+portableMarkdown(n.note,paths)+(citations.length?'\n\n## 图表来源\n\n'+citations.join('\n'):'')+'\n');
    }
    if(board)files['flow.json']=strToU8(JSON.stringify({...board,nodes:board.nodes.map(n=>({...n,note:portableMarkdown(n.note,paths)}))},null,2));
    files['README.md']=strToU8('笔记保留 Markdown 原文；图片位于 assets。notes 内的图片路径已改为 ../assets，可直接在 Markdown 编辑器中打开。flow.json 保留流图的节点、坐标与连线。\n');
    for(const path of Object.keys(files).filter(p=>p.startsWith('notes/')))files[path]=strToU8(new TextDecoder().decode(files[path]).replace(/\]\(assets\//g,'](../assets/'));
    return new Blob([zipSync(files,{level:6}) as Uint8Array<ArrayBuffer>],{type:'application/zip'});
  }
  return {get,put,url,hydrate,exportZip};
}
