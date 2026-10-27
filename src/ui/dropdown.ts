import {dropdownPosition,type MenuAnchor} from '../shared/dropdown-layout.js';
type State = {anchor?:MenuAnchor;active?:HTMLDialogElement;trigger?:HTMLElement};
const states = new WeakMap<Document,State>();
function stateFor(doc:Document):State {
  let state=states.get(doc);if(state)return state;state={};states.set(doc,state);
  const close=()=>{if(state!.active?.open)state!.active.close();};
  doc.addEventListener('pointerdown',event=>{
    const node=event.target as Element|null;if(state!.active?.contains(node))return;
    close();const trigger=node?.closest<HTMLElement>('button,summary,select');
    if(trigger){const {left,right,bottom}=trigger.getBoundingClientRect();state!.anchor={left,right,bottom};state!.trigger=trigger;}
  },true);
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&state!.active?.open){event.preventDefault();close();state!.trigger?.focus();}},true);
  doc.defaultView?.addEventListener('resize',close);
  doc.defaultView?.addEventListener('blur',()=>{if(doc.activeElement?.tagName==='IFRAME')close();});
  return state;
}
export function rememberDropdownAnchor(doc:Document,anchor:MenuAnchor){if([anchor.left,anchor.right,anchor.bottom].every(Number.isFinite))stateFor(doc).anchor=anchor;}
export function initializeDropdowns(doc:Document){stateFor(doc);}
export function showDropdown(dialog:HTMLDialogElement,anchor?:MenuAnchor){
  const doc=dialog.ownerDocument,win=doc.defaultView!;const state=stateFor(doc);
  if(anchor)rememberDropdownAnchor(doc,anchor);
  if(state.active!==dialog&&state.active?.open)state.active.close();
  const position=dropdownPosition(state.anchor??{left:win.innerWidth-8,right:win.innerWidth-8,bottom:38},{width:win.innerWidth,height:win.innerHeight},'right');
  dialog.classList.add('artinfact-dropdown');
  Object.assign(dialog.style,{left:`${position.left}px`,top:`${position.top}px`,width:`${position.width}px`,maxHeight:`${position.maxHeight}px`});
  state.active=dialog;if(!dialog.open)dialog.show();
}
