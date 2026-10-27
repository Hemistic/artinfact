import {sourceTree,sourceLabel,type AssetSource} from './source-tree.js';
import {sourceDragType} from './whiteboard-drop.js';
import {assetPreviewHtml} from './asset-preview.js';
export function createSourceTreeView(container:HTMLElement,options:{add:(id:string)=>void|Promise<void>;error:(error:string)=>void;image?:(id:string)=>Promise<string|undefined>}){
 const expanded=new Set<string>();
 const images=new Map<string,Promise<string|undefined>>();let observer:IntersectionObserver|undefined,byId=new Map<string,AssetSource>();
 function folder(key:string,label:string,count:number,searching:boolean){
  const details=document.createElement('details');details.className='wb-asset-folder';details.dataset.folderId=key;details.open=searching||expanded.has(key);
  const summary=document.createElement('summary'),name=document.createElement('span'),badge=document.createElement('small');name.textContent=label;name.title=label;badge.textContent=String(count);summary.append(name,badge);details.append(summary);
  // Search temporarily reveals ancestors without replacing the user's folder state.
  summary.addEventListener('click',()=>{if(!searching){if(details.open)expanded.delete(key);else expanded.add(key);}});
  return details;
 }
 function render(sources:AssetSource[],query=''){
  observer?.disconnect();byId=new Map(sources.map(source=>[source.id,source]));observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;observer?.unobserve(entry.target);const target=entry.target as HTMLElement,id=target.dataset.sourceId!,source=byId.get(id);if(!target.isConnected||!source)continue;if(!target.classList.contains('wb-asset-image')){target.innerHTML=assetPreviewHtml(source);target.querySelectorAll('a').forEach(link=>link.replaceWith(document.createTextNode(link.textContent??'')));target.querySelectorAll('img').forEach(image=>image.remove());if(!target.innerHTML)target.remove();continue;}if(!options.image)continue;let image=images.get(id);if(!image){image=options.image!(id);images.set(id,image);while(images.size>24)images.delete(images.keys().next().value!);}void image.then(url=>{if(!target.isConnected)return;if(url){const img=document.createElement('img');img.src=url;img.alt=target.dataset.caption||'图表预览';img.draggable=false;target.replaceChildren(img);}else target.textContent='暂无区域图片，请完成布局解析';}).catch(error=>{images.delete(id);if(target.isConnected)target.textContent='图片未加载，可重新打开资料重试';options.error(String(error));});}},{root:container,rootMargin:'100px'});
  container.replaceChildren();container.classList.add('wb-asset-tree');
  const searching=!!query.trim(),roots=sourceTree(sources,query);
  for(const root of roots){
   const paper=folder('paper:'+root.id,root.name,root.count,searching);paper.classList.add('wb-asset-paper');
   for(const group of root.folders){
    const category=folder('paper:'+root.id+':'+group.id,group.label,group.items.length,searching);
    for(const source of group.items){
     const item=document.createElement('button');item.type='button';item.className='wb-insert-source wb-asset-item';item.dataset.sourceId=source.id;item.draggable=true;
     const preview=document.createElement('div');preview.className='wb-asset-preview flow-markdown';preview.dataset.sourceId=source.id;preview.dataset.caption=source.caption??source.name;
     if(['figure','table'].includes(source.category??'')||source.category==='formula'&&!source.latex){preview.classList.add('wb-asset-image');preview.textContent='正在加载图表…';}
     item.append(preview);observer.observe(preview);
     const name=document.createElement('span');name.textContent=sourceLabel(source,root.name);item.title=name.textContent;
     const meta=document.createElement('small');meta.textContent=[source.page?'第 '+source.page+' 页':'',source.category==='insight'?'AI 洞察':source.basicReady?'原始资料卡片':'',source.added?'已添加 · 点击定位':!source.ready?'待解析 · 点击添加全文':'点击添加 · 或拖到画布'].filter(Boolean).join(' · ');item.append(name,meta);
     item.onclick=()=>{void Promise.resolve().then(()=>options.add(source.id)).catch(e=>options.error(String(e)));};
     item.ondragstart=event=>{event.dataTransfer?.setData(sourceDragType,source.id);if(event.dataTransfer)event.dataTransfer.effectAllowed='copy';};category.append(item);
    }
    if(!group.items.length){const empty=document.createElement('p');empty.className='wb-asset-empty';empty.textContent='暂无'+group.label;category.append(empty);}
    paper.append(category);
   }
   container.append(paper);
  }
  if(!roots.length){const empty=document.createElement('p');empty.className='wb-asset-empty';empty.textContent='没有匹配的资料';container.append(empty);}
 }
 return {render};
}
