type Camera={x:number;y:number;zoom:number};
export function imageFit(image:{width:number;height:number},stage:{width:number;height:number}):Camera{const zoom=Math.min(1,(stage.width-32)/Math.max(1,image.width),(stage.height-32)/Math.max(1,image.height));return{zoom,x:(stage.width-image.width*zoom)/2,y:(stage.height-image.height*zoom)/2};}
export function imageZoomAt(camera:Camera,value:number,p:{x:number;y:number}):Camera{const zoom=Math.max(.1,Math.min(12,value));return{zoom,x:p.x-(p.x-camera.x)/camera.zoom*zoom,y:p.y-(p.y-camera.y)/camera.zoom*zoom};}
export function openImageViewer(url:string,alt:string){
  const dialog=document.createElement('dialog');dialog.className='flow-image-dialog';dialog.setAttribute('aria-label','图片查看器');
  const toolbar=document.createElement('div');toolbar.className='flow-image-toolbar';const title=document.createElement('strong');title.textContent=alt;
  const stage=document.createElement('div');stage.className='flow-image-stage';stage.setAttribute('aria-label','图片画布：滚轮缩放，左键拖动');const img=document.createElement('img');img.src=url;img.alt=alt;stage.append(img);
  const percent=document.createElement('span');percent.className='flow-image-percent';const hint=document.createElement('small');hint.className='flow-image-hint';hint.textContent='滚轮缩放图片 · 左键拖动查看 · 双击适应窗口';
  let camera:Camera={x:0,y:0,zoom:1},fitted=true,drag:{pointer:number;x:number;y:number;left:number;top:number}|undefined;
  const apply=()=>{img.style.width=img.naturalWidth+'px';img.style.height=img.naturalHeight+'px';img.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;percent.textContent=Math.round(camera.zoom*100)+'%';};
  const fit=()=>{camera=imageFit({width:img.naturalWidth,height:img.naturalHeight},{width:stage.clientWidth,height:stage.clientHeight});fitted=true;apply();};
  const scale=(value:number,p={x:stage.clientWidth/2,y:stage.clientHeight/2})=>{camera=imageZoomAt(camera,value,p);fitted=false;apply();};
  const button=(text:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;};
  toolbar.append(title,button('−',()=>scale(camera.zoom/1.2)),percent,button('+',()=>scale(camera.zoom*1.2)),button('原图 100%',()=>scale(1)),button('适应窗口',fit),button('关闭',()=>dialog.close()));
  stage.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();const r=stage.getBoundingClientRect();scale(camera.zoom*Math.exp(-e.deltaY*.0015),{x:e.clientX-r.left,y:e.clientY-r.top});},{passive:false});
  stage.onpointerdown=e=>{if(e.button!==0)return;drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,left:camera.x,top:camera.y};stage.setPointerCapture(e.pointerId);stage.dataset.dragging='true';};
  stage.onpointermove=e=>{if(!drag||e.pointerId!==drag.pointer)return;camera.x=drag.left+e.clientX-drag.x;camera.y=drag.top+e.clientY-drag.y;fitted=false;apply();};
  stage.onpointerup=stage.onpointercancel=()=>{drag=undefined;stage.dataset.dragging='false';};stage.ondblclick=fit;
  const onResize=()=>{if(fitted)fit();};addEventListener('resize',onResize);dialog.onclose=()=>{removeEventListener('resize',onResize);dialog.remove();};
  dialog.append(toolbar,stage,hint);document.body.append(dialog);dialog.showModal();img.onload=fit;if(img.complete&&img.naturalWidth)fit();
}
