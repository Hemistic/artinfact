import {anchoredMenuPosition,type MenuRect} from '../shared/anchored-menu.js';
type MenuWindow=Window&{ResizeObserver?:typeof ResizeObserver};
export function trackAnchoredMenu(win:Window,menu:HTMLElement,anchor:HTMLElement,onDismiss:()=>void){
 const source=anchor.ownerDocument.defaultView,frame=source?.frameElement as HTMLElement|null;let active=true,pending=0;
 const targets=[...new Set([win,source,win.visualViewport,source?.visualViewport].filter(Boolean))] as EventTarget[];
 function position(){
  pending=0;if(!active)return;if(!anchor.isConnected||!menu.isConnected){dispose();onDismiss();return;}
  const rect=anchor.getBoundingClientRect(),frameRect=frame?.getBoundingClientRect();let bounds:MenuRect={left:0,top:0,right:win.innerWidth,bottom:win.innerHeight},offsetX=0,offsetY=0,scaleX=1,scaleY=1;
  if(frame&&frameRect&&frameRect.width>0&&frameRect.height>0){
   scaleX=frame.offsetWidth?frameRect.width/frame.offsetWidth:1;scaleY=frame.offsetHeight?frameRect.height/frame.offsetHeight:1;offsetX=frameRect.left+frame.clientLeft*scaleX;offsetY=frameRect.top+frame.clientTop*scaleY;
   bounds={left:Math.max(0,offsetX),top:Math.max(0,offsetY),right:Math.min(win.innerWidth,offsetX+(frame.clientWidth||frameRect.width/scaleX)*scaleX),bottom:Math.min(win.innerHeight,offsetY+(frame.clientHeight||frameRect.height/scaleY)*scaleY)};
  }
  const target={left:offsetX+rect.left*scaleX,top:offsetY+rect.top*scaleY,right:offsetX+rect.right*scaleX,bottom:offsetY+rect.bottom*scaleY};
  const width=Math.min(248,Math.max(0,bounds.right-bounds.left-16));if(menu.style.width!==width+'px')menu.style.width=width+'px';
  const height=Math.max(menu.scrollHeight+Math.max(0,menu.offsetHeight-menu.clientHeight),menu.getBoundingClientRect().height),placed=anchoredMenuPosition(target,bounds,{width,height});
  if(!placed){dispose();onDismiss();return;}menu.dataset.placement=placed.placement;Object.assign(menu.style,{left:placed.left+'px',top:placed.top+'px',width:placed.width+'px',maxHeight:placed.maxHeight+'px',overflowY:'auto'});
 }
 function refresh(){if(active&&!pending)pending=win.requestAnimationFrame(position);}
 const Observer=(win as MenuWindow).ResizeObserver,observer=Observer?new Observer(refresh):undefined;
 for(const element of [menu,anchor,frame].filter(Boolean) as Element[])observer?.observe(element);
 for(const target of targets){target.addEventListener('scroll',refresh,true);target.addEventListener('resize',refresh);}
 function dispose(){if(!active)return;active=false;if(pending)win.cancelAnimationFrame(pending);pending=0;observer?.disconnect();for(const target of targets){target.removeEventListener('scroll',refresh,true);target.removeEventListener('resize',refresh);}}
 position();return {refresh,dispose};
}
