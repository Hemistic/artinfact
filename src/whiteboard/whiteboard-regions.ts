import type {Board,Operation} from './whiteboard-domain.js';
export type Region=NonNullable<Board['groups']>[number];
export type RegionBounds={x:number;y:number;width:number;height:number};
export const regionColors=[['#83b9a1','薄荷'],['#83a9cc','浅蓝'],['#b0a0cc','淡紫'],['#d5ad7c','暖杏'],['#ce9597','浅红'],['#a4acb7','灰蓝']] as const;
export function createRegionTools(root:HTMLElement,viewport:HTMLElement,scene:HTMLElement,hooks:{board:()=>Board|undefined;world:(x:number,y:number)=>{x:number;y:number};selected:()=>string[];prepare:()=>Promise<void>;patch:(ops:Operation[])=>Promise<unknown>;busy:(value:boolean)=>void;notice:(message:string)=>void;changed:()=>void}){
 const panel=document.createElement('section');panel.className='wb-region-tools';panel.hidden=true;panel.setAttribute('aria-label','白板工具');root.append(panel);
 let armed=false,drawing:{id:number;start:{x:number;y:number};end:{x:number;y:number};preview:HTMLElement}|undefined;
 const button=(text:string,action:()=>void|Promise<void>)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>{void Promise.resolve().then(action).catch(e=>hooks.notice(String(e)));};return b;};
 function hide(){panel.hidden=true;hooks.changed();}
 function stop(){armed=false;root.dataset.regionDrawing='false';drawing?.preview.remove();drawing=undefined;hooks.busy(false);hooks.changed();}
 function heading(title:string){panel.replaceChildren();const header=document.createElement('div');header.className='wb-region-tools-head';const name=document.createElement('strong');name.textContent=title;header.append(name,button('×',hide));panel.append(header);panel.hidden=false;hooks.changed();}
 function edit(group?:Region,ids=hooks.selected(),bounds?:RegionBounds){
  heading(group?'编辑分区':'新建分区');const title=document.createElement('input');title.value=group?.title??'研究分区';title.maxLength=240;title.placeholder='分区标题';title.setAttribute('aria-label','分区标题');
  let color=group?.color??regionColors[0][0];const palette=document.createElement('div');palette.className='wb-region-palette';
  const choose=(value:string)=>{color=value;for(const swatch of palette.querySelectorAll<HTMLButtonElement>('button'))swatch.setAttribute('aria-pressed',String(swatch.dataset.color===color));};
  for(const [value,name]of regionColors){const swatch=button(name,()=>choose(value));swatch.title=name;swatch.setAttribute('aria-label',name);swatch.dataset.color=value;swatch.style.setProperty('--swatch',value);palette.append(swatch);}choose(color);
  const opacity=document.createElement('input');opacity.type='range';opacity.min='4';opacity.max='30';opacity.value=String(Math.round((group?.opacity??.1)*100));opacity.setAttribute('aria-label','背景透明度');
  const label=document.createElement('label');label.textContent='背景浓淡';label.append(opacity);
  const save=button(group?'保存分区':'创建分区',async()=>{save.disabled=true;try{await hooks.prepare();const region:Region={...group,id:group?.id??crypto.randomUUID(),title:title.value.trim()||'研究分区',color,opacity:Number(opacity.value)/100,...(bounds?{bounds}:{})};const nodes=hooks.board()?.nodes.filter(n=>ids.includes(n.id))??[];await hooks.patch([{op:'put_group',group:region},...(!group?nodes.map(n=>({op:'put_node' as const,node:{...n,groupId:region.id}})):[])]);hide();hooks.notice('分区已保存 · Ctrl+Z 可撤销');}finally{save.disabled=false;}});save.className='flow-primary';panel.append(title,palette,label,save);
  if(group){const hint=document.createElement('small');hint.textContent='分区随卡片扩展；移出请用卡片菜单，不会因拖动位置自动退出。';panel.append(hint,button('删除分区 · 保留卡片',async()=>{await hooks.prepare();await hooks.patch([{op:'remove_group',id:group.id}]);hide();hooks.notice('已删除分区背景，卡片和连线保留 · Ctrl+Z 可恢复');}));}
  else if(ids.length){const hint=document.createElement('small');hint.textContent='仅添加背景，不移动卡片；拖动标题可移动整组。';panel.append(hint);}
 }
 async function toggle(){if(armed||drawing){stop();hide();return;}await hooks.prepare();hide();armed=true;root.dataset.regionDrawing='true';hooks.changed();hooks.notice('拖动绘制分区，可跨过卡片框选 · Esc 退出');}
 function bounds(start:{x:number;y:number},end:{x:number;y:number}):RegionBounds{return{x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};}
 viewport.addEventListener('pointerdown',e=>{if(!armed||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();const start=hooks.world(e.clientX,e.clientY),preview=document.createElement('div');preview.className='wb-region-draft';scene.append(preview);drawing={id:e.pointerId,start,end:start,preview};hooks.busy(true);viewport.setPointerCapture(e.pointerId);},true);
 viewport.addEventListener('pointermove',e=>{if(!drawing||drawing.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();drawing.end=hooks.world(e.clientX,e.clientY);const b=bounds(drawing.start,drawing.end);Object.assign(drawing.preview.style,{left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px'});},true);
 viewport.addEventListener('pointerup',e=>{if(!drawing||drawing.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();const current=drawing,raw=bounds(current.start,hooks.world(e.clientX,e.clientY));stop();if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);if(raw.width<12||raw.height<12){hooks.notice('区域太小，请重新绘制');return;}
  const nodes=hooks.board()?.nodes.filter(n=>{const x=n.x+(n.width??420)/2,y=n.y+(n.height??200)/2;return x>=raw.x&&x<=raw.x+raw.width&&y>=raw.y&&y<=raw.y+raw.height;})??[];
  const x=Math.min(raw.x,...nodes.map(n=>n.x-24)),y=Math.min(raw.y,...nodes.map(n=>n.y-56)),right=Math.max(raw.x+Math.max(120,raw.width),...nodes.map(n=>n.x+(n.width??420)+24)),bottom=Math.max(raw.y+Math.max(120,raw.height),...nodes.map(n=>n.y+(n.height??200)+24));edit(undefined,nodes.map(n=>n.id),{x,y,width:right-x,height:bottom-y});
 },true);
 viewport.addEventListener('pointercancel',()=>{if(drawing)stop();},true);
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&(armed||drawing||!panel.hidden)){e.preventDefault();e.stopImmediatePropagation();stop();hide();}},true);
 root.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target as Node)&&!(e.target as Element).closest('[data-region-tool],.wb-group-menu'))hide();});
 return{panel,edit,hide,cancel:stop,active:()=>armed||!!drawing,toggle};
}
