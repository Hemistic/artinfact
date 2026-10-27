import type {BoardNode} from './whiteboard-domain.js';
import {canvasIcon} from './canvas-icons.js';
import {visualResize} from './visual-card.js';
import {formulaCardLayout} from './formula-card-layout.js';

type Hooks={zoom():number;busy():boolean;read():BoardNode|undefined;save(values:Partial<BoardNode>):Promise<void>;dragging(value:boolean):void;measure():void;notice(error:unknown):void;};
type Drag={pointer:number;clientX:number;clientY:number;width:number;noteHeight:number;limit?:number;left:string;top:string;zoom:number;expanded:boolean;changed:boolean;heightChanged:boolean;autoHeight:boolean;imageHeight:number;aspectRatio?:number;inset:number};
type Size={width:number;noteHeight?:number;imageHeight?:number};
export const defaultNoteBodyHeight=520;

export function cardFrame(card:HTMLElement,body:HTMLElement,hooks:Hooks){
 const corner=document.createElement('button'),fold=document.createElement('button');
 corner.type=fold.type='button';corner.className='wb-card-corner';corner.append(canvasIcon('resize'));
 fold.className='wb-note-fold';fold.hidden=true;card.append(corner,fold);
 const media=card.dataset.visualType==='image'||card.dataset.visualType==='table',image=card.dataset.visualType==='image',formula=card.dataset.presentation==='formula',formulaLayout=formula?formulaCardLayout(card,body):undefined;
 corner.setAttribute('aria-label',image?'按比例缩放图片':media?'调整表格宽高':'调整笔记宽高');
 corner.title=image?'固定左上角，按比例缩放图片':media?'固定左上角，调整表格宽高':'固定左上角，调整笔记宽高；证据由你手动收起';
 let expanded=false,disposed=false,saving=false,deferred=false,layoutDirty=true,frame:number|undefined,start:Drag|undefined,pending:Size|undefined,lastGeometry='',legacyLimit:number|undefined,region:HTMLElement|undefined;

 function updateScrollEnd(){if(region?.dataset.mdFolded==='true')region.dataset.mdScrollEnd=String(region.scrollHeight-region.clientHeight-region.scrollTop<=3);}
 function textRegion(){const next=body.querySelector<HTMLElement>('.wb-study-upper')??(media?body.querySelector<HTMLElement>('.wb-visual-summary')??undefined:formula?body.querySelector<HTMLElement>('.flow-math')??undefined:body);
  if(region!==next){clearLimit();region?.removeEventListener('scroll',updateScrollEnd);region?.classList.remove('wb-md-fold-region');region=next;region?.classList.add('wb-md-fold-region');region?.addEventListener('scroll',updateScrollEnd,{passive:true});}return next;
 }
 function clearLimit(){if(!region)return;delete region.dataset.mdFolded;delete region.dataset.mdScrollEnd;region.style.removeProperty('max-height');}
 function flowHeight(){const style=getComputedStyle(card),number=(value:string)=>parseFloat(value)||0;let height=number(style.paddingTop)+number(style.paddingBottom)+number(style.borderTopWidth)+number(style.borderBottomWidth),count=0;
  for(const child of Array.from(card.children)){if(!(child instanceof HTMLElement))continue;const css=getComputedStyle(child);if(css.display==='none'||css.position==='absolute'||css.position==='fixed')continue;height+=child.offsetHeight+number(css.marginTop)+number(css.marginBottom);count++;}
  return height+Math.max(0,count-1)*number(style.rowGap);
 }
 function minimum(text:HTMLElement){return Math.min(text.scrollHeight,Math.max(56,(text.querySelector<HTMLElement>('h1,h2,h3')?.offsetHeight??0)+16));}
 function limitFor(node:BoardNode){
  if(node.autoHeight!==false)return formula?undefined:defaultNoteBodyHeight;if(node.noteHeight!==undefined)return node.noteHeight;
  const text=textRegion(),loaded=card.dataset.loading!=='true'&&(!node.studyNote||!!body.querySelector('.wb-study-upper .milkdown'));
  // Legacy outer heights are interpreted once, after rendering, without keeping their empty tail.
  if(legacyLimit===undefined&&text&&loaded){clearLimit();legacyLimit=Math.max(minimum(text),Math.min(text.scrollHeight,(node.height??240)-Math.max(0,flowHeight()-text.offsetHeight)));}
  return legacyLimit;
 }
 function placeFold(target:HTMLElement){const rect=target.getBoundingClientRect(),outer=card.getBoundingClientRect(),zoom=hooks.zoom()||1;fold.style.top=Math.max(0,(rect.bottom-outer.top)/zoom-(target.dataset.mdFolded==='true'?26:20))+'px';fold.style.bottom='auto';}
 function layout(limit:number|undefined){
  card.style.removeProperty('height');if(card.dataset.loading!=='true')card.style.removeProperty('min-height');
  card.dataset.noteLimited=String(!media&&limit!==undefined&&!expanded);card.dataset.noteOverflow='false';
  if(formula){clearLimit();fold.hidden=true;formulaLayout?.layout(limit);return;}
  const text=textRegion();if(!text){fold.hidden=true;return;}
  const natural=text.scrollHeight,available=limit===undefined||expanded?natural:Math.max(minimum(text),Math.min(natural,limit)),overflow=natural>available+3;
  // Only Markdown gets a viewport; disclosures and provenance keep their natural height.
  if(overflow){text.style.setProperty('max-height',Math.floor(available)+'px','important');text.dataset.mdFolded='true';card.dataset.noteOverflow='true';updateScrollEnd();}else clearLimit();
  fold.hidden=limit===undefined||!overflow&&!expanded;const direction=String(expanded);if(fold.dataset.expanded!==direction){fold.dataset.expanded=direction;fold.replaceChildren(canvasIcon(expanded?'chevronUp':'chevronDown'));}fold.title=expanded?'收起笔记正文':'展开笔记正文';fold.setAttribute('aria-label',fold.title);fold.setAttribute('aria-expanded',String(expanded));if(!fold.hidden)placeFold(text);
 }
 function refresh(){if(disposed||start||saving)return;if(hooks.busy()){deferred=true;return;}deferred=false;const node=hooks.read();if(!node)return;
  const geometry=JSON.stringify([node.width,node.noteHeight,node.imageHeight,node.autoHeight]);
  if(!layoutDirty&&geometry===lastGeometry)return;layoutDirty=false;
  if(lastGeometry&&geometry!==lastGeometry)expanded=false;lastGeometry=geometry;if(node.autoHeight!==false||node.noteHeight!==undefined)legacyLimit=undefined;
  card.dataset.mediaSized=String(node.imageHeight!==undefined);
  layout(limitFor(node));
 }
 function scheduleRefresh(){layoutDirty=true;if(frame!==undefined||disposed||start||saving)return;frame=requestAnimationFrame(()=>{frame=undefined;refresh();hooks.measure();});}
 function stop(){if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;pending=undefined;start=undefined;card.dataset.resizing='false';hooks.dragging(false);}
 const sizes=new ResizeObserver(scheduleRefresh);
 const observed=new Set<Element>();
 function observe(){const targets=new Set<Element>([card,body,...(body.firstElementChild?[body.firstElementChild]:[]),...Array.from(body.querySelectorAll('.wb-study-upper'))]);for(const target of observed)if(!targets.has(target)){sizes.unobserve(target);observed.delete(target);}for(const target of targets)if(!observed.has(target)){observed.add(target);sizes.observe(target);}}
 observe();const content=new MutationObserver(()=>{observe();scheduleRefresh();});content.observe(body,{childList:true,subtree:true,characterData:true});
 void formulaLayout?.ready.then(scheduleRefresh);
 body.addEventListener('toggle',scheduleRefresh,true);
 fold.onpointerdown=event=>event.stopPropagation();fold.onclick=event=>{event.stopPropagation();expanded=!expanded;layoutDirty=true;refresh();hooks.measure();};corner.onclick=event=>{event.preventDefault();event.stopPropagation();};
 corner.onpointerdown=event=>{if(event.button!==0||saving||hooks.busy())return;event.preventDefault();event.stopPropagation();const node=hooks.read();if(!node)return;
  if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;
  const img=body.querySelector<HTMLImageElement>('.wb-visual-image img'),inset=img?card.offsetWidth-img.offsetWidth:40;
  start={pointer:event.pointerId,clientX:event.clientX,clientY:event.clientY,width:card.offsetWidth,noteHeight:textRegion()?.offsetHeight??56,limit:limitFor(node),left:card.style.left,top:card.style.top,zoom:hooks.zoom()||1,expanded,changed:false,heightChanged:false,autoHeight:node.autoHeight!==false,imageHeight:img?.offsetHeight||node.imageHeight||360,aspectRatio:img?.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:img?.offsetWidth&&img.offsetHeight?img.offsetWidth/img.offsetHeight:undefined,inset};
  hooks.dragging(true);corner.setPointerCapture(event.pointerId);
 };
 function size(event:PointerEvent):Size{const drag=start!,delta={x:event.clientX-drag.clientX,y:event.clientY-drag.clientY};
  if(media)return visualResize({width:drag.width,imageHeight:drag.imageHeight,...(image?{aspectRatio:drag.aspectRatio??(drag.width-drag.inset)/drag.imageHeight}:{}),inset:drag.inset},delta,drag.zoom);
  return {width:Math.round(Math.max(220,Math.min(1400,drag.width+delta.x/drag.zoom))),noteHeight:drag.heightChanged?Math.round(Math.max(56,Math.min(4000,drag.noteHeight+delta.y/drag.zoom))):drag.limit};
 }
 function paint(value:Size,drag:Drag){card.style.width=value.width+'px';card.style.left=drag.left;card.style.top=drag.top;card.dataset.resizing='true';
  if(media){card.dataset.mediaSized='true';card.style.setProperty('--flow-image-height',value.imageHeight+'px');layout(defaultNoteBodyHeight);}
  else{if(drag.heightChanged)expanded=false;layout(value.noteHeight);}
 }
 corner.onpointermove=event=>{if(!start||event.pointerId!==start.pointer)return;event.stopPropagation();if(!start.changed&&Math.hypot(event.clientX-start.clientX,event.clientY-start.clientY)<3)return;
  start.changed=true;start.heightChanged||=Math.abs(event.clientY-start.clientY)>=3;pending=size(event);if(frame!==undefined)return;frame=requestAnimationFrame(()=>{frame=undefined;if(!pending||!start)return;paint(pending,start);hooks.measure();});
 };
 function restore(previous:Drag){expanded=previous.expanded;Object.assign(card.style,{width:previous.width+'px',left:previous.left,top:previous.top});card.dataset.mediaSized=String(hooks.read()?.imageHeight!==undefined);card.style.setProperty('--flow-image-height',(hooks.read()?.imageHeight??previous.imageHeight)+'px');layout(previous.limit);hooks.measure();}
 corner.onpointerup=event=>{if(!start||event.pointerId!==start.pointer)return;event.stopPropagation();const previous=start;if(!previous.changed){stop();return;}previous.heightChanged||=Math.abs(event.clientY-previous.clientY)>=3;const next=size(event);paint(next,previous);
  const values:Partial<BoardNode>={width:next.width};if(media)Object.assign(values,{imageHeight:next.imageHeight,autoHeight:true,height:Math.max(152,Math.min(4000,Math.ceil(card.offsetHeight)))});else if(previous.heightChanged||!previous.autoHeight&&!previous.expanded)Object.assign(values,{autoHeight:false,noteHeight:Math.max(56,Math.min(4000,Math.ceil(textRegion()?.offsetHeight??56))),height:Math.max(152,Math.min(4000,Math.ceil(card.offsetHeight)))});
  saving=true;stop();void hooks.save(values).then(()=>{saving=false;refresh();hooks.measure();}).catch(error=>{saving=false;restore(previous);hooks.notice(error);});
 };
 const cancel=()=>{if(!start)return;const previous=start;stop();restore(previous);};corner.onpointercancel=cancel;corner.onlostpointercapture=cancel;
 return{refresh,contentWidth:()=>formulaLayout?.width(),resume(){if(deferred)refresh();},dispose(){disposed=true;sizes.disconnect();content.disconnect();body.removeEventListener('toggle',scheduleRefresh,true);region?.removeEventListener('scroll',updateScrollEnd);clearLimit();if(frame!==undefined)cancelAnimationFrame(frame);}};
}
