type Rect={left:number;right:number;top:number;bottom:number};
export function tooltipPosition(anchor:Rect,size:{width:number;height:number},viewport:{width:number;height:number}){
 const margin=8,gap=10;
 const left=Math.max(margin,Math.min((anchor.left+anchor.right-size.width)/2,viewport.width-size.width-margin));
 const above=anchor.top-size.height-gap;
 const top=Math.max(margin,Math.min(above>=margin?above:anchor.bottom+gap,viewport.height-size.height-margin));
 return{left,top};
}
type Controller={show(control:HTMLElement):void;hide(control?:HTMLElement):void};
const controllers=new WeakMap<Document,Controller>();
function controller(doc:Document):Controller{
 const existing=controllers.get(doc);if(existing)return existing;
 const win=doc.defaultView!,tip=doc.createElement('div');tip.className='artinfact-control-tooltip';tip.id='artinfact-control-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;doc.body.append(tip);
 let active:HTMLElement|undefined,previousDescription:string|null=null;
 const hide=(control?:HTMLElement)=>{if(control&&control!==active)return;if(active){if(previousDescription===null)active.removeAttribute('aria-describedby');else active.setAttribute('aria-describedby',previousDescription);}active=undefined;tip.hidden=true;};
 const show=(control:HTMLElement)=>{hide();if(!control.isConnected||control.matches(':disabled'))return;const label=control.getAttribute('aria-label');if(!label)return;active=control;previousDescription=control.getAttribute('aria-describedby');control.setAttribute('aria-describedby',[previousDescription,tip.id].filter(Boolean).join(' '));tip.textContent=label;tip.hidden=false;const size=tip.getBoundingClientRect(),position=tooltipPosition(control.getBoundingClientRect(),size,{width:win.innerWidth,height:win.innerHeight});tip.style.left=position.left+'px';tip.style.top=position.top+'px';};
 doc.addEventListener('scroll',()=>hide(),true);doc.addEventListener('pointerdown',()=>hide(),true);doc.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});win.addEventListener('resize',()=>hide());win.addEventListener('blur',()=>hide());
 const value={show,hide};controllers.set(doc,value);return value;
}
export function bindControlTooltip(control:HTMLElement){
 control.addEventListener('pointerenter',()=>controller(control.ownerDocument).show(control));
 control.addEventListener('pointerleave',()=>controller(control.ownerDocument).hide(control));
 control.addEventListener('focus',()=>controller(control.ownerDocument).show(control));
 control.addEventListener('blur',()=>controller(control.ownerDocument).hide(control));
}
