import {regionDropTarget,type RegionDropTarget,type RegionBox} from './region-layout.js';
export function createRegionDragFeedback(hooks:{regions:()=>RegionDropTarget[];group:(id:string)=>string|undefined;card:(id:string)=>HTMLElement|undefined;areas:()=>Map<string,HTMLElement>;invalidate:()=>void}){
 let drag:{id:string;regions:RegionDropTarget[];originalGroup?:string;target?:RegionDropTarget;box?:RegionBox}|undefined;
 function begin(id:string){clear();const card=hooks.card(id);if(card)delete card.dataset.regionJoined;drag={id,regions:hooks.regions(),originalGroup:hooks.group(id)};}
 function resolve(id:string,box:RegionBox,currentGroup?:string){return regionDropTarget(box,drag?.id===id?drag.regions:hooks.regions(),drag?.id===id?drag.originalGroup:currentGroup);}
 function paint(boxes:Map<string,RegionBox>){
  if(!drag)return;const box=boxes.get(drag.id);if(!box)return;drag.box=box;drag.target=resolve(drag.id,box,drag.originalGroup);
  for(const [id,area]of hooks.areas()){const active=id===drag.target?.id;area.dataset.dropTarget=String(active);let hint=area.querySelector<HTMLElement>('.wb-region-drop-hint');if(active){if(!hint){hint=document.createElement('small');hint.className='wb-region-drop-hint';area.querySelector('.wb-group-title')?.append(hint);}const text=drag.originalGroup===id?'分区内移动':'松开加入分区';if(hint.dataset.label!==text){hint.dataset.label=text;hint.textContent=text;}}else hint?.remove();}
  const card=hooks.card(drag.id);if(card){card.dataset.regionDrop=String(!!drag.target);if(drag.target)card.style.setProperty('--region-target-color',drag.target.color);}
 }
 function clear(id?:string,joined=false){
  if(id&&drag?.id!==id)return;const previous=drag;drag=undefined;
  for(const area of hooks.areas().values()){delete area.dataset.dropTarget;area.querySelector('.wb-region-drop-hint')?.remove();}
  if(previous){const card=hooks.card(previous.id);if(card){delete card.dataset.regionDrop;if(joined&&previous.target){card.dataset.regionJoined='true';setTimeout(()=>{delete card.dataset.regionJoined;},900);}}
   const area=joined&&previous.target?hooks.areas().get(previous.target.id):undefined;if(area){const stamp=String(performance.now());area.dataset.dropJoined='true';area.dataset.joinStamp=stamp;const hint=document.createElement('small');hint.className='wb-region-drop-hint';hint.textContent='已加入分区';area.querySelector('.wb-group-title')?.append(hint);setTimeout(()=>{if(area.dataset.joinStamp!==stamp)return;delete area.dataset.dropJoined;if(!drag)hint.remove();},900);}
  }
  hooks.invalidate();
 }
 return{begin,paint,resolve,clear,preview(groupId:string){return drag?.target?.id===groupId&&drag.box?{id:drag.id,box:drag.box}:undefined;}};
}
