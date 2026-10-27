import {PanelWidth} from './panel-width.js';

/** Keep the grip outside the scrolling/replaced contents of the inspector. */
export function resizePanel(panel:HTMLElement,options:{host:HTMLElement;container:HTMLElement;key:string;defaultWidth:number;label:string;onResize?:()=>void}){
 const {host,container,key,defaultWidth,label,onResize}=options;
 let saved=NaN;try{saved=Number(localStorage.getItem(key));}catch{}
 const size=new PanelWidth(saved,container.clientWidth,defaultWidth),grip=document.createElement('div');
 grip.className='wb-panel-resize';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.setAttribute('aria-label',label);
 grip.title='拖动调整侧栏宽度 · 双击恢复默认';document.body.append(grip);
 const persist=()=>{try{localStorage.setItem(key,String(size.preferred));}catch{}};
 function update(){
  size.resize(container.clientWidth);const width=size.width+'px',maxWidth=size.bounds.max+'px';if(panel.style.width!==width)panel.style.width=width;if(panel.style.maxWidth!==maxWidth)panel.style.maxWidth=maxWidth;
  const rect=panel.getBoundingClientRect(),hidden=panel.hidden||host.hidden||!host.isConnected||rect.width===0||rect.height===0;if(grip.hidden!==hidden)grip.hidden=hidden;
  grip.style.left=rect.left-5+'px';grip.style.top=rect.top+12+'px';grip.style.height=Math.max(0,rect.height-24)+'px';
  grip.setAttribute('aria-valuemin',String(size.bounds.min));grip.setAttribute('aria-valuemax',String(size.bounds.max));grip.setAttribute('aria-valuenow',String(size.width));
  onResize?.();
 }
 const cancel=()=>{size.cancel();grip.removeAttribute('data-dragging');update();};
 grip.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();size.begin(event.pointerId,event.clientX);grip.setPointerCapture(event.pointerId);grip.dataset.dragging='true';grip.focus({preventScroll:true});};
 grip.onpointermove=event=>{if(!size.active)return;event.stopPropagation();size.move(event.pointerId,event.clientX);update();};
 grip.onpointerup=event=>{event.stopPropagation();if(size.end(event.pointerId)===undefined)return;grip.removeAttribute('data-dragging');persist();update();};
 grip.onpointercancel=cancel;grip.onlostpointercapture=()=>{if(size.active)cancel();};
 grip.onclick=event=>event.stopPropagation();grip.ondblclick=event=>{event.preventDefault();event.stopPropagation();size.set(defaultWidth);persist();update();};
 grip.onkeydown=event=>{
  if(event.key==='Escape'&&size.active){event.preventDefault();event.stopPropagation();cancel();return;}
  const value=event.key==='ArrowLeft'?size.width+(event.shiftKey?40:16):event.key==='ArrowRight'?size.width-(event.shiftKey?40:16):event.key==='Home'?size.bounds.min:event.key==='End'?size.bounds.max:undefined;
  if(value===undefined)return;event.preventDefault();event.stopPropagation();size.set(value);persist();update();
 };
 const layout=new ResizeObserver(update);layout.observe(container);layout.observe(panel);
 const visibility=new MutationObserver(update);visibility.observe(panel,{attributes:true,attributeFilter:['hidden']});visibility.observe(host,{attributes:true,attributeFilter:['hidden']});
 update();return{cancel,dispose(){layout.disconnect();visibility.disconnect();grip.remove();}};
}
